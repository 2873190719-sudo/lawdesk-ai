/* LawDesk AI - 核心框架：路由 / API / 全局交互 */
const ICONS = {
  home:'⌂', briefcase:'▣', users:'◍', 'file-text':'▤', file:'▢', search:'⌕', paperclip:'⎆',
  shield:'⛨', building:'▥', calendar:'▦', timer:'◷', book:'▣', sparkles:'✦',
  'bar-chart':'▥', grid:'▦', settings:'⚙', bell:'◔', plus:'＋', chevron:'›'
};

export const LD = {
  boot:null, user:null, menu:[], tables:{}, options:{}, lookups:{}, today:'',
  pages:{}, hash:'', timer:{running:false,startedAt:0,elapsed:0,caseId:null,clientId:null,content:''},
  ai:{open:false, action:'chat', caseId:null, clientId:null, history:[]},
  notices:[], riskBootDone:false,
  // 左侧导航：当前展开的一级菜单（手风琴）；null = 全部收起。折叠偏好持久化到本地。
  navOpen:null, _navIntent:false, _lastTop:null, _navReady:false,

  loadNavOpen(){
    try{ const v=localStorage.getItem('lawdesk_nav_open'); return v===null?undefined:(v||null); }
    catch(e){ return undefined; }
  },
  saveNavOpen(){ try{ localStorage.setItem('lawdesk_nav_open', this.navOpen||''); }catch(e){} },
  applyNavOpen(){
    const nav=this.el('nav'); if(!nav) return;
    nav.querySelectorAll('.nav-item').forEach(n=>{
      const on = !!this.navOpen && n.dataset.id===this.navOpen;
      n.classList.toggle('expanded', on);
      const sub=n.nextElementSibling;
      if(sub && sub.classList.contains('nav-sub')){
        sub.style.maxHeight = on ? (sub.scrollHeight+'px') : '0px';
        sub.style.opacity = on ? '1' : '0';
      }
    });
    if(!this._navReady){
      this._navReady=true; nav.classList.add('nav-init');
      requestAnimationFrame(()=>requestAnimationFrame(()=>nav.classList.remove('nav-init')));
    }
  },

  register(id, fn){ this.pages[id] = fn; },
  el(id){ return document.getElementById(id); },
  esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  icon(k){ return ICONS[k] || '▢'; },
  money(v){ if(v==null||v==='') return '—'; return '¥' + Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}); },
  num(v){ if(v==null||v==='') return '—'; return Number(v).toLocaleString('zh-CN'); },
  date(v){ return v ? String(v).slice(0,10) : '—'; },
  dt(v){ return v ? String(v).replace('T',' ').slice(0,16) : '—'; },
  field(table,key){ return (this.tables[table]?.fields||[]).find(f=>f.key===key) || {key,label:key,type:'text'}; },
  label(table,key){ return this.field(table,key).label; },
  lookup(table,id){ return (this.lookups[table]||{})[id] || (id? '#'+id : '—'); },

  async api(method, path, data, retry=true){
    const opt = {method, credentials:'same-origin', headers:{}};
    if(data!==undefined && data!==null){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(data); }
    const r = await fetch(path, opt);
    if(r.status===401 && retry){
      await this.api('POST','/api/auth/login',{username:'admin',password:'lawdesk'},false);
      return this.api(method,path,data,false);
    }
    const ct = r.headers.get('Content-Type')||'';
    const payload = ct.includes('json') ? await r.json() : await r.text();
    if(!r.ok) throw new Error(payload?.error || ('请求失败 '+r.status));
    return payload;
  },
  async download(path, filename){
    const r = await fetch(path,{credentials:'same-origin'});
    if(!r.ok){ this.toast('导出失败','error'); return; }
    const blob = await r.blob(); this.saveBlob(blob, filename || 'export.csv');
  },
  async postDownload(path, data, filename){
    const r = await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    if(!r.ok){ this.toast('导出失败','error'); return; }
    this.saveBlob(await r.blob(), filename);
  },
  saveBlob(blob, filename){
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename;
    document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);
  },
  async refreshLookups(){ this.lookups = await this.api('GET','/api/lookups'); },

  // ---------------- 启动 ----------------
  async start(){
    try{
      await this.api('POST','/api/auth/login',{username:'admin',password:'lawdesk'},false);
      const b = await this.api('GET','/api/bootstrap');
      Object.assign(this,{boot:b,user:b.user,menu:b.menu,tables:b.tables,options:b.options,lookups:b.lookups,today:b.today,stages:b.stages});
      this.timer = this.loadTimer();
      const savedNav=this.loadNavOpen();
      if(savedNav===undefined){
        const t=(location.hash||'#/home').replace(/^#\/?/,'').split('/')[0]||'home';
        const pm=this.menu.find(x=>x.id===t && (x.children||[]).length);
        this.navOpen = pm ? pm.id : null;
      } else this.navOpen = savedNav;
      await Promise.all([import('./components.js'),import('./pages.js'),import('./pages2.js')]);
      this.renderShell();
      window.addEventListener('hashchange',()=>this.route());
      document.addEventListener('keydown',e=>this.hotkeys(e));
      this.tickTimer();
      this.route();
      this.checkRiskBoot();
    }catch(e){
      this.el('app').innerHTML = '<div class="boot-screen"><div class="boot-logo">LD</div><div>启动失败：'+this.esc(e.message)+'</div><button class="btn primary" onclick="location.reload()">重试</button></div>';
      console.error(e);
    }
  },

  // ---------------- 布局 ----------------
  renderShell(){
    const menuHtml = this.menu.map(m=>{
      const kids = (m.children||[]).map(c=>`<div class="sub-item" data-go="${this.esc(c.id)}">${this.esc(c.label)}</div>`).join('');
      return `<div class="nav-item" data-id="${this.esc(m.id)}" title="${this.esc(m.label)}">
        <span class="ico">${this.icon(m.icon)}</span><span>${this.esc(m.label)}</span>${kids?`<span class="caret">›</span>`:''}</div>
        ${kids?`<div class="nav-sub" data-sub="${this.esc(m.id)}">${kids}</div>`:''}`;
    }).join('');
    this.el('app').innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="mark">LD</div><div><b>LawDesk AI</b><small>LAW PRACTICE OS</small></div></div>
        <div class="nav-scroll" id="nav">${menuHtml}</div>
        <div class="foot">本地数据 · 隐私优先<br>© LawDesk AI</div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="gsearch">
            <span class="sicon">⌕</span>
            <input id="gsearch" placeholder="全局搜索案件、客户、合同…" autocomplete="off">
            <kbd class="gs-kbd">Ctrl K</kbd>
            <div id="search-panel"></div>
          </div>
          <div class="top-actions">
            <button class="tbtn primary" data-new="cases"><span>＋ 新建案件</span></button>
            <button class="tbtn" data-new="clients"><span>＋ 客户</span></button>
            <button class="tbtn" data-new="contracts"><span>↑ 合同</span></button>
            <button class="tbtn" data-new="documents"><span>＋ 文书</span></button>
            <div class="timer-chip" id="timer-chip" title="全局计时器"><span class="pulse"></span><span id="timer-text">00:00</span></div>
            <button class="tbtn" id="bell-btn" title="通知中心">◔<span class="dot" id="bell-dot" style="display:none"></span></button>
            <div class="today-label" id="today-label"></div>
            <div class="avatar" id="avatar" title="账户设置">${this.esc((this.user.display_name||'律')[0])}</div>
          </div>
        </header>
        <main class="content" id="view"></main>
      </div>
    </div>
    <aside class="ai-panel" id="ai-panel"></aside>`;
    this.el('today-label').textContent = this.today + ' ' + ['周日','周一','周二','周三','周四','周五','周六'][new Date().getDay()];
    this.bindShell();
  },

  bindShell(){
    this.el('nav').addEventListener('click', e=>{
      const sub = e.target.closest('.sub-item');
      if(sub){ this.go(sub.dataset.go); return; }
      const item = e.target.closest('.nav-item');
      if(!item) return;
      const id = item.dataset.id;
      const m = this.menu.find(x=>x.id===id);
      if(m && m.children && m.children.length){
        const isOpen = this.navOpen===id;
        this.navOpen = isOpen ? null : id;   // 再次单击同一菜单即收起
        this.saveNavOpen();
        this.applyNavOpen();
        // 收起时不触发路由（避免 route 又把菜单展开）；
        // 展开时若当前页面已属于该菜单则原地停留，否则进入第一个子页。
        if(!isOpen){
          const h=(location.hash||'').replace(/^#\/?/,'');
          const belongs=(m.children||[]).some(c=>c.id===h);
          if(!belongs) this.go(m.children[0].id);
        }
      } else this.go(id);
    });
    document.querySelectorAll('[data-new]').forEach(b=>b.addEventListener('click',()=>{
      import('./components.js').then(m=>m.CRUD.openForm(b.dataset.new,null,()=>this.reload()));
    }));
    this.el('timer-chip').addEventListener('click',()=>this.openTimer());
    this.el('bell-btn').addEventListener('click',()=>this.openNotices());
    this.el('avatar').addEventListener('click',()=>this.openAccount());
    const gs = this.el('gsearch');
    gs.addEventListener('input',()=>this.globalSearch(gs.value));
    gs.addEventListener('focus',()=>{ if(gs.value) this.globalSearch(gs.value); });
    document.addEventListener('click',e=>{
      if(!e.target.closest('.gsearch')) this.el('search-panel').innerHTML='';
      if(!e.target.closest('#bell-btn') && !e.target.closest('.notice-pop')) this.closeOverlay('notice-pop');
    });
    this.renderAIPanel();
  },

  // ---------------- 路由 ----------------
  go(id){
    this._navIntent=true;
    if(location.hash === '#/'+id){ this.reload(); return; }
    location.hash = '#/'+id;
  },
  reload(){ this.route(true); },
  async route(force=false){
    const h = decodeURIComponent((location.hash||'#/home').replace(/^#\/?/,'') || 'home');
    this.hash = h;
    const view = this.el('view');
    if(!view) return;
    // 高亮导航：只有「主动导航到某个模块」才自动展开其父菜单；
    // 用户手动收起的状态由 navOpen 保持，route 不再强制加回 expanded。
    const top = h.split('/')[0];
    const parent = this.menu.find(m=>m.id===top && (m.children||[]).length);
    if(parent && this._navIntent && top!==this._lastTop){ this.navOpen=top; this.saveNavOpen(); }
    this._lastTop = top;
    this._navIntent = false;
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.id===top));
    this.applyNavOpen();
    document.querySelectorAll('.sub-item').forEach(n=>n.classList.toggle('active',n.dataset.go===h));
    view.innerHTML = '<div class="center muted" style="padding:50px">载入中…</div>';
    try{
      let fn = null, arg = null;
      if(h.startsWith('case/')){ fn=this.pages['case_detail']; arg=h.slice(5); }
      else if(h.startsWith('client/')){ fn=this.pages['client_detail']; arg=h.slice(7); }
      else fn = this.pages[h] || this.pages[(this.menu.find(m=>m.id===top)?.children||[{}])[0]?.id] || this.pages['home'];
      if(!fn) fn = (el)=>{ el.innerHTML = this.emptyPage(h); };
      await fn(view, arg);
      window.scrollTo(0,0);
    }catch(e){
      view.innerHTML = `<div class="card"><h2>页面载入失败</h2><p class="muted">${this.esc(e.message)}</p><button class="btn" onclick="location.reload()">重新载入</button></div>`;
      console.error(e);
    }
  },
  emptyPage(h){ return `<div class="card"><h2>${this.esc(h)}</h2><p class="muted">该页面正在加载或暂未定义。</p></div>`; },

  hotkeys(e){
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); this.el('gsearch')?.focus(); return; }
    if(e.key==='Escape'){
      if(this.el('search-panel')) this.el('search-panel').innerHTML='';
      this.closeDrawer(); this.closeModal(); this.closeOverlay('notice-pop');
      if(this.ai.open){ this.ai.open=false; this.el('ai-panel').classList.remove('open'); }
    }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); this.toast('表单已自动保存草稿；业务数据请点击保存按钮写入数据库','info'); }
  },

  // ---------------- 全局搜索 ----------------
  async globalSearch(q){
    const panel = this.el('search-panel');
    if(!q.trim()){ panel.innerHTML=''; return; }
    try{
      const d = await this.api('GET','/api/search?q='+encodeURIComponent(q.trim()));
      if(!d.groups.length){ panel.innerHTML='<div class="search-empty">未找到相关记录</div>'; return; }
      panel.innerHTML = '<div class="search-panel-inner">' + d.groups.map(g=>`
        <div class="search-group"><div class="gt">${this.esc(g.label)} · ${g.items.length}</div>
        ${g.items.map(it=>`<div class="search-item" data-table="${g.table}" data-id="${it.id}">
          <div class="st">${this.esc(it.title)}</div><div class="ss">${this.esc(it.sub)}</div></div>`).join('')}</div>`).join('') + '</div>';
      panel.querySelectorAll('.search-item').forEach(it=>it.addEventListener('click',()=>{
        const t=it.dataset.table, id=it.dataset.id;
        panel.innerHTML=''; this.el('gsearch').value='';
        const map={cases:'case/',clients:'client/',contracts:'contracts/list',documents:'documents/list',
          knowledge_base:'legal_search/all',schedules:'schedules/list',evidence:'evidence/list',legal_templates:'documents/templates'};
        this.go((map[t]||'home').startsWith('case/')|| (map[t]||'home').startsWith('client/') ? map[t]+id : map[t]||'home');
        if(t==='contracts'||t==='documents'||t==='schedules'||t==='evidence') sessionStorage.setItem('ld_focus_id',id);
      }));
    }catch(e){ panel.innerHTML='<div class="search-empty">搜索失败</div>'; }
  },

  // ---------------- 通知 ----------------
  async openNotices(){
    const old=this.el('notice-pop'); if(old){ old.remove(); return; }
    const d = await this.api('GET','/api/dashboard');
    this.notices = d.notices||[];
    this.el('bell-dot').style.display = this.notices.length?'inline-block':'none';
    const pop=document.createElement('div'); pop.id='notice-pop'; pop.className='notice-pop';
    pop.style.cssText='position:fixed;right:70px;top:58px;width:320px;max-height:70vh;overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow-lg);z-index:80;padding:10px';
    pop.innerHTML = `<div class="flex between mb8"><b style="font-size:13px">通知中心</b><span class="small muted">${this.notices.length} 条</span></div>` +
      (this.notices.length? this.notices.map(n=>`<div class="notice-item ${this.esc(n.level)}" data-link="${this.esc(n.link)}"><div class="nd"></div><div><div class="strong">${this.esc(n.title)}</div><div class="nb">${this.esc(n.body)}</div></div></div>`).join('')
       : '<div class="search-empty">暂无待处理提醒</div>');
    document.body.appendChild(pop);
    pop.querySelectorAll('.notice-item').forEach(x=>x.addEventListener('click',()=>{ pop.remove(); this.go(x.dataset.link); }));
  },
  closeOverlay(id){ const e=this.el(id); if(e && e.classList?.contains('notice-pop')) e.remove(); },

  // ---------------- 账户 ----------------
  openAccount(){
    this.openModal({title:'账户与偏好', body:`
      <div class="form-grid">
        <div class="fld"><label>当前用户</label><input value="${this.esc(this.user.display_name)}" id="ac-name"></div>
        <div class="fld"><label>登录账号</label><input value="${this.esc(this.user.username)}" disabled></div>
        <div class="fld full"><label>新密码（留空不修改）</label><input type="password" id="ac-pw" placeholder="设置新密码"></div>
      </div>
      <div class="hint mt12">数据按账号隔离，不同用户之间的案件、客户、合同与证据材料互不可见。所有数据保存在本机 data/lawdesk.db。</div>`,
      footer:`<button class="btn" data-act="switch">切换/注册账号</button><button class="btn" data-act="close">取消</button><button class="btn primary" data-act="save">保存</button>`,
      onAction:async(act,modal)=>{
        if(act==='close') return true;
        if(act==='save'){
          await this.api('POST','/api/auth/profile',{display_name:this.el('ac-name').value,password:this.el('ac-pw').value||undefined});
          this.user.display_name=this.el('ac-name').value; this.toast('账户信息已保存'); return true;
        }
        if(act==='switch'){ modal.remove(); this.openLogin(); return false; }
      }});
  },
  openLogin(){
    this.openModal({title:'切换账号', body:`<div class="form-grid">
      <div class="fld full"><label>账号</label><input id="lg-u" placeholder="已有账号或新账号"></div>
      <div class="fld full"><label>密码</label><input type="password" id="lg-p"></div></div>
      <div class="hint mt8">输入新账号名将自动注册一个数据完全隔离的独立工作区。</div>`,
      footer:`<button class="btn" data-act="close">取消</button><button class="btn" data-act="reg">注册新账号</button><button class="btn primary" data-act="login">登录</button>`,
      onAction:async(act)=>{
        if(act==='close') return true;
        const u=this.el('lg-u').value, p=this.el('lg-p').value;
        try{
          const r=await fetch('/api/auth/'+(act==='reg'?'register':'login'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
          const d=await r.json(); if(!r.ok){ this.toast(d.error||'失败','error'); return false; }
          location.reload(); return true;
        }catch(e){ this.toast('操作失败','error'); return false; }
      }});
  },

  // ---------------- 弹窗 / 抽屉 / Toast ----------------
  overlay(content, cls='overlay'){
    const o=document.createElement('div'); o.className=cls; o.innerHTML=content;
    this.el('overlay-root').appendChild(o); return o;
  },
  openModal({title,body,footer,onAction,wide=false}){
    this.closeModal();
    const o=this.overlay(`<div class="modal ${wide?'wide':''}" id="ld-modal">
      <div class="mh"><h3>${this.esc(title)}</h3><button class="icon-btn" data-x>×</button></div>
      <div class="mb">${body}</div><div class="mf">${footer||'<button class="btn" data-x>关闭</button>'}</div></div>`);
    o.addEventListener('click',e=>{
      if(e.target===o || e.target.closest('[data-x]')){ this.closeModal(); return; }
      const b=e.target.closest('[data-act]');
      if(b && onAction){ Promise.resolve(onAction(b.dataset.act,o.querySelector('.modal'))).then(done=>{ if(done!==false) this.closeModal(); }); }
    });
    return o;
  },
  closeModal(){ const m=this.el('ld-modal'); if(m){ m.parentElement.remove(); } },
  openDrawer({title,body,footer,width}){
    this.closeDrawer();
    const o=this.overlay(`<div class="drawer" id="ld-drawer" ${width?`style="width:${width}"`:''}>
      <div class="dh"><h3>${this.esc(title)}</h3><button class="icon-btn" data-x>×</button></div>
      <div class="db" id="ld-drawer-body">${body}</div>
      <div class="df">${footer||''}</div></div>`, 'overlay drawer-overlay');
    o.addEventListener('click',e=>{ if(e.target===o||e.target.closest('[data-x]')) this.closeDrawer(); });
    return o;
  },
  closeDrawer(){ const d=this.el('ld-drawer'); if(d){ d.parentElement.remove(); } },
  toast(msg,type='success',logId){
    const t=document.createElement('div'); t.className='toast '+type;
    t.innerHTML=`<span>${this.esc(msg)}</span>${logId?`<span class="undo" data-undo="${logId}">撤销</span>`:''}`;
    this.el('toast-root').appendChild(t);
    t.querySelector('[data-undo]')?.addEventListener('click',async()=>{
      try{ await this.api('POST','/api/undo/'+logId,{}); this.toast('已撤销上一步操作'); this.reload(); }
      catch(e){ this.toast('撤销失败：'+e.message,'error'); }
      t.remove();
    });
    setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),320); }, logId?7000:3500);
  },
  confirm({title,body,danger=false,okText='确认',onOk}){
    this.openModal({title, body:`<div class="${danger?'alert danger':'alert info'}">${body}</div>`,
      footer:`<button class="btn" data-x>取消</button><button class="btn ${danger?'danger':'primary'}" data-act="ok">${this.esc(okText)}</button>`,
      onAction:async(act)=>{ if(act==='ok'){ await onOk(); return true; } return true; }});
  },

  // ---------------- 保全强制提醒 ----------------
  async checkRiskBoot(){
    if(this.riskBootDone) return; this.riskBootDone=true;
    try{
      const d=await this.api('GET','/api/risk/boot');
      if(!d.count) return;
      const items=d.items.slice(0,6);
      this.openModal({title:'⚠ 高风险保全事项提醒', wide:true, body:`
        <div class="alert danger mb12"><div>系统检测到 <b>${d.count}</b> 项已过期或 7 天内到期的保全事项，按优先级排在普通诉讼期限之前。仅点击「知道了」不会改变事项的未处理状态，须完成续期、解除或其他明确处理操作后才会解除提醒。</div></div>
        ${items.map(x=>`<div class="risk-stripe" style="border-left-color:${x.risk_color}" data-case="${x.case_id||''}" data-id="${x.id}">
          <span class="badge danger">${this.esc(x.risk_label)}</span>
          <span class="rt">${this.esc(x.target)}</span>
          <span class="rd">${this.esc(x.case_name)} · 到期 ${this.esc(x.end_on)} · ${x.days} 天</span>
        </div>`).join('')}`,
        footer:`<button class="btn" data-x>知道了（不改变状态）</button><button class="btn" data-act="detail">查看保全汇总</button><button class="btn primary" data-act="handle">登记续期/处理</button>`,
        onAction:(act)=>{
          if(act==='detail'){ this.go('preservation/risk'); return true; }
          if(act==='handle'){ this.go('preservation/risk'); setTimeout(()=>document.querySelector('[data-risk-renew]')?.click(),600); return true; }
          return true;
        }});
      document.querySelectorAll('#ld-modal .risk-stripe').forEach(el=>el.addEventListener('click',()=>{
        if(el.dataset.case){ this.closeModal(); this.go('case/'+el.dataset.case); }
      }));
    }catch(e){ console.warn('风险检查失败',e); }
  },

  // ---------------- 全局计时器 ----------------
  loadTimer(){ try{ return JSON.parse(localStorage.getItem('lawdesk_timer')) || {running:false,startedAt:0,elapsed:0,caseId:null,clientId:null,content:''}; }catch(e){ return {running:false,startedAt:0,elapsed:0,caseId:null,clientId:null,content:''}; } },
  saveTimer(){ localStorage.setItem('lawdesk_timer',JSON.stringify(this.timer)); },
  elapsedSec(){ return Math.floor((this.timer.elapsed + (this.timer.running? Date.now()-this.timer.startedAt:0))/1000); },
  tickTimer(){
    setInterval(()=>{
      const s=this.elapsedSec(), m=String(Math.floor(s/60)).padStart(2,'0'), ss=String(s%60).padStart(2,'0');
      const t=this.el('timer-text'); if(t) t.textContent=m+':'+ss;
      const chip=this.el('timer-chip'); if(chip) chip.classList.toggle('running',this.timer.running);
    },1000);
  },
  openTimer(){
    const cases=Object.entries(this.lookups.cases||{}).map(([id,n])=>`<option value="${id}" ${String(this.timer.caseId)===id?'selected':''}>${this.esc(n)}</option>`).join('');
    const clients=Object.entries(this.lookups.clients||{}).map(([id,n])=>`<option value="${id}" ${String(this.timer.clientId)===id?'selected':''}>${this.esc(n)}</option>`).join('');
    this.openModal({title:'全局计时器', body:`
      <div class="center" style="padding:8px 0 16px"><div style="font-size:38px;font-weight:650" class="mono" id="tm-display">00:00</div><div class="small muted">可在任意页面使用；切换页面计时不中断，刷新页面后继续</div></div>
      <div class="form-grid">
        <div class="fld"><label>关联案件</label><select id="tm-case"><option value="">不关联</option>${cases}</select></div>
        <div class="fld"><label>关联客户</label><select id="tm-client"><option value="">不关联</option>${clients}</select></div>
        <div class="fld full"><label>工作内容</label><input id="tm-content" value="${this.esc(this.timer.content)}" placeholder="例如：审阅证据材料"></div>
      </div>
      <div class="hint mt8">切换关联案件时会提示是否结束当前计时并切换。计时结束后自动生成工时记录。</div>`,
      footer:`<button class="btn" data-act="close">关闭</button>
        <button class="btn" data-act="pause">${this.timer.running?'暂停':'继续'}</button>
        <button class="btn danger" data-act="stop">结束并生成工时</button>
        <button class="btn primary" data-act="start">${this.timer.running?'计时中':'开始计时'}</button>`,
      onAction:async(act)=>{
        const read=()=>{ this.timer.caseId=this.el('tm-case').value||null; this.timer.clientId=this.el('tm-client').value||null; this.timer.content=this.el('tm-content').value||''; };
        if(act==='close') return true;
        if(act==='start'){ if(this.timer.running){ this.toast('计时已在进行中','info'); return false; } read(); this.timer.startedAt=Date.now(); this.timer.running=true; this.saveTimer(); this.toast('计时已开始'); return true; }
        if(act==='pause'){ read();
          if(this.timer.running){ this.timer.elapsed+=Date.now()-this.timer.startedAt; this.timer.running=false; this.toast('已暂停'); }
          else if(this.timer.elapsed>0){ this.timer.startedAt=Date.now(); this.timer.running=true; this.toast('已继续'); }
          else { this.toast('请先开始计时','info'); return false; }
          this.saveTimer(); return true; }
        if(act==='stop'){
          if(!this.timer.running && !this.timer.elapsed){ this.toast('当前没有计时记录','info'); return false; }
          read();
          const sec=this.elapsedSec(); if(this.timer.running){ this.timer.elapsed+=Date.now()-this.timer.startedAt; }
          const mins=Math.max(1,Math.round(sec/60));
          const now=new Date().toISOString().slice(0,19);
          const start=new Date(Date.now()-sec*1000).toISOString().slice(0,19);
          await this.api('POST','/api/t/time_entries',{content:this.timer.content||'计时工作',case_id:this.timer.caseId,
            client_id:this.timer.clientId,started_at:start,ended_at:now,minutes:mins,billing_type:'计时',source:'计时器'});
          this.timer={running:false,startedAt:0,elapsed:0,caseId:null,clientId:null,content:''}; this.saveTimer();
          this.toast('已生成工时记录：'+mins+' 分钟'); this.reload(); return true;
        }
        return true;
      }});
    const upd=()=>{ const s=this.elapsedSec(); const d=this.el('tm-display'); if(d) d.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); };
    upd(); this._tmInterval=setInterval(()=>{ if(!this.el('tm-display')){ clearInterval(this._tmInterval); return; } upd(); },1000);
  },

  // ---------------- AI 右侧滑出面板 ----------------
  toggleAI(open){ this.ai.open = open===undefined? !this.ai.open : open; this.el('ai-panel').classList.toggle('open',this.ai.open); },
  renderAIPanel(){
    const chips=[['chat','法律咨询问答'],['summarize_case','总结案件材料'],['draft_document','智能文书起草'],
      ['review_contract','合同审查'],['legal_research','法律检索辅助'],['client_comm','客户沟通辅助']];
    const cases=Object.entries(this.lookups.cases||{}).map(([id,n])=>`<option value="${id}">${this.esc(n)}</option>`).join('');
    const clients=Object.entries(this.lookups.clients||{}).map(([id,n])=>`<option value="${id}">${this.esc(n)}</option>`).join('');
    this.el('ai-panel').innerHTML=`
      <div class="ah"><b><span style="color:var(--purple)">✦</span> AI 法律助手</b><button class="icon-btn" id="ai-close">×</button></div>
      <div class="ab" id="ai-body">
        <div class="small muted mb8">选择上下文后，助手只读取你有权访问的系统业务数据。</div>
        <div class="form-grid mb12">
          <div class="fld"><label>案件上下文</label><select id="ai-case"><option value="">不选择</option>${cases}</select></div>
          <div class="fld"><label>客户上下文</label><select id="ai-client"><option value="">不选择</option>${clients}</select></div>
        </div>
        <div class="flex flex-wrap mb12" id="ai-chips">${chips.map(([k,l])=>`<span class="ai-chip ${k==='chat'?'active':''}" data-ai="${k}">${l}</span>`).join('')}</div>
        <div id="ai-history"></div>
        <div class="ai-disclaimer">AI 仅生成草稿、建议与整理结果；案件事实、法条、司法解释、裁判观点须律师核验。AI 不会编造事实，也不会擅自修改正式业务数据。</div>
      </div>
      <div class="af">
        <textarea id="ai-input" placeholder="输入问题；合同审查可粘贴合同条款…"></textarea>
        <div class="flex between mt8"><span class="small muted">Ctrl+Enter 发送</span><button class="btn primary sm" id="ai-send">发送</button></div>
      </div>`;
    this.el('ai-close').addEventListener('click',()=>this.toggleAI(false));
    this.el('ai-chips').addEventListener('click',e=>{
      const c=e.target.closest('[data-ai]'); if(!c) return;
      this.ai.action=c.dataset.ai;
      this.el('ai-chips').querySelectorAll('.ai-chip').forEach(x=>x.classList.toggle('active',x===c));
      const ph={review_contract:'粘贴需要审查的合同条款…',legal_research:'输入法律问题或检索关键词…',
        draft_document:'补充起草要求（可留空，将按选定模板生成）…',summarize_case:'可留空，直接总结所选案件…',
        client_comm:'可留空，直接整理所选客户沟通…'}[this.ai.action]||'输入问题…';
      this.el('ai-input').placeholder=ph;
    });
    this.el('ai-send').addEventListener('click',()=>this.aiSend());
    this.el('ai-input').addEventListener('keydown',e=>{ if(e.ctrlKey&&e.key==='Enter') this.aiSend(); });
  },
  async aiSend(){
    const input=this.el('ai-input'); const q=input.value.trim();
    const payload={action:this.ai.action,question:q,text:q,
      case_id:this.el('ai-case').value||null, client_id:this.el('ai-client').value||null};
    if((payload.action==='summarize_case'||payload.action==='draft_document') && !payload.case_id && !q){
      this.toast('请先在上方选择案件上下文','info'); return;
    }
    if(payload.action==='client_comm' && !payload.client_id && !payload.case_id){ this.toast('请选择客户或案件上下文','info'); return; }
    const hist=this.el('ai-history');
    hist.insertAdjacentHTML('afterbegin',`<div class="ai-msg user">${this.esc(q||'（使用快捷功能，无附加输入）')}</div><div class="ai-msg system" id="ai-loading">正在读取系统业务数据…</div>`);
    input.value='';
    try{
      const d=await this.api('POST','/api/ai/run',payload);
      const load=this.el('ai-loading');
      if(d.error){ load.outerHTML=`<div class="ai-msg system"><div class="mt">需要补充信息</div>${this.esc(d.error)}</div>`; return; }
      let html=`<div class="ai-msg system"><div class="mt">${this.esc(d.title||'AI 助手')} · ${this.esc((d.generated_at||'').slice(0,16))}</div>${this.esc(d.text||'')}`;
      if(d.notice) html+=`<div class="ai-disclaimer">${this.esc(d.notice)}</div>`;
      if(d.action==='draft_document') html+=`<div class="btn-row mt8"><button class="btn sm" id="ai-insert-doc">插入文书编辑器</button><button class="btn sm" id="ai-dl-doc">导出 Word</button></div>`;
      html+=`<div class="ai-disclaimer">${this.esc(d.disclaimer||'')}</div></div>`;
      load.outerHTML=html;
      this.ai.last=d;
      this.el('ai-insert-doc')?.addEventListener('click',()=>this.insertAIDoc(d));
      this.el('ai-dl-doc')?.addEventListener('click',()=>this.postDownload('/api/export/docx',{title:d.title,text:d.text},(d.template_name||'文书')+'.docx'));
    }catch(e){
      const load=this.el('ai-loading'); if(load) load.outerHTML=`<div class="ai-msg system">调用失败：${this.esc(e.message)}</div>`;
    }
  },
  insertAIDoc(d){
    this.toggleAI(false);
    this.go('documents/new');
    sessionStorage.setItem('ld_ai_draft',JSON.stringify({content:d.text,template_id:d.template_id,case_id:this.el('ai-case').value||null}));
    setTimeout(()=>this.reload(),120);
  },

  // ---------------- 通用页面骨架 ----------------
  pageHead(title,sub,actions=''){
    return `<div class="page-head"><div><h1>${this.esc(title)}</h1><p>${this.esc(sub||'')}</p></div><div class="head-actions">${actions}</div></div>`;
  },
  card(title,body,more='',extra=''){
    return `<div class="card ${extra}"><div class="card-head"><h2>${this.esc(title)}</h2>${more}</div>${body}</div>`;
  },
  empty(text,btn='',action=''){
    return `<div class="empty"><div class="eicon">▤</div><p>${this.esc(text)}</p>${btn?`<button class="btn primary" ${action}>${this.esc(btn)}</button>`:''}</div>`;
  },
  badge(text,type=''){
    const map={'高':'danger','中':'accent','低':'primary','已过期':'danger','7天内到期':'danger','8—30天到期':'accent',
      '待审查':'accent','审查中':'primary','已签署':'success','履行中':'success','已解除':'plain','已终止':'plain',
      '进行中':'primary','已完成':'success','待办':'accent','已逾期':'danger','未核验':'plain','待核验':'plain',
      '现行有效':'success','已废止':'danger','生效中':'success','已提交':'success','待收集':'danger','正常':'success'};
    return `<span class="badge ${type||map[text]||''}">${this.esc(text||'—')}</span>`;
  },
  printHTML(title,html){
    const p=this.el('print-root'); p.innerHTML=`<h1 style="text-align:center">${this.esc(title)}</h1>`+html;
    p.style.display='block'; window.print(); setTimeout(()=>p.style.display='none',800);
  },
};

LD.start();
