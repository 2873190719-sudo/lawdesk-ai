/* LawDesk AI - 业务页面（一）：首页 / 案件 / 客户 / 合同 / 文书 / 检索 / 证据 */
import { LD } from './core.js';
import { CRUD } from './components.js';

const E=LD.esc;
function casePreset(){ const v=sessionStorage.getItem('ld_filter_case'); sessionStorage.removeItem('ld_filter_case'); return v?{case_id:v}:{}; }
function goCaseRecords(route,caseId){ sessionStorage.setItem('ld_filter_case',String(caseId)); LD.go(route); }
function bindGo(root){
  root.querySelectorAll('[data-go]').forEach(el=>el.addEventListener('click',e=>{ e.stopPropagation(); LD.go(el.dataset.go); }));
}
function relList(rows,cols,table,empty='暂无记录'){
  if(!rows||!rows.length) return `<div class="empty" style="padding:20px"><p>${E(empty)}</p></div>`;
  return `<div class="mini-list">${rows.slice(0,8).map(r=>`<div class="mini-item" data-rec="${r.id}">
    ${cols.map(c=>`<span class="${c.cls||'mt'}">${c.fn(r)}</span>`).join('')}</div>`).join('')}</div>`;
}

/* ==================== 首页总览 ==================== */
LD.register('home', async view=>{
  const d=await LD.api('GET','/api/dashboard');
  const hour=new Date().getHours();
  const greet=hour<11?'早上好':hour<14?'中午好':hour<18?'下午好':'晚上好';
  const cards=[
    {k:'todo',label:'今日待办',hint:'未完成待办事项',go:'schedules/tasks',cls:''},
    {k:'hearings',label:'本周开庭',hint:'未来 7 天开庭日程',go:'schedules/calendar',cls:'a'},
    {k:'deadlines',label:'临近期限',hint:'7 天内到期诉讼期限',go:'schedules/deadlines',cls:'d'},
    {k:'contracts',label:'待审查合同',hint:'待审查 + 审查中',go:'contracts/review',cls:'p'},
    {k:'cases',label:'待处理案件',hint:'进行中案件',go:'cases/list',cls:'s'},
  ];
  const urgent=d.urgent_preservation||[];
  view.innerHTML=`
    <div class="welcome">
      <div><h1>${greet}，${E(LD.user.display_name||'律师')}。</h1>
        <p>今天是 ${E(d.today)} ${E(d.weekday)}。今日有 <b>${d.cards.todo}</b> 项待办，建议优先处理保全风险、合同审查和案件期限提醒。</p></div>
      <div class="wdate"><b>${E(d.today.slice(5))}</b>${E(d.today.slice(0,4))} · ${E(d.weekday)}</div>
    </div>
    <div class="grid g5 mt14">${cards.map(c=>`<div class="stat-card ${c.cls}" data-go="${c.go}"><div class="bar"></div>
      <div class="label">${c.label}</div><div class="value">${d.cards[c.k]}</div><div class="hint">${c.hint} →</div></div>`).join('')}</div>
    ${urgent.length?`<div class="alert danger mt14"><div><b>保全风险优先提醒（${urgent.length} 项）</b>：${urgent.slice(0,3).map(x=>`${E(x.target)}（${E(x.risk_label)}，${x.days} 天）`).join('；')}
      <button class="btn sm danger" data-go="preservation/risk">立即处理</button></div></div>`:''}
    <div class="home-grid mt14">
      <div class="col">
        ${LD.card('合同审查与案件概览',`
          <div class="grid g3 mb12">
            <div class="center"><div style="font-size:23px;font-weight:650">${d.contract_stats['待审查']}</div><div class="small muted">待审查合同</div></div>
            <div class="center"><div style="font-size:23px;font-weight:650">${d.contract_stats['审查中']}</div><div class="small muted">审查中合同</div></div>
            <div class="center"><div style="font-size:23px;font-weight:650">${d.contract_stats['已完成']}</div><div class="small muted">已完成合同</div></div>
          </div>
          <div class="divider"></div><div class="small muted mb8">最近上传的合同</div>
          ${relList(d.recent_contracts,[{fn:r=>`${E(r.name||'')}`},{cls:'ms',fn:r=>LD.badge(r.status||'')},{cls:'ms',fn:r=>E(LD.date(r.signed_at||r.created_at))}],'contracts','暂无合同，点击右上角新建')}
          <div class="btn-row mt12"><button class="btn sm" data-go="contracts/list">全部合同</button><button class="btn sm" data-go="contracts/review">待审查</button><button class="btn sm" data-new="contracts">上传合同</button></div>`,
          '<span class="link-more" data-go="contracts/list">查看全部 ›</span>')}
        ${LD.card('法律检索',`
          <div class="quick-grid mb12">${Object.entries(d.kb_counts||{}).map(([k,v])=>`<div class="quick-tile purple" data-kb="${E(k)}"><span class="qi">▣</span>${E(k)}<div class="small muted">${v} 条</div></div>`).join('')}</div>
          <div class="small muted mb8">最近检索记录</div>
          ${relList(d.recent_search,[{fn:r=>E(r.keyword)},{cls:'ms',fn:r=>E(r.category||'')},{cls:'ms',fn:r=>E(String(r.created_at||'').slice(0,10))}],'legal_search_logs','暂无检索记录')}
          <div class="small muted mt12 mb8">热门检索词</div>
          <div class="pill-tabs">${(d.hot_terms||[]).length?d.hot_terms.map(t=>`<span class="pill" data-term="${E(t)}">${E(t)}</span>`).join(''):'<span class="small muted">检索后自动统计</span>'}</div>`,
          '<span class="link-more" data-go="legal_search/all">进入检索 ›</span>')}
        ${LD.card('本月经营速览',`<div class="grid g2">
          <div><div class="small muted">本月实际回款</div><div style="font-size:20px;font-weight:650" class="mono">${LD.money(d.income_month)}</div></div>
          <div><div class="small muted">在办案件</div><div style="font-size:20px;font-weight:650">${d.cards.cases}</div></div></div>
          <div class="btn-row mt12"><button class="btn sm" data-go="analytics">查看经营分析</button><button class="btn sm" data-go="billing/payments">收款记录</button></div>`)}
      </div>
      <div class="col">
        ${LD.card('今日待办与临近期限',`
          <div class="tabs"><span class="tab active" data-tab="deadlines">临近期限</span><span class="tab" data-tab="todo">今日待办</span></div>
          <div id="home-tab-body"></div>`, '<span class="link-more" data-go="schedules/deadlines">期限管理 ›</span>')}
        ${LD.card('案件进展',`<div id="home-cases"></div>`,'<span class="link-more" data-go="cases/list">全部案件 ›</span>')}
        ${LD.card('文书写作快捷区',`<div class="quick-grid">${['民事起诉状','民事答辩状','代理词','上诉状','律师函','更多模板'].map((t,i)=>`<div class="quick-tile" data-tpl="${E(t)}"><span class="qi">▤</span>${E(t)}</div>`).join('')}</div>`)}
      </div>
      <div class="col">
        ${LD.card('✦ AI 法律助手',`
          <div class="quick-grid mb12">${[['review_contract','审查合同'],['summarize_case','总结案件材料'],['draft_document','生成法律意见书'],
            ['summarize_case','整理诉讼材料'],['summarize_case','法律风险评估'],['chat','法律咨询问答']].map(([a,l])=>`<div class="quick-tile purple" data-ai="${a}"><span class="qi">✦</span>${l}</div>`).join('')}</div>
          <div class="fld"><label>选择案件上下文</label><select id="home-ai-case"><option value="">不选择</option>
            ${Object.entries(LD.lookups.cases||{}).map(([id,n])=>`<option value="${id}">${E(n)}</option>`).join('')}</select></div>
          <div class="fld mt8"><label>直接提问</label><textarea id="home-ai-q" style="min-height:58px" placeholder="输入问题，回车发送…"></textarea></div>
          <button class="btn primary w100 mt8" id="home-ai-send">发送给 AI 助手</button>
          <div class="ai-disclaimer mt8">AI 读取你有权限访问的业务资料；生成内容须律师核验，不编造事实或法条。</div>`)}
        ${LD.card('今日时间轴',`${(d.today_schedule||[]).length?`<div class="timeline">${d.today_schedule.map(s=>`<div class="tl-item ${s.status==='已完成'?'done':''}" data-go="schedules/calendar">
            <span class="mtime">${E(String(s.start_at||'').slice(11,16)||'全天')}</span> <span class="tt">${E(s.title)}</span>
            <div class="ts">${LD.badge(s.type||'')} ${E(s.location||'')}</div></div>`).join('')}</div>`:'<div class="empty" style="padding:16px"><p>今日暂无日程</p></div>'}
          <div class="hint mt8">日程全部来自你自己的日程数据，可自由修改或删除。</div>`,
          '<span class="link-more" data-go="schedules/calendar">日历 ›</span>')}
        ${LD.card('待补充证据',`${(d.pending_evidence||[]).length?d.pending_evidence.map(x=>`<div class="mini-item" data-evi="${x.id}" data-case="${x.case_id||''}">
          <span class="mt">${E(x.name)}</span><span class="ms">${LD.badge(x.status||'')}</span></div>`).join(''):'<div class="empty" style="padding:16px"><p>暂无待收集证据</p></div>'}`,
          '<span class="link-more" data-go="evidence/pending">全部 ›</span>')}
      </div>
    </div>
    ${LD.card('快捷工作区',`<div class="grid g2">
      <div><div class="small muted mb8">文书写作</div><div class="quick-grid">${['起诉状','答辩状','代理词','合同模板','更多模板'].map(t=>`<div class="quick-tile accent" data-tpl="${E(t)}">${E(t)}</div>`).join('')}</div></div>
      <div><div class="small muted mb8">知识库</div><div class="quick-grid">${['法律法规','案例判例','律师文书','实务指引','办案工具'].map(t=>`<div class="quick-tile purple" data-kb="${E(t)}">${E(t)}</div>`).join('')}</div></div>
    </div>`)}
    <div class="hint mt12">所有统计均由系统真实业务数据实时计算；点击任意卡片或条目可直接进入对应数据列表。</div>`;
  bindGo(view);
  // 首页 tab
  const tabBody=view.querySelector('#home-tab-body');
  const drawTab=(which)=>{
    view.querySelectorAll('[data-tab]').forEach(t=>t.classList.toggle('active',t.dataset.tab===which));
    if(which==='deadlines'){
      const rows=d.upcoming_deadlines||[];
      tabBody.innerHTML=rows.length?rows.map(r=>`<div class="mini-item" data-go="schedules/deadlines"><span class="mtime">${E(String(r.due_on||'').slice(5))}</span>
        <span class="mt">${E(r.dtype||'')} · ${E(LD.lookup('cases',r.case_id))}</span><span class="ms">${LD.badge(r.status||'')}</span></div>`).join(''):'<div class="empty" style="padding:18px"><p>暂无临近期限</p></div>';
    } else {
      tabBody.innerHTML=`<div class="mini-list">${(d.notices||[]).filter(n=>n.key==='tasks').map(n=>`<div class="mini-item" data-go="schedules/tasks"><span class="mt">${E(n.title)}</span><span class="ms">${E(n.body)}</span></div>`).join('')||'<div class="empty" style="padding:18px"><p>暂无待办</p></div>'}</div>`;
    }
    tabBody.querySelectorAll('[data-go]').forEach(el=>el.addEventListener('click',()=>LD.go(el.dataset.go)));
  };
  drawTab('deadlines');
  view.querySelectorAll('[data-tab]').forEach(t=>t.addEventListener('click',()=>drawTab(t.dataset.tab)));
  // 案件进展
  const cases=await LD.api('GET','/api/t/cases?pageSize=6');
  view.querySelector('#home-cases').innerHTML=relList(cases.rows,[
    {fn:r=>`${E(r.name)}`},{cls:'ms',fn:r=>LD.badge(r.stage||'')},{cls:'ms',fn:r=>E(LD.date(r.next_key_date))}],'cases','暂无案件');
  view.querySelectorAll('#home-cases [data-rec]').forEach(el=>el.addEventListener('click',()=>LD.go('case/'+el.dataset.rec)));
  // 事件
  view.querySelectorAll('[data-kb]').forEach(el=>el.addEventListener('click',()=>{ sessionStorage.setItem('ld_kb_cat',el.dataset.kb); LD.go('knowledge/list'); }));
  view.querySelectorAll('[data-tpl]').forEach(el=>el.addEventListener('click',()=>{ sessionStorage.setItem('ld_tpl_name',el.dataset.tpl); LD.go('documents/new'); }));
  view.querySelectorAll('[data-term]').forEach(el=>el.addEventListener('click',()=>{ sessionStorage.setItem('ld_search_term',el.dataset.term); LD.go('legal_search/all'); }));
  view.querySelectorAll('[data-evi]').forEach(el=>el.addEventListener('click',()=>{ if(el.dataset.case) LD.go('case/'+el.dataset.case); else LD.go('evidence/pending'); }));
  view.querySelectorAll('[data-ai]').forEach(el=>el.addEventListener('click',()=>{
    LD.renderAIPanel(); LD.toggleAI(true);
    const chip=LD.el('ai-panel').querySelector(`[data-ai="${el.dataset.ai}"]`); chip?.click();
    const cs=view.querySelector('#home-ai-case'); if(cs?.value) LD.el('ai-case').value=cs.value;
  }));
  view.querySelectorAll('[data-new]').forEach(b=>b.addEventListener('click',()=>CRUD.openForm(b.dataset.new,null,()=>LD.reload())));
  const send=async()=>{
    const q=LD.el('home-ai-q').value.trim(); if(!q){ LD.toast('请输入问题','info'); return; }
    LD.renderAIPanel(); LD.toggleAI(true);
    const cs=view.querySelector('#home-ai-case'); if(cs?.value) LD.el('ai-case').value=cs.value;
    LD.el('ai-input').value=q; LD.aiSend();
  };
  LD.el('home-ai-send').addEventListener('click',send);
  LD.el('home-ai-q').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } });
});

/* ==================== 案件列表 / 看板 ==================== */
async function caseList(view){
  await CRUD.render(view,'cases',{title:'案件管理',sub:'案件是系统的核心；点击任意一行进入独立案件详情页',
    headActions:`<button class="btn" id="case-board-btn">流程看板</button><button class="btn primary" id="case-new-btn">＋ 新建案件</button>`,
    extraActions:`<button class="btn" id="case-conflict-btn">利益冲突检查</button>`});
  view.querySelector('#case-new-btn')?.addEventListener('click',()=>CRUD.openForm('cases',null,()=>LD.reload()));
  view.querySelector('#case-board-btn')?.addEventListener('click',()=>LD.go('cases/board'));
  view.querySelector('#case-conflict-btn')?.addEventListener('click',()=>{
    LD.openModal({title:'潜在利益冲突检查',body:`<div class="fld"><label>输入拟对方当事人名称</label><input id="cf-name" placeholder="例如：某贸易公司"></div><div id="cf-result" class="mt12"></div>
      <div class="hint mt8">仅作名称匹配提示，不构成利益冲突认定。</div>`,footer:'<button class="btn" data-x>关闭</button>',
      onAction:()=>true});
    LD.el('cf-name').addEventListener('input',async e=>{
      const v=e.target.value.trim(); if(v.length<2){ LD.el('cf-result').innerHTML=''; return; }
      const d=await LD.api('GET','/api/conflict/check?opponent='+encodeURIComponent(v));
      LD.el('cf-result').innerHTML=d.items.length?`<div class="alert warning">匹配到 ${d.items.length} 条历史记录：<br>${d.items.map(x=>`· ${E(x.name)}（客户 ${E(x.client_name||'—')}）`).join('<br>')}<br><span class="small">${E(d.note)}</span></div>`:'<div class="hint">未匹配到历史记录。</div>';
    });
  });
}
LD.register('cases',caseList);
LD.register('cases/list',caseList);

LD.register('cases/board',async view=>{
  const d=await LD.api('GET','/api/t/cases?pageSize=200');
  const stages=LD.stages||[];
  view.innerHTML=LD.pageHead('案件流程看板','按当前阶段分组，点击卡片进入案件详情；阶段变更在详情页操作并留痕',
    `<button class="btn" data-go="cases/list">表格视图</button><button class="btn primary" id="bd-new">＋ 新建案件</button>`)+
    `<div class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">${stages.map(s=>{
      const list=d.rows.filter(r=>r.stage===s);
      return `<div class="card"><div class="card-head"><h2>${E(s)}</h2><span class="badge">${list.length}</span></div>
        ${list.length?list.map(r=>`<div class="rec-card mb8" data-case="${r.id}" style="padding:10px">
          <div class="strong small">${E(r.name)}</div><div class="small muted">${E(LD.lookup('clients',r.client_id))} · ${E(r.cause||'')}</div>
          <div class="mt8">${LD.badge(r.status||'')} ${r.next_key_date?`<span class="small muted">${E(LD.date(r.next_key_date))}</span>`:''}</div></div>`).join(''):'<div class="hint center" style="padding:14px">暂无案件</div>'}</div>`;
    }).join('')}</div>`;
  bindGo(view);
  view.querySelectorAll('[data-case]').forEach(el=>el.addEventListener('click',()=>LD.go('case/'+el.dataset.case)));
  view.querySelector('#bd-new').addEventListener('click',()=>CRUD.openForm('cases',null,()=>LD.reload()));
});

/* ==================== 案件详情 ==================== */
LD.register('case_detail',async(view,id)=>{
  const d=await LD.api('GET','/api/cases/'+id+'/full');
  if(d.error){ view.innerHTML=LD.empty(d.error); return; }
  const ca=d.case, cl=d.client||{};
  const stages=LD.stages||[], cur=stages.indexOf(ca.stage);
  const risks=await LD.api('GET','/api/risk/preservation');
  const myRisks=risks.items.filter(x=>String(x.case_id)===String(id));
  const totalMinutes=(d.time_entries||[]).reduce((s,x)=>s+Number(x.minutes||0),0);
  const received=(d.payments||[]).reduce((s,x)=>s+Number(x.received||0),0);
  const fee=Number(ca.fee||0), unpaid=Math.max(fee-received,0);
  const nextDate=ca.next_key_date? (Math.ceil((new Date(ca.next_key_date)-new Date(LD.today))/86400000)) : null;
  const lastStageLog=(d.history||[]).find(h=>h.action==='stage_change'&&!h.undone);
  view.innerHTML=`
    <div class="flex between mb12"><button class="btn sm" data-go="cases/list">‹ 返回案件列表</button>
      <div class="btn-row">
        <button class="btn sm" id="cd-files">文件仓库</button>
        <button class="btn sm" id="cd-edit">编辑案件</button>
        <button class="btn sm primary" id="cd-doc">生成文书</button>
      </div></div>
    <div class="detail-head">
      <div class="flex between"><h1>${E(ca.name)}</h1><div>${LD.badge(ca.status||'')} ${LD.badge('风险'+(ca.risk_level||'—'))}</div></div>
      <div class="sub"><span>编号：${E(ca.case_no||'未填写')}</span><span>客户：${E(cl.name||'未关联')}</span>
        <span>当前阶段：${E(ca.stage||'—')}</span><span>律师费：${LD.money(ca.fee)}</span></div>
      <div class="stage-flow">${stages.map((s,i)=>`<div class="stage-node ${i<cur?'done':''} ${i===cur?'current':''}" data-stage="${E(s)}">${E(s)}</div>`).join('')}</div>
      <div class="hint mt8">点击阶段节点修改案件进度（修改前确认，每次变化自动记录时间与原/新状态）。
        ${lastStageLog?`<button class="btn sm" id="cd-undo">撤销最近一次阶段变更</button>`:''}</div>
    </div>
    ${myRisks.filter(x=>x.priority<=1).length?`<div class="alert danger mb12">本案件有 ${myRisks.filter(x=>x.priority<=1).length} 项高风险保全事项，
      <button class="btn sm danger" data-go="preservation/risk">前往处理</button></div>`:''}
    <div class="detail-grid">
      <div>
        ${LD.card('基本信息',`<div class="kv-grid">${[
          ['案件名称',ca.name],['案件编号',ca.case_no],['案由',ca.cause],['委托人',cl.name],['对方当事人',ca.opponent],
          ['联系方式',ca.contact||cl.phone],['受理法院',ca.court],['承办法官',ca.judge],['收案日期',LD.date(ca.received_at)],
          ['立案日期',LD.date(ca.filed_at)],['律师费',LD.money(ca.fee)],['风险等级',ca.risk_level],['当前阶段',ca.stage],['负责人',ca.lawyer]
        ].map(([k,v])=>`<div class="kv"><b>${E(k)}</b><span>${E(v==null||v===''?'—':String(v))}</span></div>`).join('')}</div>
        ${ca.note?`<div class="hint mt12">备注：${E(ca.note)}</div>`:''}`)}
        <div class="card"><div class="tabs" id="cd-tabs">
          <span class="tab active" data-t="timeline">案件时间线</span><span class="tab" data-t="docs">文档管理</span>
          <span class="tab" data-t="evidence">证据材料</span><span class="tab" data-t="comm">沟通记录</span>
          <span class="tab" data-t="history">操作历史</span></div>
          <div id="cd-tab-body"></div></div>
      </div>
      <div>
        ${LD.card('关键日期及倒计时',`<div class="center" style="padding:6px 0">
          <div class="small muted">下一关键日期</div><div style="font-size:18px;font-weight:650">${E(LD.date(ca.next_key_date))}</div>
          <div style="font-size:26px;font-weight:650;color:${nextDate!=null&&nextDate<=7?'var(--danger)':'var(--primary)'}">${nextDate==null?'—':(nextDate<0?'已逾期 '+(-nextDate)+' 天':'剩余 '+nextDate+' 天')}</div></div>
          <div class="btn-row"><button class="btn sm" data-recgo="schedules/calendar">日程</button><button class="btn sm" data-recgo="schedules/deadlines">期限</button></div>`)}
        ${LD.card('待办事项',`${(d.tasks||[]).length?d.tasks.slice(0,6).map(t=>`<div class="mini-item" data-recgo="schedules/tasks"><span class="mt">${E(t.title)}</span>${LD.badge(t.status||'')}</div>`).join(''):'<div class="hint">暂无待办</div>'}
          <button class="btn sm mt8" id="cd-add-task">＋ 新增待办</button>`)}
        ${LD.card('工时 / 费用 / 收款',`<div class="grid g2">
          <div><div class="small muted">累计工时</div><div style="font-size:17px;font-weight:650">${(totalMinutes/60).toFixed(1)} h</div></div>
          <div><div class="small muted">费用合计</div><div style="font-size:17px;font-weight:650">${LD.money((d.expenses||[]).reduce((s,x)=>s+Number(x.amount||0),0))}</div></div>
          <div><div class="small muted">已收款</div><div style="font-size:17px;font-weight:650;color:var(--success)">${LD.money(received)}</div></div>
          <div><div class="small muted">未收金额</div><div style="font-size:17px;font-weight:650;color:${unpaid>0?'var(--danger)':'var(--muted)'}">${LD.money(unpaid)}</div></div></div>
          <div class="btn-row mt12"><button class="btn sm" data-recgo="billing/time">工时</button><button class="btn sm" data-recgo="billing/expenses">费用</button><button class="btn sm" data-recgo="billing/payments">收款</button></div>`)}
        ${LD.card('案件风险提醒',`${myRisks.length?myRisks.map(x=>`<div class="risk-stripe" style="border-left-color:${x.risk_color}" data-recgo="preservation/risk">
          <span class="rt">${E(x.target)}</span><span class="rd">${E(x.risk_label)} · ${x.days} 天</span></div>`).join(''):'<div class="hint">暂无保全风险记录</div>'}`)}
        ${LD.card('最近沟通记录',`${(d.communications||[]).length?d.communications.slice(0,5).map(x=>`<div class="mini-item"><span class="mt">${E(String(x.content||'').slice(0,40))}</span><span class="ms">${E(String(x.contact_at||'').slice(0,10))}</span></div>`).join(''):'<div class="hint">暂无沟通记录</div>'}
          <button class="btn sm mt8" id="cd-add-comm">＋ 新增沟通</button>`)}
      </div>
    </div>`;
  bindGo(view);
  view.querySelectorAll('[data-recgo]').forEach(el=>el.addEventListener('click',()=>goCaseRecords(el.dataset.recgo,id)));
  view.querySelector('#cd-edit').addEventListener('click',()=>CRUD.openForm('cases',id,()=>LD.reload()));
  view.querySelector('#cd-files').addEventListener('click',()=>CRUD.openFiles('cases',id,'案件文件仓库 · '+ca.name));
  view.querySelector('#cd-doc').addEventListener('click',()=>{ sessionStorage.setItem('ld_doc_case',String(id)); LD.go('documents/new'); });
  view.querySelectorAll('[data-stage]').forEach(el=>el.addEventListener('click',()=>{
    const s=el.dataset.stage;
    if(s===ca.stage){ LD.toast('当前已处于该阶段','info'); return; }
    LD.confirm({title:'修改案件阶段',body:`<b>${E(ca.name)}</b><br>阶段将由 <b>${E(ca.stage||'—')}</b> 修改为 <b>${E(s)}</b>。<br>系统将自动记录操作时间、修改前状态与修改后状态，并可在操作后撤销。`,
      okText:'确认修改',onOk:async()=>{ const r=await LD.api('PUT','/api/t/cases/'+id,{stage:s});
        LD.toast('案件阶段已更新为「'+s+'」','success',r.log_id); LD.reload(); }});
  }));
  view.querySelector('#cd-undo')?.addEventListener('click',async()=>{
    if(!lastStageLog) return;
    await LD.api('POST','/api/undo/'+lastStageLog.id,{}); LD.toast('已撤销最近一次阶段变更'); LD.reload();
  });
  view.querySelector('#cd-add-task').addEventListener('click',()=>CRUD.openForm('tasks',null,()=>LD.reload(),{case_id:Number(id),client_id:ca.client_id}));
  view.querySelector('#cd-add-comm').addEventListener('click',()=>CRUD.openForm('communications',null,()=>LD.reload(),{client_id:ca.client_id,case_id:Number(id)}));
  // Tab 内容
  const body=view.querySelector('#cd-tab-body');
  const tabs={
    timeline:()=>`<div class="timeline">${(d.events||[]).length?d.events.map(ev=>`<div class="tl-item done"><span class="tt">${E(ev.title)}</span>
      <div class="ts">${E(String(ev.event_at||'').slice(0,16))} · ${E(ev.type||'')}</div>${ev.content?`<div class="small">${E(ev.content)}</div>`:''}</div>`).join(''):'<div class="empty" style="padding:20px"><p>暂无事件</p></div>'}</div>
      <button class="btn sm mt8" id="cd-add-event">＋ 手动添加事件</button>`,
    docs:()=>`<div class="grid g2 mb12"><div class="dropzone" id="cd-drop">拖拽上传案件文档，或点击选择文件</div>
      <div class="hint">支持按文档类型分类；上传后自动归档到本案件文档区。可在文件仓库中预览、下载、重命名与删除。</div></div>
      ${(d.documents||[]).length?d.documents.map(x=>`<div class="mini-item" data-doc="${x.id}"><span class="mt">${E(x.title)}</span>
        <span class="ms">${LD.badge(x.category||'')} ${LD.badge(x.status||'')}</span></div>`).join(''):'<div class="hint">暂无文档</div>'}
      <button class="btn sm mt8" id="cd-add-doc">＋ 新建文书</button>`,
    evidence:()=>`${(d.evidence||[]).length?d.evidence.map(x=>`<div class="mini-item" data-evi="${x.id}"><span class="mt">${E(x.evidence_no||'')} ${E(x.name)}</span>
      <span class="ms">${LD.badge(x.status||'')}</span></div>`).join(''):'<div class="hint">暂无证据材料</div>'}
      <div class="btn-row mt12"><button class="btn sm" id="cd-add-evi">＋ 新增证据</button><button class="btn sm" data-recgo="evidence/list">证据清单</button><button class="btn sm" id="cd-catalog">生成证据目录</button></div>`,
    comm:()=>`${(d.communications||[]).length?d.communications.map(x=>`<div class="mini-item"><span class="mt">${E(String(x.content||'').slice(0,60))}</span>
      <span class="ms">${E(x.channel||'')} ${E(String(x.contact_at||'').slice(0,10))}</span></div>`).join(''):'<div class="hint">暂无沟通记录</div>'}
      <button class="btn sm mt8" id="cd-add-comm2">＋ 新增沟通记录</button>`,
    history:()=>`${(d.history||[]).length?d.history.map(h=>`<div class="mini-item"><span class="mt">${E(h.summary||h.action)}</span>
      <span class="ms">${E(String(h.created_at||'').slice(0,16))} ${h.undone?'<span class="badge plain">已撤销</span>':''}</span></div>`).join(''):'<div class="hint">暂无操作历史</div>'}
      <button class="btn sm mt8" data-recgo="workspace/logs">全部操作日志</button>`
  };
  const draw=(t)=>{
    view.querySelectorAll('#cd-tabs .tab').forEach(x=>x.classList.toggle('active',x.dataset.t===t));
    body.innerHTML=tabs[t]();
    body.querySelectorAll('[data-recgo]').forEach(el=>el.addEventListener('click',()=>goCaseRecords(el.dataset.recgo,id)));
    body.querySelector('#cd-add-event')?.addEventListener('click',()=>CRUD.openForm('case_events',null,()=>LD.reload(),{case_id:Number(id)}));
    body.querySelector('#cd-add-doc')?.addEventListener('click',()=>CRUD.openForm('documents',null,()=>LD.reload(),{case_id:Number(id),client_id:ca.client_id}));
    body.querySelector('#cd-add-evi')?.addEventListener('click',()=>CRUD.openForm('evidence',null,()=>LD.reload(),{case_id:Number(id)}));
    body.querySelector('#cd-add-comm2')?.addEventListener('click',()=>CRUD.openForm('communications',null,()=>LD.reload(),{client_id:ca.client_id,case_id:Number(id)}));
    body.querySelector('#cd-catalog')?.addEventListener('click',async()=>{
      const r=await LD.api('GET','/api/evidence/catalog?case_id='+id);
      LD.openModal({title:'证据目录 · '+ca.name,wide:true,body:`<div class="code-block">${E(r.text)}</div><div class="hint mt8">共 ${r.count} 份证据，由系统依据已录入证据材料自动生成。</div>`,
        footer:`<button class="btn" data-x>关闭</button><button class="btn" data-act="dl">导出目录</button><button class="btn primary" data-act="print">打印 / PDF</button>`,
        onAction:(act)=>{ if(act==='dl'){ LD.saveBlob(new Blob(['\ufeff'+r.text],{type:'text/csv;charset=utf-8'}),'证据目录.csv'); return false; }
          if(act==='print'){ LD.printHTML('证据目录 · '+ca.name,'<pre style="white-space:pre-wrap">'+E(r.text)+'</pre>'); return false; } return true; }});
    });
    body.querySelectorAll('[data-doc]').forEach(el=>el.addEventListener('click',()=>{ sessionStorage.setItem('ld_doc_id',el.dataset.doc); LD.go('documents/new'); }));
    body.querySelectorAll('[data-evi]').forEach(el=>el.addEventListener('click',()=>CRUD.openForm('evidence',el.dataset.evi,()=>LD.reload())));
    const dz=body.querySelector('#cd-drop');
    if(dz){ dz.addEventListener('click',()=>CRUD.openFiles('cases',id,'上传案件文档'));
      dz.addEventListener('dragover',e=>{ e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('drop',async e=>{ e.preventDefault(); dz.classList.remove('over');
        for(const f of e.dataTransfer.files){ try{ await CRUD.uploadFile(f,'cases',id); }catch(err){ LD.toast('上传失败：'+err.message,'error'); } }
        LD.toast('文件已上传并关联到本案件'); LD.reload(); }); }
  };
  draw('timeline');
  view.querySelectorAll('#cd-tabs .tab').forEach(t=>t.addEventListener('click',()=>draw(t.dataset.t)));
});

/* ==================== 客户 ==================== */
LD.register('clients',async view=>clientList(view));
LD.register('clients/list',async view=>clientList(view));
async function clientList(view){
  await CRUD.render(view,'clients',{title:'客户管理',sub:'独立客户档案；修改联系方式后，案件与相关页面同步更新',
    headActions:`<button class="btn" id="cl-export">导出客户</button><button class="btn primary" id="cl-new">＋ 新建客户</button>`});
  view.querySelector('#cl-new').addEventListener('click',()=>CRUD.openForm('clients',null,()=>LD.reload()));
  view.querySelector('#cl-export').addEventListener('click',()=>LD.download('/api/export/clients?format=csv','clients.csv'));
}
LD.register('clients/follow',async view=>{
  await CRUD.render(view,'clients',{title:'待跟进客户',sub:'状态为「跟进中」的客户，点击可查看完整档案',
    preset:{status:'跟进中'},key:'follow',headActions:`<button class="btn" id="cl-all">全部客户</button>`});
  view.querySelector('#cl-all').addEventListener('click',()=>LD.go('clients/list'));
});

LD.register('client_detail',async(view,id)=>{
  const d=await LD.api('GET','/api/clients/'+id+'/full');
  if(d.error){ view.innerHTML=LD.empty(d.error); return; }
  const c=d.client;
  const sections=[
    ['关联案件',d.cases,'cases/list','name','案件名称'],
    ['关联合同',d.contracts,'contracts/list','name','合同名称'],
    ['相关文档',d.documents,'documents/list','title','文书标题'],
    ['服务记录（常法）',d.advisory,'advisory/list','contract_no','合同编号'],
    ['收费记录',d.payments,'billing/payments','received','收款'],
    ['待办事项',d.tasks,'schedules/tasks','title','待办'],
  ];
  view.innerHTML=`<div class="flex between mb12"><button class="btn sm" data-go="clients/list">‹ 返回客户列表</button>
    <div class="btn-row"><button class="btn sm" id="cl-comm">＋ 新增沟通记录</button><button class="btn sm" id="cl-edit">编辑客户</button>
    <button class="btn sm primary" id="cl-case">＋ 为该客户新建案件</button></div></div>
    ${LD.card('客户档案 · '+c.name,`<div class="flex between mb12"><div>${LD.badge(c.type||'')} ${LD.badge(c.status||'')}</div>
      <div class="small muted">客户来源：${E(c.source||'未填写')} · 最近联系：${E(LD.date(c.last_contact_at))}</div></div>
      <div class="kv-grid">${[['客户名称',c.name],['客户类型',c.type],['联系人',c.contact],['联系电话',c.phone],['邮箱',c.email],
        ['地址',c.address],['客户标签',c.tags],['备注',c.note]].map(([k,v])=>`<div class="kv"><b>${E(k)}</b><span>${E(v==null||v===''?'—':String(v))}</span></div>`).join('')}</div>`)}
    <div class="grid g2 mt14">
      ${LD.card('沟通记录',`${(d.communications||[]).length?d.communications.slice(0,10).map(x=>`<div class="mini-item"><span class="mt">${E(String(x.content||'').slice(0,50))}</span>
        <span class="ms">${E(x.channel||'')} ${E(String(x.contact_at||'').slice(0,10))}</span></div>`).join(''):'<div class="hint">暂无沟通记录</div>'}`)}
      ${LD.card('关联业务汇总',sections.map(s=>`<div class="mini-item" data-sec="${E(s[2])}"><span class="mt">${E(s[0])}</span>
        <span class="badge">${s[1].length}</span><span class="ms">›</span></div>`).join(''))}
    </div>`;
  bindGo(view);
  view.querySelectorAll('[data-sec]').forEach(el=>el.addEventListener('click',()=>{ sessionStorage.setItem('ld_filter_client',String(id)); LD.go(el.dataset.sec); }));
  view.querySelector('#cl-edit').addEventListener('click',()=>CRUD.openForm('clients',id,()=>LD.reload()));
  view.querySelector('#cl-comm').addEventListener('click',()=>CRUD.openForm('communications',null,()=>LD.reload(),{client_id:Number(id)}));
  view.querySelector('#cl-case').addEventListener('click',()=>CRUD.openForm('cases',null,()=>LD.reload(),{client_id:Number(id)}));
});

/* ==================== 合同 ==================== */
function contractPage(view,preset,title,sub,key){
  return CRUD.render(view,'contracts',{title,sub,preset,key,
    headActions:`<button class="btn" id="ct-extract">AI 辅助识别</button><button class="btn primary" id="ct-new">＋ 新建/上传合同</button>`,
    extraActions:`<button class="btn" id="ct-versions">版本记录</button>`}).then(()=>{
    view.querySelector('#ct-new').addEventListener('click',()=>CRUD.openForm('contracts',null,()=>LD.reload()));
    view.querySelector('#ct-versions').addEventListener('click',()=>LD.go('workspace/logs'));
    view.querySelector('#ct-extract').addEventListener('click',()=>openContractExtract());
  });
}
LD.register('contracts',v=>contractPage(v,{},'合同管理','合同与客户、案件、付款记录自动关联；支持版本管理与到期提醒','all'));
LD.register('contracts/list',v=>contractPage(v,{},'合同管理','合同与客户、案件、付款记录自动关联；支持版本管理与到期提醒','all'));
LD.register('contracts/review',v=>contractPage(v,{status:'待审查'},'待审查合同','筛选状态为「待审查」的合同','review'));
LD.register('contracts/expiring',v=>{
  const from=LD.today, to=new Date(Date.now()+90*86400000).toISOString().slice(0,10);
  return CRUD.render(v,'contracts',{title:'即将到期合同',sub:'未来 90 天内到期的合同，系统会自动生成到期日程',
    dateField:'end_on',dateFrom:from,dateTo:to,sort:'end_on',key:'expiring'});
});

async function openContractExtract(){
  const d=await LD.api('GET','/api/t/contracts?pageSize=100');
  LD.openModal({title:'合同 AI 辅助识别',wide:true,body:`
    <div class="alert info mb12">识别结果 <b>必须由律师逐项确认后</b> 才会写入正式合同数据；未勾选的项不会改动任何业务记录。</div>
    <div class="form-grid mb12">
      <div class="fld"><label>选择合同</label><select id="cx-contract"><option value="">不选择（仅粘贴文本）</option>
        ${d.rows.map(r=>`<option value="${r.id}">${E(r.name)}</option>`).join('')}</select></div>
      <div class="fld"><label>或直接粘贴合同文本</label><textarea id="cx-text" style="min-height:70px" placeholder="粘贴合同主体、金额、日期、条款文本…"></textarea></div>
    </div>
    <button class="btn primary" id="cx-run">开始识别</button><div id="cx-result" class="mt12"></div>`,
    footer:'<button class="btn" data-x>关闭</button>', onAction:()=>true});
  LD.el('cx-run').addEventListener('click',async()=>{
    const r=await LD.api('POST','/api/contracts/extract',{contract_id:LD.el('cx-contract').value||null,text:LD.el('cx-text').value});
    if(r.error){ LD.el('cx-result').innerHTML=`<div class="alert danger">${E(r.error)}</div>`; return; }
    LD.el('cx-result').innerHTML=`<div class="divider"></div><div class="small muted mb8">共识别 ${r.items.length} 项，来源文本 ${r.source_length} 字</div>
      ${r.items.map((it,i)=>{
        const v=Array.isArray(it.value)?it.value.join('<br>'):(it.value==null?'未识别':it.value);
        return `<div class="risk-stripe" style="border-left-color:var(--purple);align-items:flex-start">
          ${it.writable?`<input type="checkbox" data-cx="${i}" checked style="margin-top:3px">`:'<span style="width:16px"></span>'}
          <span class="rt"><b>${E(it.label)}</b><div class="small muted">${v==='未识别'||v===''?'未识别':E(String(v))}</div></span>
          <span class="rd">${E(it.confidence)}${it.writable?' · 可写入':''}</span></div>`; }).join('')}
      <div class="hint mt8">${E(r.note)}</div>
      <button class="btn primary mt12" id="cx-apply" ${r.contract_id?'':'disabled'}>确认写入所选合同</button>
      ${r.contract_id?'':'<div class="hint mt8">请先在上方选择一份合同，才能把确认结果写入正式数据。</div>'}`;
    LD.el('cx-apply')?.addEventListener('click',async()=>{
      const payload={ai_confirmed:1};
      const boxes=[...LD.el('cx-result').querySelectorAll('[data-cx]')];
      boxes.forEach(b=>{ if(!b.checked) return; const it=r.items[Number(b.dataset.cx)];
        if(it.writable && it.value!=null && it.value!=='') payload[it.key]=it.value; });
      payload.ai_extract=LD.el('cx-text').value||undefined;
      await LD.api('PUT','/api/t/contracts/'+r.contract_id,payload);
      LD.toast('已按律师确认结果写入合同正式数据，关联模块已同步'); LD.closeModal(); LD.reload();
    });
  });
}

/* ==================== 文书中心 / 编辑器 ==================== */
LD.register('documents',v=>docList(v));
LD.register('documents/list',v=>docList(v));
async function docList(view){
  const cp=casePreset();
  await CRUD.render(view,'documents',{title:'文书中心',sub:'生成的文书自动关联案件；修改保留历史版本',preset:cp,
    onRow:(id)=>{ sessionStorage.setItem('ld_doc_id',String(id)); LD.go('documents/new'); },
    headActions:`<button class="btn" data-go="documents/templates">模板库</button><button class="btn primary" data-go="documents/new">＋ 智能生成文书</button>`});
  bindGo(view);
}
LD.register('documents/templates',async view=>{
  await CRUD.render(view,'legal_templates',{title:'文书模板库',sub:'系统预置 10 类常用律师文书模板，支持 {变量} 自动填充',
    headActions:`<button class="btn primary" data-go="documents/new">用模板生成文书</button>`});
  bindGo(view);
});

LD.register('documents/new',async view=>{
  const casesD=await LD.api('GET','/api/t/cases?pageSize=200');
  const tplD=await LD.api('GET','/api/t/legal_templates?pageSize=200');
  const tplName=sessionStorage.getItem('ld_tpl_name'); sessionStorage.removeItem('ld_tpl_name');
  const aiDraft=JSON.parse(sessionStorage.getItem('ld_ai_draft')||'null'); sessionStorage.removeItem('ld_ai_draft');
  const docId=sessionStorage.getItem('ld_doc_id'); sessionStorage.removeItem('ld_doc_id');
  const presetCase=sessionStorage.getItem('ld_doc_case'); sessionStorage.removeItem('ld_doc_case');
  let doc=null;
  if(docId){ const r=await LD.api('GET','/api/t/documents/'+docId); doc=r.record; }
  let content=doc?.content||'';
  let chosenTpl=tplD.rows.find(t=>t.name===tplName)?.id||doc?.template_id||'';
  let chosenCase=doc?.case_id||presetCase||'';
  if(aiDraft){ content=aiDraft.content||content; chosenTpl=aiDraft.template_id||chosenTpl; chosenCase=aiDraft.case_id||chosenCase; }
  view.innerHTML=LD.pageHead(doc?'编辑文书':'智能文书生成',doc?`${doc.title} · 版本 ${doc.version||1}`:'选择模板与案件，系统自动读取案件资料填充变量',
    `<button class="btn" data-go="documents/list">返回文书列表</button>
     <button class="btn" id="ed-history">历史版本</button><button class="btn" id="ed-word">导出 Word</button>
     <button class="btn" id="ed-pdf">导出 PDF</button><button class="btn primary" id="ed-save">保存文书</button>`)+
    `<div class="card mb12"><div class="form-grid">
      <div class="fld"><label>文书标题 <span class="req">*</span></label><input id="ed-title" value="${E(doc?.title||(tplName?tplName+'（'+LD.today+'）':''))}" placeholder="例如：民事起诉状"></div>
      <div class="fld"><label>关联案件</label><select id="ed-case"><option value="">不关联</option>
        ${casesD.rows.map(r=>`<option value="${r.id}" ${String(chosenCase)===String(r.id)?'selected':''}>${E(r.name)}</option>`).join('')}</select></div>
      <div class="fld"><label>文书模板</label><select id="ed-tpl"><option value="">不使用模板</option>
        ${tplD.rows.map(t=>`<option value="${t.id}" ${String(chosenTpl)===String(t.id)?'selected':''}>${E(t.name)}</option>`).join('')}</select></div>
      <div class="fld"><label>文档类型</label><select id="ed-cat">${(LD.options.doc_category||[]).map(x=>`<option value="${E(x)}" ${doc?.category===x?'selected':''}>${E(x)}</option>`).join('')}</select></div>
    </div>
    <div class="btn-row mt12"><button class="btn sm" id="ed-render">按模板 + 案件变量生成初稿</button>
      <button class="btn sm" id="ed-ai">AI 起草辅助</button><span class="small muted" id="ed-state">草稿自动保存已开启</span></div>
    <div class="hint mt8">可用变量：{委托人} {对方当事人} {受理法院} {案由} {案件编号} {当前日期}，均来自系统已录入资料。</div></div>
    <div class="card"><div class="editor-toolbar">
      <button data-cmd="bold"><b>B</b></button><button data-cmd="italic"><i>I</i></button><button data-cmd="underline"><u>U</u></button>
      <button data-cmd="formatBlock" data-val="h2">标题</button><button data-cmd="formatBlock" data-val="p">段落</button>
      <button data-cmd="insertUnorderedList">项目列表</button><button data-cmd="insertOrderedList">编号列表</button>
      <button data-cmd="justifyLeft">左对齐</button><button data-cmd="justifyCenter">居中</button><button data-cmd="justifyRight">落款右对齐</button>
      <button id="ed-table">插入表格</button>
      <select id="ed-font"><option value="3">字号 普通</option><option value="4">字号 大</option><option value="5">字号 特大</option></select>
    </div><div class="editor-surface" id="ed-surface" contenteditable="true">${E(content).replace(/\n/g,'<br>')}</div></div>
    <div class="ai-disclaimer mt12">AI 生成的法律事实、法条及裁判观点必须能够核验；系统不会自行编造案件事实、法条、司法解释或判例。括号占位内容请律师依据案卷补全。</div>`;
  bindGo(view);
  const surf=LD.el('ed-surface');
  const draftKey='ld_editor_'+(docId||'new');
  let dt;
  const autosave=()=>{ clearTimeout(dt); dt=setTimeout(()=>{ localStorage.setItem(draftKey,JSON.stringify({title:LD.el('ed-title').value,html:surf.innerHTML,time:new Date().toLocaleTimeString('zh-CN')}));
    LD.el('ed-state').textContent='草稿已自动保存 '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}); },500); };
  surf.addEventListener('input',autosave); LD.el('ed-title').addEventListener('input',autosave);
  if(!content && !doc){ const saved=JSON.parse(localStorage.getItem(draftKey)||'null');
    if(saved){ surf.innerHTML=saved.html; LD.el('ed-title').value=saved.title||''; LD.el('ed-state').textContent='已恢复上次草稿 '+saved.time; } }
  view.querySelectorAll('.editor-toolbar [data-cmd]').forEach(b=>b.addEventListener('click',()=>{
    surf.focus(); document.execCommand(b.dataset.cmd,false,b.dataset.val||null); autosave(); }));
  LD.el('ed-font').addEventListener('change',e=>{ surf.focus(); document.execCommand('fontSize',false,e.target.value); autosave(); });
  LD.el('ed-table').addEventListener('click',()=>{ surf.focus();
    document.execCommand('insertHTML',false,'<table><tr><td>项目</td><td>内容</td></tr><tr><td>　</td><td>　</td></tr></table><p><br></p>'); autosave(); });
  LD.el('ed-render').addEventListener('click',async()=>{
    const tpl=LD.el('ed-tpl').value; if(!tpl){ LD.toast('请先选择模板','info'); return; }
    const r=await LD.api('POST','/api/templates/render',{template_id:tpl,case_id:LD.el('ed-case').value||null});
    surf.innerHTML=E(r.content).replace(/\n/g,'<br>');
    if(!LD.el('ed-title').value.trim()) LD.el('ed-title').value=r.template_name+'（'+LD.today+'）';
    LD.toast('初稿已生成：'+r.notice,'info'); autosave();
  });
  LD.el('ed-ai').addEventListener('click',()=>{ LD.renderAIPanel(); LD.toggleAI(true);
    LD.el('ai-panel').querySelector('[data-ai="draft_document"]')?.click();
    if(LD.el('ed-case').value) LD.el('ai-case').value=LD.el('ed-case').value; });
  LD.el('ed-history').addEventListener('click',async()=>{
    if(!docId){ LD.toast('请先保存文书后再查看历史版本','info'); return; }
    const r=await LD.api('GET','/api/t/document_versions?filter_document_id='+docId+'&pageSize=100');
    LD.openModal({title:'文书历史版本',wide:true,body:r.rows.length?r.rows.map(v=>`<div class="card mb8"><div class="flex between"><b>版本 ${v.version}</b><span class="small muted">${E(String(v.created_at||'').slice(0,16))}</span></div>
      <div class="code-block mt8" style="white-space:pre-wrap">${E((v.content||'').slice(0,800))}</div>
      <button class="btn sm mt8" data-restore-ver="${v.id}" data-content="${E(v.content||'')}">恢复此版本内容</button></div>`).join(''):'<div class="hint">暂无历史版本；每次修改正文后系统自动保留修改前快照。</div>',
      footer:'<button class="btn" data-x>关闭</button>',onAction:()=>true});
    LD.el('ld-modal')?.querySelectorAll('[data-restore-ver]').forEach(b=>b.addEventListener('click',()=>{
      surf.innerHTML=E(b.dataset.content).replace(/\n/g,'<br>'); LD.closeModal(); LD.toast('已载入历史版本到编辑器，请点击保存','info'); autosave(); }));
  });
  const getText=()=>surf.innerText.replace(/\n{3,}/g,'\n\n');
  LD.el('ed-word').addEventListener('click',()=>LD.postDownload('/api/export/docx',{title:LD.el('ed-title').value||'法律文书',text:getText()},(LD.el('ed-title').value||'法律文书')+'.docx'));
  LD.el('ed-pdf').addEventListener('click',()=>LD.printHTML(LD.el('ed-title').value||'法律文书','<div style="white-space:pre-wrap;font-size:14px;line-height:2">'+E(getText())+'</div>'));
  LD.el('ed-save').addEventListener('click',async()=>{
    const title=LD.el('ed-title').value.trim(); if(!title){ LD.toast('请填写文书标题','error'); return; }
    const caseId=LD.el('ed-case').value||null;
    const ca=casesD.rows.find(r=>String(r.id)===String(caseId));
    const payload={title,content:getText(),case_id:caseId,client_id:ca?.client_id||null,
      template_id:LD.el('ed-tpl').value||null,category:LD.el('ed-cat').value,status:'草稿'};
    const r=docId? await LD.api('PUT','/api/t/documents/'+docId,payload) : await LD.api('POST','/api/t/documents',payload);
    localStorage.removeItem(draftKey);
    LD.toast((docId?'已保存修改，旧版本已留痕':'文书已保存并归档到案件文档区'),'success',r.log_id);
    sessionStorage.setItem('ld_doc_id',String(r.record.id)); LD.reload();
  });
});

/* ==================== 法律检索 ==================== */
LD.register('legal_search',v=>legalSearch(v));
LD.register('legal_search/all',v=>legalSearch(v));
async function legalSearch(view){
  const term=sessionStorage.getItem('ld_search_term'); sessionStorage.removeItem('ld_search_term');
  const cats=LD.options.kb_category||[];
  let curCat=sessionStorage.getItem('ld_kb_cat')||''; sessionStorage.removeItem('ld_kb_cat');
  view.innerHTML=LD.pageHead('法律检索与资料库','本地资料库：每条资料均标注来源、发布机构、发布时间、效力状态与检索日期；未经核验不得作为正式法律依据',
    `<button class="btn" id="ls-log">检索记录</button><button class="btn primary" id="ls-new">＋ 录入资料</button>`)+
    `<div class="card mb12"><div class="toolbar mb8">
      <div class="search"><span class="sicon">⌕</span><input id="ls-q" value="${E(term||'')}" placeholder="检索法规、司法解释、案例判例、裁判观点、合同范本…"></div>
      <button class="btn primary" id="ls-search">检索</button><button class="btn" id="ls-clear">清空</button></div>
      <div class="pill-tabs" id="ls-cats"><span class="pill ${!curCat?'active':''}" data-cat="">全部</span>
        ${cats.map(c=>`<span class="pill ${curCat===c?'active':''}" data-cat="${E(c)}">${E(c)}</span>`).join('')}</div>
      <div class="hint">检索会写入检索记录并显示检索日期。AI 生成的未经核实内容不得作为正式法律依据。</div></div>
    <div id="ls-results"></div>`;
  const results=view.querySelector('#ls-results');
  const load=async()=>{
    const q=LD.el('ls-q').value.trim(), cat=curCat;
    const p=new URLSearchParams({pageSize:'100'});
    if(q) p.set('search',q); if(cat) p.set('filter_category',cat);
    const d=await LD.api('GET','/api/t/knowledge_base?'+p.toString());
    if(q){ LD.api('POST','/api/t/legal_search_logs',{keyword:q,category:cat||'全部',result_count:d.total}); }
    results.innerHTML=d.rows.length?d.rows.map(r=>`<div class="card mb8">
      <div class="flex between"><div><b>${E(r.title)}</b> ${LD.badge(r.category||'')} ${LD.badge(r.effective_status||'')}
        ${r.verified?'<span class="badge success">来源已核验</span>':'<span class="badge plain">待核验</span>'}</div>
        <div class="btn-row"><button class="btn sm" data-fav="${r.id}">${r.favorite?'取消收藏':'收藏'}</button>
        <button class="btn sm" data-edit="${r.id}">编辑/备注</button></div></div>
      <div class="small muted mt8">来源：${E(r.source||'未标注')} · 发布机构：${E(r.publisher||'未标注')} · 发布时间：${E(LD.date(r.published_at))} · 检索日期：${E(LD.date(r.retrieved_at))}</div>
      ${r.summary?`<div class="mt8 small">${E(r.summary)}</div>`:''}
      ${r.content?`<div class="code-block mt8" style="white-space:pre-wrap">${E(String(r.content).slice(0,500))}</div>`:''}
      ${r.source_url?`<div class="mt8"><a href="${E(r.source_url)}" target="_blank" rel="noopener">原文入口 ↗</a></div>`:''}
      ${r.note?`<div class="hint mt8">备注：${E(r.note)}</div>`:''}</div>`).join(''):LD.card('检索结果','<div class="empty" style="padding:24px"><p>本地资料库暂无匹配资料。请通过权威法律来源核验后录入，系统不会生成法条或判例。</p></div>');
    results.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>CRUD.openForm('knowledge_base',b.dataset.edit,()=>load())));
    results.querySelectorAll('[data-fav]').forEach(b=>b.addEventListener('click',async()=>{
      const row=d.rows.find(x=>String(x.id)===b.dataset.fav);
      await LD.api('PUT','/api/t/knowledge_base/'+b.dataset.fav,{favorite:row.favorite?0:1});
      LD.toast('收藏状态已更新'); load(); }));
  };
  view.querySelectorAll('#ls-cats .pill').forEach(p=>p.addEventListener('click',()=>{
    curCat=p.dataset.cat; view.querySelectorAll('#ls-cats .pill').forEach(x=>x.classList.toggle('active',x===p)); load(); }));
  LD.el('ls-search').addEventListener('click',load);
  LD.el('ls-clear').addEventListener('click',()=>{ LD.el('ls-q').value=''; curCat=''; view.querySelectorAll('#ls-cats .pill').forEach(x=>x.classList.toggle('active',!x.dataset.cat)); load(); });
  LD.el('ls-q').addEventListener('keydown',e=>{ if(e.key==='Enter') load(); });
  LD.el('ls-new').addEventListener('click',()=>CRUD.openForm('knowledge_base',null,()=>load(),{retrieved_at:LD.today,effective_status:'待核验'}));
  LD.el('ls-log').addEventListener('click',()=>LD.go('legal_search/logs'));
  load();
}
LD.register('legal_search/logs',async view=>{
  await CRUD.render(view,'legal_search_logs',{title:'检索记录',sub:'每次检索的关键词、范围与结果数，便于追溯',headActions:`<button class="btn" data-go="legal_search/all">返回检索</button>`});
  bindGo(view);
});

/* ==================== 证据材料 ==================== */
LD.register('evidence',v=>eviList(v,{}));
LD.register('evidence/list',v=>eviList(v,{}));
async function eviList(view,preset,title='证据材料',key='all'){
  const cp=casePreset(); Object.assign(preset,cp);
  await CRUD.render(view,'evidence',{title,sub:'每个案件拥有独立证据库；修改保留历史记录，可自动生成证据目录',preset,key,
    headActions:`<button class="btn" id="ev-catalog">生成证据目录</button><button class="btn" id="ev-history">变更记录</button>
      <button class="btn primary" id="ev-new">＋ 新增证据</button>`});
  view.querySelector('#ev-new').addEventListener('click',()=>CRUD.openForm('evidence',null,()=>LD.reload()));
  view.querySelector('#ev-history').addEventListener('click',()=>LD.go('workspace/logs'));
  view.querySelector('#ev-catalog').addEventListener('click',()=>LD.go('evidence/catalog'));
  const focus=sessionStorage.getItem('ld_filter_case');
}
LD.register('evidence/pending',v=>eviList(v,{status:'待收集'},'待补充证据','pending'));
LD.register('evidence/catalog',async view=>{
  const d=await LD.api('GET','/api/t/cases?pageSize=200');
  view.innerHTML=LD.pageHead('证据目录生成','依据已录入证据材料自动生成，支持打印与导出',`<button class="btn" data-go="evidence/list">返回证据清单</button>`)+
    `<div class="card mb12"><div class="toolbar mb8"><select id="cat-case"><option value="">全部案件（汇总）</option>
      ${d.rows.map(r=>`<option value="${r.id}">${E(r.name)}</option>`).join('')}</select>
      <button class="btn primary" id="cat-gen">生成目录</button></div>
      <div class="hint">证据修改会保留历史记录；目录内容始终来自当前最新的证据数据。</div></div><div id="cat-out"></div>`;
  bindGo(view);
  const gen=async()=>{
    const cid=LD.el('cat-case').value;
    const r=await LD.api('GET','/api/evidence/catalog'+(cid?'?case_id='+cid:''));
    LD.el('cat-out').innerHTML=LD.card('证据目录（'+r.count+' 份）',`<div class="code-block" style="white-space:pre-wrap">${E(r.text)}</div>
      <div class="btn-row mt12"><button class="btn" id="cat-dl">导出 CSV</button><button class="btn" id="cat-print">打印 / PDF</button></div>`);
    LD.el('cat-dl').addEventListener('click',()=>LD.saveBlob(new Blob(['\ufeff'+r.text],{type:'text/csv;charset=utf-8'}),'证据目录.csv'));
    LD.el('cat-print').addEventListener('click',()=>LD.printHTML('证据目录','<pre style="white-space:pre-wrap">'+E(r.text)+'</pre>'));
  };
  LD.el('cat-gen').addEventListener('click',gen); gen();
});
