// ==UserScript==
// @name         Torn Item Market — Prefill (Fill Max + Floating Draggable YES)
// @namespace    https://torn.city/
// @version      2.11.0
// @description  Row: rightmost 25% "Fill Max" overlay fills max affordable qty. Confirm: show a floating, draggable YES button (only while confirm dialog is visible) that forwards to Torn’s native Yes. Position persists; Alt+Y clicks it.
// @author       Baz
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Styles ----------
  GM_addStyle(`
    /* Fill Max overlay (unchanged) */
    .im-fill-overlay{
      position:absolute; display:flex; align-items:center; justify-content:center;
      cursor:pointer; font-size:11px; font-weight:600;
      z-index:9; background:rgba(22,163,74,.12); color:#16a34a;
      border-left:1px solid #16a34a; border-radius:0 8px 8px 0;
      user-select:none;
    }
    .im-fill-overlay:hover{ background:rgba(22,163,74,.20) }
    .im-fill-overlay.im-done{ z-index:-1; pointer-events:none; background:transparent; border-color:transparent }
    .im-flash{ box-shadow:0 0 0 3px rgba(0,160,255,.55)!important; transition:box-shadow .25s ease }

    /* Floating draggable YES */
    .im-yes-float{
      position: fixed;
      z-index: 2147483647;
      padding: 10px 14px;
      border-radius: 10px;
      border: 2px solid var(--tt-color-green, #16a34a);
      background: rgba(22,163,74,.12);
      color: #16a34a; font-weight: 800; letter-spacing: .3px;
      box-shadow: 0 8px 30px rgba(0,0,0,.35);
      cursor: grab; user-select: none;
    }
    .im-yes-float:active{ cursor: grabbing; }
    .im-yes-float.hidden{ display:none!important; }
    .im-yes-float:hover{ background: rgba(22,163,74,.20); }
  `);

  // ---------- Selectors & utils ----------
  const SEL = {
    list: 'ul[class*="sellerList"]',
    rowWrapper: 'li[class*="rowWrapper"]',
    row: 'div[class*="sellerRow"]',
    price: 'div[class*="price"]',
    qtyCell: 'div[class*="available"]',
    showBtn: 'button[class*="showBuyControlsButton"]',
    amountInputs: 'input:not([type="checkbox"]):not([type="hidden"])',
    buyButtons: 'button, a'
  };
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const parseMoney = (s)=>{ s=String(s||'').replace(/[^\d.]/g,''); return s?Math.floor(Number(s)):NaN; };
  const toInt = (s)=>{ const m=String(s||'').match(/\d[\d,]*/); return m?Number(m[0].replace(/[^\d]/g,'')):NaN; };

  // ---------- Fill Max ----------
  function getRows(){
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)).filter(r=>r.offsetParent!==null);
  }
  function findNativeBuyButton(row){
    const li=row.closest(SEL.rowWrapper) || row.closest('li') || document.body;
    const btns=Array.from(li.querySelectorAll(SEL.buyButtons)).filter(b=>{
      const t=(b.textContent||'').trim().toLowerCase();
      if (!t) return false;
      if (/show\s*buy/i.test(t)) return false;
      return /buy|confirm|purchase/.test(t);
    });
    const visible=btns.find(b=>b.getBoundingClientRect().width>0 && b.getBoundingClientRect().height>0);
    return visible || btns[0] || null;
  }
  async function ensureControlsOpen(row){
    const show=row.querySelector(SEL.showBtn);
    if (show) show.click();
    for (let i=0;i<20;i++){ await sleep(20); if (findAmountInputForRow(row)) break; }
  }
  function findAmountInputForRow(row){
    const li=row.closest(SEL.rowWrapper) || row.closest('li') || document.body;
    const cands=Array.from(li.querySelectorAll(SEL.amountInputs)).filter(inp=>{
      if (!(inp instanceof HTMLInputElement)) return false;
      if (inp.type==='checkbox'||inp.type==='hidden'||inp.disabled) return false;
      const r=inp.getBoundingClientRect(); return r.width>0 && r.height>0;
    });
    return cands[0] || null;
  }
  function getWalletFromHeader(){
    const root=document.querySelector('#topRoot')||document.body;
    for (const n of root.querySelectorAll('span,div,a,li,b,strong')){
      const t=n.textContent||'';
      if (/\$\s?[\d,. ]+/.test(t)){ const v=parseMoney(t); if (Number.isFinite(v) && v>=0) return v; }
    }
    return NaN;
  }
  function computeAfford(wallet, unitPrice, qty){
    if (!Number.isFinite(wallet)||wallet<=0) return 0;
    if (!Number.isFinite(unitPrice)||unitPrice<=0) return 0;
    if (!Number.isFinite(qty)||qty<=0) qty=Infinity;
    return Math.max(0, Math.min(Math.floor(wallet/unitPrice), qty));
  }
  function setInputValue(input, value){
    const proto=Object.getPrototypeOf(input);
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    if (setter) setter.call(input,String(value)); else input.value=String(value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true, key:'0'}));
  }
  function flash(el){ if(!el) return; el.classList.add('im-flash'); setTimeout(()=>el.classList.remove('im-flash'),280); }

  function positionOverlay(overlay, nativeBtn){
    const parent=overlay.parentElement; if (!parent) return;
    const pr=parent.getBoundingClientRect(), br=nativeBtn.getBoundingClientRect();
    const ow=Math.max(24, Math.round(br.width*0.25));
    overlay.style.top=`${br.top-pr.top}px`;
    overlay.style.left=`${br.left-pr.left + (br.width-ow)}px`;
    overlay.style.width=`${ow}px`;
    overlay.style.height=`${br.height}px`;
    overlay.style.borderRadius='0 8px 8px 0';
  }
  function placeRowOverlay(row){
    const native=findNativeBuyButton(row);
    if (!native) return;
    const container=native.parentElement || row;
    if (getComputedStyle(container).position==='static') container.style.position='relative';
    if (container.querySelector(':scope > .im-fill-overlay')) return;

    const overlay=document.createElement('div');
    overlay.className='im-fill-overlay';
    overlay.textContent='Fill Max';
    positionOverlay(overlay, native);

    const ro=new ResizeObserver(()=>positionOverlay(overlay, native));
    ro.observe(container); ro.observe(native);
    window.addEventListener('scroll', ()=>positionOverlay(overlay, native), {passive:true});

    overlay.addEventListener('mousedown',(e)=>{ e.preventDefault(); e.stopPropagation(); }, {capture:true});
    overlay.addEventListener('click', async (e)=>{
      e.preventDefault(); e.stopPropagation();
      const unit=parseMoney(row.querySelector(SEL.price)?.textContent);
      const qty=toInt(row.querySelector(SEL.qtyCell)?.textContent);
      const wallet=getWalletFromHeader();
      const afford=computeAfford(wallet, unit, qty);

      await ensureControlsOpen(row);
      const input=findAmountInputForRow(row);
      if (input){
        setInputValue(input, afford>0?afford:'');
        if (afford<=0) input.placeholder='Insufficient funds';
        flash(input);
      }
      overlay.classList.add('im-done');
    }, {capture:true});

    container.appendChild(overlay);
  }
  function refreshRows(){
    for (const row of getRows()) placeRowOverlay(row);
  }

  // ---------- Confirm dialog helpers ----------
  function findDialog(){
    const list = document.querySelectorAll(
      '[role="dialog"], [class*="modal"], [class*="Dialog"], [class*="dialog"], .confirmWrapper, .ui-dialog, .popup'
    );
    const vis = Array.from(list).filter(el=>{
      const r=el.getBoundingClientRect(); return r.width>0 && r.height>0;
    });
    return vis.pop() || null;
  }
  function findNativeYes(scope){
    const dlg = scope || document;
    const labels = /(^(yes|confirm|buy|purchase|ok|proceed)\b)|(\b(confirm purchase|confirm order|buy now)\b)/i;
    const btns = Array.from(dlg.querySelectorAll('button, a, [role="button"]'));
    let yes = btns.find(b=>labels.test((b.textContent||'').trim()));
    if (!yes) yes = dlg.querySelector('button[class*="confirmButton"], a[class*="confirmButton"], button[class*="primary"]');
    return yes || null;
  }

  // ---------- Floating YES ----------
  const POS_KEY = 'imYesFloatPos';
  function loadPos(){
    try{ const p = JSON.parse(localStorage.getItem(POS_KEY)||''); if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) return p; }catch{}
    return { left: window.innerWidth - 140, top: Math.round(window.innerHeight*0.18) };
  }
  function clamp(val,min,max){ return Math.max(min, Math.min(max, val)); }

  function ensureFloatYes(){
    let btn = document.querySelector('.im-yes-float');
    if (!btn){
      btn = document.createElement('button');
      btn.className = 'im-yes-float hidden';
      btn.textContent = 'YES';
      document.body.appendChild(btn);

      // Drag support
      let dragging=false, sx=0, sy=0, startLeft=0, startTop=0;
      const onDown = (e)=>{
        e.preventDefault(); e.stopPropagation();
        dragging=true; btn.style.cursor='grabbing';
        const pos = btn.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; startLeft = pos.left; startTop = pos.top;
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', onUp, true);
      };
      const onMove = (e)=>{
        if (!dragging) return;
        const nl = clamp(startLeft + (e.clientX - sx), 4, window.innerWidth - btn.offsetWidth - 4);
        const nt = clamp(startTop + (e.clientY - sy), 4, window.innerHeight - btn.offsetHeight - 4);
        btn.style.left = nl + 'px';
        btn.style.top  = nt + 'px';
        btn.style.right = ''; btn.style.bottom = '';
      };
      const onUp = ()=>{
        if (!dragging) return;
        dragging=false; btn.style.cursor='grab';
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        const rect = btn.getBoundingClientRect();
        localStorage.setItem(POS_KEY, JSON.stringify({left: rect.left, top: rect.top}));
      };
      btn.addEventListener('mousedown', onDown, true);

      // Click forwards to native Yes
      btn.addEventListener('click', (e)=>{
        e.preventDefault(); e.stopPropagation();
        const dlg = findDialog();
        const yes = findNativeYes(dlg || document);
        if (yes) yes.click();
      }, {capture:true});

      const pos = loadPos();
      btn.style.left = pos.left + 'px';
      btn.style.top  = pos.top + 'px';
    }
    return btn;
  }

  function updateFloatVisibility(){
    const dlg = findDialog();
    const btn = ensureFloatYes();
    if (dlg){ btn.classList.remove('hidden'); }
    else { btn.classList.add('hidden'); }
  }

  window.addEventListener('keydown', (e)=>{
    if (e.altKey && e.code === 'KeyY'){
      const btn = document.querySelector('.im-yes-float');
      if (btn && !btn.classList.contains('hidden')) btn.click();
    }
  }, true);

  // ---------- Observers ----------
  const rowsMO = new MutationObserver(()=>refreshRows());
  rowsMO.observe(document.documentElement, {childList:true, subtree:true});

  const dialogMO = new MutationObserver(()=>updateFloatVisibility());
  dialogMO.observe(document.documentElement, {childList:true, subtree:true});

  document.addEventListener('click', (ev)=>{
    const t = ev.target; if (!t) return;
    const txt = (t.textContent || '').toLowerCase();
    if (!/(^|\b)(buy|purchase|confirm)(\b|!|\.|,)/.test(txt)) return;
    let tries = 0;
    const iv = setInterval(()=>{
      tries++;
      updateFloatVisibility();
      const btn = document.querySelector('.im-yes-float');
      if ((btn && !btn.classList.contains('hidden')) || tries>60) clearInterval(iv);
    }, 50);
  }, true);

  // ---------- Bootstrap ----------
  setTimeout(refreshRows,200);
  setTimeout(refreshRows,800);
  setInterval(refreshRows,2000);
  setInterval(updateFloatVisibility, 400);
})();
