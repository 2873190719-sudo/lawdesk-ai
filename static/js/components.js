/* LawDesk AI - schema 驱动的通用 CRUD 组件（所有列表/表单/按钮都有真实逻辑） */
import { LD } from './core.js';

export const CRUD = {
  state:{},

  // ---------- 值显示 ----------
  display(table,key,value,row){
    const f=LD.field(table,key);
    if(value==null||value==='') return '<span class="muted">—</span>';
    if(f.type==='ref') return `<span class="truncate" title="${LD.esc(LD.lookup(f.ref,value))}">${LD.esc(LD.lookup(f.ref,value))}</span>`;
    if(f.type==='file') return `<button class="mini-btn" data-file-open="${value}">查看附件</button>`;
    if(f.type==='money') return `<span class="mono">${LD.money(value)}</span>`;
    if(f.type==='number') return `<span class="mono">${LD.num(value)}</span>`;
    if(f.type==='bool') return value? '<span class="badge success">是</span>' : '<span class="badge plain">否</span>';
    if(f.type==='date') return `<span class="mono small">${LD.esc(LD.date(value))}</span>`;
    if(f.type==='datetime') return `<span class="mono small">${LD.esc(LD.dt(value))}</span>`;
    if(f.type==='textarea'){ const s=String(value).replace(/\n/g,' '); return `<span class="truncate" title="${LD.esc(s)}">${LD.esc(s.slice(0,40))}</span>`; }
    if(f.type==='select') return LD.badge(String(value));
    if(key==='created_at'||key==='updated_at'||key==='uploaded_at') return `<span class="mono small muted">${LD.esc(String(value).slice(0,10))}</span>`;
    return LD.esc(String(value));
  },

  // ---------- 通用列表页 ----------
  async render(container, table, opts={}){
    const meta=LD.tables[table]; if(!meta){ container.innerHTML=LD.empty('数据表不存在'); return; }
    const key='crud_'+table+'_'+(opts.key||'default');
    const st=this.state[key]=Object.assign({
      search:'',filters:{...(opts.preset||{})},sort:opts.sort||'',order:opts.order||'desc',page:1,pageSize:20,
      view:opts.view||'table',selected:new Set(),rows:[],total:0
    }, this.state[key]||{});
    const title=opts.title||meta.label+'管理';
    const sub=opts.sub||`共 ${st.total||0} 条记录 · 数据实时来自本地数据库`;
    container.innerHTML = LD.pageHead(title,sub,opts.headActions||'') + `<div id="crud-root"></div>`;
    const root=container.querySelector('#crud-root');
    await this.load(root,table,opts,key);
  },

  queryString(table,opts,st){
    const p=new URLSearchParams();
    if(st.search) p.set('search',st.search);
    Object.entries(st.filters).forEach(([k,v])=>{ if(v!==''&&v!=null) p.set('filter_'+k,v); });
    if(st.sort) { p.set('sort',st.sort); p.set('order',st.order); }
    p.set('page',st.page); p.set('pageSize',st.pageSize);
    if(opts.dateField&&opts.dateFrom){ p.set('date_field',opts.dateField); p.set('date_from',opts.dateFrom); }
    if(opts.dateField&&opts.dateTo){ p.set('date_field',opts.dateField); p.set('date_to',opts.dateTo); }
    if(opts.deletedOnly) p.set('deleted_only','1');
    return p.toString();
  },

  async load(root,table,opts,key){
    const st=this.state[key], meta=LD.tables[table];
    const d=await LD.api('GET','/api/t/'+table+'?'+this.queryString(table,opts,st));
    st.rows=d.rows; st.total=d.total;
    const filterFields=meta.fields.filter(f=>f.filterable);
    const filterHtml=filterFields.map(f=>{
      let options=[];
      if(f.type==='ref') options=Object.entries(LD.lookups[f.ref]||{}).map(([id,n])=>[id,n]);
      else if(f.options) options=f.options.map(x=>[x,x]);
      else {
        const vals=[...new Set(st.rows.map(r=>r[f.key]).filter(Boolean))].sort();
        options=vals.map(v=>[v,v]);
      }
      return `<select data-filter="${f.key}" title="${LD.esc(f.label)}"><option value="">全部${LD.esc(f.label)}</option>
        ${options.map(([v,l])=>`<option value="${LD.esc(v)}" ${String(st.filters[f.key]||'')===String(v)?'selected':''}>${LD.esc(l)}</option>`).join('')}</select>`;
    }).join('');
    const sortOpts=(meta.list||[]).map(k=>`<option value="${k}" ${st.sort===k?'selected':''}>${LD.esc(LD.label(table,k))}</option>`).join('');
    const cols=opts.columns||meta.list||[];
    const head=`<div class="toolbar">
      <div class="search"><span class="sicon">⌕</span><input id="crud-search" placeholder="搜索${LD.esc(meta.label)}…" value="${LD.esc(st.search)}"></div>
      ${filterHtml}
      <select data-sort><option value="">默认排序</option>${sortOpts}</select>
      <button class="btn icon" data-order title="切换升降序">${st.order==='desc'?'↓':'↑'}</button>
      <div class="spacer"></div>
      ${opts.extraActions||''}
      <button class="btn icon" data-view title="切换视图">${st.view==='table'?'▦ 卡片':'▤ 表格'}</button>
      <button class="btn" data-export>导出</button>
      <button class="btn" data-import>导入</button>
      ${opts.deletedOnly?'':`<button class="btn danger" data-batch style="display:${st.selected.size?'inline-flex':'none'}">删除选中 (${st.selected.size})</button>`}
      ${opts.deletedOnly?'':`<button class="btn primary" data-create>＋ 新建${LD.esc(meta.label)}</button>`}
    </div>`;
    let body='';
    if(!st.rows.length){
      body=`<div class="card">${LD.empty(st.search||Object.values(st.filters).some(Boolean)?'没有符合筛选条件的记录':'暂无'+meta.label+'，点击下方新建开始录入',opts.deletedOnly?'':'新建'+meta.label,'data-create')}</div>`;
    } else if(st.view==='table'){
      const rows=st.rows.map(r=>`<tr class="clickable" data-id="${r.id}">
        ${opts.deletedOnly?'':`<td style="width:28px"><input type="checkbox" data-sel="${r.id}" ${st.selected.has(r.id)?'checked':''}></td>`}
        ${cols.map(k=>`<td>${this.display(table,k,r[k],r)}</td>`).join('')}
        <td style="width:96px"><div class="row-actions">
          ${opts.deletedOnly?`<button class="mini-btn" data-restore="${r.id}">恢复</button><button class="mini-btn del" data-purge="${r.id}">彻底删除</button>`
            :`<button class="mini-btn" data-edit="${r.id}">编辑</button><button class="mini-btn del" data-del="${r.id}">删除</button>`}
        </div></td></tr>`).join('');
      body=`<div class="table-wrap"><table class="data"><thead><tr>
        ${opts.deletedOnly?'<th></th>':''}
        ${cols.map(k=>`<th class="sortable" data-col="${k}">${LD.esc(LD.label(table,k))}${st.sort===k?(st.order==='desc'?' ↓':' ↑'):''}</th>`).join('')}
        <th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="pager"><span>共 ${st.total} 条 · 第 ${st.page} / ${Math.max(1,Math.ceil(st.total/st.pageSize))} 页</span>
        <div class="btn-row"><button class="btn sm" data-prev ${st.page<=1?'disabled':''}>上一页</button>
        <button class="btn sm" data-next ${st.page*st.pageSize>=st.total?'disabled':''}>下一页</button></div></div>`;
    } else {
      body=`<div class="card-view">${st.rows.map(r=>`<div class="rec-card" data-id="${r.id}">
        <h3>${LD.esc(this.recTitle(table,r))}</h3>
        <div class="meta">${cols.slice(1,6).map(k=>`${LD.esc(LD.label(table,k))}：${this.display(table,k,r[k],r)}`).join('<br>')}</div>
        <div class="btn-row mt8">${opts.deletedOnly?`<button class="btn sm" data-restore="${r.id}">恢复</button>`:
          `<button class="btn sm" data-edit="${r.id}">编辑</button><button class="btn sm danger" data-del="${r.id}">删除</button>`}</div></div>`).join('')}</div>
        <div class="pager"><span>共 ${st.total} 条</span><div class="btn-row">
        <button class="btn sm" data-prev ${st.page<=1?'disabled':''}>上一页</button>
        <button class="btn sm" data-next ${st.page*st.pageSize>=st.total?'disabled':''}>下一页</button></div></div>`;
    }
    root.innerHTML = head + body;
    this.bind(root,table,opts,key,cols);
  },

  recTitle(table,r){
    const meta=LD.tables[table];
    const f=meta.fields.find(f=>f.type==='text'&&r[f.key])||meta.fields[0];
    return r[f.key]||(meta.label+' #'+r.id);
  },

  bind(root,table,opts,key,cols){
    const st=this.state[key], meta=LD.tables[table];
    const reload=()=>this.load(root,table,opts,key);
    let t;
    root.querySelector('#crud-search')?.addEventListener('input',e=>{ clearTimeout(t); t=setTimeout(()=>{ st.search=e.target.value; st.page=1; reload(); },280); });
    root.querySelectorAll('[data-filter]').forEach(s=>s.addEventListener('change',()=>{ st.filters[s.dataset.filter]=s.value; st.page=1; reload(); }));
    root.querySelector('[data-sort]')?.addEventListener('change',e=>{ st.sort=e.target.value; st.page=1; reload(); });
    root.querySelector('[data-order]')?.addEventListener('click',()=>{ st.order=st.order==='desc'?'asc':'desc'; reload(); });
    root.querySelector('[data-view]')?.addEventListener('click',()=>{ st.view=st.view==='table'?'card':'table'; reload(); });
    root.querySelectorAll('th[data-col]').forEach(th=>th.addEventListener('click',()=>{ st.sort=th.dataset.col; st.order=st.order==='desc'?'asc':'desc'; reload(); }));
    root.querySelector('[data-prev]')?.addEventListener('click',()=>{ if(st.page>1){ st.page--; reload(); } });
    root.querySelector('[data-next]')?.addEventListener('click',()=>{ if(st.page*st.pageSize<st.total){ st.page++; reload(); } });
    root.querySelectorAll('[data-create]').forEach(b=>b.addEventListener('click',()=>this.openForm(table,null,reload,opts.defaults||{})));
    root.querySelector('[data-export]')?.addEventListener('click',()=>LD.download('/api/export/'+table+'?format=csv',table+'.csv'));
    root.querySelector('[data-import]')?.addEventListener('click',()=>this.openImport(table,reload));
    root.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',e=>{ e.stopPropagation(); this.openForm(table,b.dataset.edit,reload); }));
    root.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',e=>{ e.stopPropagation(); this.confirmDelete(table,b.dataset.del,reload); }));
    root.querySelectorAll('[data-restore]').forEach(b=>b.addEventListener('click',async e=>{
      e.stopPropagation(); await LD.api('POST',`/api/t/${table}/${b.dataset.restore}/restore`,{}); LD.toast('已恢复到业务列表'); reload();
    }));
    root.querySelectorAll('[data-purge]').forEach(b=>b.addEventListener('click',e=>{
      e.stopPropagation();
      LD.confirm({title:'彻底删除确认',danger:true,okText:'永久删除',body:`<b>此操作不可撤销。</b><br>将从数据库中永久移除该${LD.esc(meta.label)}记录及其内容。<br>如只是暂时不用，建议使用「恢复」或普通删除（进入回收站）。`,
        onOk:async()=>{ await LD.api('POST',`/api/t/${table}/${b.dataset.purge}/purge`,{}); LD.toast('已彻底删除'); reload(); }});
    }));
    root.querySelectorAll('[data-sel]').forEach(cb=>cb.addEventListener('change',e=>{
      e.stopPropagation(); const id=Number(cb.dataset.sel);
      if(cb.checked) st.selected.add(id); else st.selected.delete(id);
      const b=root.querySelector('[data-batch]'); if(b){ b.style.display=st.selected.size?'inline-flex':'none'; b.textContent=`删除选中 (${st.selected.size})`; }
    }));
    root.querySelector('[data-batch]')?.addEventListener('click',()=>{
      const ids=[...st.selected]; if(!ids.length) return;
      const names=ids.map(id=>{ const r=st.rows.find(x=>x.id===id); return '· '+(r?this.recTitle(table,r):'#'+id)+'（#'+id+'）'; });
      LD.confirm({title:'批量删除确认',danger:true,okText:`确认删除 ${ids.length} 条`,body:
        `<b>即将删除以下 ${ids.length} 条${LD.esc(meta.label)}记录（进入回收站，可恢复）：</b><div class="code-block mt8">${LD.esc(names.join('\n'))}</div>`,
        onOk:async()=>{ for(const id of ids) await LD.api('DELETE','/api/t/'+table+'/'+id); st.selected.clear(); LD.toast('已删除 '+ids.length+' 条记录'); reload(); }});
    });
    root.querySelectorAll('[data-file-open]').forEach(b=>b.addEventListener('click',e=>{
      e.stopPropagation(); window.open('/api/files/'+b.dataset.fileOpen+'/preview','_blank');
    }));
    root.querySelectorAll('tr[data-id], .rec-card[data-id]').forEach(el=>el.addEventListener('click',e=>{
      if(e.target.closest('button')||e.target.closest('input')||e.target.closest('[data-file-open]')) return;
      const id=Number(el.dataset.id);
      if(opts.onRow) opts.onRow(id, st.rows.find(r=>r.id===id));
      else if(table==='cases') LD.go('case/'+id);
      else if(table==='clients') LD.go('client/'+id);
      else this.openForm(table,id,reload);
    }));
    const focus=sessionStorage.getItem('ld_focus_id');
    if(focus){ sessionStorage.removeItem('ld_focus_id');
      const row=root.querySelector(`[data-id="${focus}"]`); if(row) row.style.outline='2px solid var(--accent)';
    }
  },

  // ---------- 表单抽屉 ----------
  async openForm(table,id,onSaved,defaults={}){
    const meta=LD.tables[table];
    let rec={...defaults};
    if(id){ const d=await LD.api('GET','/api/t/'+table+'/'+id); rec=d.record||{}; }
    const draftKey='ld_draft_'+table+'_'+(id||'new');
    let draft=null; try{ draft=JSON.parse(localStorage.getItem(draftKey)); }catch(e){}
    const fieldsHtml=meta.fields.map(f=>{
      const v=rec[f.key]!=null?rec[f.key]:(f.default!==undefined?f.default:'');
      const full=f.type==='textarea'||f.editor?'full':'';
      const req=f.required?'<span class="req">*</span>':'';
      let ctrl='';
      if(f.type==='ref'){
        const opts=Object.entries(LD.lookups[f.ref]||{}).map(([k,n])=>`<option value="${k}" ${String(v)===String(k)?'selected':''}>${LD.esc(n)}</option>`).join('');
        ctrl=`<select data-f="${f.key}" id="ff-${f.key}"><option value="">请选择</option>${opts}</select>`;
      } else if(f.type==='select'){
        const opts=(f.options||[]).map(o=>`<option value="${LD.esc(o)}" ${String(v)===o?'selected':''}>${LD.esc(o)}</option>`).join('');
        ctrl=`<select data-f="${f.key}" id="ff-${f.key}"><option value="">请选择</option>${opts}</select>`;
      } else if(f.type==='bool'){
        ctrl=`<select data-f="${f.key}" id="ff-${f.key}"><option value="0" ${!v?'selected':''}>否</option><option value="1" ${v?'selected':''}>是</option></select>`;
      } else if(f.type==='file'){
        ctrl=`<input type="file" data-upload="${f.key}" id="fu-${f.key}"><input type="hidden" data-f="${f.key}" id="ff-${f.key}" value="${LD.esc(v||'')}">
          <div id="fv-${f.key}">${v?`<button class="mini-btn" data-file-open="${v}">查看已上传附件</button>`:'<span class="help">支持 Word/PDF/图片/常见办公文件，单文件≤50MB</span>'}</div>`;
      } else if(f.type==='textarea'||f.editor){
        ctrl=`<textarea data-f="${f.key}" id="ff-${f.key}" ${f.editor?'style="min-height:220px"':''} placeholder="${LD.esc(f.label)}">${LD.esc(v)}</textarea>`;
      } else if(f.type==='date'){
        ctrl=`<input type="date" data-f="${f.key}" id="ff-${f.key}" value="${LD.esc(String(v).slice(0,10))}">`;
      } else if(f.type==='datetime'){
        ctrl=`<input type="datetime-local" data-f="${f.key}" id="ff-${f.key}" value="${LD.esc(String(v).slice(0,16))}">`;
      } else if(f.type==='money'||f.type==='number'){
        ctrl=`<input type="number" step="any" data-f="${f.key}" id="ff-${f.key}" value="${LD.esc(v)}">`;
      } else ctrl=`<input type="text" data-f="${f.key}" id="ff-${f.key}" value="${LD.esc(v)}" placeholder="${LD.esc(f.label)}">`;
      return `<div class="fld ${full}"><label>${LD.esc(f.label)}${req}</label>${ctrl}${f.ai?'<div class="help">识别结果须由律师确认后才写入正式合同数据</div>':''}<div class="err" id="fe-${f.key}"></div></div>`;
    }).join('');
    LD.openDrawer({title:(id?'编辑':'新建')+meta.label, width:'min(620px,96vw)', body:`
      <div id="draft-tip"></div>
      ${table==='cases'?'<div id="conflict-tip"></div>':''}
      ${table==='preservation'?'<div class="alert info mb12">到期日可手动修改；系统辅助参考：银行账户冻结 1 年 / 不动产查封 3 年 / 动产、股权 2 年。<b>必须以实际裁定书、适用法律及具体案件情况为准。</b>修改到期日请在备注中记录原因。</div>':''}
      ${table==='deadlines'?'<div class="alert warning mb12">「计算依据」为必填项。本系统不套用固定 15 天上诉期或 30 天举证期作为通用规则，请以法院指定/双方约定并经确认的期限为准。</div>':''}
      <div class="form-grid" id="ld-form">${fieldsHtml}</div>
      <div class="divider"></div><div class="hint">带 <span style="color:var(--danger)">*</span> 为必填。表单内容会自动保存为本地草稿；点击「保存」后才写入数据库并同步所有关联模块。</div>`,
      footer:`<span class="save-state" id="save-state">草稿自动保存已开启</span>
        <button class="btn" data-x>取消</button><button class="btn primary" id="form-save">保存</button>`});
    const drawer=LD.el('ld-drawer'), form=LD.el('ld-form');
    const tip=LD.el('draft-tip');
    if(draft && Object.keys(draft).length){
      tip.innerHTML=`<div class="alert info mb12">检测到未提交的草稿（${LD.esc(draft._time||'')}）。
        <button class="btn sm" id="draft-restore">恢复草稿</button> <button class="btn sm" id="draft-drop">丢弃</button></div>`;
      LD.el('draft-restore').addEventListener('click',()=>{ Object.entries(draft).forEach(([k,v])=>{ if(k.startsWith('_'))return; const e=form.querySelector(`[data-f="${k}"]`); if(e) e.value=v; }); tip.innerHTML=''; LD.toast('草稿已恢复','info'); });
      LD.el('draft-drop').addEventListener('click',()=>{ localStorage.removeItem(draftKey); tip.innerHTML=''; });
    }
    let timer;
    const snapshot=()=>{ const o={_time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})};
      form.querySelectorAll('[data-f]').forEach(e=>o[e.dataset.f]=e.value); return o; };
    form.addEventListener('input',()=>{ clearTimeout(timer); timer=setTimeout(()=>{ localStorage.setItem(draftKey,JSON.stringify(snapshot()));
      const s=LD.el('save-state'); if(s){ s.textContent='草稿已自动保存 '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}); s.className='save-state ok'; } },400); });
    form.addEventListener('change',e=>{
      if(e.target.dataset.upload){
        const f=e.target; if(!f.files||!f.files[0]) return;
        this.uploadFile(f.files[0],table,id||'').then(up=>{
          LD.el('ff-'+f.dataset.upload).value=up.id;
          LD.el('fv-'+f.dataset.upload).innerHTML=`<button class="mini-btn" data-file-open="${up.id}">${LD.esc(up.name)} 已上传</button>`;
          LD.toast('文件已上传：'+up.name);
        }).catch(err=>LD.toast('上传失败：'+err.message,'error'));
      }
      if(table==='cases'&&e.target.dataset.f==='client_id'){
        const cl=LD.lookups.clients?.[e.target.value];
        if(cl){ LD.toast('已自动关联客户档案：'+cl,'info'); }
      }
    });
    // 利益冲突提示（仅名称匹配，不构成认定）
    if(table==='cases'){
      const opp=form.querySelector('[data-f="opponent"]');
      let ct;
      opp?.addEventListener('input',()=>{ clearTimeout(ct); ct=setTimeout(async()=>{
        const v=opp.value.trim(); const box=LD.el('conflict-tip');
        if(v.length<2){ box.innerHTML=''; return; }
        const d=await LD.api('GET','/api/conflict/check?opponent='+encodeURIComponent(v));
        box.innerHTML=d.items.length? `<div class="alert warning mb12"><b>潜在利益冲突提示（${d.items.length} 条历史记录）</b><br>
          ${d.items.slice(0,3).map(x=>`· ${LD.esc(x.name)}｜客户 ${LD.esc(x.client_name||'—')}｜对方 ${LD.esc(x.opponent||'—')}｜${LD.esc(x.cause||'')}`).join('<br>')}
          <br><span class="small">${LD.esc(d.note)}</span> <button class="btn sm mt8" id="conflict-hist">查看相关历史记录</button></div>`
          :'';
        LD.el('conflict-hist')?.addEventListener('click',()=>{ LD.closeDrawer(); LD.go('cases/list'); });
      },450); });
    }
    drawer.querySelector('[data-file-open]')?.addEventListener('click',e=>window.open('/api/files/'+e.target.dataset.fileOpen+'/preview','_blank'));
    LD.el('form-save').addEventListener('click',async()=>{
      const data={}; let bad=false;
      meta.fields.forEach(f=>{
        const e=form.querySelector(`[data-f="${f.key}"]`); if(!e) return;
        const v=e.value; const err=LD.el('fe-'+f.key); if(err) err.textContent='';
        if(f.required && !String(v).trim()){ if(err) err.textContent='此项为必填'; bad=true; }
        data[f.key]=v;
      });
      if(bad){ LD.toast('请补全必填字段','error'); return; }
      try{
        const r=id? await LD.api('PUT','/api/t/'+table+'/'+id,data) : await LD.api('POST','/api/t/'+table,data);
        localStorage.removeItem(draftKey);
        LD.closeDrawer(); LD.toast((id?'已保存修改':'已新建')+meta.label+'，关联模块已同步','success',r.log_id);
        await LD.refreshLookups();
        if(onSaved) onSaved(r.record); else LD.reload();
      }catch(e){ LD.toast('保存失败：'+e.message,'error'); }
    });
  },

  async uploadFile(file,entity,entityId){
    const fd=new FormData(); fd.append('file',file); fd.append('entity',entity); fd.append('entity_id',entityId||'');
    const r=await fetch('/api/files/upload',{method:'POST',credentials:'same-origin',body:fd});
    const d=await r.json(); if(!r.ok||d.error) throw new Error(d.error||'上传失败');
    return d.file;
  },

  confirmDelete(table,id,onDone){
    const meta=LD.tables[table];
    LD.api('GET','/api/t/'+table+'/'+id).then(d=>{
      const r=d.record||{};
      const name=this.recTitle(table,r);
      LD.confirm({title:'删除确认',danger:true,okText:'确认删除',body:
        `<b>即将删除：${LD.esc(name)}（#${id}）</b><br>该${LD.esc(meta.label)}记录将进入回收站，可随时恢复；关联模块统计会同步更新。<br><span class="small muted">涉及历史案件、合同和证据材料建议优先归档而非彻底删除。</span>`,
        onOk:async()=>{ const res=await LD.api('DELETE','/api/t/'+table+'/'+id);
          LD.toast('已删除，进入回收站','success',res.log_id); if(onDone) onDone(); }});
    });
  },

  openImport(table,onDone){
    const meta=LD.tables[table];
    LD.openModal({title:'导入'+meta.label+'数据',wide:true,body:`
      <div class="alert info mb12">支持粘贴 JSON 数组或 CSV 文本（首行为列名，建议先「导出」一份作为模板）。导入会逐条创建新记录并写入操作日志。</div>
      <div class="fld mb12"><label>选择本地 CSV / JSON 文件（可选）</label><input type="file" id="imp-file" accept=".csv,.json,.txt"></div>
      <div class="fld"><label>数据内容</label><textarea id="imp-text" style="min-height:220px;font-family:Consolas,monospace;font-size:12px" placeholder='[{"name":"示例客户","type":"企业客户"}]'></textarea></div>
      <div class="hint mt8">字段名请使用系统内部字段：${LD.esc(meta.fields.map(f=>f.key).join(', '))}</div>`,
      footer:`<button class="btn" data-x>取消</button><button class="btn" data-act="template">下载模板</button><button class="btn primary" data-act="import">开始导入</button>`,
      onAction:async(act)=>{
        if(act==='template'){ LD.download('/api/export/'+table+'?format=csv',table+'-template.csv'); return false; }
        if(act==='import'){
          const txt=LD.el('imp-text').value.trim(); if(!txt){ LD.toast('请粘贴数据','error'); return false; }
          let payload={};
          try{ payload={rows:JSON.parse(txt)}; }catch(e){ payload={csv:txt}; }
          const r=await LD.api('POST','/api/import/'+table,payload);
          if(r.error){ LD.toast(r.error,'error'); return false; }
          LD.toast(`导入完成：成功 ${r.created} 条${r.failed.length?'，失败 '+r.failed.length+' 条':''}`);
          await LD.refreshLookups(); if(onDone) onDone(); return true;
        }
        return true;
      }});
    LD.el('imp-file')?.addEventListener('change',e=>{
      const f=e.target.files[0]; if(!f) return;
      const rd=new FileReader(); rd.onload=()=>{ LD.el('imp-text').value=rd.result; }; rd.readAsText(f,'utf-8');
    });
  },

  // ---------- 文件仓库（拖拽上传 / 预览 / 下载 / 删除） ----------
  async openFiles(entity,entityId,title='相关文件'){
    const load=async()=>{
      const d=await LD.api('GET',`/api/t/files?${entity?`filter_entity=${encodeURIComponent(entity)}&`:''}${entityId?`filter_entity_id=${entityId}&`:''}pageSize=100`);
      return d.rows;
    };
    let files=await load();
    LD.openModal({title,wide:true,body:`<div id="file-area"></div>`,footer:'<button class="btn" data-x>关闭</button>'});
    const area=LD.el('file-area');
    const paint=()=>{
      area.innerHTML=`<div class="dropzone mb12" id="fz">拖拽文件到此处，或点击选择上传（Word / PDF / 图片 / 常见办公文件，≤50MB）</div>
        <input type="file" id="fz-input" multiple style="display:none">
        ${files.length?`<div class="table-wrap"><table class="data"><thead><tr><th>文件名</th><th>类型</th><th>大小</th><th>上传时间</th><th>操作</th></tr></thead><tbody>
        ${files.map(f=>`<tr><td>${LD.esc(f.name)}</td><td class="small muted">${LD.esc(f.mime||'')}</td><td class="mono">${(f.size/1024).toFixed(1)} KB</td>
          <td class="small muted">${LD.esc(String(f.uploaded_at||'').slice(0,16))}</td><td><div class="btn-row">
          <button class="btn sm" data-fp="${f.id}">预览</button><button class="btn sm" data-fd="${f.id}">下载</button>
          <button class="btn sm danger" data-fx="${f.id}">删除</button></div></td></tr>`).join('')}</tbody></table></div>`
        :`<div class="empty"><div class="eicon">▢</div><p>暂无文件，拖拽上传即可与当前记录建立真实关联</p></div>`}`;
      const dz=LD.el('fz'), inp=LD.el('fz-input');
      dz.addEventListener('click',()=>inp.click());
      dz.addEventListener('dragover',e=>{ e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
      dz.addEventListener('drop',async e=>{ e.preventDefault(); dz.classList.remove('over'); await handleFiles(e.dataTransfer.files); });
      inp.addEventListener('change',()=>handleFiles(inp.files));
      area.querySelectorAll('[data-fp]').forEach(b=>b.addEventListener('click',()=>window.open('/api/files/'+b.dataset.fp+'/preview','_blank')));
      area.querySelectorAll('[data-fd]').forEach(b=>b.addEventListener('click',()=>window.open('/api/files/'+b.dataset.fd+'/download','_blank')));
      area.querySelectorAll('[data-fx]').forEach(b=>b.addEventListener('click',()=>{
        const f=files.find(x=>String(x.id)===b.dataset.fx);
        LD.confirm({title:'删除文件确认',danger:true,okText:'删除文件',body:`<b>${LD.esc(f?.name||'')}</b><br>将解除该附件与业务记录的关联（文件记录进入回收站，可恢复）。`,
          onOk:async()=>{ await LD.api('DELETE','/api/files/'+b.dataset.fx); LD.toast('附件已删除'); files=await load(); paint(); }});
      }));
    };
    const handleFiles=async list=>{
      for(const f of list){
        try{ await this.uploadFile(f,entity||'',entityId||''); }
        catch(e){ LD.toast(f.name+' 上传失败：'+e.message,'error'); }
      }
      files=await load(); paint(); LD.toast('文件上传完成，已与当前记录关联');
    };
    paint();
  },
};

export default CRUD;
