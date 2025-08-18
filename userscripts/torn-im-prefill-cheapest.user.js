// ==UserScript==
// @name         Torn Item Market — Floating Fill Max (Cheapest) + Floating YES
// @namespace    https://torn.city/
// @version      2.12.3
// @description  Floating, draggable "FILL MAX" that pre-fills the cheapest listing with max affordable qty; floating, draggable "YES" that forwards to Torn’s native confirm. Both remember position; Alt+F/Alt+Y to trigger; Ctrl+Alt+F / Ctrl+Alt+Y to show/hide.
// @author       Baz
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    .im-chip{
      position: fixed; z-index: 2147483647;
      padding: 12px 16px; min-width: 86px;
      border-radius: 12px; border: 2px solid var(--tt-color-green,#16a34a);
      background: rgba(22,163,74,.12); color:#16a34a;
      font-weight: 900; letter-spacing:.3px; text-shadow:0 1px 0 rgba(255,255,255,.25);
      box-shadow: 0 10px 34px rgba(0,0,0,.45);
      cursor: grab; user-select: none; transition: opacity .15s ease, transform .05s ease;
      opacity: .45;
    }
    .im-chip.active{ opacity: 1; }
    .im-chip.hidden{ display:none!important; }
    .im-chip:hover{ background: rgba(22,163,74,.20); }
    .im-chip:active{ cursor: grabbing; transform: scale(.98); }

    .im-chip-fill{ border-color:#0ea5e9; color:#0ea5e9; background:rgba(14,165,233,.12); }
    .im-chip-fill:hover{ background:rgba(14,165,233,.20); }
  `);

  const SEL = {
    list: 'ul[class*="sellerList"]',
    rowWrapper: 'li[class*="rowWrapper"]',
    row: 'div[class*="sellerRow"]',
    price: 'div[class*="price"]',
    qtyCell: 'div[class*="available"]',
    showBtn: 'button[class*="showBuyControlsButton"]',
    amountInputs: 'input:not([type="checkbox"]):not([type="hidden"])',
  };

  const isVisible = el => !!el && el.getBoundingClientRect().width>0 && el.getBoundingClientRect().height>0 && getComputedStyle(el).visibility!=='hidden';
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const parseMoney = s => { s=String(s||'').replace(/[^\d.]/g,''); return s?Math.floor(Number(s)):NaN; };
  const toInt = s => { const m=String(s||'').match(/\d[\d,]*/); return m?Number(m[0].replace(/[^\d]/g,'')):NaN; };

  function getRows(){
    const list=document.querySelector(SEL.list); if (!list) return [];
    // Only real seller rows (skip header row which has priceHead/availableHead)
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`))
      .filter(r=>isVisible(r) && r.querySelector(SEL.price) && r.querySelector(SEL.qtyCell));
  }
  function getRowWrapper(el){ return el?.closest(SEL.rowWrapper) || el?.closest('li') || null; }

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

  // Robustly find the active qty input inside a given row wrapper (retry after UI opens/re-renders)
  async function findQtyInputWithRetries(rowWrapper, tries=25, delay=40){
    for (let i=0;i<tries;i++){
      const inp = Array.from(rowWrapper.querySelectorAll(SEL.amountInputs)).find(x=>{
        return x instanceof HTMLInputElement && x.type!=='hidden' && x.type!=='checkbox' && !x.disabled && isVisible(x);
      });
      if (inp) return inp;
      await sleep(delay);
    }
    return null;
  }

  async function ensureControlsOpen(row){
    // Click the per-row “show buy controls” if present
    const btn = row.querySelector(SEL.showBtn);
    if (btn) btn.click();
    // Wait a beat for the controls to render
    await sleep(60);
  }

  function setInputValue(input, value){
    input.focus();
    const proto=Object.getPrototypeOf(input);
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    if (setter) setter.call(input,String(value)); else input.value=String(value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true, key:'0'}));
    input.blur();
  }

  // Cheapest row chooser (by price text)
  function getCheapestRow(){
    let bestRow=null, bestPrice=Infinity, bestQty=NaN;
    for (const row of getRows()){
      const p = parseMoney(row.querySelector(SEL.price)?.textContent);
      const q = toInt(row.querySelector(SEL.qtyCell)?.textContent);
      if (Number.isFinite(p) && p < bestPrice){
        bestPrice = p; bestRow = row; bestQty = q;
      }
    }
    return { row: bestRow, unit: bestPrice, qty: bestQty };
  }

  // ---------- Dialog helpers for floating YES ----------
  function findDialog(){
    const list = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Dialog"], [class*="dialog"], .confirmWrapper, .ui-dialog, .popup, [class*="confirmWrapper"]');
    const vis = Array.from(list).filter(isVisible);
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

  // ---------- Floating chips ----------
  const YES_POS_KEY='imYesFloatPos', YES_VIS_KEY='imYesFloatVisible';
  const FILL_POS_KEY='imFillFloatPos', FILL_VIS_KEY='imFillFloatVisible';

  function loadPos(key, def){
    try{ const p = JSON.parse(localStorage.getItem(key)||''); if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) return p; }catch{}
    return def;
  }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function makeDraggable(btn, key){
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
      localStorage.setItem(key, JSON.stringify({left: rect.left, top: rect.top}));
    };
    btn.addEventListener('mousedown', onDown, true);
  }

  function ensureYesChip(){
    let btn=document.querySelector('.im-chip.im-yes');
    if (!btn){
      btn=document.createElement('button');
      btn.className='im-chip im-yes';
      btn.textContent='YES';
      document.body.appendChild(btn);
      makeDraggable(btn, YES_POS_KEY);
      btn.addEventListener('click',(e)=>{
        e.preventDefault(); e.stopPropagation();
        const dlg=findDialog(); const yes=findNativeYes(dlg||document);
        if (yes) yes.click();
      },{capture:true});
      const pos=loadPos(YES_POS_KEY,{left:window.innerWidth-140, top:Math.round(window.innerHeight*0.18)});
      btn.style.left=pos.left+'px'; btn.style.top=pos.top+'px';
      const vis=localStorage.getItem(YES_VIS_KEY); if (vis==='hidden') btn.classList.add('hidden');
    }
    return btn;
  }
  function ensureFillChip(){
    let btn=document.querySelector('.im-chip.im-fill-chip');
    if (!btn){
      btn=document.createElement('button');
      btn.className='im-chip im-chip-fill im-fill-chip';
      btn.textContent='FILL MAX';
      document.body.appendChild(btn);
      makeDraggable(btn, FILL_POS_KEY);

      btn.addEventListener('click', async (e)=>{
        e.preventDefault(); e.stopPropagation();

        const {row, unit, qty} = getCheapestRow();
        if (!row || !Number.isFinite(unit)) { console.debug('[FillMax] No cheapest row found'); return; }

        const wrap = getRowWrapper(row);
        const wallet = getWalletFromHeader();
        const afford = computeAfford(wallet, unit, qty);

        console.debug('[FillMax] Picked row:', {unit, qty, wallet, afford});

        await ensureControlsOpen(row);

        // re-resolve input within THIS row wrapper (handles re-render)
        const input = await findQtyInputWithRetries(wrap, 30, 50);
        if (!input) { console.debug('[FillMax] Qty input not found after opening'); return; }

        setInputValue(input, afford>0?afford:'');
        if (afford<=0) input.placeholder='Insufficient funds';

        // visual feedback
        input.style.boxShadow='0 0 0 3px rgba(14,165,233,.55)';
        setTimeout(()=>{ input.style.boxShadow=''; }, 260);

        // ensure you see it
        wrap?.scrollIntoView({behavior:'smooth', block:'center'});
      },{capture:true});

      const pos=loadPos(FILL_POS_KEY,{left:window.innerWidth-240, top:Math.round(window.innerHeight*0.18)+60});
      btn.style.left=pos.left+'px'; btn.style.top=pos.top+'px';
      const vis=localStorage.getItem(FILL_VIS_KEY); if (vis==='hidden') btn.classList.add('hidden');
    }
    return btn;
  }

  function updateYesActive(){
    const btn=ensureYesChip();
    const dlg=findDialog();
    if (dlg) btn.classList.add('active'); else btn.classList.remove('active');
  }

  // Hotkeys
  window.addEventListener('keydown',(e)=>{
    if (e.altKey && !e.ctrlKey && e.code==='KeyY'){ const b=ensureYesChip(); if(!b.classList.contains('hidden')) b.click(); }
    if (e.altKey && e.ctrlKey && e.code==='KeyY'){ const b=ensureYesChip(); b.classList.toggle('hidden'); localStorage.setItem(YES_VIS_KEY, b.classList.contains('hidden')?'hidden':'visible'); }
    if (e.altKey && !e.ctrlKey && e.code==='KeyF'){ const b=ensureFillChip(); if(!b.classList.contains('hidden')) b.click(); }
    if (e.altKey && e.ctrlKey && e.code==='KeyF'){ const b=ensureFillChip(); b.classList.toggle('hidden'); localStorage.setItem(FILL_VIS_KEY, b.classList.contains('hidden')?'hidden':'visible'); }
  }, true);

  // Observers / bootstrap
  const dialogMO=new MutationObserver(()=>updateYesActive());
  dialogMO.observe(document.documentElement,{childList:true,subtree:true});

  ensureYesChip();
  ensureFillChip();
  updateYesActive();
})();
