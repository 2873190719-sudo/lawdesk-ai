# -*- coding: utf-8 -*-
"""LawDesk AI - 律师个人智能业务管理工作台 / 本地服务。

零第三方依赖：Python 标准库 http.server + sqlite3。
所有业务数据真实写入 data/lawdesk.db，附件真实写入 data/uploads/。
"""
import os, sys, json, re, io, csv, shutil, zipfile, hashlib, secrets, uuid
import sqlite3, urllib.request, urllib.error, mimetypes, traceback
from datetime import date, datetime, timedelta
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote, quote

import schema as S

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "data", "lawdesk.db")
UPLOAD_DIR = os.path.join(ROOT, "data", "uploads")
BACKUP_DIR = os.path.join(ROOT, "data", "backups")
STATIC_DIR = os.path.join(ROOT, "static")
for d in (os.path.dirname(DB_PATH), UPLOAD_DIR, BACKUP_DIR):
    os.makedirs(d, exist_ok=True)

TODAY = lambda: date.today().isoformat()
NOW = lambda: datetime.now().isoformat(timespec="seconds")


# ---------------------------------------------------------------- 基础工具
def conn():
    c = sqlite3.connect(DB_PATH, timeout=20)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def rows(c, sql, args=()):
    return [dict(r) for r in c.execute(sql, args).fetchall()]


def row(c, sql, args=()):
    r = c.execute(sql, args).fetchone()
    return dict(r) if r else None


def jdump(o):
    return json.dumps(o, ensure_ascii=False, default=str)


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(12)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120000).hex()
    return salt + "$" + h


def check_pw(pw, stored):
    try:
        salt, h = stored.split("$", 1)
        return secrets.compare_digest(hash_pw(pw, salt).split("$", 1)[1], h)
    except Exception:
        return False


def parse_date(v):
    if not v:
        return None
    v = str(v)[:10].replace("/", "-")
    try:
        return date.fromisoformat(v).isoformat()
    except Exception:
        return None


def days_until(d):
    d = parse_date(d)
    if not d:
        return None
    return (date.fromisoformat(d) - date.today()).days


def month_of(d):
    return (str(d or "")[:7]) or ""


def clean_filename(name):
    name = os.path.basename(str(name or "file"))
    return re.sub(r'[\\/:*?"<>|\r\n\t]', "_", name)[:180] or "file"


def safe_num(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


# ---------------------------------------------------------------- 初始化
def bootstrap_data(c):
    if not row(c, "SELECT id FROM users WHERE username='admin'"):
        c.execute("INSERT INTO users(username,password_hash,display_name,role,created_at) VALUES(?,?,?,?,?)",
                  ("admin", hash_pw("lawdesk"), "郑律师", "lawyer", NOW()))
    if not row(c, "SELECT id FROM legal_templates LIMIT 1"):
        for name, cat, content in S.BUILTIN_TEMPLATES:
            c.execute("INSERT INTO legal_templates(user_id,name,category,content,variables,builtin,created_at,updated_at) "
                      "VALUES(1,?,?,?,?,1,?,?)",
                      (name, cat, content, "{委托人} {对方当事人} {受理法院} {案由} {案件编号} {当前日期}", NOW(), NOW()))
    if not row(c, "SELECT id FROM knowledge_base LIMIT 1"):
        for title, cat, pub, pdate, eff, url, tags, note, verified in S.SEED_KNOWLEDGE:
            c.execute("INSERT INTO knowledge_base(user_id,title,category,publisher,published_at,effective_status,"
                      "source_url,retrieved_at,tags,content,note,verified,created_at,updated_at) "
                      "VALUES(1,?,?,?,?,?,?,?,?,?,?,0,?,?)",
                      (title, cat, pub, pdate, eff, url, TODAY(), tags, "", note, NOW(), NOW()))
    c.commit()


def migrate(c):
    """轻量迁移：后续新增字段时自动补列，老数据不丢失。"""
    for t, meta in S.TABLES.items():
        existing = {r["name"] for r in rows(c, "PRAGMA table_info(%s)" % t)}
        need = {f["key"]: S.SQL_TYPE.get(f["type"], "TEXT") for f in meta["fields"]}
        need.update({"created_at": "TEXT", "updated_at": "TEXT", "deleted_at": "TEXT",
                     "uploaded_at": "TEXT", "user_id": "INTEGER"})
        for col, typ in need.items():
            if col not in existing:
                c.execute("ALTER TABLE %s ADD COLUMN %s %s" % (t, col, typ))
    c.commit()


def setup():
    c = conn()
    S.init_db(c)
    migrate(c)
    bootstrap_data(c)
    c.close()


# ---------------------------------------------------------------- 认证
def current_user(c, token):
    if not token:
        return None
    r = row(c, "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id "
               "WHERE s.token=? AND s.expires_at>?", (token, NOW()))
    return r


def login(c, username, password):
    u = row(c, "SELECT * FROM users WHERE username=?", (username,))
    if not u or not check_pw(password, u["password_hash"]):
        return None
    token = secrets.token_urlsafe(32)
    c.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
              (token, u["id"], NOW(), (datetime.now() + timedelta(days=30)).isoformat(timespec="seconds")))
    c.commit()
    return token


# ---------------------------------------------------------------- 通用 CRUD
COMMON = {"id", "user_id", "created_at", "updated_at", "deleted_at", "uploaded_at"}
AUDIT_TABLES = {"operation_logs", "files", "sessions", "users"}


def table_fields(table):
    meta = S.TABLES[table]
    return {f["key"] for f in meta["fields"]} | COMMON


def _log(c, uid, table, eid, action, before, after, summary=""):
    cur = c.execute("INSERT INTO operation_logs(user_id,entity,entity_id,action,summary,before_json,after_json,undone,created_at,updated_at) "
                    "VALUES(?,?,?,?,?,?,?,0,?,?)",
                    (uid, table, eid, action, summary or action, jdump(before or {}), jdump(after or {}), NOW(), NOW()))
    return cur.lastrowid


def list_records(c, table, uid, q):
    meta = S.TABLES[table]
    allowed = table_fields(table)
    where = ["user_id=?"]
    args = [uid]
    if q.get("deleted_only"):
        where.append("deleted_at IS NOT NULL")
    elif not q.get("include_deleted"):
        where.append("deleted_at IS NULL")
    # 子页面预置筛选
    for key in list(q.keys()):
        if key.startswith("filter_") and q[key] not in (None, ""):
            col = key[7:]
            if col in allowed:
                if col == "case_id" and str(q[key]) == "none":
                    where.append("(case_id IS NULL OR case_id=0)")
                else:
                    where.append("%s=?" % col)
                    fmeta = next((f for f in S.TABLES[table]["fields"] if f["key"] == col), None)
                    if fmeta and fmeta["type"] in ("bool", "number", "money", "ref", "file"):
                        try:
                            args.append(int(q[key]))
                        except (ValueError, TypeError):
                            args.append(q[key])
                    else:
                        args.append(q[key])
    if q.get("search"):
        cols = meta.get("search") or [f["key"] for f in meta["fields"] if f["type"] in ("text", "textarea")]
        cols = [x for x in cols if x in allowed]
        if cols:
            where.append("(" + " OR ".join("COALESCE(%s,'') LIKE ?" % x for x in cols) + ")")
            args += ["%" + str(q["search"]) + "%"] * len(cols)
    # 日期区间（用于经营分析、临期筛选）
    if q.get("date_field") and q.get("date_from") and q["date_field"] in allowed:
        where.append("COALESCE(%s,'')>=?" % q["date_field"]); args.append(q["date_from"])
    if q.get("date_field") and q.get("date_to") and q["date_field"] in allowed:
        where.append("COALESCE(%s,'')<=?" % q["date_field"]); args.append(q["date_to"])
    sql_where = " WHERE " + " AND ".join(where)
    sort = q.get("sort") or "id"
    if sort not in allowed:
        sort = "id"
    order = "DESC" if str(q.get("order", "")).lower() == "desc" else "ASC"
    if not q.get("sort") and meta.get("sort"):
        # meta.sort 可能是 "col DESC" 或 "a ASC, b DESC"，只取首个白名单列与方向
        ms = re.match(r"^\s*(\w+)\s*(ASC|DESC)?", meta["sort"], re.I)
        if ms and ms.group(1) in allowed:
            sort, order = ms.group(1), (ms.group(2) or "ASC").upper()
    total = c.execute("SELECT COUNT(*) FROM %s%s" % (table, sql_where), args).fetchone()[0]
    sql = "SELECT * FROM %s%s ORDER BY %s %s, id DESC" % (table, sql_where, sort, order)
    if not q.get("all"):
        try:
            page, size = int(q.get("page", 1)), min(int(q.get("pageSize", 30)), 500)
        except Exception:
            page, size = 1, 30
        sql += " LIMIT ? OFFSET ?"
        args += [size, (page - 1) * size]
    data = rows(c, sql, args)
    return {"rows": data, "total": total, "page": int(q.get("page", 1) or 1)}


def get_record(c, table, uid, rid):
    return row(c, "SELECT * FROM %s WHERE id=? AND user_id=?" % table, (rid, uid))


def normalize(c, table, uid, data):
    """字段白名单 + 引用字段自动带出，减少重复录入。"""
    meta = S.TABLES[table]
    allowed = table_fields(table) - {"id", "user_id", "created_at", "updated_at", "deleted_at"}
    out = {}
    for fld in meta["fields"]:
        k = fld["key"]
        if k not in data or k not in allowed:
            continue
        v = data[k]
        if fld["type"] in ("ref", "file", "number", "money"):
            v = None if v in ("", None) else safe_num(v)
            if fld["type"] in ("ref", "file"):
                v = int(v) if v else None
        elif fld["type"] == "bool":
            v = 1 if v in (1, True, "1", "true", "on", "是") else 0
        elif fld["type"] == "date":
            v = parse_date(v)
        elif v is None:
            v = None
        out[k] = v
    # 自动带入：案件选择客户后自动带出联系方式
    if table == "cases" and out.get("client_id") and not out.get("contact"):
        cl = get_record(c, "clients", uid, int(out["client_id"]))
        if cl:
            out["contact"] = cl.get("phone") or cl.get("contact") or ""
    if table == "contracts" and out.get("case_id") and not out.get("client_id"):
        ca = get_record(c, "cases", uid, int(out["case_id"]))
        if ca and ca.get("client_id"):
            out["client_id"] = ca["client_id"]
    if table == "time_entries" and out.get("case_id") and not out.get("client_id"):
        ca = get_record(c, "cases", uid, int(out["case_id"]))
        if ca:
            out["client_id"] = ca.get("client_id")
    if table == "payments" and out.get("case_id") and not out.get("client_id"):
        ca = get_record(c, "cases", uid, int(out["case_id"]))
        if ca:
            out["client_id"] = ca.get("client_id")
    if table == "advisory_logs" and out.get("advisory_id") and not out.get("client_id"):
        ad = get_record(c, "legal_advisory", uid, int(out["advisory_id"]))
        if ad:
            out["client_id"] = ad.get("client_id")
    if table == "time_entries" and out.get("billing_type") == "计时" and out.get("minutes") and out.get("rate"):
        out["amount"] = round(safe_num(out["minutes"]) / 60.0 * safe_num(out["rate"]), 2)
    return out


def create_record(c, table, uid, data, actor=True):
    meta = S.TABLES[table]
    payload = normalize(c, table, uid, data)
    for fld in meta["fields"]:
        k = fld["key"]
        if k not in payload and fld.get("default") is not None:
            payload[k] = fld["default"]
    cols = ["user_id", "created_at", "updated_at"] + list(payload.keys())
    vals = [uid, NOW(), NOW()] + list(payload.values())
    cur = c.execute("INSERT INTO %s(%s) VALUES(%s)" % (table, ",".join(cols), ",".join("?" * len(cols))), vals)
    rid = cur.lastrowid
    rec = get_record(c, table, uid, rid)
    log_id = None
    if actor and table not in AUDIT_TABLES:
        log_id = _log(c, uid, table, rid, "create", {}, rec, "新建%s：%s" % (meta["label"], display_name(c, table, rec, uid)))
    hooks(c, table, uid, rid, None, rec, "create")
    c.commit()
    if log_id:
        rec["_log_id"] = log_id
    return rec


def update_record(c, table, uid, rid, data, actor=True):
    meta = S.TABLES[table]
    before = get_record(c, table, uid, rid)
    if not before:
        return None
    payload = normalize(c, table, uid, data)
    if not payload:
        return before
    sets = ", ".join("%s=?" % k for k in payload)
    c.execute("UPDATE %s SET %s, updated_at=? WHERE id=? AND user_id=?" % (table, sets),
              list(payload.values()) + [NOW(), rid, uid])
    after = get_record(c, table, uid, rid)
    changed = [k for k in payload if before.get(k) != after.get(k)]
    log_id = None
    if changed:
        action = "stage_change" if table == "cases" and "stage" in changed else "update"
        if actor and table not in AUDIT_TABLES:
            log_id = _log(c, uid, table, rid, action, before, after,
                          "修改%s：%s（%s）" % (meta["label"], display_name(c, table, after, uid), ", ".join(changed)))
        hooks(c, table, uid, rid, before, after, action)
    c.commit()
    if log_id:
        after["_log_id"] = log_id
    return after


def delete_record(c, table, uid, rid, purge=False):
    before = get_record(c, table, uid, rid)
    if not before:
        return None
    meta = S.TABLES[table]
    if purge:
        c.execute("DELETE FROM %s WHERE id=? AND user_id=?" % table, (rid, uid))
        summary = "彻底删除%s：%s" % (meta["label"], display_name(c, table, before, uid))
    else:
        c.execute("UPDATE %s SET deleted_at=?, updated_at=? WHERE id=? AND user_id=?" % table, (NOW(), NOW(), rid, uid))
        summary = "删除%s（进回收站）：%s" % (meta["label"], display_name(c, table, before, uid))
    log_id = _log(c, uid, table, rid, "delete", before, {}, summary)
    c.commit()
    return {"ok": True, "purge": purge, "log_id": log_id}


def restore_record(c, table, uid, rid):
    before = get_record(c, table, uid, rid)
    if not before:
        return None
    c.execute("UPDATE %s SET deleted_at=NULL, updated_at=? WHERE id=? AND user_id=?" % table, (NOW(), rid, uid))
    after = get_record(c, table, uid, rid)
    _log(c, uid, table, rid, "restore", before, after, "从回收站恢复：%s" % S.TABLES[table]["label"])
    c.commit()
    return after


def undo_log(c, uid, log_id):
    lg = row(c, "SELECT * FROM operation_logs WHERE id=? AND user_id=?", (log_id, uid))
    if not lg:
        return {"error": "日志不存在"}
    if lg["undone"]:
        return {"error": "该操作已撤销"}
    table, rid, action = lg["entity"], lg["entity_id"], lg["action"]
    if table not in S.TABLES:
        return {"error": "无法撤销"}
    before = json.loads(lg["before_json"] or "{}")
    cur = get_record(c, table, uid, rid)
    if action == "create":
        if cur:
            c.execute("UPDATE %s SET deleted_at=?, updated_at=? WHERE id=? AND user_id=?" % table, (NOW(), NOW(), rid, uid))
    elif action == "delete":
        if cur:
            c.execute("UPDATE %s SET deleted_at=NULL, updated_at=? WHERE id=? AND user_id=?" % table, (NOW(), rid, uid))
    else:
        payload = {k: v for k, v in before.items() if k in table_fields(table) - {"id", "user_id", "created_at", "updated_at"}}
        if payload and cur:
            c.execute("UPDATE %s SET %s, updated_at=? WHERE id=? AND user_id=?" %
                      (table, ", ".join("%s=?" % k for k in payload)), list(payload.values()) + [NOW(), rid, uid])
        elif not cur:
            # 记录被彻底删除：按原 id 复原
            payload = {k: v for k, v in before.items() if k in table_fields(table) - {"id"}}
            cols = list(payload.keys()) + ["id"]
            c.execute("INSERT INTO %s(%s) VALUES(%s)" % (table, ",".join(cols), ",".join("?" * len(cols))),
                      list(payload.values()) + [rid])
    c.execute("UPDATE operation_logs SET undone=1, updated_at=? WHERE id=?", (NOW(), log_id))
    c.commit()
    return {"ok": True, "undone": action}


def display_name(c, table, rec, uid):
    if not rec:
        return ""
    meta = S.TABLES[table]
    for fld in meta["fields"]:
        if fld["type"] in ("text", "textarea") and rec.get(fld["key"]):
            return str(rec[fld["key"]])[:60]
    return "%s #%s" % (meta["label"], rec.get("id"))


# ---------------------------------------------------------------- 业务联动钩子
def hooks(c, table, uid, rid, before, after, action):
    """统一数据源上的联动：所有关联页面通过查询读取最新值，钩子负责跨表派生记录。"""
    if not after:
        return
    now = NOW()
    # 案件阶段变化 -> 时间线事件（同时 operation_logs 已留痕，可撤销）
    if table == "cases" and before and before.get("stage") != after.get("stage"):
        c.execute("INSERT INTO case_events(user_id,case_id,title,type,event_at,content,created_at,updated_at) "
                  "VALUES(?,?,?,?,?,?,?,?)",
                  (uid, rid, "案件阶段：%s → %s" % (before.get("stage"), after.get("stage")), "其他", now,
                   "系统自动记录阶段变化，原状态：%s，新状态：%s" % (before.get("stage"), after.get("stage")), now, now))
    # 案件关键日期变化 -> 同步开庭日程（存在则更新，不存在则创建）
    if table == "cases" and before and before.get("next_key_date") != after.get("next_key_date") and after.get("next_key_date"):
        sch = row(c, "SELECT * FROM schedules WHERE user_id=? AND case_id=? AND type='开庭' AND status='正常' AND deleted_at IS NULL ORDER BY id LIMIT 1", (uid, rid))
        new_start = str(after["next_key_date"]) + "T09:00"
        if sch:
            c.execute("UPDATE schedules SET start_at=?, updated_at=? WHERE id=?", (new_start, now, sch["id"]))
        else:
            c.execute("INSERT INTO schedules(user_id,title,type,case_id,start_at,status,created_at,updated_at) "
                      "VALUES(?,?,?,?,?,?,?,?)", (uid, "开庭：" + (after.get("name") or ""), "开庭", rid, new_start, "正常", now, now))
    # 开庭日程 -> 反写案件下一关键日期 / 取消开庭标记
    if table == "schedules" and after.get("case_id") and after.get("type") == "开庭":
        d = parse_date(after.get("start_at"))
        ca = get_record(c, "cases", uid, int(after["case_id"]))
        if ca and d:
            if after.get("status") == "已取消":
                c.execute("UPDATE cases SET next_key_date=NULL, updated_at=? WHERE id=?", (now, ca["id"]))
            elif ca.get("next_key_date") != d:
                c.execute("UPDATE cases SET next_key_date=?, updated_at=? WHERE id=?", (d, now, ca["id"]))
    # 文书修改 -> 保留历史版本
    if table == "documents" and before and before.get("content") != after.get("content"):
        ver = int(row(c, "SELECT COALESCE(MAX(version),0) v FROM document_versions WHERE document_id=?", (rid,))["v"] or 0) + 1
        c.execute("INSERT INTO document_versions(user_id,document_id,version,content,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                  (uid, rid, ver, before.get("content") or "", "修改前快照", now, now))
        c.execute("UPDATE documents SET version=? WHERE id=?", (ver, rid))
    # 证据状态/内容修改 -> 保留历史
    if table == "evidence" and before:
        for k in ("status", "name", "purpose", "obtained_at", "evidence_no"):
            if before.get(k) != after.get(k):
                c.execute("INSERT INTO evidence_history(user_id,evidence_id,field,old_value,new_value,reason,created_at,updated_at) "
                          "VALUES(?,?,?,?,?,?,?,?)", (uid, rid, k, str(before.get(k) or ""), str(after.get(k) or ""), "编辑证据材料", now, now))
    # 期限变更 -> 保留原计算结果 + 同步日历
    if table == "deadlines" and before and before.get("due_on") != after.get("due_on"):
        c.execute("INSERT INTO deadline_history(user_id,deadline_id,old_due_on,new_due_on,basis,reason,created_at,updated_at) "
                  "VALUES(?,?,?,?,?,?,?,?)", (uid, rid, before.get("due_on"), after.get("due_on"),
                                              after.get("basis") or "", "律师确认/修改截止日期", now, now))
        maptype = {"举证期限": "举证期限", "上诉期限": "上诉期限", "保全期限": "保全到期", "合同期限": "合同到期"}
        stype = maptype.get(after.get("dtype"), "其他工作")
        sch = row(c, "SELECT id FROM schedules WHERE user_id=? AND case_id=? AND type=? AND deleted_at IS NULL ORDER BY id LIMIT 1",
                  (uid, after.get("case_id"), stype))
        start = str(after.get("due_on")) + "T09:00"
        if sch:
            c.execute("UPDATE schedules SET start_at=?, title=?, status=?, updated_at=? WHERE id=?",
                      (start, "%s：%s" % (after.get("dtype"), "期限届满"), "已取消" if after.get("status") == "已完成" else "正常", now, sch["id"]))
        elif after.get("due_on"):
            c.execute("INSERT INTO schedules(user_id,title,type,case_id,start_at,status,created_at,updated_at) "
                      "VALUES(?,?,?,?,?,?,?,?)", (uid, "%s：期限届满" % (after.get("dtype") or ""), stype, after.get("case_id"), start, "正常", now, now))
    # 合同到期 -> 自动生成到期日程（去重）
    if table == "contracts" and after.get("end_on") and after.get("status") not in ("已终止", "已到期"):
        exists = row(c, "SELECT id FROM schedules WHERE user_id=? AND type='合同到期' AND deleted_at IS NULL AND title LIKE ?",
                     (uid, "%" + str(after.get("name") or "")[:20] + "%"))
        if not exists:
            c.execute("INSERT INTO schedules(user_id,title,type,case_id,start_at,status,created_at,updated_at) "
                      "VALUES(?,?,?,?,?,?,?,?)",
                      (uid, "合同到期：" + (after.get("name") or ""), "合同到期", after.get("case_id"),
                       str(after["end_on"]) + "T09:00", "正常", now, now))
    # 保全新增/到期日变化 -> 生成保全到期日程
    if table == "preservation" and after.get("end_on") and after.get("status") != "已解除":
        exists = row(c, "SELECT id FROM schedules WHERE user_id=? AND type='保全到期' AND deleted_at IS NULL AND title LIKE ?",
                     (uid, "%" + str(after.get("target") or "")[:20] + "%"))
        if not exists:
            c.execute("INSERT INTO schedules(user_id,title,type,case_id,start_at,status,created_at,updated_at) "
                      "VALUES(?,?,?,?,?,?,?,?)",
                      (uid, "保全到期：" + (after.get("target") or ""), "保全到期", after.get("case_id"),
                       str(after["end_on"]) + "T09:00", "正常", now, now))
    # 常法工作记录 -> 服务记录自动归属客户
    if table == "advisory_logs" and after.get("advisory_id") and not after.get("client_id"):
        ad = get_record(c, "legal_advisory", uid, int(after["advisory_id"]))
        if ad:
            c.execute("UPDATE advisory_logs SET client_id=? WHERE id=?", (ad["client_id"], rid))
    # 计时器结束 -> 自动生成工时记录
    if table == "time_entries" and after.get("source") == "计时器" and after.get("case_id"):
        pass  # 工时本身即记录，案件详情/经营分析实时聚合


# ---------------------------------------------------------------- 保全风险
RISK_LEVELS = [
    ("expired", "已过期", "#C98272", 0),
    ("d7", "7天内到期", "#C98272", 1),
    ("d30", "8—30天到期", "#C6A477", 2),
    ("d90", "31—90天到期", "#D8CFC0", 3),
    ("normal", "90天以上", "#92989A", 4),
]


def preservation_risks(c, uid):
    recs = rows(c, "SELECT * FROM preservation WHERE user_id=? AND deleted_at IS NULL AND "
                   "COALESCE(status,'')!='已解除' AND COALESCE(handled_action,'')='' ORDER BY end_on ASC", (uid,))
    cases = {r["id"]: r["name"] for r in rows(c, "SELECT id,name FROM cases WHERE user_id=?", (uid,))}
    out = []
    for r in recs:
        d = days_until(r.get("end_on"))
        if d is None:
            continue
        if d < 0:
            level, label, color, pri = RISK_LEVELS[0]
        elif d <= 7:
            level, label, color, pri = RISK_LEVELS[1]
        elif d <= 30:
            level, label, color, pri = RISK_LEVELS[2]
        elif d <= 90:
            level, label, color, pri = RISK_LEVELS[3]
        else:
            level, label, color, pri = RISK_LEVELS[4]
        item = dict(r)
        item.update({"days": d, "risk": level, "risk_label": label, "risk_color": color, "priority": pri,
                     "case_name": cases.get(r.get("case_id"), "未关联案件")})
        out.append(item)
    return out


def renew_preservation(c, uid, rid, data):
    rec = get_record(c, "preservation", uid, rid)
    if not rec:
        return {"error": "记录不存在"}
    new_end = parse_date(data.get("new_end_on"))
    if not new_end:
        return {"error": "请填写新的到期日期"}
    hist = rows(c, "SELECT * FROM preservation_history WHERE preservation_id=? AND user_id=?", (rid, uid))
    count = max([int(h.get("renewal_count") or 0) for h in hist] or [0]) + 1
    now = NOW()
    c.execute("INSERT INTO preservation_history(user_id,preservation_id,action,old_end_on,new_end_on,ruling_no,file_id,"
              "renewal_count,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
              (uid, rid, "续期", rec.get("end_on"), new_end, data.get("ruling_no") or "",
               data.get("file_id") or None, count, data.get("note") or "", now, now))
    c.execute("UPDATE preservation SET end_on=?, ruling_no=?, status='已续期', handled_action='', handled_at=?, "
              "updated_at=? WHERE id=? AND user_id=?",
              (new_end, data.get("ruling_no") or rec.get("ruling_no"), now[:10], now, rid, uid))
    after = get_record(c, "preservation", uid, rid)
    _log(c, uid, "preservation", rid, "renew", rec, after,
         "保全续期：%s，%s → %s（第%s次）" % (rec.get("target"), rec.get("end_on"), new_end, count))
    c.commit()
    return {"ok": True, "record": after, "renewal_count": count}


def handle_preservation(c, uid, rid, data):
    rec = get_record(c, "preservation", uid, rid)
    if not rec:
        return {"error": "记录不存在"}
    action = data.get("action") or "其他处理"
    if action not in ("解除", "其他处理", "已执行完毕"):
        action = "其他处理"
    now = NOW()
    hist = rows(c, "SELECT * FROM preservation_history WHERE preservation_id=? AND user_id=?", (rid, uid))
    count = max([int(h.get("renewal_count") or 0) for h in hist] or [0])
    c.execute("INSERT INTO preservation_history(user_id,preservation_id,action,old_end_on,new_end_on,ruling_no,file_id,"
              "renewal_count,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
              (uid, rid, action, rec.get("end_on"), rec.get("end_on"), rec.get("ruling_no") or "",
               data.get("file_id") or None, count, data.get("note") or "", now, now))
    c.execute("UPDATE preservation SET status=?, handled_action=?, handled_at=?, updated_at=? WHERE id=? AND user_id=?",
              ("已解除" if action == "解除" else rec.get("status"), action, now[:10], now, rid, uid))
    after = get_record(c, "preservation", uid, rid)
    _log(c, uid, "preservation", rid, "handle", rec, after, "保全处理：%s - %s" % (rec.get("target"), action))
    c.commit()
    return {"ok": True, "record": after}


# ---------------------------------------------------------------- 聚合接口
def lookups(c, uid):
    out = {}
    for t, key in (("clients", "name"), ("cases", "name"), ("contracts", "name"),
                   ("legal_advisory", "contract_no"), ("legal_templates", "name"),
                   ("documents", "title"), ("knowledge_base", "title")):
        out[t] = {r["id"]: (r.get(key) or ("%s #%s" % (S.TABLES[t]["label"], r["id"])))
                  for r in rows(c, "SELECT id,%s FROM %s WHERE user_id=? AND deleted_at IS NULL" % (key, t), (uid,))}
    return out


def dashboard(c, uid):
    today = TODAY()
    week_end = (date.today() + timedelta(days=7)).isoformat()
    month = today[:7]
    def cnt(sql, args=()):
        return c.execute(sql, (uid,) + tuple(args)).fetchone()[0]
    tasks_open = cnt("SELECT COUNT(*) FROM tasks WHERE user_id=? AND deleted_at IS NULL AND status IN ('待办','进行中')")
    hearings = cnt("SELECT COUNT(*) FROM schedules WHERE user_id=? AND deleted_at IS NULL AND type='开庭' AND status='正常' AND substr(start_at,1,10) BETWEEN ? AND ?", (today, week_end))
    near_deadlines = cnt("SELECT COUNT(*) FROM deadlines WHERE user_id=? AND deleted_at IS NULL AND status!='已完成' AND due_on BETWEEN ? AND ?", (today, week_end))
    pending_contracts = cnt("SELECT COUNT(*) FROM contracts WHERE user_id=? AND deleted_at IS NULL AND status IN ('待审查','审查中')")
    active_cases = cnt("SELECT COUNT(*) FROM cases WHERE user_id=? AND deleted_at IS NULL AND status='进行中'")
    risks = preservation_risks(c, uid)
    urgent = [r for r in risks if r["priority"] <= 1]
    contract_stats = {
        "待审查": cnt("SELECT COUNT(*) FROM contracts WHERE user_id=? AND deleted_at IS NULL AND status='待审查'"),
        "审查中": cnt("SELECT COUNT(*) FROM contracts WHERE user_id=? AND deleted_at IS NULL AND status='审查中'"),
        "已完成": cnt("SELECT COUNT(*) FROM contracts WHERE user_id=? AND deleted_at IS NULL AND status IN ('已签署','履行中','已到期','已终止')"),
    }
    recent_contracts = rows(c, "SELECT * FROM contracts WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5", (uid,))
    today_schedule = rows(c, "SELECT * FROM schedules WHERE user_id=? AND deleted_at IS NULL AND substr(start_at,1,10)=? AND status!='已取消' ORDER BY start_at", (uid, today))
    pending_evidence = rows(c, "SELECT * FROM evidence WHERE user_id=? AND deleted_at IS NULL AND status='待收集' ORDER BY created_at DESC LIMIT 8", (uid,))
    recent_search = rows(c, "SELECT * FROM legal_search_logs WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 6", (uid,))
    hot_terms = [r["keyword"] for r in rows(c, "SELECT keyword, COUNT(*) n FROM legal_search_logs WHERE user_id=? AND deleted_at IS NULL GROUP BY keyword ORDER BY n DESC LIMIT 6", (uid,))]
    kb_counts = {}
    for cat in S.OPT["kb_category"]:
        kb_counts[cat] = cnt("SELECT COUNT(*) FROM knowledge_base WHERE user_id=? AND deleted_at IS NULL AND category=?", (cat,))
    income_month = c.execute("SELECT COALESCE(SUM(received),0) FROM payments WHERE user_id=? AND deleted_at IS NULL AND substr(paid_at,1,7)=?", (uid, month)).fetchone()[0]
    upcoming_deadlines = rows(c, "SELECT * FROM deadlines WHERE user_id=? AND deleted_at IS NULL AND status!='已完成' AND due_on>=? ORDER BY due_on ASC LIMIT 12", (uid, today))
    return {
        "today": today, "weekday": ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"][date.today().weekday()],
        "cards": {"todo": tasks_open, "hearings": hearings, "deadlines": near_deadlines,
                  "contracts": pending_contracts, "cases": active_cases},
        "urgent_preservation": urgent, "risk_total": len(risks),
        "contract_stats": contract_stats, "recent_contracts": recent_contracts,
        "today_schedule": today_schedule, "pending_evidence": pending_evidence,
        "recent_search": recent_search, "hot_terms": hot_terms, "kb_counts": kb_counts,
        "income_month": round(income_month, 2), "upcoming_deadlines": upcoming_deadlines,
        "notices": build_notices(c, uid, urgent, tasks_open, pending_contracts, near_deadlines),
    }


def build_notices(c, uid, urgent, tasks, contracts, deadlines):
    out = []
    for r in urgent:
        out.append({"level": "danger", "title": "保全风险：%s" % r["target"],
                    "body": "%s，剩余 %s 天（%s）" % (r["risk_label"], r["days"], r["case_name"]),
                    "link": "preservation/risk", "key": "pres-%s" % r["id"]})
    if contracts:
        out.append({"level": "warning", "title": "%s 份合同待审查" % contracts, "body": "请在合同管理中处理", "link": "contracts/review", "key": "contracts"})
    if deadlines:
        out.append({"level": "warning", "title": "%s 项期限临近" % deadlines, "body": "7 天内到期的诉讼期限", "link": "schedules/deadlines", "key": "deadlines"})
    if tasks:
        out.append({"level": "info", "title": "%s 项待办未完成" % tasks, "body": "查看今日待办", "link": "schedules/tasks", "key": "tasks"})
    return out[:12]


def global_search(c, uid, q):
    q = (q or "").strip()
    if not q:
        return {"groups": []}
    groups = []
    for t in ("cases", "clients", "contracts", "documents", "knowledge_base", "schedules", "evidence", "legal_templates"):
        meta = S.TABLES[t]
        cols = [x for x in (meta.get("search") or []) if x in table_fields(t)]
        if not cols:
            continue
        where = "user_id=? AND deleted_at IS NULL AND (" + " OR ".join("COALESCE(%s,'') LIKE ?" % x for x in cols) + ")"
        res = rows(c, "SELECT * FROM %s WHERE %s ORDER BY updated_at DESC LIMIT 8" % (t, where),
                   (uid,) + tuple("%" + q + "%" for _ in cols))
        if res:
            groups.append({"table": t, "label": meta["label"],
                           "items": [{"id": r["id"], "title": display_name(c, t, r, uid),
                                      "sub": "%s · %s" % (meta["label"], str(r.get("updated_at") or "")[:10])} for r in res]})
    return {"groups": groups, "query": q}


def case_full(c, uid, rid):
    ca = get_record(c, "cases", uid, rid)
    if not ca:
        return {"error": "案件不存在"}
    def rel(t, order):
        return rows(c, "SELECT * FROM %s WHERE user_id=? AND case_id=? AND deleted_at IS NULL ORDER BY %s" % (t, order), (uid, rid))
    return {
        "case": ca, "client": get_record(c, "clients", uid, ca["client_id"]) if ca.get("client_id") else None,
        "events": rel("case_events", "event_at DESC"), "documents": rel("documents", "updated_at DESC"),
        "evidence": rel("evidence", "sort_order ASC, id ASC"), "schedules": rel("schedules", "start_at ASC"),
        "deadlines": rel("deadlines", "due_on ASC"), "tasks": rel("tasks", "due_on ASC"),
        "time_entries": rel("time_entries", "started_at DESC"), "expenses": rel("expenses", "occurred_at DESC"),
        "payments": rel("payments", "paid_at DESC"), "preservation": rel("preservation", "end_on ASC"),
        "contracts": rel("contracts", "created_at DESC"),
        "communications": rel("communications", "contact_at DESC"),
        "history": rows(c, "SELECT * FROM operation_logs WHERE user_id=? AND entity='cases' AND entity_id=? ORDER BY created_at DESC, id DESC LIMIT 30", (uid, rid)),
        "files": rows(c, "SELECT * FROM files WHERE user_id=? AND entity='cases' AND entity_id=? AND deleted_at IS NULL ORDER BY uploaded_at DESC", (uid, rid)),
    }


def client_full(c, uid, rid):
    cl = get_record(c, "clients", uid, rid)
    if not cl:
        return {"error": "客户不存在"}
    return {
        "client": cl,
        "cases": rows(c, "SELECT * FROM cases WHERE user_id=? AND client_id=? AND deleted_at IS NULL ORDER BY created_at DESC", (uid, rid)),
        "contracts": rows(c, "SELECT * FROM contracts WHERE user_id=? AND client_id=? AND deleted_at IS NULL ORDER BY created_at DESC", (uid, rid)),
        "documents": rows(c, "SELECT * FROM documents WHERE user_id=? AND client_id=? AND deleted_at IS NULL ORDER BY updated_at DESC", (uid, rid)),
        "schedules": rows(c, "SELECT * FROM schedules WHERE user_id=? AND case_id IN (SELECT id FROM cases WHERE user_id=? AND client_id=?) AND deleted_at IS NULL ORDER BY start_at DESC LIMIT 30", (uid, uid, rid)),
        "tasks": rows(c, "SELECT * FROM tasks WHERE user_id=? AND client_id=? AND deleted_at IS NULL ORDER BY due_on", (uid, rid)),
        "payments": rows(c, "SELECT * FROM payments WHERE user_id=? AND client_id=? AND deleted_at IS NULL ORDER BY paid_at DESC", (uid, rid)),
        "advisory": rows(c, "SELECT * FROM legal_advisory WHERE user_id=? AND client_id=? AND deleted_at IS NULL", (uid, rid)),
        "communications": rows(c, "SELECT * FROM communications WHERE user_id=? AND client_id=? AND deleted_at IS NULL ORDER BY contact_at DESC", (uid, rid)),
        "events": rows(c, "SELECT e.* FROM case_events e JOIN cases ca ON ca.id=e.case_id WHERE e.user_id=? AND ca.client_id=? AND e.deleted_at IS NULL ORDER BY e.event_at DESC LIMIT 30", (uid, rid)),
    }


def analytics(c, uid, period="month"):
    today = date.today()
    if period == "quarter":
        start = (today - timedelta(days=90)).isoformat()
    elif period == "year":
        start = today.replace(month=1, day=1).isoformat()
    else:
        start = today.replace(day=1).isoformat()
    month = today.replace(day=1).isoformat()[:7]
    def cnt(sql, args=()):
        return c.execute(sql, (uid,) + tuple(args)).fetchone()[0]
    def sm(sql, args=()):
        return round(c.execute(sql, (uid,) + tuple(args)).fetchone()[0] or 0, 2)
    active = cnt("SELECT COUNT(*) FROM cases WHERE user_id=? AND deleted_at IS NULL AND status='进行中'")
    new_m = cnt("SELECT COUNT(*) FROM cases WHERE user_id=? AND deleted_at IS NULL AND substr(created_at,1,7)=?", (month,))
    closed_m = cnt("SELECT COUNT(*) FROM cases WHERE user_id=? AND deleted_at IS NULL AND stage='结案' AND substr(updated_at,1,7)=?", (month,))
    clients = cnt("SELECT COUNT(*) FROM clients WHERE user_id=? AND deleted_at IS NULL")
    retainers = cnt("SELECT COUNT(*) FROM legal_advisory WHERE user_id=? AND deleted_at IS NULL AND status='生效中'")
    contract_amt = sm("SELECT COALESCE(SUM(amount),0) FROM contracts WHERE user_id=? AND deleted_at IS NULL AND substr(COALESCE(signed_at,created_at),1,7)=?", (month,))
    received_m = sm("SELECT COALESCE(SUM(received),0) FROM payments WHERE user_id=? AND deleted_at IS NULL AND substr(paid_at,1,7)=?", (month,))
    receivable_total = sm("SELECT COALESCE(SUM(fee),0) FROM cases WHERE user_id=? AND deleted_at IS NULL")
    received_total = sm("SELECT COALESCE(SUM(received),0) FROM payments WHERE user_id=? AND deleted_at IS NULL")
    unpaid = round(max(receivable_total - received_total, 0), 2)
    minutes_m = sm("SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE user_id=? AND deleted_at IS NULL AND substr(COALESCE(started_at,created_at),1,7)=?", (month,))
    def dist(table, col):
        return [{"name": r[col] or "未填写", "value": r["n"]} for r in
                rows(c, "SELECT COALESCE(%s,'未填写') %s, COUNT(*) n FROM %s WHERE user_id=? AND deleted_at IS NULL GROUP BY %s ORDER BY n DESC" % (col, col, table, col), (uid,))]
    trend = []
    for i in range(11, -1, -1):
        y, m = (today.year * 12 + today.month - 1 - i) // 12, (today.year * 12 + today.month - 1 - i) % 12 + 1
        key = "%04d-%02d" % (y, m)
        v = sm("SELECT COALESCE(SUM(received),0) FROM payments WHERE user_id=? AND deleted_at IS NULL AND substr(paid_at,1,7)=?", (key,))
        trend.append({"month": key, "value": v})
    return {
        "period": period, "start": start,
        "kpi": {"active_cases": active, "new_cases": new_m, "closed_cases": closed_m, "clients": clients,
                "retainers": retainers, "contract_amount": contract_amt, "received": received_m,
                "unpaid": unpaid, "minutes": minutes_m},
        "case_type_dist": dist("cases", "cause"), "client_source_dist": dist("clients", "source"),
        "case_stage_dist": dist("cases", "stage"), "income_trend": trend,
    }


def advisory_report(c, uid, rid):
    ad = get_record(c, "legal_advisory", uid, rid)
    if not ad:
        return {"error": "常法合同不存在"}
    logs = rows(c, "SELECT * FROM advisory_logs WHERE user_id=? AND advisory_id=? AND deleted_at IS NULL ORDER BY worked_at ASC", (uid, rid))
    cl = get_record(c, "clients", uid, ad["client_id"]) if ad.get("client_id") else None
    by_type, by_month = {}, {}
    total_min = 0
    for l in logs:
        k = l.get("work_type") or "其他"
        by_type[k] = by_type.get(k, 0) + 1
        mo = month_of(l.get("worked_at"))
        by_month[mo] = by_month.get(mo, 0) + 1
        total_min += safe_num(l.get("minutes"))
    return {
        "contract": ad, "client": cl, "logs": logs, "total_count": len(logs),
        "total_minutes": total_min, "by_type": [{"name": k, "value": v} for k, v in by_type.items()],
        "by_month": [{"month": k, "value": v} for k, v in sorted(by_month.items())],
        "generated_at": NOW(),
        "disclaimer": "本报告完全依据系统中已录入的工作记录生成，未使用任何虚构服务次数或内容。",
    }


# ---------------------------------------------------------------- AI 助手（结合真实业务数据）
AI_DISCLAIMER = "AI 仅生成草稿与建议：案件事实、法律依据、司法解释、裁判观点均须律师核验；系统不会编造事实或法条，也不会擅自修改正式业务数据。"


def ai_run(c, uid, payload):
    action = payload.get("action") or "chat"
    case_id = payload.get("case_id") or None
    client_id = payload.get("client_id") or None
    text = (payload.get("text") or "").strip()
    question = (payload.get("question") or "").strip()
    ca = get_record(c, "cases", uid, case_id) if case_id else None
    cl = get_record(c, "clients", uid, client_id) if client_id else None
    if ca and not cl and ca.get("client_id"):
        cl = get_record(c, "clients", uid, ca["client_id"])
    ctx = {"case": ca.get("name") if ca else None, "client": cl.get("name") if cl else None,
           "case_id": case_id, "client_id": client_id}
    out = {"action": action, "context": ctx, "disclaimer": AI_DISCLAIMER, "generated_at": NOW()}

    if action == "summarize_case":
        if not ca:
            return {"error": "请选择一个案件作为上下文"}
        full = case_full(c, uid, case_id)
        out["title"] = "案件材料总结 · %s" % ca["name"]
        out["sections"] = [
            {"h": "一、案件基本情况", "body": "案件名称：%s\n案件编号：%s\n案由：%s\n委托人：%s\n对方当事人：%s\n受理法院：%s\n当前阶段：%s\n案件状态：%s\n律师费：%s" %
             (ca.get("name"), ca.get("case_no") or "未填写", ca.get("cause") or "未填写",
              (full["client"] or {}).get("name") or "未关联客户", ca.get("opponent") or "未填写",
              ca.get("court") or "未填写", ca.get("stage"), ca.get("status"), ca.get("fee") or "未填写")},
            {"h": "二、双方主张与争议焦点", "body": "系统内已录入争议事实 %s 条：\n%s\n（上述内容来自证据材料「关联争议事实」字段，未作事实推断）" %
             (len(full["evidence"]), "\n".join("- " + (e.get("dispute_fact") or e.get("name") or "") for e in full["evidence"][:20]) or "暂无记录")},
            {"h": "三、证据材料", "body": "共 %s 份；待收集 %s 份、已提交 %s 份。\n%s" %
             (len(full["evidence"]), sum(1 for e in full["evidence"] if e.get("status") == "待收集"),
              sum(1 for e in full["evidence"] if e.get("status") == "已提交"),
              "\n".join("- [%s] %s（%s）" % (e.get("status"), e.get("name"), e.get("evidence_no") or "无编号") for e in full["evidence"][:30]) or "暂无")},
            {"h": "四、当前进展", "body": "\n".join("- %s %s" % (str(e.get("event_at") or "")[:16], e.get("title")) for e in full["events"][:20]) or "暂无时间线事件"},
            {"h": "五、待处理事项", "body": "\n".join("- [%s] %s（截止 %s）" % (t.get("status"), t.get("title"), t.get("due_on") or "未设定") for t in full["tasks"] if t.get("status") != "已完成") or "暂无待办"},
            {"h": "六、潜在风险", "body": "\n".join("- 保全：%s，到期 %s，%s" % (p.get("target"), p.get("end_on"), preservation_risks(c, uid) and next((x["risk_label"] for x in preservation_risks(c, uid) if x["id"] == p["id"]), "正常")) for p in full["preservation"]) or "暂无保全记录"},
        ]
        out["text"] = "\n\n".join(s["h"] + "\n" + s["body"] for s in out["sections"])
        return out

    if action == "draft_document":
        tpl = None
        if payload.get("template_id"):
            tpl = get_record(c, "legal_templates", uid, payload["template_id"])
        if not tpl:
            tpl = row(c, "SELECT * FROM legal_templates WHERE user_id=? AND deleted_at IS NULL ORDER BY id LIMIT 1", (uid,))
        if not tpl:
            return {"error": "暂无可用模板"}
        content = tpl.get("content") or ""
        if ca:
            mapping = {
                "{委托人}": (cl or {}).get("name") or "（请填写委托人）",
                "{对方当事人}": ca.get("opponent") or "（请填写对方当事人）",
                "{受理法院}": ca.get("court") or "（请填写受理法院）",
                "{案由}": ca.get("cause") or "（请填写案由）",
                "{案件编号}": ca.get("case_no") or ca.get("name") or "",
                "{当前日期}": TODAY(),
            }
            for k, v in mapping.items():
                content = content.replace(k, str(v))
        else:
            content = content.replace("{当前日期}", TODAY())
        out.update({"title": "文书初稿 · %s" % tpl.get("name"), "template_id": tpl["id"],
                    "template_name": tpl.get("name"), "text": content,
                    "notice": "正文中的括号占位内容须律师依据案件事实补全；引用法条须核验来源与现行效力。"})
        return out

    if action == "review_contract":
        src = text
        if not src and payload.get("contract_id"):
            ct = get_record(c, "contracts", uid, payload["contract_id"])
            if ct and ct.get("ai_extract"):
                src = ct["ai_extract"]
        if not src and payload.get("case_id"):
            ct = row(c, "SELECT * FROM contracts WHERE user_id=? AND case_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", (uid, case_id))
            if ct and ct.get("ai_extract"):
                src = ct["ai_extract"]
        if not src:
            return {"error": "请粘贴合同条款，或在合同管理中上传文件并将识别文本填入 AI 识别结果"}
        rules = [
            ("单方解除权", ["单方解除", "随时解除", "无需通知即可解除"], "高", "仅一方享有解除权，权利义务明显不对等，建议约定对等解除条件与通知期。"),
            ("违约责任失衡", ["违约金", "赔偿责任", "连带责任"], "中", "核对违约金比例、损失范围与责任上限，避免畸高或无限责任。"),
            ("付款风险", ["付款", "结算", "账期", "预付", "发票"], "中", "明确付款节点、条件、逾期利息与发票开具义务，建议增加分期与验收挂钩。"),
            ("管辖与争议解决", ["管辖", "仲裁", "诉讼", "争议解决"], "中", "确认管辖法院/仲裁机构是否明确、是否对委托人明显不利。"),
            ("保密与竞业", ["保密", "竞业"], "低", "核对保密范围、期限与例外情形。"),
            ("自动续期", ["自动续期", "自动展期", "默认续约"], "中", "自动续期可能形成长期义务，建议增加提前通知与退出机制。"),
            ("知识产权", ["知识产权", "著作权", "成果归属"], "低", "明确成果归属与授权范围。"),
            ("责任限制缺失", ["不可抗力", "责任限额"], "低", "检查是否缺少不可抗力与责任限额条款。"),
        ]
        findings = []
        for name, kws, level, advice in rules:
            hits = [k for k in kws if k in src]
            if hits:
                snippets = []
                for k in hits[:2]:
                    i = src.find(k)
                    snippets.append(src[max(0, i - 45):i + 55].replace("\n", " "))
                findings.append({"item": name, "level": level, "hits": hits, "snippets": snippets, "advice": advice})
        missing = [r[0] for r in rules if not any(k in src for k in r[1])]
        out.update({"title": "合同审查意见（草稿）", "findings": findings, "checked_rules": len(rules),
                    "missing": missing, "source_length": len(src),
                    "text": "\n".join("%s. 【%s】%s\n   依据片段：%s\n   修改建议：%s" %
                                      (i + 1, f["level"], f["item"], " / ".join(f["snippets"]), f["advice"])
                                      for i, f in enumerate(findings)) or "未命中内置风险规则，请律师人工复核全文。",
                    "notice": "本结果由本地规则引擎基于合同文本生成，不含法条引用，不构成正式法律意见。"})
        return out

    if action == "legal_research":
        kw = question or text
        if not kw:
            return {"error": "请输入法律问题或检索关键词"}
        cols = "title,source,publisher,published_at,effective_status,source_url,tags,content,summary,verified,retrieved_at"
        like = "%" + kw + "%"
        res = rows(c, "SELECT * FROM knowledge_base WHERE user_id=? AND deleted_at IS NULL AND (title LIKE ? OR tags LIKE ? OR content LIKE ? OR summary LIKE ? OR source LIKE ?) ORDER BY verified DESC, updated_at DESC LIMIT 20",
                   (uid, like, like, like, like, like))
        c.execute("INSERT INTO legal_search_logs(user_id,keyword,category,result_count,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                  (uid, kw, "本地资料库", len(res), NOW(), NOW()))
        c.commit()
        out.update({"title": "法律检索辅助 · %s" % kw, "results": res, "retrieved_at": TODAY(),
                    "text": "\n".join("- %s｜来源：%s｜发布机构：%s｜发布时间：%s｜效力：%s｜核验：%s｜检索日期：%s" %
                                      (r.get("title"), r.get("source") or "未标注", r.get("publisher") or "未标注",
                                       r.get("published_at") or "未标注", r.get("effective_status"),
                                       "已核验" if r.get("verified") else "待核验", TODAY()) for r in res)
                    or "本地资料库未检索到匹配资料。请通过权威法律数据库核验后录入，本系统不会生成法条或判例。",
                    "notice": "以上均为本地已录入资料，须标注来源与更新时间；未经核验的内容不得作为正式法律依据。"})
        return out

    if action == "client_comm":
        if not cl:
            return {"error": "请选择一个客户作为上下文"}
        full = client_full(c, uid, cl["id"])
        hist = full["communications"]
        pending = [t for t in full["tasks"] if t.get("status") != "已完成"]
        out.update({"title": "客户沟通辅助 · %s" % cl.get("name"),
                    "sections": [
                        {"h": "一、客户概况", "body": "客户类型：%s｜状态：%s｜来源：%s｜最近联系：%s｜关联案件：%s 件｜关联合同：%s 份｜沟通记录：%s 条" %
                         (cl.get("type"), cl.get("status"), cl.get("source") or "未填写", cl.get("last_contact_at") or "未记录", len(full["cases"]), len(full["contracts"]), len(hist))},
                        {"h": "二、历史沟通摘要", "body": "\n".join("- %s [%s] %s%s" %
                         (str(h.get("contact_at") or "")[:16], h.get("channel") or "沟通", h.get("content") or "",
                          "｜跟进：" + h["follow_up"] if h.get("follow_up") else "") for h in hist[:20]) or "暂无沟通记录"},
                        {"h": "三、下一步跟进建议", "body": "· 对未记录最近联系时间的客户补充回访；\n· 优先处理 %s 项未完成待办；\n· 核对在办案件下一关键日期与临近期限。" % len(pending)},
                        {"h": "四、待办事项", "body": "\n".join("- [%s] %s（%s）" % (t.get("status"), t.get("title"), t.get("due_on") or "未设定") for t in pending) or "暂无"},
                    ]})
        out["text"] = "\n\n".join(s["h"] + "\n" + s["body"] for s in out["sections"])
        return out

    # chat / 通用：优先调用用户配置的 LLM，并注入真实业务上下文；否则走本地检索式回答
    context_text = ""
    if ca:
        full = case_full(c, uid, case_id)
        context_text += "【案件】%s｜编号 %s｜案由 %s｜客户 %s｜对方 %s｜法院 %s｜阶段 %s｜状态 %s\n" % (
            ca.get("name"), ca.get("case_no"), ca.get("cause"), (full["client"] or {}).get("name"),
            ca.get("opponent"), ca.get("court"), ca.get("stage"), ca.get("status"))
        context_text += "【证据】%s 份；【文书】%s 份；【待办】%s 项；【保全】%s 项\n" % (
            len(full["evidence"]), len(full["documents"]), len(full["tasks"]), len(full["preservation"]))
    elif cl:
        context_text += "【客户】%s｜类型 %s｜状态 %s\n" % (cl.get("name"), cl.get("type"), cl.get("status"))
    cfg = {r["key"]: r["value"] for r in rows(c, "SELECT key,value FROM settings WHERE user_id=?", (uid,))}
    if cfg.get("llm_endpoint") and cfg.get("llm_api_key"):
        try:
            messages = [
                {"role": "system", "content": "你是律师业务助理。只能依据提供的系统业务数据回答，不得编造案件事实、法条、司法解释或判例；无法确认的内容明确说明需律师核验。不得建议直接修改正式业务数据。\n" + AI_DISCLAIMER + "\n业务上下文：\n" + context_text},
                {"role": "user", "content": question or text},
            ]
            req = urllib.request.Request(cfg["llm_endpoint"].rstrip("/") + "/chat/completions",
                data=json.dumps({"model": cfg.get("llm_model") or "gpt-4o-mini", "messages": messages, "temperature": 0.2}).encode(),
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + cfg["llm_api_key"]})
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode())
            answer = data["choices"][0]["message"]["content"]
            out.update({"title": "AI 法律助手", "text": answer, "mode": "llm", "context_used": bool(context_text)})
            return out
        except Exception as e:
            out["llm_error"] = "已配置的模型调用失败：%s" % type(e).__name__
    # 本地检索式回答：只复述系统内真实数据
    kw = question or text
    hits = global_search(c, uid, kw)
    lines = []
    for g in hits["groups"]:
        lines.append("【%s】" % g["label"])
        lines += ["  · " + it["title"] for it in g["items"][:5]]
    out.update({"title": "AI 法律助手（本地上下模式）", "mode": "local",
                "text": (context_text or "未选择案件/客户上下文。") + "\n\n" +
                        ("系统内与「%s」相关的真实资料：\n" % kw + "\n".join(lines) if lines else
                         "系统内未检索到与「%s」直接相关的记录。可先选择案件/客户作为上下文，或在系统设置中配置大模型接口以获得生成式回答。" % kw) +
                        "\n\n提示：本地模式只检录系统已有数据，不生成法条或案件事实。"})
    return out


def contract_extract(c, uid, payload):
    """合同辅助识别：基于本地文本规则抽取，结果必须律师确认后才能写入正式数据。"""
    text = (payload.get("text") or "").strip()
    ct = get_record(c, "contracts", uid, payload.get("contract_id")) if payload.get("contract_id") else None
    if not text and ct:
        text = ct.get("ai_extract") or ""
    if not text:
        return {"error": "请先在合同的「AI识别结果」字段粘贴合同文本，或直接粘贴到此处"}
    def first(pattern, group=1):
        m = re.search(pattern, text)
        return m.group(group).strip() if m else None
    def amount_val(s):
        if not s:
            return None
        try:
            v = float(s.replace(",", ""))
            if "万元" in text[max(0, text.find(s) - 6):text.find(s) + len(s) + 3]:
                v *= 10000
            return v
        except Exception:
            return None
    amt_raw = first(r'(?:合同金额|总金额|价款|金额|总价)[^\d]{0,12}([\d,]+(?:\.\d+)?)\s*(万元|元)?')
    dates = re.findall(r'(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})', text)
    iso = ["%04d-%02d-%02d" % (int(a), int(b), int(d)) for a, b, d in dates]
    party_a = first(r'(?:甲方|委托方|买方|发包方)[：:\s]*([^\s，,；;。\n]{2,30})')
    party_b = first(r'(?:乙方|受托方|卖方|承包方)[：:\s]*([^\s，,；;。\n]{2,30})')
    def sentences(kws):
        out = []
        for seg in re.split(r'[。；;\n]', text):
            if any(k in seg for k in kws) and len(seg.strip()) > 4:
                out.append(seg.strip()[:160])
        return out[:5]
    items = [
        {"key": "name", "label": "合同主体 / 名称", "value": "甲方：%s；乙方：%s" % (party_a or "未识别", party_b or "未识别"), "confidence": "低" if not party_a else "中", "writable": False},
        {"key": "amount", "label": "合同金额", "value": amount_val(amt_raw), "confidence": "中" if amt_raw else "未识别", "writable": True},
        {"key": "signed_at", "label": "签订日期", "value": iso[0] if iso else None, "confidence": "中" if iso else "未识别", "writable": True},
        {"key": "start_on", "label": "合同期限（起）", "value": iso[1] if len(iso) > 1 else None, "confidence": "低" if len(iso) > 1 else "未识别", "writable": True},
        {"key": "end_on", "label": "合同期限（止）", "value": iso[2] if len(iso) > 2 else None, "confidence": "低" if len(iso) > 2 else "未识别", "writable": True},
        {"key": "payment_nodes", "label": "付款节点", "value": sentences(["付款", "支付", "分期", "账期", "预付"]), "confidence": "低", "writable": False},
        {"key": "liability", "label": "违约责任", "value": sentences(["违约", "赔偿", "滞纳金"]), "confidence": "低", "writable": False},
        {"key": "termination", "label": "解除条件", "value": sentences(["解除", "终止"]), "confidence": "低", "writable": False},
        {"key": "risk_clauses", "label": "风险条款", "value": sentences(["单方", "无限责任", "免责", "自动续期", "不得异议"]), "confidence": "低", "writable": False},
    ]
    return {"items": items, "contract_id": ct["id"] if ct else None, "source_length": len(text),
            "note": "以上为本地规则识别结果，仅供辅助。须由律师逐项核对合同原件后确认写入；未勾选的项不会改动正式合同数据。",
            "disclaimer": AI_DISCLAIMER}


# ---------------------------------------------------------------- 文件 / 导入导出 / 备份
def parse_multipart(body, content_type):
    m = re.search(r'boundary=(?:"([^"]+)"|([^;\s]+))', content_type or "")
    if not m:
        return {}, {}
    boundary = (m.group(1) or m.group(2)).encode()
    parts = body.split(b"--" + boundary)
    fields, files = {}, {}
    for p in parts:
        if not p or p.startswith(b"--"):
            continue
        p = p.lstrip(b"\r\n")
        if p.endswith(b"\r\n"):
            p = p[:-2]
        if b"\r\n\r\n" not in p:
            continue
        head, data = p.split(b"\r\n\r\n", 1)
        hs = head.decode("utf-8", "ignore")
        nm = re.search(r'name="([^"]*)"', hs)
        if not nm:
            continue
        name = nm.group(1)
        fm = re.search(r'filename="([^"]*)"', hs)
        cm = re.search(r'Content-Type:\s*([^\r\n]+)', hs, re.I)
        if fm:
            files[name] = {"filename": fm.group(1), "data": data,
                           "mime": (cm.group(1).strip() if cm else "application/octet-stream")}
        else:
            fields[name] = data.decode("utf-8", "ignore")
    return fields, files


def save_upload(c, uid, item, entity="", entity_id=None):
    fn = clean_filename(item["filename"])
    ext = os.path.splitext(fn)[1].lower()
    allowed = {".doc", ".docx", ".pdf", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".csv",
               ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".zip", ".rar", ".7z", ".eml", ".msg", ".mp3", ".mp4", ".wav"}
    if ext and ext not in allowed:
        return {"error": "不支持的文件类型：%s" % ext}
    if len(item["data"]) > 50 * 1024 * 1024:
        return {"error": "文件超过 50MB 限制"}
    sub = os.path.join(UPLOAD_DIR, str(uid))
    os.makedirs(sub, exist_ok=True)
    stored = uuid.uuid4().hex + "_" + fn
    path = os.path.join(sub, stored)
    with open(path, "wb") as fp:
        fp.write(item["data"])
    mime = item["mime"] if item["mime"] != "application/octet-stream" else (mimetypes.guess_type(fn)[0] or "application/octet-stream")
    cur = c.execute("INSERT INTO files(user_id,name,size,mime,entity,entity_id,path,uploaded_at,created_at,updated_at) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (uid, fn, len(item["data"]), mime, entity, entity_id,
                     os.path.relpath(path, ROOT).replace("\\", "/"), NOW(), NOW(), NOW()))
    c.commit()
    return {"id": cur.lastrowid, "name": fn, "size": len(item["data"]), "mime": mime,
            "entity": entity, "entity_id": entity_id}


def export_rows(c, table, uid, fmt="csv"):
    recs = list_records(c, table, uid, {"all": "1"})["rows"]
    meta = S.TABLES[table]
    keys = [f["key"] for f in meta["fields"]] + ["created_at"]
    labels = [f["label"] for f in meta["fields"]] + ["创建时间"]
    if fmt == "json":
        return jdump(recs).encode("utf-8"), "application/json; charset=utf-8", "%s.json" % table
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(labels)
    for r in recs:
        w.writerow([r.get(k) if r.get(k) is not None else "" for k in keys])
    return ("\ufeff" + buf.getvalue()).encode("utf-8"), "text/csv; charset=utf-8", "%s.csv" % table


def import_rows(c, table, uid, payload):
    data = payload.get("rows")
    if data is None and payload.get("csv"):
        data = list(csv.DictReader(io.StringIO(payload["csv"])))
    if not isinstance(data, list):
        return {"error": "数据格式错误，需要 rows 数组或 csv 文本"}
    ok, fail = 0, []
    for i, r in enumerate(data):
        try:
            create_record(c, table, uid, r)
            ok += 1
        except Exception as e:
            fail.append({"row": i + 1, "error": str(e)})
    return {"ok": True, "created": ok, "failed": fail}


def make_backup(c, uid):
    name = "lawdesk-backup-%s.zip" % datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(BACKUP_DIR, name)
    c.commit()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(DB_PATH, "lawdesk.db")
        if os.path.isdir(UPLOAD_DIR):
            for root, _, files in os.walk(UPLOAD_DIR):
                for fn in files:
                    fp = os.path.join(root, fn)
                    z.write(fp, "uploads/" + os.path.relpath(fp, UPLOAD_DIR).replace("\\", "/"))
    return {"ok": True, "name": name, "size": os.path.getsize(path)}


def list_backups():
    out = []
    for fn in sorted(os.listdir(BACKUP_DIR), reverse=True):
        if fn.endswith(".zip"):
            p = os.path.join(BACKUP_DIR, fn)
            out.append({"name": fn, "size": os.path.getsize(p),
                        "created_at": datetime.fromtimestamp(os.path.getmtime(p)).isoformat(timespec="seconds")})
    return out


def restore_backup(c, name):
    name = clean_filename(name)
    path = os.path.join(BACKUP_DIR, name)
    if not os.path.isfile(path):
        return {"error": "备份文件不存在"}
    tmp = path + ".extract"
    with zipfile.ZipFile(path) as z:
        z.extractall(tmp)
    src_db = os.path.join(tmp, "lawdesk.db")
    if not os.path.isfile(src_db):
        shutil.rmtree(tmp, ignore_errors=True)
        return {"error": "备份内容不完整"}
    # 恢复前先为当前数据留一份安全备份
    make_backup(c, 1)
    shutil.copy2(src_db, DB_PATH)
    up = os.path.join(tmp, "uploads")
    if os.path.isdir(up):
        shutil.copytree(up, UPLOAD_DIR, dirs_exist_ok=True)
    shutil.rmtree(tmp, ignore_errors=True)
    return {"ok": True, "note": "已恢复数据库与附件，刷新页面后生效"}


def make_docx(title, text):
    """生成最小合法 OOXML .docx（无需第三方库）。"""
    def esc(s):
        return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    paras = []
    for line in str(text or "").split("\n"):
        paras.append('<w:p><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>' % esc(line))
    doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>%s</w:body></w:document>' % "".join(paras)
    ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc)
    return buf.getvalue()


# ---------------------------------------------------------------- HTTP 处理
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LawDeskAI/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = jdump(body).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    def _token(self):
        ck = self.headers.get("Cookie") or ""
        m = re.search(r'lawdesk_sid=([^;\s]+)', ck)
        return m.group(1) if m else (self.headers.get("X-Session-Token") or "")

    def _uid(self, c):
        u = current_user(c, self._token())
        return u["id"] if u else None

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method):
        u = urlparse(self.path)
        path = unquote(u.path)
        q = {k: v[0] for k, v in parse_qs(u.query, keep_blank_values=True).items()}
        try:
            if not path.startswith("/api/"):
                return self.serve_static(path)
            return self.api(method, path, q)
        except Exception as e:
            traceback.print_exc()
            return self._send(500, {"error": "服务器错误：%s" % e})

    # ------------------------------------------------------------ 静态文件
    def serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        rel = path.lstrip("/").replace("..", "")
        fp = os.path.join(STATIC_DIR, rel)
        if not os.path.isfile(fp):
            fp = os.path.join(STATIC_DIR, "index.html")
        ext = os.path.splitext(fp)[1].lower()
        ctype = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
                 ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json"}.get(
            ext, mimetypes.guess_type(fp)[0] or "application/octet-stream")
        with open(fp, "rb") as f:
            self._send(200, f.read(), ctype)

    # ------------------------------------------------------------ API
    def api(self, method, path, q):
        c = conn()
        uid = self._uid(c)
        parts = [p for p in path.split("/") if p]
        # parts: ['api', ...]
        seg = parts[1:]
        ctype = self.headers.get("Content-Type", "")
        # multipart 上传的原始字节由 files/upload 分支自行读取，不能在这里提前消费
        body = {} if (method not in ("POST", "PUT") or "multipart/form-data" in ctype) else self._json_body()

        # ---- 公开：登录 / 引导
        if seg == ["auth", "login"] and method == "POST":
            token = login(c, body.get("username", ""), body.get("password", ""))
            if not token:
                return self._send(401, {"error": "用户名或密码不正确"})
            return self._send(200, {"ok": True}, headers={"Set-Cookie": "lawdesk_sid=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000" % token})
        if seg == ["auth", "logout"] and method == "POST":
            c.execute("DELETE FROM sessions WHERE token=?", (self._token(),)); c.commit()
            return self._send(200, {"ok": True}, headers={"Set-Cookie": "lawdesk_sid=; Path=/; Max-Age=0"})
        if not uid:
            c.close()
            return self._send(401, {"error": "未登录"})

        # ---- 引导数据
        if seg == ["bootstrap"]:
            u = current_user(c, self._token())
            cfg = {r["key"]: r["value"] for r in rows(c, "SELECT key,value FROM settings WHERE user_id=?", (uid,))}
            return self._send(200, {
                "user": {"id": u["id"], "username": u["username"], "display_name": u["display_name"], "role": u["role"]},
                "menu": S.MENU, "tables": S.TABLES, "options": S.OPT, "lookups": lookups(c, uid),
                "today": TODAY(), "stages": S.OPT["case_stage"], "schedule_types": S.OPT["schedule_type"],
                "preservation_reference": S.PRESERVATION_REFERENCE,
                "settings": {k: (bool(v) if k.startswith("llm_") and k != "llm_model" else v) for k, v in cfg.items() if not k.endswith("api_key")},
                "llm_configured": bool(cfg.get("llm_endpoint") and cfg.get("llm_api_key")),
            })
        if seg == ["lookups"]:
            return self._send(200, lookups(c, uid))

        # ---- 账户
        if seg == ["auth", "me"]:
            u = current_user(c, self._token())
            return self._send(200, {"id": u["id"], "username": u["username"], "display_name": u["display_name"]})
        if seg == ["auth", "profile"] and method == "POST":
            if body.get("password"):
                c.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_pw(body["password"]), uid))
            if body.get("display_name"):
                c.execute("UPDATE users SET display_name=? WHERE id=?", (body["display_name"], uid))
            c.commit()
            return self._send(200, {"ok": True})
        if seg == ["auth", "register"] and method == "POST":
            name = (body.get("username") or "").strip()
            if not name or not body.get("password"):
                return self._send(400, {"error": "请填写用户名和密码"})
            if row(c, "SELECT id FROM users WHERE username=?", (name,)):
                return self._send(400, {"error": "用户名已存在"})
            cur = c.execute("INSERT INTO users(username,password_hash,display_name,role,created_at) VALUES(?,?,?,?,?)",
                            (name, hash_pw(body["password"]), body.get("display_name") or name, "lawyer", NOW()))
            token = secrets.token_urlsafe(32)
            c.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
                      (token, cur.lastrowid, NOW(), (datetime.now() + timedelta(days=30)).isoformat(timespec="seconds")))
            c.commit()
            return self._send(200, {"ok": True}, headers={"Set-Cookie": "lawdesk_sid=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000" % token})

        # ---- 设置
        if seg == ["settings"] and method == "POST":
            for k, v in body.items():
                c.execute("INSERT INTO settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value",
                          (uid, k, str(v) if v is not None else ""))
            c.commit()
            return self._send(200, {"ok": True})

        # ---- 首页 / 搜索 / 统计
        if seg == ["dashboard"]:
            return self._send(200, dashboard(c, uid))
        if seg == ["search"]:
            return self._send(200, global_search(c, uid, q.get("q")))
        if seg == ["analytics"]:
            return self._send(200, analytics(c, uid, q.get("period", "month")))
        if seg == ["analytics", "export"]:
            data, ctype, fn = export_rows(c, "payments", uid, "csv")
            return self._send(200, data, ctype, {"Content-Disposition": 'attachment; filename="analytics-payments.csv"'})
        if seg == ["risk", "preservation"]:
            return self._send(200, {"items": preservation_risks(c, uid)})
        if seg == ["risk", "boot"]:
            items = [x for x in preservation_risks(c, uid) if x["priority"] <= 1]
            return self._send(200, {"items": items, "count": len(items), "checked_at": NOW()})
        if seg == ["preservation", "calc"]:
            months = S.PRESERVATION_REFERENCE.get(q.get("ptype", ""))
            start = parse_date(q.get("start_on")) or TODAY()
            res = None
            if months:
                d = date.fromisoformat(start)
                try:
                    res = d.replace(year=d.year + months // 12).isoformat()
                except ValueError:
                    res = (d + timedelta(days=months * 30)).isoformat()
            return self._send(200, {"reference_end_on": res, "months": months,
                                   "note": "仅为系统辅助计算参考，必须以实际裁定书、适用法律及具体案件情况为准，律师可手动修改最终到期日期。"})
        if seg == ["deadlines", "calc"]:
            days = q.get("days")
            start = parse_date(q.get("start_on")) or TODAY()
            if not days or not str(days).isdigit():
                return self._send(200, {"error": "请填写法院指定/双方约定并经确认的天数；本系统不套用固定 15 天或 30 天通用规则。"})
            due = (date.fromisoformat(start) + timedelta(days=int(days))).isoformat()
            return self._send(200, {"due_on": due, "basis": q.get("basis") or "",
                                   "note": "辅助计算结果须显示计算依据并由律师确认、修改后方可使用。"})

        # ---- 业务聚合
        if len(seg) == 3 and seg[0] == "cases" and seg[2] == "full":
            return self._send(200, case_full(c, uid, seg[1]))
        if len(seg) == 3 and seg[0] == "clients" and seg[2] == "full":
            return self._send(200, client_full(c, uid, seg[1]))
        if len(seg) == 3 and seg[0] == "advisory" and seg[2] == "report":
            return self._send(200, advisory_report(c, uid, seg[1]))
        if seg == ["evidence", "catalog"]:
            cid = q.get("case_id")
            ev = rows(c, "SELECT * FROM evidence WHERE user_id=? AND case_id=? AND deleted_at IS NULL ORDER BY sort_order,id", (uid, cid))
            ca = get_record(c, "cases", uid, cid) if cid else None
            lines = ["证据目录", "案件：%s" % ((ca or {}).get("name") or "全部案件"), "生成日期：%s" % TODAY(), "",
                     "序号\t证据名称\t证据编号\t证据类型\t来源\t形成时间\t证明目的\t状态"]
            for i, e in enumerate(ev, 1):
                lines.append("%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s" % (i, e.get("name") or "", e.get("evidence_no") or "",
                    e.get("type") or "", e.get("source") or "", e.get("formed_at") or "", e.get("purpose") or "", e.get("status") or ""))
            return self._send(200, {"text": "\n".join(lines), "count": len(ev)})
        if seg == ["conflict", "check"]:
            name = (q.get("opponent") or "").strip()
            if not name:
                return self._send(200, {"items": []})
            items = rows(c, "SELECT id,name,client_id,opponent,cause,stage FROM cases WHERE user_id=? AND deleted_at IS NULL AND "
                            "(opponent LIKE ? OR client_id IN (SELECT id FROM clients WHERE user_id=? AND name LIKE ?)) LIMIT 20",
                            (uid, "%" + name + "%", uid, "%" + name + "%"))
            lk = lookups(c, uid)
            for it in items:
                it["client_name"] = lk.get("clients", {}).get(it.get("client_id"), "")
            return self._send(200, {"items": items,
                                    "note": "仅为名称匹配提示，不构成利益冲突认定。请律师结合委托事项、当事人关系与历史案卷独立判断。"})

        # ---- AI
        if seg == ["ai", "run"] and method == "POST":
            return self._send(200, ai_run(c, uid, body))
        if seg == ["contracts", "extract"] and method == "POST":
            return self._send(200, contract_extract(c, uid, body))
        if seg == ["templates", "render"] and method == "POST":
            tpl = get_record(c, "legal_templates", uid, body.get("template_id")) if body.get("template_id") else None
            if not tpl:
                return self._send(400, {"error": "模板不存在"})
            ca = get_record(c, "cases", uid, body.get("case_id")) if body.get("case_id") else None
            cl = get_record(c, "clients", uid, ca["client_id"]) if ca and ca.get("client_id") else None
            content = tpl.get("content") or ""
            mapping = {"{委托人}": (cl or {}).get("name") or "", "{对方当事人}": (ca or {}).get("opponent") or "",
                       "{受理法院}": (ca or {}).get("court") or "", "{案由}": (ca or {}).get("cause") or "",
                       "{案件编号}": (ca or {}).get("case_no") or "", "{当前日期}": TODAY()}
            for k, v in mapping.items():
                content = content.replace(k, str(v))
            return self._send(200, {"content": content, "template_name": tpl.get("name"),
                                   "notice": "变量均来自系统已录入的案件资料；括号占位内容与法条引用须律师核验。"})
        if seg == ["export", "docx"] and method == "POST":
            data = make_docx(body.get("title") or "法律文书", body.get("text") or "")
            return self._send(200, data, "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                              {"Content-Disposition": 'attachment; filename="document.docx"'})

        # ---- 保全专用动作
        if len(seg) == 3 and seg[0] == "preservation" and seg[2] in ("renew", "handle") and method == "POST":
            fn = renew_preservation if seg[2] == "renew" else handle_preservation
            res = fn(c, uid, seg[1], body)
            return self._send(200, res)

        # ---- 文件
        if seg == ["files", "upload"] and method == "POST":
            ctype = self.headers.get("Content-Type", "")
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n)
            fields, files = parse_multipart(raw, ctype)
            if not files:
                return self._send(400, {"error": "未收到文件"})
            results = []
            for key, item in files.items():
                r = save_upload(c, uid, item, fields.get("entity", ""), fields.get("entity_id") or None)
                if r.get("error"):
                    return self._send(400, r)
                results.append(r)
            return self._send(200, {"ok": True, "files": results, "file": results[0]})
        if len(seg) >= 3 and seg[0] == "files" and seg[2] in ("download", "preview"):
            fr = row(c, "SELECT * FROM files WHERE id=? AND user_id=?", (seg[1], uid))
            if not fr or not os.path.isfile(os.path.join(ROOT, fr["path"])):
                return self._send(404, {"error": "文件不存在"})
            with open(os.path.join(ROOT, fr["path"]), "rb") as f:
                data = f.read()
            disp = "attachment" if seg[2] == "download" else "inline"
            ascii_name = fr["name"].encode("ascii", "ignore").decode() or "file"
            return self._send(200, data, fr["mime"] or "application/octet-stream",
                              {"Content-Disposition": "%s; filename=\"%s\"; filename*=UTF-8''%s" % (disp, ascii_name, quote(fr["name"])),
                               "X-Content-Type-Options": "nosniff"})
        if len(seg) == 2 and seg[0] == "files" and method == "DELETE":
            c.execute("UPDATE files SET deleted_at=?, updated_at=? WHERE id=? AND user_id=?", (NOW(), NOW(), seg[1], uid))
            c.commit()
            return self._send(200, {"ok": True})

        # ---- 导入导出 / 备份
        if len(seg) == 2 and seg[0] == "export" and seg[1] in S.TABLES:
            data, ctype, fn = export_rows(c, seg[1], uid, q.get("format", "csv"))
            return self._send(200, data, ctype, {"Content-Disposition": 'attachment; filename="%s"' % fn})
        if seg == ["export", "all"]:
            dump = {}
            for t in S.TABLES:
                dump[t] = rows(c, "SELECT * FROM %s WHERE user_id=?" % t, (uid,))
            return self._send(200, jdump(dump).encode("utf-8"), "application/json; charset=utf-8",
                              {"Content-Disposition": 'attachment; filename="lawdesk-all-data.json"'})
        if len(seg) == 2 and seg[0] == "import" and seg[1] in S.TABLES and method == "POST":
            return self._send(200, import_rows(c, seg[1], uid, body))
        if seg == ["backup", "list"]:
            return self._send(200, {"items": list_backups()})
        if seg == ["backup", "create"] and method == "POST":
            return self._send(200, make_backup(c, uid))
        if seg == ["backup", "download"]:
            p = os.path.join(BACKUP_DIR, clean_filename(q.get("name", "")))
            if not os.path.isfile(p):
                return self._send(404, {"error": "备份不存在"})
            with open(p, "rb") as f:
                return self._send(200, f.read(), "application/zip",
                                  {"Content-Disposition": 'attachment; filename="%s"' % os.path.basename(p)})
        if seg == ["backup", "restore"] and method == "POST":
            return self._send(200, restore_backup(c, body.get("name", "")))

        # ---- 撤销 / 日志
        if len(seg) == 2 and seg[0] == "undo" and method == "POST":
            return self._send(200, undo_log(c, uid, seg[1]))
        if seg == ["logs"]:
            return self._send(200, {"rows": rows(c, "SELECT * FROM operation_logs WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 300", (uid,))})
        if seg == ["recycle"]:
            out = []
            for t, meta in S.TABLES.items():
                rs = rows(c, "SELECT id FROM %s WHERE user_id=? AND deleted_at IS NOT NULL" % t, (uid,))
                for r in rs:
                    rec = row(c, "SELECT * FROM %s WHERE id=?" % t, (r["id"],))
                    out.append({"table": t, "label": meta["label"], "id": r["id"],
                                "title": display_name(c, t, rec, uid), "deleted_at": rec.get("deleted_at")})
            return self._send(200, {"rows": sorted(out, key=lambda x: x["deleted_at"] or "", reverse=True)})

        # ---- 通用 CRUD /api/t/<table>[/<id>[/restore|purge|history]]
        if seg and seg[0] == "t" and len(seg) >= 2 and seg[1] in S.TABLES:
            table = seg[1]
            if len(seg) == 2:
                if method == "GET":
                    return self._send(200, list_records(c, table, uid, q))
                if method == "POST":
                    rec = create_record(c, table, uid, body)
                    return self._send(200, {"ok": True, "record": rec, "log_id": rec.get("_log_id")})
            if len(seg) >= 3:
                rid = seg[2]
                if len(seg) == 3:
                    if method == "GET":
                        return self._send(200, {"record": get_record(c, table, uid, rid)})
                    if method == "PUT":
                        rec = update_record(c, table, uid, rid, body)
                        return self._send(200, {"ok": True, "record": rec, "log_id": rec.get("_log_id")})
                    if method == "DELETE":
                        return self._send(200, delete_record(c, table, uid, rid))
                if len(seg) == 4 and method == "POST":
                    if seg[3] == "restore":
                        return self._send(200, {"ok": True, "record": restore_record(c, table, uid, rid)})
                    if seg[3] == "purge":
                        return self._send(200, delete_record(c, table, uid, rid, purge=True))
                if len(seg) == 4 and seg[3] == "history" and method == "GET":
                    return self._send(200, {"rows": rows(c, "SELECT * FROM operation_logs WHERE user_id=? AND entity=? AND entity_id=? ORDER BY created_at DESC", (uid, table, rid))})
        return self._send(404, {"error": "接口不存在：%s" % path})


def main():
    setup()
    port = int(os.environ.get("LAWDESK_PORT", "8765"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("LawDesk AI 已启动： http://127.0.0.1:%d" % port)
    print("数据文件： %s" % DB_PATH)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
