/* LawDesk AI - 业务页面（二）：保全 / 常法 / 日程 / 计费 / 知识库 / 分析 / 工作台 / 设置 */
import { LD } from './core.js';
import { CRUD } from './components.js';

const E=LD.esc;
function bindGo(root){ root.querySelectorAll('[data-go]').forEach(el=>el.addEventListener('click',e=>{ e.stopPropagation(); LD.go(el.dataset.go); })); }
function casePreset(){ const v=sessionStorage.getItem('ld_filter_case'); sessionStorage.removeItem('ld_filter_case'); return v?{case_id:v}:{}; }
function csvCell(v){ return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'; }
function saveCSV(rows,filename){
  const txt='\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
  LD.saveBlob(new Blob([txt],{type:'text/csv;charset=utf-8'}),filename);
}

/* ==================== 保全管理与风险预警 ==================== */
const RISK_FILTERS=[['all','全部'],['expired','已过期'],['d7','7天内'],['d30','30天内'],['d90','90天内']];
async function preservationPage(view,mode='list'){
  const all=await LD.api('GET','/api/t/preservation?pageSize=300');
  const risk=await LD.api('GET','/api/risk/preservation');
  const riskMap=Object.fromEntries(risk.items.map(x=>[x.id,x]));
  const cases=await LD.api('GET','/api/t/cases?pageSize=300');
  const caseName=Object.fromEntries(cases.rows.map(r=>[r.id,r.name]));
  let filter=mode==='risk'?'d7':'all', caseFilter='';
  let checked=new Set();
  const render=()=>{
    let items=all.rows.map(r=>{
      const rk=riskMap[r.id];
      const d=r.end_on?Math.ceil((new Date(r.end_on)-new Date(LD.today))/86400000):null;
      let level='normal',label='90天以上',color='#92989A',pri=4;
      if(r.status==='已解除'||r.handled_action){ level='handled';label='已处理/已解除';color='#86A58A';pri=5; }
      else if(rk){ level=rk.risk;label=rk.risk_label;color=rk.risk_color;pri=rk.priority; }
      return {...r,days:d,level,label,color,pri,case_name:caseName[r.case_id]||'未关联案件'};
    });
    if(filter==='expired') items=items.filter(x=>x.level==='expired');
    else if(filter==='d7') items=items.filter(x=>x.pri<=1);
    else if(filter==='d30') items=items.filter(x=>x.days!=null&&x.days<=30&&x.pri<=2);
    else if(filter==='d90') items=items.filter(x=>x.days!=null&&x.days<=90&&x.pri<=3);
    if(caseFilter) items=items.filter(x=>String(x.case_id)===caseFilter);
    items.sort((a,b)=>String(a.end_on||'').localeCompare(String(b.end_on||'')));
    const counts={expired:all.rows.filter(x=>riskMap[x.id]?.risk==='expired').length,
      d7:all.rows.filter(x=>(riskMap[x.id]?.priority??9)<=1).length,
      d30:all.rows.filter(x=>(riskMap[x.id]?.priority??9)<=2).length,
      d90:all.rows.filter(x=>(riskMap[x.id]?.priority??9)<=3).length};
    view.innerHTML=LD.pageHead(mode==='risk'?'高风险保全预警':'保全管理汇总',
      mode==='risk'?'已过期或 7 天内到期的保全事项须完成续期、解除或其他明确处理操作后才会解除提醒':'五级预警：已过期 / 7天内 / 8—30天 / 31—90天 / 90天以上；以到期日排序',
      `<button class="btn" id="pr-report">生成风险报告</button><button class="btn" id="pr-export">导出所选</button>
       <button class="btn primary" id="pr-new">＋ 新增保全记录</button>`)+
    (mode==='risk'?`<div class="alert danger mb12"><b>强制提醒规则</b>：仅点击「知道了」不会改变事项的未处理状态；只有完成续期、解除或其他明确处理操作后，相应提醒才会解除。此模块优先级高于普通诉讼期限。</div>`:'')+
    `<div class="grid g4 mb12">${[['已过期',counts.expired,'danger'],['7天内',counts.d7,'danger'],['30天内',counts.d30,'accent'],['90天内',counts.d90,'plain']].map(([l,v,c])=>
      `<div class="stat-card ${c==='danger'?'d':c==='accent'?'a':''}"><div class="bar"></div><div class="label">${l}到期</div><div class="value">${v}</div></div>`).join('')}</div>
    <div class="card"><div class="toolbar">
      <div class="pill-tabs mb8">${RISK_FILTERS.map(([k,l])=>`<span class="pill ${filter===k?'active':''}" data-rf="${k}">${l}</span>`).join('')}</div>
      <select id="pr-case"><option value="">全部案件</option>${cases.rows.map(r=>`<option value="${r.id}" ${caseFilter===String(r.id)?'selected':''}>${E(r.name)}</option>`).join('')}</select>
      <div class="spacer"></div><span class="small muted">已选 ${checked.size} 项 · 共 ${items.length} 条</span></div>
      ${items.length?`<div class="table-wrap"><table class="data"><thead><tr>
        <th style="width:28px"></th><th>预警级别</th><th>被保全标的</th><th>关联案件</th><th>保全类型</th><th>到期日</th><th>剩余天数</th><th>保全金额</th><th>状态</th><th>操作</th>
      </tr></thead><tbody>${items.map(r=>`<tr>
        <td><input type="checkbox" data-chk="${r.id}" ${checked.has(r.id)?'checked':''}></td>
        <td><span class="badge" style="background:${r.color}22;color:${r.color};border-color:${r.color}55">${E(r.label)}</span></td>
        <td><b>${E(r.target||'')}</b><div class="rowsub">${E(r.ruling_no||'')}</div></td>
        <td>${E(r.case_name)}</td><td>${E(r.ptype||'')}</td><td class="mono">${E(LD.date(r.end_on))}</td>
        <td class="mono" style="color:${r.pri<=1?'var(--danger)':'inherit'}">${r.days==null?'—':r.days}</td>
        <td class="mono">${LD.money(r.amount)}</td><td>${LD.badge(r.status||'')}</td>
        <td><div class="btn-row"><button class="btn sm" data-redit="${r.id}">编辑</button>
          <button class="btn sm" data-risk-renew="${r.id}" ${r.status==='已解除'?'disabled':''}>续期</button>
          <button class="btn sm" data-rhandle="${r.id}" ${r.status==='已解除'?'disabled':''}>处理</button></div></td>
      </tr>`).join('')}</tbody></table></div>`:LD.empty('当前筛选下没有保全记录','新增保全记录','id="pr-empty-new"')}
      <div class="hint mt12">到期日辅助参考：银行账户冻结 1 年 / 不动产查封 3 年 / 动产、股权 2 年 / 行为保全依裁定内容确定。<b>必须以实际裁定书、适用法律及具体案件情况为准</b>，律师可手动修改最终到期日期并记录原因。</div>
    </div>`;
    bindEvents(items);
  };
  const bindEvents=(items)=>{
    view.querySelectorAll('[data-rf]').forEach(p=>p.addEventListener('click',()=>{ filter=p.dataset.rf; render(); }));
    view.querySelector('#pr-case').addEventListener('change',e=>{ caseFilter=e.target.value; render(); });
    view.querySelectorAll('[data-chk]').forEach(c=>c.addEventListener('change',()=>{
      const id=Number(c.dataset.chk); if(c.checked) checked.add(id); else checked.delete(id); render(); }));
    view.querySelectorAll('[data-redit]').forEach(b=>b.addEventListener('click',()=>CRUD.openForm('preservation',b.dataset.redit,()=>preservationPage(view,mode))));
    view.querySelectorAll('[data-risk-renew]').forEach(b=>b.addEventListener('click',()=>openRenew(b.dataset.riskRenew,()=>preservationPage(view,mode))));
    view.querySelectorAll('[data-rhandle]').forEach(b=>b.addEventListener('click',()=>openHandle(b.dataset.rhandle,()=>preservationPage(view,mode))));
    view.querySelector('#pr-new')?.addEventListener('click',()=>CRUD.openForm('preservation',null,()=>preservationPage(view,mode)));
    view.querySelector('#pr-empty-new')?.addEventListener('click',()=>CRUD.openForm('preservation',null,()=>preservationPage(view,mode)));
    view.querySelector('#pr-export').addEventListener('click',()=>{
      const chosen=items.filter(r=>checked.has(r.id));
      if(!chosen.length){ LD.toast('请先勾选要导出的保全记录','info'); return; }
      saveCSV([['被保全标的','关联案件','保全类型','到期日','剩余天数','保全金额','状态','裁定书案号','预警级别'],
        ...chosen.map(r=>[r.target,r.case_name,r.ptype,r.end_on,r.days,r.amount,r.status,r.ruling_no,r.label])],'保全记录.csv');
      LD.toast('已导出 '+chosen.length+' 条保全记录');
    });
    view.querySelector('#pr-report').addEventListener('click',()=>{
      const rows=[['预警级别','数量'],...RISK_FILTERS.slice(1).map(([k,l])=>[l,items.filter(x=>({expired:x.level==='expired',d7:x.pri<=1,d30:x.days!=null&&x.days<=30,d90:x.days!=null&&x.days<=90})[k]).length])];
      LD.openModal({title:'保全风险报告',wide:true,body:`
        <div class="hint mb8">生成日期：${E(LD.today)} · 依据系统中真实保全记录自动汇总</div>
        <div class="code-block">${E(rows.map(r=>r.join('\t')).join('\n'))}</div>
        <div class="divider"></div><div class="small muted mb8">明细（按到期日排序）</div>
        <div class="code-block" style="max-height:260px">${E(items.map(r=>`[${r.label}] ${r.target}｜${r.case_name}｜到期 ${r.end_on}｜剩余 ${r.days} 天`).join('\n'))||'无记录'}</div>
        <div class="hint mt8">报告仅汇总已录入数据；到期日须以裁定书与适用法律为准。</div>`,
        footer:`<button class="btn" data-x>关闭</button><button class="btn" data-act="csv">导出 CSV</button><button class="btn primary" data-act="print">打印 / PDF</button>`,
        onAction:(act)=>{ if(act==='csv'){ saveCSV([['项目','内容'],...items.map(r=>[r.label,r.target+'｜'+r.case_name+'｜到期 '+r.end_on])],'保全风险报告.csv'); return false; }
          if(act==='print'){ LD.printHTML('保全风险报告','<pre style="white-space:pre-wrap">'+E(rows.map(r=>r.join('\t')).join('\n')+'\n\n'+items.map(r=>`[${r.label}] ${r.target}｜${r.case_name}｜到期 ${r.end_on}`).join('\n'))+'</pre>'); return false; } return true; }});
    });
  };
  render();
}
LD.register('preservation',v=>preservationPage(v,'list'));
LD.register('preservation/list',v=>preservationPage(v,'list'));
LD.register('preservation/risk',v=>preservationPage(v,'risk'));

async function openRenew(id,onDone){
  const r=await LD.api('GET','/api/t/preservation/'+id); const rec=r.record||{};
  LD.openModal({title:'保全续期闭环 · '+E(rec.target||''),wide:true,body:`
    <div class="alert info mb12">续期后：更新当前到期日、<b>续期次数自动增加</b>、历史到期日期与续期记录<b>永久保留</b>。未填写完整信息不会改变事项状态。</div>
    <div class="form-grid">
      <div class="fld"><label>原到期日期</label><input value="${E(LD.date(rec.end_on))}" disabled></div>
      <div class="fld"><label>新的到期日期 <span class="req">*</span></label><input type="date" id="rn-end" value="${E(LD.date(rec.end_on))}"></div>
      <div class="fld"><label>辅助计算参考（可选）</label><div class="flex"><select id="rn-ptype">${Object.keys(LD.boot?.preservation_reference||{银行账户冻结:12}).map(k=>`<option value="${E(k)}" ${rec.ptype===k?'selected':''}>${E(k)}</option>`).join('')}</select>
        <button class="btn sm" id="rn-calc">计算参考值</button></div><div class="help" id="rn-ref"></div></div>
      <div class="fld"><label>续期裁定书案号</label><input id="rn-no" value="${E(rec.ruling_no||'')}" placeholder="填写新的裁定书案号"></div>
      <div class="fld full"><label>上传续期裁定书</label><input type="file" id="rn-file"><div id="rn-file-name" class="help">支持 PDF / Word / 图片</div></div>
      <div class="fld full"><label>处理备注</label><textarea id="rn-note" placeholder="记录续期依据、法院要求或处理说明"></textarea></div>
    </div>`,
    footer:`<button class="btn" data-x>取消</button><button class="btn primary" data-act="ok">确认续期并更新</button>`,
    onAction:async(act)=>{
      if(act!=='ok') return true;
      const end=LD.el('rn-end').value; if(!end){ LD.toast('请填写新的到期日期','error'); return false; }
      let file_id=null;
      const f=LD.el('rn-file').files[0];
      if(f){ try{ file_id=(await CRUD.uploadFile(f,'preservation',id)).id; }catch(e){ LD.toast('裁定书上传失败：'+e.message,'error'); return false; } }
      const res=await LD.api('POST','/api/preservation/'+id+'/renew',
        {new_end_on:end,ruling_no:LD.el('rn-no').value,file_id,note:LD.el('rn-note').value});
      if(res.error){ LD.toast(res.error,'error'); return false; }
      LD.toast('续期完成，第 '+res.renewal_count+' 次；历史记录已永久保留'); if(onDone) onDone(); return true;
    }});
  LD.el('rn-calc').addEventListener('click',async()=>{
    const d=await LD.api('GET','/api/preservation/calc?ptype='+encodeURIComponent(LD.el('rn-ptype').value)+'&start_on='+(LD.el('rn-end').value||LD.today));
    LD.el('rn-ref').innerHTML=d.reference_end_on?`参考到期日：<b>${E(d.reference_end_on)}</b>（${d.months} 个月）。${E(d.note)}`:E(d.note);
    if(d.reference_end_on) LD.el('rn-end').value=d.reference_end_on;
  });
  LD.el('rn-file').addEventListener('change',()=>{ LD.el('rn-file-name').textContent='已选择：'+LD.el('rn-file').files[0]?.name; });
}
async function openHandle(id,onDone){
  const r=await LD.api('GET','/api/t/preservation/'+id); const rec=r.record||{};
  LD.openModal({title:'登记保全处理 · '+E(rec.target||''),body:`
    <div class="alert warning mb12">只有完成续期、解除或其他明确处理操作后，才会解除相应提醒。此操作会写入保全历史，永久保留。</div>
    <div class="form-grid">
      <div class="fld full"><label>处理动作</label><select id="hd-action"><option>解除</option><option>其他处理</option><option>已执行完毕</option></select></div>
      <div class="fld full"><label>处理备注 <span class="req">*</span></label><textarea id="hd-note" placeholder="说明处理依据与结果"></textarea></div>
      <div class="fld full"><label>相关附件</label><input type="file" id="hd-file"></div>
    </div>`,
    footer:`<button class="btn" data-x>取消</button><button class="btn primary" data-act="ok">确认处理</button>`,
    onAction:async(act)=>{
      if(act!=='ok') return true;
      if(!LD.el('hd-note').value.trim()){ LD.toast('请填写处理备注','error'); return false; }
      let file_id=null; const f=LD.el('hd-file').files[0];
      if(f){ try{ file_id=(await CRUD.uploadFile(f,'preservation',id)).id; }catch(e){ LD.toast('附件上传失败','error'); return false; } }
      const res=await LD.api('POST','/api/preservation/'+id+'/handle',
        {action:LD.el('hd-action').value,note:LD.el('hd-note').value,file_id});
      if(res.error){ LD.toast(res.error,'error'); return false; }
      LD.toast('处理已登记，提醒状态已更新'); if(onDone) onDone(); return true;
    }});
}
LD.register('preservation/history',async view=>{
  await CRUD.render(view,'preservation_history',{title:'保全续期与处理历史',sub:'历史到期日期、续期次数与处理记录永久保留，不可通过普通删除抹除',
    headActions:`<button class="btn" data-go="preservation/list">返回保全汇总</button>`});
  bindGo(view);
});

/* ==================== 常年法律顾问 ==================== */
LD.register('advisory',v=>advisoryList(v));
LD.register('advisory/list',v=>advisoryList(v));
async function advisoryList(view){
  await CRUD.render(view,'legal_advisory',{title:'常年法律顾问',sub:'每个常法客户对应一份或多份年度服务合同；工作记录自动汇总进年度报告',
    headActions:`<button class="btn" id="ad-report">生成年度顾问报告</button><button class="btn primary" id="ad-new">＋ 新增服务合同</button>`});
  view.querySelector('#ad-new').addEventListener('click',()=>CRUD.openForm('legal_advisory',null,()=>LD.reload()));
  view.querySelector('#ad-report').addEventListener('click',()=>LD.go('advisory/report'));
}
LD.register('advisory/logs',async view=>{
  await CRUD.render(view,'advisory_logs',{title:'常法工作记录',sub:'按月自动汇总服务次数与工作时长，年度报告完全基于这些真实记录',
    headActions:`<button class="btn primary" id="al-new">＋ 新增工作记录</button>`});
  view.querySelector('#al-new').addEventListener('click',()=>CRUD.openForm('advisory_logs',null,()=>LD.reload()));
});
LD.register('advisory/report',async view=>{
  const d=await LD.api('GET','/api/t/legal_advisory?pageSize=200');
  view.innerHTML=LD.pageHead('年度顾问报告','服务概况、工作类型分布、工作明细、月度趋势、服务总结、后续建议 —— 全部依据真实工作记录生成',
    `<button class="btn" data-go="advisory/logs">工作记录</button><button class="btn" id="ar-print">导出 PDF</button>`)+
    `<div class="card mb12"><div class="toolbar mb8"><select id="ar-contract">${d.rows.map(r=>`<option value="${r.id}">${E(LD.lookup('clients',r.client_id))} · ${E(r.contract_no||'#'+r.id)}</option>`).join('')}</select>
      <button class="btn primary" id="ar-gen">生成报告</button></div>
      <div class="hint">${d.rows.length?'':'暂无常法服务合同，请先在「服务合同」中新增。'}</div></div><div id="ar-body"></div>`;
  bindGo(view);
  const gen=async()=>{
    const id=LD.el('ar-contract').value; if(!id){ LD.el('ar-body').innerHTML=LD.empty('请先新增常法服务合同'); return; }
    const r=await LD.api('GET','/api/advisory/'+id+'/report');
    const c=r.contract||{};
    LD.el('ar-body').innerHTML=`
      <div class="card"><div class="card-head"><h2>服务概况</h2><span class="small muted">生成时间 ${E(String(r.generated_at).slice(0,16))}</span></div>
        <div class="kv-grid">${[['客户名称',(r.client||{}).name],['合同编号',c.contract_no],['服务期间',LD.date(c.start_on)+' 至 '+LD.date(c.end_on)],
          ['服务金额',LD.money(c.amount)],['服务状态',c.status],['负责人',c.owner],['服务记录数',r.total_count+' 次'],
          ['累计工作时长',(r.total_minutes/60).toFixed(1)+' 小时']].map(([k,v])=>`<div class="kv"><b>${E(k)}</b><span>${E(v==null?'—':String(v))}</span></div>`).join('')}</div>
        <div class="hint mt12">服务范围：${E(c.scope||'未填写')}</div></div>
      <div class="grid g2 mt14">
        ${LD.card('工作类型分布',(r.by_type||[]).length?distHTML(r.by_type):'<div class="hint">暂无工作记录</div>')}
        ${LD.card('月度工作趋势',(r.by_month||[]).length?distHTML(r.by_month.map(x=>({name:x.month,value:x.value}))):'<div class="hint">暂无工作记录</div>')}
      </div>
      ${LD.card('工作明细',(r.logs||[]).length?`<div class="table-wrap"><table class="data"><thead><tr><th>日期</th><th>工作类型</th><th>服务内容</th><th>时长</th><th>备注</th></tr></thead><tbody>
        ${r.logs.map(l=>`<tr><td>${E(LD.date(l.worked_at))}</td><td>${LD.badge(l.work_type||'')}</td><td>${E(l.content||'')}</td>
          <td class="mono">${E(l.minutes||0)} 分</td><td class="small muted">${E(l.note||'')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="hint">暂无工作记录；请先在「工作记录」中录入。</div>','','mt14')}
      <div class="card mt14"><div class="card-head"><h2>服务总结与后续建议（可编辑）</h2></div>
        <div class="fld mb12"><label>服务总结</label><textarea id="ar-sum" style="min-height:80px">${E(`本报告期内共录入 ${r.total_count} 次服务，累计工作 ${(r.total_minutes/60).toFixed(1)} 小时。主要工作类型为 ${r.by_type.map(x=>x.name+' '+x.value+' 次').join('、')||'暂无'}。以上内容均来自系统实际工作记录。`)}</textarea></div>
        <div class="fld"><label>后续建议</label><textarea id="ar-adv" style="min-height:80px">${E('建议结合下年度经营计划，提前梳理合同审核、法律培训与合规风险评估需求，并保持工作记录持续录入以便自动汇总。')}</textarea></div>
        <div class="hint mt8">${E(r.disclaimer)}</div></div>`;
    LD.el('ar-print').onclick=()=>{
      const sum=LD.el('ar-sum').value, adv=LD.el('ar-adv').value;
      LD.printHTML('年度法律顾问报告 · '+((r.client||{}).name||''),
        `<div class="kv-grid">${[['客户',(r.client||{}).name],['合同',c.contract_no],['期间',LD.date(c.start_on)+' 至 '+LD.date(c.end_on)],
          ['服务次数',r.total_count],['累计时长',(r.total_minutes/60).toFixed(1)+' 小时']].map(([k,v])=>`<div class="kv"><b>${E(k)}</b><span>${E(v)}</span></div>`).join('')}</div>
        <h3>工作明细</h3><pre style="white-space:pre-wrap">${E(r.logs.map(l=>`${LD.date(l.worked_at)}｜${l.work_type}｜${l.content}｜${l.minutes||0} 分`).join('\n'))}</pre>
        <h3>服务总结</h3><p style="white-space:pre-wrap">${E(sum)}</p><h3>后续建议</h3><p style="white-space:pre-wrap">${E(adv)}</p>
        <p class="small">${E(r.disclaimer)}</p>`);
    };
  };
  LD.el('ar-gen').addEventListener('click',gen);
  LD.el('ar-print').addEventListener('click',()=>{ if(!LD.el('ar-sum')) LD.toast('请先生成报告','info'); });
  if(d.rows.length) gen();
});
function distHTML(list){
  const max=Math.max(...list.map(x=>Number(x.value)||0),1);
  return list.map(x=>`<div class="dist-row"><span class="dl">${E(x.name)}</span><span class="dbar"><i style="width:${Math.max(3,(Number(x.value)/max)*100)}%"></i></span>
    <span class="dn">${E(x.value)}</span></div>`).join('');
}

/* ==================== 日程 / 期限 / 待办 ==================== */
const SCH_COLORS={'开庭':0,'会见':1,'客户沟通':2,'提交材料':3,'举证期限':1,'上诉期限':1,'保全到期':1,'合同到期':3,'其他工作':4};
let calState={mode:'month',date:new Date(),selected:null};
LD.register('schedules',v=>calendar(v));
LD.register('schedules/calendar',v=>calendar(v));
async function calendar(view){
  const d=await LD.api('GET','/api/t/schedules?pageSize=500');
  const deadlines=await LD.api('GET','/api/t/deadlines?pageSize=500');
  const items=[...d.rows.map(r=>({...r,_kind:'schedule'})),
    ...deadlines.rows.map(r=>({id:'dl'+r.id,title:r.dtype+'：'+LD.lookup('cases',r.case_id),type:r.dtype,
      start_at:(r.due_on||'')+'T09:00',status:r.status,case_id:r.case_id,_kind:'deadline'})).filter(x=>x.start_at.length>10)];
  const cases=await LD.api('GET','/api/t/cases?pageSize=200');
  const render=()=>{
    const mode=calState.mode, cur=calState.date;
    const y=cur.getFullYear(), m=cur.getMonth();
    const iso=x=>`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
    let days=[];
    if(mode==='month'){
      const first=new Date(y,m,1); const start=new Date(first); start.setDate(1-((first.getDay()+6)%7));
      for(let i=0;i<42;i++){ const dd=new Date(start); dd.setDate(start.getDate()+i); days.push(dd); }
    } else if(mode==='week'){
      const s=new Date(cur); s.setDate(cur.getDate()-((cur.getDay()+6)%7));
      for(let i=0;i<7;i++){ const dd=new Date(s); dd.setDate(s.getDate()+i); days.push(dd); }
    } else days=[new Date(cur)];
    const byDay={};
    items.forEach(it=>{ const k=String(it.start_at||'').slice(0,10); (byDay[k]=byDay[k]||[]).push(it); });
    const sel=calState.selected||iso(new Date());
    const selItems=byDay[sel]||[];
    const nav=`<div class="cal-head"><button class="btn sm" id="cal-prev">‹ 上一${mode==='month'?'月':mode==='week'?'周':'日'}</button>
      <b>${y} 年 ${m+1} 月</b><button class="btn sm" id="cal-next">下一${mode==='month'?'月':mode==='week'?'周':'日'} ›</button>
      <button class="btn sm" id="cal-today">今天</button>
      <div class="pill-tabs" style="margin:0 0 0 8px">${[['month','月视图'],['week','周视图'],['day','日视图'],['list','列表视图']].map(([k,l])=>
        `<span class="pill ${mode===k?'active':''}" data-cal="${k}">${l}</span>`).join('')}</div>
      <div class="spacer" style="flex:1"></div>
      <button class="btn sm" id="cal-deadline">期限辅助计算</button>
      <button class="btn primary sm" id="cal-new">＋ 新建日程</button></div>`;
    let grid='';
    if(mode==='list') grid='<div id="cal-list"></div>';
    else grid=`<div class="cal-grid">${['一','二','三','四','五','六','日'].map(w=>`<div class="cw">周${w}</div>`).join('')}
      ${days.map(dd=>{ const k=iso(dd); const evs=byDay[k]||[];
        return `<div class="cal-day ${dd.getMonth()!==m?'other':''} ${k===iso(new Date())?'today':''} ${k===sel?'selected':''}" data-day="${k}">
          <div class="dn">${dd.getDate()}</div>
          ${evs.slice(0,3).map(it=>`<div class="cal-ev c${SCH_COLORS[it.type]??4}" draggable="${it._kind==='schedule'}" data-item="${it._kind==='schedule'?it.id:''}" title="${E(it.title)}">${E(String(it.start_at||'').slice(11,16))} ${E(it.title)}</div>`).join('')}
          ${evs.length>3?`<div class="small muted">+${evs.length-3} 项</div>`:''}</div>`; }).join('')}</div>`;
    view.innerHTML=LD.pageHead('日程与提醒','支持月/周/日/列表视图，拖拽日程可调整日期；调整后关联案件与提醒自动同步',
      `<button class="btn" data-go="schedules/deadlines">诉讼期限</button><button class="btn" data-go="schedules/tasks">待办事项</button>`)+
      `<div class="card">${nav}<div class="mt12">${grid}</div>
        <div class="divider"></div><div class="grid g2"><div><div class="small strong mb8">${E(sel)} 当日事项（${selItems.length}）</div>
          ${selItems.length?selItems.map(it=>`<div class="mini-item" data-edititem="${it._kind==='schedule'?it.id:''}">
            <span class="mtime">${E(String(it.start_at||'').slice(11,16))}</span><span class="mt">${E(it.title)}</span>
            <span class="ms">${LD.badge(it.type||'')}</span></div>`).join(''):'<div class="hint">当日暂无事项，点击日历日期后「新建日程」</div>'}</div>
          <div><div class="small strong mb8">类型颜色</div><div class="flex flex-wrap">${Object.keys(SCH_COLORS).map((t,i)=>`<span class="badge" style="background:#fff"><span class="cal-ev c${SCH_COLORS[t]}" style="display:inline-block;padding:1px 8px;margin:0;border-radius:3px">${E(t)}</span></span>`).join('')}</div>
            <div class="hint mt12">新增开庭日期会自动创建日程并反写案件下一关键日期；取消开庭会清除该关键日期。</div></div></div></div>`;
    bindGo(view);
    view.querySelectorAll('[data-cal]').forEach(p=>p.addEventListener('click',()=>{ calState.mode=p.dataset.cal; if(p.dataset.cal==='list'){ LD.go('schedules/list'); return; } render(); }));
    view.querySelector('#cal-prev').addEventListener('click',()=>{ move(-1); });
    view.querySelector('#cal-next').addEventListener('click',()=>{ move(1); });
    view.querySelector('#cal-today').addEventListener('click',()=>{ calState.date=new Date(); calState.selected=iso(new Date()); render(); });
    view.querySelector('#cal-new').addEventListener('click',()=>CRUD.openForm('schedules',null,()=>calendar(view),{start_at:(calState.selected||iso(new Date()))+'T09:00'}));
    view.querySelector('#cal-deadline').addEventListener('click',()=>openDeadlineCalc(()=>calendar(view)));
    view.querySelectorAll('[data-day]').forEach(el=>el.addEventListener('click',()=>{ calState.selected=el.dataset.day; render(); }));
    view.querySelectorAll('[data-day]').forEach(el=>{
      el.addEventListener('dragover',e=>e.preventDefault());
      el.addEventListener('drop',async e=>{ e.preventDefault(); const id=e.dataTransfer.getData('text/plain'); if(!id) return;
        const it=d.rows.find(r=>String(r.id)===id); if(!it) return;
        const time=String(it.start_at||'').slice(11,16)||'09:00';
        await LD.api('PUT','/api/t/schedules/'+id,{start_at:el.dataset.day+'T'+time});
        LD.toast('日程日期已调整，关联案件与提醒已同步'); calendar(view); });
    });
    view.querySelectorAll('[data-item]').forEach(el=>{
      if(!el.dataset.item) return;
      el.addEventListener('dragstart',e=>e.dataTransfer.setData('text/plain',el.dataset.item));
      el.addEventListener('click',e=>{ e.stopPropagation(); CRUD.openForm('schedules',el.dataset.item,()=>calendar(view)); });
    });
    view.querySelectorAll('[data-edititem]').forEach(el=>{ if(el.dataset.edititem) el.addEventListener('click',()=>CRUD.openForm('schedules',el.dataset.edititem,()=>calendar(view))); });
    const move=(dir)=>{ const nd=new Date(calState.date);
      if(calState.mode==='month') nd.setMonth(nd.getMonth()+dir);
      else if(calState.mode==='week') nd.setDate(nd.getDate()+dir*7);
      else nd.setDate(nd.getDate()+dir);
      calState.date=nd; render(); };
  };
  render();
}
LD.register('schedules/list',async view=>{
  const cp=casePreset();
  await CRUD.render(view,'schedules',{title:'日程列表',sub:'点击任意日程可编辑；状态变更会同步案件与提醒',preset:cp,
    headActions:`<button class="btn" data-go="schedules/calendar">日历视图</button>`});
  bindGo(view);
});
LD.register('schedules/tasks',async view=>{
  const cp=casePreset();
  await CRUD.render(view,'tasks',{title:'待办事项',sub:'完成待办后首页统计自动减少',preset:cp,
    headActions:`<button class="btn primary" id="tk-new">＋ 新建待办</button>`});
  view.querySelector('#tk-new').addEventListener('click',()=>CRUD.openForm('tasks',null,()=>LD.reload()));
});
LD.register('schedules/deadlines',async view=>{
  const cp=casePreset();
  await CRUD.render(view,'deadlines',{title:'诉讼期限管理',sub:'所有自动计算结果均显示计算依据，并须律师确认、修改；系统不套用固定通用天数',preset:cp,
    headActions:`<button class="btn" id="dl-calc">期限辅助计算</button><button class="btn primary" id="dl-new">＋ 新增期限</button>`});
  view.querySelector('#dl-new').addEventListener('click',()=>CRUD.openForm('deadlines',null,()=>LD.reload()));
  view.querySelector('#dl-calc').addEventListener('click',()=>openDeadlineCalc(()=>LD.reload()));
});
function openDeadlineCalc(onDone){
  const cases=Object.entries(LD.lookups.cases||{}).map(([id,n])=>`<option value="${id}">${E(n)}</option>`).join('');
  LD.openModal({title:'诉讼期限辅助计算',wide:true,body:`
    <div class="alert warning mb12">系统<b>不会</b>将固定 30 天举证期限或 15 天上诉期限作为所有案件的通用规则。请填写法院指定、双方约定并经确认的天数与计算依据；结果须律师确认后写入。</div>
    <div class="form-grid">
      <div class="fld"><label>关联案件</label><select id="dc-case"><option value="">请选择</option>${cases}</select></div>
      <div class="fld"><label>期限类型</label><select id="dc-type">${(LD.options.deadline_type||[]).map(x=>`<option>${E(x)}</option>`).join('')}</select></div>
      <div class="fld"><label>起算日期</label><input type="date" id="dc-start" value="${E(LD.today)}"></div>
      <div class="fld"><label>法院指定/约定天数 <span class="req">*</span></label><input type="number" id="dc-days" placeholder="按本案实际填写"></div>
      <div class="fld full"><label>计算依据 <span class="req">*</span></label><textarea id="dc-basis" placeholder="例如：法院《举证通知书》指定举证期限，自送达之日起算；或判决书送达日期 + 民诉法规定的上诉期，经律师核对"></textarea></div>
      <div class="fld"><label>提醒日期</label><input type="date" id="dc-remind"></div>
      <div class="fld"><label>律师已确认</label><select id="dc-confirm"><option value="1">是，确认后写入</option><option value="0">否，仅查看计算</option></select></div>
    </div>
    <div class="btn-row mt12"><button class="btn" id="dc-run">计算</button></div><div id="dc-out" class="mt12"></div>`,
    footer:`<button class="btn" data-x>关闭</button><button class="btn primary" data-act="save">确认并创建期限记录</button>`,
    onAction:async(act)=>{
      if(act!=='save') return true;
      const days=LD.el('dc-days').value, basis=LD.el('dc-basis').value.trim();
      if(!days||!basis){ LD.toast('请填写天数与计算依据','error'); return false; }
      const r=await LD.api('GET','/api/deadlines/calc?days='+encodeURIComponent(days)+'&start_on='+encodeURIComponent(LD.el('dc-start').value)+'&basis='+encodeURIComponent(basis));
      if(r.error){ LD.toast(r.error,'error'); return false; }
      await LD.api('POST','/api/t/deadlines',{case_id:LD.el('dc-case').value||null,dtype:LD.el('dc-type').value,
        basis,start_on:LD.el('dc-start').value,due_on:r.due_on,remind_on:LD.el('dc-remind').value||null,
        confirmed:LD.el('dc-confirm').value==='1'?1:0,calc_note:'起算 '+LD.el('dc-start').value+' + '+days+' 天；依据：'+basis+'。'+r.note,
        status:'进行中'});
      LD.toast('期限记录已创建，日历、待办与首页提醒已同步'); if(onDone) onDone(); return true;
    }});
  LD.el('dc-run').addEventListener('click',async()=>{
    const days=LD.el('dc-days').value, basis=LD.el('dc-basis').value.trim();
    if(!days||!basis){ LD.el('dc-out').innerHTML='<div class="alert danger">请填写天数与计算依据后再计算。</div>'; return; }
    const r=await LD.api('GET','/api/deadlines/calc?days='+encodeURIComponent(days)+'&start_on='+encodeURIComponent(LD.el('dc-start').value)+'&basis='+encodeURIComponent(basis));
    LD.el('dc-out').innerHTML=`<div class="alert info"><div><b>辅助计算结果：${E(r.due_on)}</b><br>计算依据：${E(basis)}<br>${E(r.note)}</div></div>`;
  });
}

/* ==================== 工时与计费 ==================== */
LD.register('billing',v=>billingTime(v));
LD.register('billing/time',v=>billingTime(v));
async function billingTime(view){
  const cp=casePreset();
  await CRUD.render(view,'time_entries',{title:'工时记录',sub:'顶部全局计时器结束后自动生成工时；金额由实际录入的时长与费率计算',preset:cp,
    headActions:`<button class="btn" id="bt-timer">打开全局计时器</button><button class="btn primary" id="bt-new">＋ 手动录入工时</button>`});
  view.querySelector('#bt-timer').addEventListener('click',()=>LD.openTimer());
  view.querySelector('#bt-new').addEventListener('click',()=>CRUD.openForm('time_entries',null,()=>LD.reload(),{source:'手动录入'}));
}
LD.register('billing/expenses',async view=>{
  const cp=casePreset();
  await CRUD.render(view,'expenses',{title:'费用记录',sub:'律师费、诉讼相关费用、差旅费与其他费用',preset:cp});
});
LD.register('billing/payments',async view=>{
  const cp=casePreset();
  const cases=await LD.api('GET','/api/t/cases?pageSize=200');
  const pays=await LD.api('GET','/api/t/payments?pageSize=500');
  const byCase={};
  pays.rows.forEach(p=>{ if(p.case_id) byCase[p.case_id]=(byCase[p.case_id]||0)+Number(p.received||0); });
  view.innerHTML=LD.pageHead('收款与账单','支持分阶段收款；已收/未收金额由实际录入数据自动计算',
    `<button class="btn" id="bp-bill">导出账单</button><button class="btn primary" id="bp-new">＋ 新增收款</button>`)+
    `<div class="card mb12"><div class="card-head"><h2>案件回款情况</h2><span class="small muted">应收取案件律师费，已收取实际收款记录</span></div>
      ${cases.rows.length?`<div class="table-wrap"><table class="data"><thead><tr><th>案件</th><th>客户</th><th>应收金额</th><th>已收金额</th><th>未收金额</th><th>回款进度</th></tr></thead><tbody>
      ${cases.rows.map(r=>{ const got=byCase[r.id]||0, fee=Number(r.fee||0), left=Math.max(fee-got,0), pct=fee?Math.min(100,Math.round(got/fee*100)):0;
        return `<tr><td>${E(r.name)}</td><td>${E(LD.lookup('clients',r.client_id))}</td><td class="mono">${LD.money(fee)}</td>
          <td class="mono" style="color:var(--success)">${LD.money(got)}</td><td class="mono" style="color:${left>0?'var(--danger)':'inherit'}">${LD.money(left)}</td>
          <td><div class="dist-row" style="margin:0"><span class="dbar"><i style="width:${pct}%"></i></span><span class="dn">${pct}%</span></div></td></tr>`; }).join('')}</tbody></table></div>`:'<div class="hint">暂无案件</div>'}</div>
    <div id="bp-list"></div>`;
  await CRUD.render(view.querySelector('#bp-list'),'payments',{title:'收款记录',sub:'每次收款实时更新经营统计与案件回款',preset:cp,hideHead:true});
  view.querySelector('#bp-new').addEventListener('click',()=>CRUD.openForm('payments',null,()=>LD.reload(),{paid_at:LD.today}));
  view.querySelector('#bp-bill').addEventListener('click',()=>{
    saveCSV([['案件','客户','应收金额','已收金额','未收金额'],...cases.rows.map(r=>{
      const got=byCase[r.id]||0, fee=Number(r.fee||0); return [r.name,LD.lookup('clients',r.client_id),fee,got,Math.max(fee-got,0)]; })],'案件账单.csv');
    LD.toast('账单已导出');
  });
});

/* ==================== 知识库 ==================== */
LD.register('knowledge',v=>knowledge(v,{}));
LD.register('knowledge/list',v=>knowledge(v,{}));
async function knowledge(view,preset,title='知识库',key='all'){
  const cat=sessionStorage.getItem('ld_kb_cat'); sessionStorage.removeItem('ld_kb_cat');
  if(cat) preset.category=cat;
  await CRUD.render(view,'knowledge_base',{title,sub:'支持文件上传、分类、标签、全文检索、收藏、AI 摘要与案件/客户关联',preset,key,
    headActions:`<button class="btn" id="kb-ai">AI 摘要</button><button class="btn" id="kb-files">文件仓库</button>
      <button class="btn primary" id="kb-new">＋ 上传/录入资料</button>`});
  view.querySelector('#kb-new').addEventListener('click',()=>CRUD.openForm('knowledge_base',null,()=>LD.reload(),{retrieved_at:LD.today,effective_status:'待核验'}));
  view.querySelector('#kb-files').addEventListener('click',()=>CRUD.openFiles('knowledge_base','','知识库附件仓库'));
  view.querySelector('#kb-ai').addEventListener('click',()=>{
    LD.renderAIPanel(); LD.toggleAI(true); LD.el('ai-panel').querySelector('[data-ai="legal_research"]')?.click();
    LD.toast('已切换到法律检索辅助，可输入主题检索本地资料','info');
  });
}
LD.register('knowledge/fav',v=>knowledge(v,{favorite:1},'我的收藏','fav'));
LD.register('knowledge/unverified',v=>knowledge(v,{verified:0},'待核验来源','unverified'));

/* ==================== AI 法律助手页面 ==================== */
LD.register('ai',async view=>{
  const b=await LD.api('GET','/api/bootstrap');
  view.innerHTML=LD.pageHead('AI 法律助手','右侧滑出面板，任意模块均可快速呼出；所有回答结合系统已有案件、客户与文档信息',
    `<button class="btn primary" id="ai-open">打开 AI 面板</button>`)+
    `<div class="grid g2">
      ${LD.card('能力范围',`<div class="mini-list">${[
        ['智能文书起草','读取关联案件资料，套用模板生成初稿，可插入文书编辑器'],
        ['合同审查','风险、不合理条款、权利义务、付款与解除条件逐条标记'],
        ['案件材料总结','基本情况、争议焦点、证据、进展、待办、潜在风险'],
        ['法律检索辅助','检索本地资料库，展示来源与检索日期'],
        ['客户沟通辅助','结合历史沟通记录生成摘要与跟进建议'],
      ].map(([a,d])=>`<div class="mini-item"><span class="mt"><b>${E(a)}</b><div class="small muted">${E(d)}</div></span></div>`).join('')}</div>`)}
      ${LD.card('AI 操作边界',`<div class="alert warning mb12"><b>AI 不得擅自修改正式业务数据。</b></div>
        <div class="mini-list">${['涉及案件阶段变化、重要日期、金额、正式文书、删除数据等操作，必须律师确认',
          '不得编造法律依据、证据或案件事实','所有生成内容标注草稿性质与核验要求',
          'AI 只读取当前账号有权限访问的业务资料'].map(x=>`<div class="mini-item"><span class="mt">${E(x)}</span></div>`).join('')}</div>
        <div class="divider"></div><div class="small muted">大模型接口：${b.llm_configured?'已配置（可在系统设置中修改）':'未配置，当前使用本地上下文模式（只检录系统真实数据，不生成法条或事实）'}</div>
        <button class="btn sm mt8" data-go="settings/ai">前往 AI 配置</button>`)}
    </div>`;
  bindGo(view);
  view.querySelector('#ai-open').addEventListener('click',()=>{ LD.renderAIPanel(); LD.toggleAI(true); });
  LD.renderAIPanel(); LD.toggleAI(true);
});

/* ==================== 经营分析 ==================== */
LD.register('analytics',async view=>{
  let period='month';
  const render=async()=>{
    const d=await LD.api('GET','/api/analytics?period='+period);
    const k=d.kpi;
    const kpis=[['当前在办案件',k.active_cases],['本月新增案件',k.new_cases],['本月结案数量',k.closed_cases],['客户总数',k.clients],
      ['常法客户数',k.retainers],['本月合同金额',LD.money(k.contract_amount)],['本月实际回款',LD.money(k.received)],
      ['待收款金额',LD.money(k.unpaid)],['本月工作时长',(Number(k.minutes)/60).toFixed(1)+' h']];
    const trend=d.income_trend||[];
    const max=Math.max(...trend.map(x=>Number(x.value)||0),1);
    const W=620,H=150,pad=26;
    const pts=trend.map((x,i)=>[pad+i*(W-2*pad)/Math.max(trend.length-1,1),H-pad-(Number(x.value)/max)*(H-2*pad)]);
    const poly=pts.map(p=>p.join(',')).join(' ');
    view.innerHTML=LD.pageHead('经营分析','所有图表依据系统实际业务数据自动生成，不使用虚构金额',
      `<div class="pill-tabs" style="margin:0">${[['month','本月'],['quarter','近一季度'],['year','本年度']].map(([k2,l])=>`<span class="pill ${period===k2?'active':''}" data-period="${k2}">${l}</span>`).join('')}</div>
       <button class="btn" id="an-export">导出 Excel 报表</button>`)+
      `<div class="kpi-grid mb12">${kpis.map(([l,v],i)=>`<div class="stat-card ${['','a','s','p'][i%4]}"><div class="bar"></div>
        <div class="label">${E(l)}</div><div class="value" style="font-size:${String(v).length>9?18:24}px">${E(String(v))}</div></div>`).join('')}</div>
      <div class="grid g2">
        ${LD.card('月度收入趋势（近 12 个月）',`<svg class="line-svg" viewBox="0 0 ${W} ${H+24}" preserveAspectRatio="none">
          <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="#E8E4DC"/>
          ${[0.25,0.5,0.75,1].map(f=>`<line x1="${pad}" y1="${H-pad-f*(H-2*pad)}" x2="${W-pad}" y2="${H-pad-f*(H-2*pad)}" stroke="#F1EEE7" stroke-dasharray="3 3"/>`).join('')}
          <polyline points="${poly}" fill="none" stroke="#657D91" stroke-width="2"/>
          ${pts.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#C6A477"><title>${E(trend[i].month)}：${LD.money(trend[i].value)}</title></circle>`).join('')}
          ${trend.map((x,i)=>`<text x="${pts[i][0]}" y="${H+8}" font-size="9" fill="#92989A" text-anchor="middle">${E(x.month.slice(5))}</text>`).join('')}
          </svg><div class="hint">按收款记录实际录入日期统计。</div>`)}
        ${LD.card('案件类型分布',distHTML(d.case_type_dist))}
        ${LD.card('客户来源分布',distHTML(d.client_source_dist))}
        ${LD.card('案件阶段分布',distHTML(d.case_stage_dist))}
      </div>`;
    view.querySelectorAll('[data-period]').forEach(p=>p.addEventListener('click',()=>{ period=p.dataset.period; render(); }));
    view.querySelector('#an-export').addEventListener('click',()=>{
      const rows=[['LawDesk AI 经营分析报表'],['统计周期',period],['生成日期',LD.today],[],
        ['指标','数值'],...kpis.map(([l,v])=>[l,v]),[],['月度收入趋势'],['月份','回款金额'],...trend.map(x=>[x.month,x.value]),[],
        ['案件类型分布'],['类型','数量'],...(d.case_type_dist||[]).map(x=>[x.name,x.value]),[],
        ['客户来源分布'],['来源','数量'],...(d.client_source_dist||[]).map(x=>[x.name,x.value]),[],
        ['案件阶段分布'],['阶段','数量'],...(d.case_stage_dist||[]).map(x=>[x.name,x.value])];
      saveCSV(rows,'经营分析报表.csv'); LD.toast('报表已导出（CSV，Excel 可直接打开）');
    });
  };
  render();
});

/* ==================== 我的工作台 ==================== */
LD.register('workspace',v=>LD.go('workspace/logs'));
LD.register('workspace/logs',async view=>{
  const d=await LD.api('GET','/api/logs');
  view.innerHTML=LD.pageHead('操作日志与撤销','每次新增、修改、删除、阶段变化、续期均留痕；可撤销最近一次尚未撤销的操作',
    `<button class="btn" data-go="workspace/recycle">回收站</button>`)+
    `<div class="card">${d.rows.length?`<div class="table-wrap"><table class="data"><thead><tr><th>时间</th><th>操作</th><th>模块</th><th>摘要</th><th>状态</th><th>动作</th></tr></thead><tbody>
      ${d.rows.slice(0,150).map(r=>`<tr><td class="small muted mono">${E(String(r.created_at||'').slice(0,16))}</td>
        <td>${LD.badge(r.action)}</td><td>${E(LD.tables[r.entity]?.label||r.entity)}</td><td>${E(r.summary||'')}</td>
        <td>${r.undone?'<span class="badge plain">已撤销</span>':'<span class="badge success">有效</span>'}</td>
        <td>${r.undone?'':`<button class="btn sm" data-undo="${r.id}">撤销</button>`}</td></tr>`).join('')}</tbody></table></div>`:LD.empty('暂无操作日志')}</div>`;
  bindGo(view);
  view.querySelectorAll('[data-undo]').forEach(b=>b.addEventListener('click',()=>{
    LD.confirm({title:'撤销操作确认',body:'将把该条记录恢复到本次操作之前的状态。撤销本身也会留痕。',okText:'确认撤销',
      onOk:async()=>{ const r=await LD.api('POST','/api/undo/'+b.dataset.undo,{});
        if(r.error) LD.toast(r.error,'error'); else { LD.toast('操作已撤销'); LD.reload(); } }});
  }));
});
LD.register('workspace/recycle',async view=>{
  const d=await LD.api('GET','/api/recycle');
  view.innerHTML=LD.pageHead('回收站','软删除的数据可随时恢复；彻底删除不可撤销，请谨慎操作',
    `<button class="btn" data-go="workspace/logs">操作日志</button>`)+
    `<div class="card">${d.rows.length?`<div class="table-wrap"><table class="data"><thead><tr><th>模块</th><th>记录</th><th>删除时间</th><th>操作</th></tr></thead><tbody>
      ${d.rows.map(r=>`<tr><td>${LD.badge(r.label)}</td><td>${E(r.title)} <span class="small muted">#${r.id}</span></td>
        <td class="small muted mono">${E(String(r.deleted_at||'').slice(0,16))}</td>
        <td><div class="btn-row"><button class="btn sm" data-restore="${r.table}|${r.id}">恢复</button>
        <button class="btn sm danger" data-purge="${r.table}|${r.id}" data-title="${E(r.title)}">彻底删除</button></div></td></tr>`).join('')}</tbody></table></div>`:LD.empty('回收站为空')}</div>`;
  bindGo(view);
  view.querySelectorAll('[data-restore]').forEach(b=>b.addEventListener('click',async()=>{
    const [t,id]=b.dataset.restore.split('|'); await LD.api('POST',`/api/t/${t}/${id}/restore`,{}); LD.toast('已恢复'); LD.reload(); }));
  view.querySelectorAll('[data-purge]').forEach(b=>b.addEventListener('click',()=>{
    const [t,id]=b.dataset.purge.split('|');
    LD.confirm({title:'彻底删除确认',danger:true,okText:'永久删除',body:`<b>⚠ 此操作不可撤销，将永久移除：${E(b.dataset.title)}（#${id}）</b><br>涉及历史案件、合同和证据材料，建议优先恢复而非永久删除。`,
      onOk:async()=>{ await LD.api('POST',`/api/t/${t}/${id}/purge`,{}); LD.toast('已彻底删除'); LD.reload(); }});
  }));
});
LD.register('workspace/files',async view=>{
  view.innerHTML=LD.pageHead('文件仓库','所有上传文件真实存储在本地 data/uploads/，与案件、客户建立关联',
    `<button class="btn primary" id="wf-up">上传文件</button>`)+`<div id="wf-list"></div>`;
  await CRUD.render(view.querySelector('#wf-list'),'files',{title:'全部文件',sub:'支持预览、下载、删除',hideCreate:true,deletedOnly:false});
  view.querySelector('#wf-up').addEventListener('click',()=>CRUD.openFiles('','','上传文件到仓库'));
});

/* ==================== 系统设置 ==================== */
LD.register('settings',v=>LD.go('settings/profile'));
LD.register('settings/profile',async view=>{
  view.innerHTML=LD.pageHead('账户与偏好','',`<button class="btn" data-go="settings/backup">备份与恢复</button>`)+
    `<div class="grid g2">
      ${LD.card('账户信息',`<div class="kv-grid">
        <div class="kv"><b>显示名称</b><span>${E(LD.user.display_name)}</span></div>
        <div class="kv"><b>登录账号</b><span>${E(LD.user.username)}</span></div>
        <div class="kv"><b>角色</b><span>${E(LD.user.role)}</span></div>
        <div class="kv"><b>数据隔离</b><span>按账号隔离</span></div></div>
        <div class="fld mt12"><label>修改显示名称</label><input id="st-name" value="${E(LD.user.display_name)}"></div>
        <div class="fld mt8"><label>新密码（留空不修改）</label><input type="password" id="st-pw"></div>
        <button class="btn primary mt12" id="st-save">保存修改</button>`)}
      ${LD.card('数据与存储',`<div class="mini-list">
        <div class="mini-item"><span class="mt">数据库</span><span class="ms">data/lawdesk.db（SQLite 关系型）</span></div>
        <div class="mini-item"><span class="mt">附件</span><span class="ms">data/uploads/（按账号分目录）</span></div>
        <div class="mini-item"><span class="mt">备份</span><span class="ms">data/backups/（含数据库与附件）</span></div>
        <div class="mini-item"><span class="mt">运行方式</span><span class="ms">本机 127.0.0.1，数据不出本机</span></div></div>
        <div class="hint mt12">页面刷新、重启电脑后数据仍保留。不同账号之间的案件、客户、合同与证据材料互不可见。</div>
        <div class="btn-row mt12"><button class="btn sm" id="st-switch">切换 / 注册账号</button><button class="btn sm" id="st-logout">退出登录</button></div>`)}
      ${LD.card('快捷键',`<div class="mini-list">
        ${[['Ctrl + K','全局搜索'],['Ctrl + S','提示自动保存状态'],['Esc','关闭弹窗 / 抽屉 / AI 面板'],['Ctrl + Enter','AI 面板发送消息']].map(([k,v])=>`<div class="mini-item"><span class="mt">${E(k)}</span><span class="ms">${E(v)}</span></div>`).join('')}</div>`)}
      ${LD.card('业务数据字典',`<div class="hint">系统共 ${Object.keys(LD.tables).length} 张业务表，全部通过统一数据源读取，模块间以关联 ID 联动。</div>
        <div class="pill-tabs mt12">${Object.entries(LD.tables).map(([k,v])=>`<span class="pill">${E(v.label)}</span>`).join('')}</div>`)}
    </div>`;
  bindGo(view);
  LD.el('st-save').addEventListener('click',async()=>{
    await LD.api('POST','/api/auth/profile',{display_name:LD.el('st-name').value,password:LD.el('st-pw').value||undefined});
    LD.user.display_name=LD.el('st-name').value; LD.toast('账户信息已保存');
  });
  LD.el('st-switch').addEventListener('click',()=>LD.openLogin());
  LD.el('st-logout').addEventListener('click',async()=>{ await LD.api('POST','/api/auth/logout',{}); location.reload(); });
});
LD.register('settings/backup',async view=>{
  const load=async()=>{
    const d=await LD.api('GET','/api/backup/list');
    view.innerHTML=LD.pageHead('备份与恢复','备份包含完整数据库与所有上传附件；恢复前会自动为当前数据再留一份安全备份',
      `<button class="btn" id="bk-export">导出全量数据 JSON</button><button class="btn primary" id="bk-create">＋ 创建备份</button>`)+
      `<div class="alert warning mb12">恢复会覆盖当前数据库与附件目录，属不可逆操作。执行前请确认影响范围，并建议先创建一份当前备份。</div>
      <div class="card">${d.items.length?`<div class="table-wrap"><table class="data"><thead><tr><th>备份文件</th><th>大小</th><th>创建时间</th><th>操作</th></tr></thead><tbody>
        ${d.items.map(x=>`<tr><td>${E(x.name)}</td><td class="mono">${(x.size/1024).toFixed(1)} KB</td>
          <td class="small muted mono">${E(x.created_at)}</td><td><div class="btn-row">
          <button class="btn sm" data-bkdl="${E(x.name)}">下载</button>
          <button class="btn sm danger" data-bkrs="${E(x.name)}">恢复到此备份</button></div></td></tr>`).join('')}</tbody></table></div>`:LD.empty('暂无备份','创建第一份备份','id="bk-empty"')}</div>`;
    bindGo(view);
    LD.el('bk-create').addEventListener('click',async()=>{ const r=await LD.api('POST','/api/backup/create',{});
      LD.toast('备份已创建：'+r.name); load(); });
    LD.el('bk-export').addEventListener('click',()=>LD.download('/api/export/all','lawdesk-all-data.json'));
    view.querySelectorAll('[data-bkdl]').forEach(b=>b.addEventListener('click',()=>LD.download('/api/backup/download?name='+encodeURIComponent(b.dataset.bkdl),b.dataset.bkdl)));
    view.querySelectorAll('[data-bkrs]').forEach(b=>b.addEventListener('click',()=>{
      LD.confirm({title:'恢复备份确认',danger:true,okText:'确认恢复',body:`<b>⚠ 此操作会覆盖当前全部业务数据</b><br>
        影响范围：数据库 data/lawdesk.db（案件、客户、合同、文书、证据、保全、日程、工时、日志等全部表）以及 data/uploads/ 附件目录。<br>
        将恢复到备份 <b>${E(b.dataset.bkrs)}</b> 的状态。系统会在恢复前自动为当前数据生成一份安全备份。`,
        onOk:async()=>{ const r=await LD.api('POST','/api/backup/restore',{name:b.dataset.bkrs});
          if(r.error) LD.toast(r.error,'error'); else { LD.toast('恢复完成：'+r.note); setTimeout(()=>location.reload(),900); } }});
    }));
    LD.el('bk-empty')?.addEventListener('click',()=>LD.el('bk-create').click());
  };
  await load();
});
LD.register('settings/import',async view=>{
  view.innerHTML=LD.pageHead('导入与导出','按数据表导入/导出 CSV 或 JSON；全量导出可用于迁移与归档')+
    `<div class="card"><div class="card-head"><h2>全量数据</h2></div>
      <div class="btn-row"><button class="btn primary" id="im-all">导出全量 JSON</button><button class="btn" id="im-backup">创建完整备份</button></div>
      <div class="hint mt8">全量 JSON 包含所有业务表数据（不含附件二进制），附件请使用「备份与恢复」。</div></div>
    <div class="card mt14"><div class="card-head"><h2>按表导出 / 导入</h2></div>
      <div class="grid g3">${Object.entries(LD.tables).map(([k,v])=>`<div class="rec-card" style="cursor:default">
        <div class="strong">${E(v.label)}</div><div class="small muted">${E(k)}</div>
        <div class="btn-row mt8"><button class="btn sm" data-expt="${k}">导出</button><button class="btn sm" data-impt="${k}">导入</button></div></div>`).join('')}</div></div>`;
  LD.el('im-all').addEventListener('click',()=>LD.download('/api/export/all','lawdesk-all-data.json'));
  LD.el('im-backup').addEventListener('click',async()=>{ const r=await LD.api('POST','/api/backup/create',{}); LD.toast('备份已创建：'+r.name); });
  view.querySelectorAll('[data-expt]').forEach(b=>b.addEventListener('click',()=>LD.download('/api/export/'+b.dataset.expt+'?format=csv',b.dataset.expt+'.csv')));
  view.querySelectorAll('[data-impt]').forEach(b=>b.addEventListener('click',()=>CRUD.openImport(b.dataset.impt,()=>LD.reload())));
});
LD.register('settings/ai',async view=>{
  const b=await LD.api('GET','/api/bootstrap');
  view.innerHTML=LD.pageHead('AI 配置','可选：配置 OpenAI 兼容的大模型接口后，AI 助手将使用生成式回答（仍强制注入系统业务数据与核验约束）')+
    `<div class="grid g2">
      ${LD.card('接口配置',`<div class="alert info mb12">当前状态：<b>${b.llm_configured?'已配置':'未配置（本地上下文模式）'}</b>。
        密钥仅保存在本机数据库，不会在界面或日志中回显。</div>
        <div class="fld mb12"><label>接口地址（到 /v1 为止，不含 /chat/completions）</label><input id="ai-end" value="${E(b.settings?.llm_endpoint||'')}" placeholder="https://…/v1"></div>
        <div class="fld mb12"><label>API Key（留空表示不修改）</label><input type="password" id="ai-key" placeholder="留空则保留原配置"></div>
        <div class="fld mb12"><label>模型名称</label><input id="ai-model" value="${E(b.settings?.llm_model||'')}" placeholder="例如 gpt-4o-mini"></div>
        <div class="btn-row"><button class="btn primary" id="ai-save">保存配置</button><button class="btn danger" id="ai-clear">清除配置</button></div>
        <div class="hint mt12">接口地址示例填到 <code>/v1</code>；系统会自动请求 <code>/chat/completions</code>。</div>`)}
      ${LD.card('本地上下文模式',`<div class="mini-list">
        ${['不配置密钥也能使用：AI 助手读取案件、客户、证据、文书、日程等真实数据生成总结与草稿',
          '合同审查由本地规则引擎完成，输出风险清单与修改建议，不引用未核验法条',
          '法律检索只返回本地已录入资料，并标注来源、效力状态与检索日期',
          '任何模式都不会编造案件事实、法条、司法解释或判例，也不会擅自修改正式业务数据'].map(x=>`<div class="mini-item"><span class="mt">${E(x)}</span></div>`).join('')}</div>`)}
    </div>`;
  LD.el('ai-save').addEventListener('click',async()=>{
    const payload={llm_endpoint:LD.el('ai-end').value,llm_model:LD.el('ai-model').value};
    if(LD.el('ai-key').value) payload.llm_api_key=LD.el('ai-key').value;
    await LD.api('POST','/api/settings',payload); LD.el('ai-key').value=''; LD.toast('AI 配置已保存（密钥已隐藏）');
  });
  LD.el('ai-clear').addEventListener('click',()=>{
    LD.confirm({title:'清除 AI 配置',danger:true,okText:'清除',body:'将移除大模型接口地址、密钥与模型名称，AI 助手回到本地上下文模式。',
      onOk:async()=>{ await LD.api('POST','/api/settings',{llm_endpoint:'',llm_api_key:'',llm_model:''}); LD.toast('配置已清除'); LD.reload(); }});
  });
});
