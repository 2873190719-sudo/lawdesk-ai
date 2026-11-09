# -*- coding: utf-8 -*-
"""LawDesk AI - 数据模型定义。

所有业务表由 FIELD_META 自动生成 DDL，前端也从同一份元数据渲染列表、表单、
搜索、筛选与排序，保证前后端字段口径完全一致。
"""
import sqlite3

DB_PATH = "data/lawdesk.db"

SQL_TYPE = {
    "text": "TEXT", "textarea": "TEXT", "select": "TEXT", "date": "TEXT",
    "datetime": "TEXT", "ref": "INTEGER", "file": "INTEGER", "readonly": "TEXT",
    "number": "REAL", "money": "REAL", "bool": "INTEGER",
}


def f(key, label, type="text", **kw):
    d = {"key": key, "label": label, "type": type}
    d.update(kw)
    return d


OPT = {
    "client_type": ["个人客户", "企业客户", "常法客户", "潜在客户"],
    "client_source": ["朋友介绍", "老客户推荐", "网络咨询", "律所分配", "公开活动", "其他"],
    "client_status": ["活跃", "跟进中", "暂停", "已归档"],
    "case_stage": ["接案", "立案", "举证", "庭前会议", "开庭", "等待判决", "执行", "结案"],
    "case_status": ["进行中", "暂缓", "已结案", "已归档"],
    "risk_level": ["低", "中", "高"],
    "contract_type": ["委托合同", "买卖合同", "服务合同", "租赁合同", "劳动合同", "股权转让", "其他"],
    "contract_status": ["待审查", "审查中", "待签署", "已签署", "履行中", "已到期", "已终止"],
    "doc_category": ["委托合同", "起诉材料", "答辩材料", "证据材料", "法院文件", "判决书", "执行材料", "法律文书", "其他"],
    "doc_status": ["草稿", "定稿", "已归档"],
    "template_category": ["诉讼文书", "合同范本", "法律意见", "常用函件", "其他"],
    "evidence_type": ["书证", "物证", "视听资料", "电子数据", "证人证言", "鉴定意见", "勘验笔录", "当事人陈述"],
    "evidence_status": ["待收集", "已收集", "待核实", "已提交"],
    "preservation_type": ["银行账户冻结", "不动产查封", "动产查封", "股权冻结", "行为保全", "其他"],
    "preservation_status": ["生效中", "已续期", "已解除", "已过期", "待处理"],
    "schedule_type": ["开庭", "会见", "客户沟通", "提交材料", "举证期限", "上诉期限", "保全到期", "合同到期", "其他工作"],
    "schedule_status": ["正常", "已完成", "已取消"],
    "deadline_type": ["举证期限", "上诉期限", "答辩期限", "申请执行期限", "保全期限", "合同期限", "其他"],
    "deadline_status": ["未开始", "进行中", "已完成", "已逾期"],
    "priority": ["高", "中", "低"],
    "task_status": ["待办", "进行中", "已完成", "已取消"],
    "billing_type": ["计时", "固定", "免费", "不计费"],
    "entry_source": ["手动录入", "计时器"],
    "expense_category": ["律师费", "诉讼相关费用", "差旅费", "其他费用"],
    "pay_method": ["银行转账", "现金", "微信", "支付宝", "其他"],
    "advisory_status": ["生效中", "已到期", "已终止"],
    "advisory_work": ["法律咨询", "合同审核", "合同起草", "法律培训", "参与会议", "风险评估", "其他"],
    "kb_category": ["法律法规", "案例判例", "律师文书", "实务指引", "办案工具"],
    "effective_status": ["现行有效", "已废止", "尚未生效", "待核验"],
    "event_type": ["客户委托", "合同签订", "材料提交", "立案", "开庭", "判决", "执行", "沟通", "其他"],
    "yesno": ["是", "否"],
}

# 保全类型 -> 辅助计算参考月数（仅辅助，必须律师确认）
PRESERVATION_REFERENCE = {
    "银行账户冻结": 12,
    "不动产查封": 36,
    "动产查封": 24,
    "股权冻结": 24,
    "行为保全": None,
    "其他": None,
}

TABLES = {
    "clients": {
        "label": "客户", "icon": "users", "sort": "created_at DESC",
        "fields": [
            f("name", "客户名称", required=True, searchable=True, width=180),
            f("type", "客户类型", "select", options=OPT["client_type"], filterable=True, default="个人客户"),
            f("contact", "联系人"), f("phone", "联系电话", searchable=True),
            f("email", "邮箱"), f("address", "地址"),
            f("source", "客户来源", "select", options=OPT["client_source"], filterable=True),
            f("status", "客户状态", "select", options=OPT["client_status"], filterable=True, default="活跃"),
            f("tags", "客户标签"), f("last_contact_at", "最近联系时间", "date"),
            f("note", "备注", "textarea"),
        ],
        "list": ["name", "type", "phone", "source", "status", "last_contact_at"],
        "search": ["name", "contact", "phone", "email", "tags"],
    },
    "cases": {
        "label": "案件", "icon": "briefcase", "sort": "created_at DESC",
        "fields": [
            f("name", "案件名称", required=True, searchable=True, width=210),
            f("case_no", "案件编号", searchable=True),
            f("cause", "案由", searchable=True, filterable=True),
            f("client_id", "委托客户", "ref", ref="clients", required=True, filterable=True),
            f("opponent", "对方当事人", searchable=True),
            f("contact", "联系方式"), f("court", "受理法院", searchable=True), f("judge", "承办法官"),
            f("received_at", "收案日期", "date"), f("filed_at", "立案日期", "date"),
            f("fee", "律师费", "money"),
            f("risk_level", "风险等级", "select", options=OPT["risk_level"], filterable=True, default="中"),
            f("stage", "当前阶段", "select", options=OPT["case_stage"], filterable=True, default="接案"),
            f("status", "案件状态", "select", options=OPT["case_status"], filterable=True, default="进行中"),
            f("lawyer", "律师负责人"), f("next_key_date", "下一关键日期", "date"),
            f("note", "备注", "textarea"),
        ],
        "list": ["name", "case_no", "cause", "client_id", "opponent", "court", "stage", "next_key_date", "status"],
        "search": ["name", "case_no", "cause", "opponent", "court", "judge", "lawyer"],
    },
    "communications": {
        "label": "沟通记录", "icon": "message", "sort": "contact_at DESC", "nested": True,
        "fields": [
            f("client_id", "关联客户", "ref", ref="clients", required=True, filterable=True),
            f("case_id", "关联案件", "ref", ref="cases", filterable=True),
            f("channel", "沟通方式", "select", options=["电话", "微信", "邮件", "面谈", "会议", "其他"], filterable=True, default="电话"),
            f("contact_at", "沟通时间", "datetime", required=True),
            f("content", "沟通内容", "textarea", required=True),
            f("follow_up", "下一步跟进", "textarea"),
            f("next_contact_at", "下次联系日期", "date"),
            f("note", "备注", "textarea"),
        ],
        "list": ["contact_at", "client_id", "case_id", "channel", "content", "follow_up"],
        "search": ["content", "follow_up", "note"],
    },
    "case_events": {
        "label": "案件事件", "icon": "clock", "sort": "event_at DESC", "nested": True,
        "fields": [
            f("case_id", "关联案件", "ref", ref="cases", required=True, filterable=True),
            f("title", "事件标题", required=True, searchable=True),
            f("type", "事件类型", "select", options=OPT["event_type"], filterable=True, default="其他"),
            f("event_at", "发生时间", "datetime", required=True),
            f("content", "事件内容", "textarea"),
        ],
        "list": ["event_at", "title", "type", "case_id", "content"],
        "search": ["title", "content"],
    },
    "contracts": {
        "label": "合同", "icon": "file-text", "sort": "created_at DESC",
        "fields": [
            f("name", "合同名称", required=True, searchable=True, width=200),
            f("contract_no", "合同编号", searchable=True),
            f("type", "合同类型", "select", options=OPT["contract_type"], filterable=True),
            f("client_id", "关联客户", "ref", ref="clients", filterable=True),
            f("case_id", "关联案件", "ref", ref="cases", filterable=True),
            f("signed_at", "签订日期", "date"),
            f("amount", "合同金额", "money"),
            f("start_on", "合同开始日", "date"), f("end_on", "合同到期日", "date"),
            f("status", "合同状态", "select", options=OPT["contract_status"], filterable=True, default="待审查"),
            f("remind_days", "到期提醒天数", "number", default=30),
            f("file_id", "合同文件", "file"),
            f("ai_extract", "AI识别结果（待律师确认）", "textarea", ai=True),
            f("ai_confirmed", "识别结果已确认", "bool"),
            f("note", "备注", "textarea"),
        ],
        "list": ["name", "contract_no", "type", "client_id", "case_id", "signed_at", "amount", "end_on", "status"],
        "search": ["name", "contract_no", "note"],
    },
    "contract_versions": {
        "label": "合同版本", "icon": "layers", "sort": "created_at DESC", "readonly": True,
        "fields": [
            f("contract_id", "关联合同", "ref", ref="contracts", required=True),
            f("version", "版本号", "number"), f("file_id", "文件", "file"),
            f("note", "版本说明", "textarea"),
        ],
        "list": ["contract_id", "version", "note", "created_at"], "search": ["note"],
    },
    "documents": {
        "label": "文书", "icon": "file", "sort": "updated_at DESC",
        "fields": [
            f("title", "文书标题", required=True, searchable=True, width=220),
            f("category", "文档类型", "select", options=OPT["doc_category"], filterable=True),
            f("case_id", "关联案件", "ref", ref="cases", filterable=True),
            f("client_id", "关联客户", "ref", ref="clients"),
            f("template_id", "使用模板", "ref", ref="legal_templates"),
            f("status", "文书状态", "select", options=OPT["doc_status"], filterable=True, default="草稿"),
            f("version", "版本", "number", default=1),
            f("content", "正文", "textarea", editor=True),
            f("file_id", "附件", "file"),
            f("note", "备注", "textarea"),
        ],
        "list": ["title", "category", "case_id", "status", "version", "updated_at"],
        "search": ["title", "content", "note"],
    },
    "document_versions": {
        "label": "文书版本", "icon": "layers", "sort": "created_at DESC", "readonly": True,
        "fields": [
            f("document_id", "关联文书", "ref", ref="documents", required=True),
            f("version", "版本号", "number"), f("content", "正文快照", "textarea"),
            f("note", "版本说明", "textarea"),
        ],
        "list": ["document_id", "version", "note", "created_at"], "search": ["note"],
    },
    "legal_templates": {
        "label": "文书模板", "icon": "layout", "sort": "created_at DESC",
        "fields": [
            f("name", "模板名称", required=True, searchable=True, width=200),
            f("category", "模板分类", "select", options=OPT["template_category"], filterable=True),
            f("content", "模板正文（支持 {委托人} 等变量）", "textarea", editor=True),
            f("variables", "可用变量说明", "textarea"),
            f("builtin", "系统预置", "bool"),
        ],
        "list": ["name", "category", "variables", "builtin"], "search": ["name", "content"],
    },
    "evidence": {
        "label": "证据材料", "icon": "paperclip", "sort": "sort_order ASC, created_at DESC",
        "fields": [
            f("case_id", "关联案件", "ref", ref="cases", required=True, filterable=True),
            f("name", "证据名称", required=True, searchable=True, width=190),
            f("evidence_no", "证据编号"),
            f("type", "证据类型", "select", options=OPT["evidence_type"], filterable=True),
            f("source", "证据来源"), f("formed_at", "形成时间", "date"), f("obtained_at", "取得时间", "date"),
            f("purpose", "证明目的", "textarea"),
            f("dispute_fact", "关联争议事实", "textarea"),
            f("status", "证据状态", "select", options=OPT["evidence_status"], filterable=True, default="待收集"),
            f("group_name", "证据分组"), f("sort_order", "排序", "number", default=0),
            f("file_id", "附件", "file"), f("note", "备注", "textarea"),
        ],
        "list": ["evidence_no", "name", "case_id", "type", "status", "obtained_at", "group_name"],
        "search": ["name", "evidence_no", "source", "purpose", "dispute_fact"],
    },
    "evidence_history": {
        "label": "证据变更记录", "icon": "history", "sort": "created_at DESC", "readonly": True,
        "fields": [
            f("evidence_id", "关联证据", "ref", ref="evidence", required=True),
            f("field", "变更字段"), f("old_value", "变更前", "textarea"),
            f("new_value", "变更后", "textarea"), f("reason", "变更原因"),
        ],
        "list": ["evidence_id", "field", "old_value", "new_value", "created_at"], "search": ["field"],
    },
    "preservation": {
        "label": "保全记录", "icon": "shield", "sort": "end_on ASC",
        "fields": [
            f("case_id", "关联案件", "ref", ref="cases", required=True, filterable=True),
            f("ptype", "保全类型", "select", options=OPT["preservation_type"], required=True, filterable=True),
            f("target", "被保全标的", required=True, searchable=True, width=180),
            f("measure", "保全措施类型"), f("ruling_no", "裁定书案号", searchable=True),
            f("start_on", "保全起始日期", "date"), f("end_on", "保全到期日期", "date", required=True),
            f("amount", "保全金额", "money"),
            f("status", "当前状态", "select", options=OPT["preservation_status"], filterable=True, default="生效中"),
            f("file_id", "裁定书附件", "file"),
            f("handled_action", "处理动作"), f("handled_at", "处理日期", "date"),
            f("note", "备注", "textarea"),
        ],
        "list": ["target", "case_id", "ptype", "end_on", "amount", "status", "ruling_no"],
        "search": ["target", "ruling_no", "measure", "note"],
    },
    "preservation_history": {
        "label": "保全历史", "icon": "history", "sort": "created_at DESC", "readonly": True,
        "fields": [
            f("preservation_id", "关联保全", "ref", ref="preservation", required=True),
            f("action", "处理动作", required=True),
            f("old_end_on", "原到期日", "date"), f("new_end_on", "新到期日", "date"),
            f("ruling_no", "续期裁定书案号"), f("file_id", "续期裁定书", "file"),
            f("renewal_count", "累计续期次数", "number"), f("note", "处理备注", "textarea"),
        ],
        "list": ["preservation_id", "action", "old_end_on", "new_end_on", "renewal_count", "created_at"],
        "search": ["action", "ruling_no", "note"],
    },
    "schedules": {
        "label": "日程", "icon": "calendar", "sort": "start_at ASC",
        "fields": [
            f("title", "日程标题", required=True, searchable=True, width=200),
            f("type", "日程类型", "select", options=OPT["schedule_type"], required=True, filterable=True),
            f("case_id", "关联案件", "ref", ref="cases", filterable=True),
            f("start_at", "开始时间", "datetime", required=True),
            f("end_at", "结束时间", "datetime"),
            f("location", "地点"),
            f("status", "状态", "select", options=OPT["schedule_status"], filterable=True, default="正常"),
            f("remind_at", "提醒时间", "datetime"),
            f("note", "备注", "textarea"),
        ],
        "list": ["start_at", "title", "type", "case_id", "location", "status"],
        "search": ["title", "location", "note"],
    },
    "deadlines": {
        "label": "诉讼期限", "icon": "hourglass", "sort": "due_on ASC",
        "fields": [
            f("case_id", "关联案件", "ref", ref="cases", required=True, filterable=True),
            f("dtype", "期限类型", "select", options=OPT["deadline_type"], required=True, filterable=True),
            f("basis", "计算依据", "textarea", required=True),
            f("start_on", "起算日期", "date"), f("due_on", "截止日期", "date", required=True),
            f("remind_on", "提醒日期", "date"),
            f("status", "当前状态", "select", options=OPT["deadline_status"], filterable=True, default="进行中"),
            f("confirmed", "律师已确认", "bool"),
            f("calc_note", "辅助计算说明", "textarea"),
            f("note", "备注", "textarea"),
        ],
        "list": ["case_id", "dtype", "start_on", "due_on", "remind_on", "status", "confirmed"],
        "search": ["dtype", "basis", "calc_note", "note"],
    },
    "deadline_history": {
        "label": "期限变更记录", "icon": "history", "sort": "created_at DESC", "readonly": True,
        "fields": [
            f("deadline_id", "关联期限", "ref", ref="deadlines", required=True),
            f("old_due_on", "原截止日", "date"), f("new_due_on", "新截止日", "date"),
            f("basis", "计算依据", "textarea"), f("reason", "修改原因"),
        ],
        "list": ["deadline_id", "old_due_on", "new_due_on", "reason", "created_at"], "search": ["reason"],
    },
    "tasks": {
        "label": "待办事项", "icon": "check-square", "sort": "due_on ASC, created_at DESC",
        "fields": [
            f("title", "待办标题", required=True, searchable=True, width=220),
            f("case_id", "关联案件", "ref", ref="cases", filterable=True),
            f("client_id", "关联客户", "ref", ref="clients"),
            f("due_on", "截止日期", "date"),
            f("priority", "优先级", "select", options=OPT["priority"], filterable=True, default="中"),
            f("status", "状态", "select", options=OPT["task_status"], filterable=True, default="待办"),
            f("note", "备注", "textarea"),
        ],
        "list": ["title", "case_id", "due_on", "priority", "status"], "search": ["title", "note"],
    },
    "time_entries": {
        "label": "工时记录", "icon": "timer", "sort": "started_at DESC",
        "fields": [
            f("content", "工作内容", required=True, searchable=True, width=220),
            f("case_id", "关联案件", "ref", ref="cases", filterable=True),
            f("client_id", "关联客户", "ref", ref="clients"),
            f("started_at", "开始时间", "datetime"), f("ended_at", "结束时间", "datetime"),
            f("minutes", "实际时长(分钟)", "number"),
            f("billing_type", "计费方式", "select", options=OPT["billing_type"], filterable=True, default="计时"),
            f("rate", "小时费率", "money"), f("amount", "计费金额", "money"),
            f("source", "记录来源", "select", options=OPT["entry_source"], filterable=True, default="手动录入"),
        ],
        "list": ["started_at", "content", "case_id", "minutes", "billing_type", "amount"],
        "search": ["content"],
    },
    "expenses": {
        "label": "费用记录", "icon": "receipt", "sort": "occurred_at DESC",
        "fields": [
            f("case_id", "关联案件", "ref", ref="cases", filterable=True),
            f("category", "费用类型", "select", options=OPT["expense_category"], required=True, filterable=True),
            f("amount", "金额", "money", required=True),
            f("occurred_at", "发生日期", "date"),
            f("note", "备注", "textarea"),
        ],
        "list": ["occurred_at", "category", "case_id", "amount", "note"], "search": ["note"],
    },
    "payments": {
        "label": "收款记录", "icon": "wallet", "sort": "paid_at DESC",
        "fields": [
            f("case_id", "关联案件", "ref", ref="cases", filterable=True),
            f("client_id", "关联客户", "ref", ref="clients"),
            f("contract_id", "关联合同", "ref", ref="contracts"),
            f("receivable", "应收金额", "money"),
            f("received", "本次收款", "money", required=True),
            f("method", "收款方式", "select", options=OPT["pay_method"], filterable=True),
            f("paid_at", "收款日期", "date", required=True),
            f("note", "收款备注", "textarea"),
        ],
        "list": ["paid_at", "case_id", "client_id", "receivable", "received", "method"],
        "search": ["note"],
    },
    "legal_advisory": {
        "label": "常法服务合同", "icon": "building", "sort": "end_on ASC",
        "fields": [
            f("client_id", "常法客户", "ref", ref="clients", required=True, filterable=True),
            f("contract_no", "合同编号", searchable=True),
            f("start_on", "服务起始日期", "date"), f("end_on", "服务结束日期", "date"),
            f("amount", "服务金额", "money"),
            f("scope", "服务范围", "textarea"),
            f("status", "服务状态", "select", options=OPT["advisory_status"], filterable=True, default="生效中"),
            f("owner", "负责人"),
        ],
        "list": ["client_id", "contract_no", "start_on", "end_on", "amount", "status"],
        "search": ["contract_no", "scope", "owner"],
    },
    "advisory_logs": {
        "label": "常法工作记录", "icon": "list", "sort": "worked_at DESC",
        "fields": [
            f("advisory_id", "关联常法合同", "ref", ref="legal_advisory", required=True, filterable=True),
            f("client_id", "关联客户", "ref", ref="clients"),
            f("work_type", "工作类型", "select", options=OPT["advisory_work"], required=True, filterable=True),
            f("content", "服务内容", "textarea", required=True),
            f("minutes", "工作时长(分钟)", "number"),
            f("worked_at", "工作日期", "date", required=True),
            f("document_id", "关联文档", "ref", ref="documents"),
            f("note", "备注", "textarea"),
        ],
        "list": ["worked_at", "advisory_id", "work_type", "minutes", "content"], "search": ["content", "note"],
    },
    "knowledge_base": {
        "label": "知识资料", "icon": "book", "sort": "updated_at DESC",
        "fields": [
            f("title", "资料标题", required=True, searchable=True, width=220),
            f("category", "分类", "select", options=OPT["kb_category"], required=True, filterable=True),
            f("source", "来源", searchable=True), f("publisher", "发布机构"),
            f("published_at", "发布时间", "date"),
            f("effective_status", "效力状态", "select", options=OPT["effective_status"], filterable=True, default="待核验"),
            f("source_url", "原文入口"),
            f("retrieved_at", "检索/更新日期", "date"),
            f("tags", "标签", searchable=True),
            f("content", "全文内容", "textarea"),
            f("summary", "摘要", "textarea"), f("keywords", "关键词", "textarea"),
            f("case_id", "关联案件", "ref", ref="cases"), f("client_id", "关联客户", "ref", ref="clients"),
            f("file_id", "附件", "file"), f("favorite", "已收藏", "bool"),
            f("verified", "来源已核验", "bool"),
            f("note", "备注", "textarea"),
        ],
        "list": ["title", "category", "source", "effective_status", "retrieved_at", "verified"],
        "search": ["title", "source", "publisher", "tags", "content", "summary", "keywords", "note"],
    },
    "legal_search_logs": {
        "label": "检索记录", "icon": "search", "sort": "created_at DESC", "readonly": True,
        "fields": [f("keyword", "检索词", required=True), f("category", "检索范围"), f("result_count", "结果数", "number")],
        "list": ["keyword", "category", "result_count", "created_at"], "search": ["keyword"],
    },
    "notifications": {
        "label": "通知", "icon": "bell", "sort": "created_at DESC", "readonly": True,
        "fields": [
            f("title", "标题", required=True), f("body", "内容", "textarea"),
            f("level", "级别", "select", options=["info", "warning", "danger"], filterable=True),
            f("link", "跳转"), f("read_at", "已读时间", "datetime"),
        ],
        "list": ["title", "level", "body", "created_at", "read_at"], "search": ["title", "body"],
    },
    "operation_logs": {
        "label": "操作日志", "icon": "history", "sort": "created_at DESC", "readonly": True,
        "fields": [
            f("entity", "数据表", required=True, filterable=True),
            f("entity_id", "记录ID", "number"),
            f("action", "操作", "select", options=["create", "update", "delete", "restore", "renew", "handle", "stage_change"], filterable=True),
            f("summary", "摘要", "textarea"), f("before_json", "变更前", "textarea"),
            f("after_json", "变更后", "textarea"), f("undone", "已撤销", "bool"),
        ],
        "list": ["created_at", "action", "entity", "entity_id", "summary", "undone"],
        "search": ["entity", "summary"],
    },
    "files": {
        "label": "文件", "icon": "file", "sort": "uploaded_at DESC", "readonly": True,
        "fields": [
            f("name", "文件名", required=True, searchable=True), f("size", "大小(字节)", "number"),
            f("mime", "类型"), f("entity", "所属模块"), f("entity_id", "所属记录", "number"),
            f("path", "存储路径", "readonly"), f("deleted_at", "删除时间", "datetime"),
        ],
        "list": ["name", "mime", "size", "entity", "entity_id", "uploaded_at", "deleted_at"],
        "search": ["name", "entity"],
    },
}

# 只读表也带通用列；extra columns 单独建
EXTRA_TABLES = {
    "users": "id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT, role TEXT DEFAULT 'lawyer', created_at TEXT",
    "sessions": "id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL, created_at TEXT, expires_at TEXT",
    "settings": "id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, UNIQUE(user_id, key)",
}

MENU = [
    {"id": "home", "label": "首页总览", "icon": "home", "custom": True},
    {"id": "cases", "label": "案件管理", "icon": "briefcase", "table": "cases", "detail": True,
     "children": [{"id": "cases/list", "label": "案件列表"}, {"id": "cases/board", "label": "案件流程看板"}]},
    {"id": "clients", "label": "客户管理", "icon": "users", "table": "clients", "detail": True,
     "children": [{"id": "clients/list", "label": "客户档案"}, {"id": "clients/follow", "label": "待跟进客户"}]},
    {"id": "contracts", "label": "合同管理", "icon": "file-text", "table": "contracts",
     "children": [{"id": "contracts/list", "label": "全部合同"}, {"id": "contracts/review", "label": "待审查合同"}, {"id": "contracts/expiring", "label": "即将到期"}]},
    {"id": "documents", "label": "文书中心", "icon": "file", "table": "documents",
     "children": [{"id": "documents/list", "label": "我的文书"}, {"id": "documents/templates", "label": "文书模板"}, {"id": "documents/new", "label": "智能生成文书"}]},
    {"id": "legal_search", "label": "法律检索", "icon": "search", "custom": True,
     "children": [{"id": "legal_search/all", "label": "法规与判例检索"}, {"id": "legal_search/logs", "label": "检索记录"}]},
    {"id": "evidence", "label": "证据材料", "icon": "paperclip", "table": "evidence",
     "children": [{"id": "evidence/list", "label": "证据清单"}, {"id": "evidence/pending", "label": "待补充证据"}, {"id": "evidence/catalog", "label": "生成证据目录"}]},
    {"id": "preservation", "label": "保全管理", "icon": "shield", "custom": True,
     "children": [{"id": "preservation/list", "label": "保全汇总"}, {"id": "preservation/risk", "label": "高风险预警"}, {"id": "preservation/history", "label": "续期历史"}]},
    {"id": "advisory", "label": "常法客户", "icon": "building", "table": "legal_advisory", "custom": True,
     "children": [{"id": "advisory/list", "label": "服务合同"}, {"id": "advisory/logs", "label": "工作记录"}, {"id": "advisory/report", "label": "年度顾问报告"}]},
    {"id": "schedules", "label": "日程与提醒", "icon": "calendar", "custom": True,
     "children": [{"id": "schedules/calendar", "label": "日历视图"}, {"id": "schedules/list", "label": "日程列表"}, {"id": "schedules/deadlines", "label": "诉讼期限"}, {"id": "schedules/tasks", "label": "待办事项"}]},
    {"id": "billing", "label": "工时与计费", "icon": "timer", "custom": True,
     "children": [{"id": "billing/time", "label": "工时记录"}, {"id": "billing/expenses", "label": "费用记录"}, {"id": "billing/payments", "label": "收款与账单"}]},
    {"id": "knowledge", "label": "知识库", "icon": "book", "table": "knowledge_base",
     "children": [{"id": "knowledge/list", "label": "全部资料"}, {"id": "knowledge/fav", "label": "我的收藏"}, {"id": "knowledge/unverified", "label": "待核验来源"}]},
    {"id": "ai", "label": "AI法律助手", "icon": "sparkles", "custom": True},
    {"id": "analytics", "label": "经营分析", "icon": "bar-chart", "custom": True},
    {"id": "workspace", "label": "我的工作台", "icon": "grid", "custom": True,
     "children": [{"id": "workspace/logs", "label": "操作日志与撤销"}, {"id": "workspace/recycle", "label": "回收站"}, {"id": "workspace/files", "label": "文件仓库"}]},
    {"id": "settings", "label": "系统设置", "icon": "settings", "custom": True,
     "children": [{"id": "settings/profile", "label": "账户与偏好"}, {"id": "settings/backup", "label": "备份与恢复"}, {"id": "settings/import", "label": "导入导出"}, {"id": "settings/ai", "label": "AI 配置"}]},
]

BUILTIN_TEMPLATES = [
    ("民事起诉状", "诉讼文书", "{委托人} 诉 {对方当事人} {案由} 一案，现依法向 {受理法院} 提起民事诉讼。\n\n诉讼请求：\n1. （请填写具体诉讼请求）\n2. 本案诉讼费用由被告承担。\n\n事实与理由：\n（请依据案件事实填写，AI 不得代编事实）\n\n此致\n{受理法院}\n\n具状人：{委托人}\n{当前日期}\n\n案件编号：{案件编号}"),
    ("民事答辩状", "诉讼文书", "答辩人：{委托人}\n被答辩人：{对方当事人}\n案由：{案由}\n受理法院：{受理法院}\n\n答辩意见：\n（请依据案件事实与证据填写）\n\n此致\n{受理法院}\n\n答辩人：{委托人}\n{当前日期}\n案件编号：{案件编号}"),
    ("代理词", "诉讼文书", "审判长、审判员：\n\n受 {委托人} 委托，就其与 {对方当事人} {案由} 一案（{案件编号}），发表如下代理意见：\n\n一、关于本案争议焦点\n（请结合证据材料填写）\n\n二、关于法律适用\n（引用的法条须经核验后填写，不得由 AI 编造）\n\n代理人：\n{当前日期}"),
    ("上诉状", "诉讼文书", "上诉人：{委托人}\n被上诉人：{对方当事人}\n\n因 {案由} 一案，不服 {受理法院} 作出的一审裁判，现依法提起上诉。\n\n上诉请求：\n（请填写）\n\n事实与理由：\n（请填写）\n\n此致\n（请填写二审法院）\n\n上诉人：{委托人}\n{当前日期}"),
    ("律师函", "常用函件", "致：{对方当事人}\n\n本律师受 {委托人} 委托，就 {案由} 相关事宜致函如下：\n\n（请依据授权范围与事实填写）\n\n特此函告。\n\n律师：\n{当前日期}"),
    ("法律意见书", "法律意见", "致：{委托人}\n\n关于：{案由} 相关法律问题\n案件编号：{案件编号}\n\n一、事实基础\n（依据委托人提供材料填写）\n\n二、法律分析\n（引用法条须核验，注明来源与检索日期）\n\n三、结论与建议\n\n出具人：\n{当前日期}"),
    ("财产保全申请书", "诉讼文书", "申请人：{委托人}\n被申请人：{对方当事人}\n受理法院：{受理法院}\n\n请求事项：\n请求依法查封/冻结被申请人名下价值人民币（请填写）元的财产。\n\n事实与理由：\n（请依据案件事实填写，并核对保全期限规则）\n\n此致\n{受理法院}\n\n申请人：{委托人}\n{当前日期}"),
    ("证据目录", "诉讼文书", "案由：{案由}\n案件编号：{案件编号}\n提交人：{委托人}\n\n（本目录由系统依据已录入证据材料自动生成，见证据材料模块）\n\n{当前日期}"),
    ("授权委托书", "常用函件", "委托人：{委托人}\n受托人：（请填写）\n\n现委托上列受托人在我与 {对方当事人} {案由} 一案中，作为我的诉讼代理人。\n\n代理权限：（请填写一般授权/特别授权及具体事项）\n\n委托人：{委托人}\n{当前日期}"),
    ("法律服务合同", "合同范本", "甲方（委托方）：{委托人}\n乙方（受托方）：（请填写）\n\n一、服务事项：{案由} 相关法律服务\n二、服务期限：（请填写）\n三、律师费及支付方式：（请填写）\n四、双方权利义务：（请填写）\n五、违约责任：（请填写）\n\n甲方：{委托人}\n乙方：\n{当前日期}\n案件编号：{案件编号}"),
]

SEED_KNOWLEDGE = [
    ("中华人民共和国民法典", "法律法规", "全国人民代表大会", "2020-05-28", "现行有效", "https://www.gov.cn/", "民法典 合同 侵权 物权", "民事基本法律，使用时须核对具体条文现行文本与司法解释。", "待核验"),
    ("中华人民共和国民事诉讼法", "法律法规", "全国人大常委会", "2023-09-01", "现行有效", "https://www.gov.cn/", "诉讼 程序 举证 期限 保全", "程序性事项请以法院要求与现行法条为准。", "待核验"),
    ("民事诉讼证据规定", "实务指引", "最高人民法院", "2019-12-25", "现行有效", "https://www.court.gov.cn/", "证据 举证期限 质证", "举证期限由法院指定或当事人协商并经法院准许，不得套用固定天数。", "待核验"),
]


def ddl_for(table, meta):
    cols = ["id INTEGER PRIMARY KEY AUTOINCREMENT", "user_id INTEGER NOT NULL DEFAULT 1"]
    for fld in meta["fields"]:
        if fld["key"] in ("created_at", "updated_at", "deleted_at", "uploaded_at"):
            continue
        cols.append("%s %s" % (fld["key"], SQL_TYPE.get(fld["type"], "TEXT")))
    cols += ["created_at TEXT", "updated_at TEXT", "deleted_at TEXT", "uploaded_at TEXT"]
    return "CREATE TABLE IF NOT EXISTS %s (%s)" % (table, ", ".join(cols))


def init_db(conn):
    c = conn.cursor()
    for name, sql in EXTRA_TABLES.items():
        c.execute("CREATE TABLE IF NOT EXISTS %s (%s)" % (name, sql))
    for table, meta in TABLES.items():
        c.execute(ddl_for(table, meta))
        c.execute("CREATE INDEX IF NOT EXISTS idx_%s_user ON %s(user_id)" % (table, table))
    conn.commit()
    return c
