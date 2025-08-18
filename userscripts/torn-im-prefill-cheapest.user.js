// ==UserScript==
// @name         Torn Item Market — Floating Fill Max (Cheapest) + Floating YES
// @namespace    https://torn.city/
// @version      2.12.0
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

  // ---------- Styles ----------
  GM_addStyle(`
    .im-chip{
      position: fixed;
      z-index: 2147483647;
      padding: 12px 16px;
      min-width: 86px;
      border-radius: 12px;
      border: 2px solid var(--tt-color-green, #16a34a);
      background: rgba(22,163,74,.12);
      color: #16a34a; font-weight: 900; letter-spacing: .3px;
      text-shadow: 0 1px 0 rgba(255,255,255,.25);
      box-shadow: 0 10px 34px rgba(0,0,0,.45);
      cursor: grab; user-select: none;
      transition: opacity .15s ease, transform .05s ease;
      opacity: .45;
    }
    .im-chip.active{ opacity: 1; }
    .im-chip.hidden{ display:none!important; }
    .im-chip:hover{ background: rgba(22,163,74,.20); }
    .im-chip:active{ cursor: grabbing; transform: scale(.98); }

    /* Different accent for Fill Max so you can tell which is which at a glance */
    .im-chip-fill{
      border-color: #0ea5e9; /* cyan */
      color: #0ea5e9;
      background: rgba(14,165,233,.12);
    }
    .im-chip-fill:hover{ background: rgba(14,165,233,.20); }
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
  const isVisible = (el)=> !!el && el.offsetParent !== null && el.getBoundingClientRect().width>0 && el.getBoundingClientRect().height>0;

  function getRows(){
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)).filter(isVisible);
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
      return isVisible(inp);
    });
    return cands[0] || null;
  }
  function findNativeYes(scope){
    const dlg = scope || document;
    const labels = /(^(yes|confirm|buy|purchase|ok|proceed)\b)|(\b(confirm purchase|confirm order|buy now)\b)/i;
    const btns = Array.from(dlg.querySelectorAll('button, a, [role="button"]'));
    let yes = btns.find(b=>labels.test((b.textContent||'').trim()));
    if (!yes) yes = dlg.querySelector('button[class*="confirmButton"], a[class*="confirmButton"], button[class*="primary"]');
    return yes || null;
  }
  function findDialog(){
    const list = document.querySelectorAll(
      '[role="dialog"], [class*="modal"], [class*="Dialog"], [class*="dialog"], .confirmWrapper, .ui-dialog, .popup, [class*="confirmWrapper"]'
    );
    const vis = Array.from(list).filter(isVisible);
    return vis.pop() || null;
  }

  // ---------- Find cheapest visible row ----------
  function getCheapestRow(){
    const rows = getRows();
    let best = null, bestPrice = Infinity;
    for (const row of rows){
      const price = parseMoney(row.querySelector(SEL.price)?.textContent);
      if (Number.isFinite(price) && price < bestPrice){
        best = row; bestPrice = price;
      }
    }
    return { row: best, unit: Number.isFinite(bestPrice) ? bestPrice : NaN };
  }

  // ---------- Floating chips (YES + FILL MAX) ----------
  const YES_POS_KEY = 'imYesFloatPos';
  const YES_VIS_KEY = 'imYesFloatVisible';
  const FILL_POS_KEY = 'imFillFloatPos';
  const FILL_VIS_KEY = 'imFillFloatVisible';

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
    let btn = document.querySelector('.im-chip.im-yes');
    if (!btn){
      btn = document.createElement('button');
      btn.className = 'im-chip im-yes';
      btn.textContent = 'YES';
      document.body.appendChild(btn);
      makeDraggable(btn, YES_POS_KEY);
      // Click -> native Yes
      btn.addEventListener('click', (e)=>{
        e.preventDefault(); e.stopPropagation();
        const dlg = findDialog();
        const yes = findNativeYes(dlg || document);
        if (yes) yes.click();
      }, {capture:true});
      // Position & visibility
      const pos = loadPos(YES_POS_KEY, { left: window.innerWidth - 140, top: Math.round(window.innerHeight*0.18) });
      btn.style.left = pos.left + 'px'; btn.style.top = pos.top + 'px';
      const visible = localStorage.getItem(YES_VIS_KEY);
      if (visible === 'hidden') btn.classList.add('hidden');
    }
    return btn;
  }

  function ensureFillChip(){
    let btn = document.querySelector('.im-chip.im-fill-chip');
    if (!btn){
      btn = document.createElement('button');
      btn.className = 'im-chip im-chip-fill im-fill-chip';
      btn.textContent = 'FILL MAX';
      document.body.appendChild(btn);
      makeDraggable(btn, FILL_POS_KEY);
      // Click -> prefill cheapest
      btn.addEventListener('click', async (e)=>{
        e.preventDefault(); e.stopPropagation();
        const {row, unit} = getCheapestRow();
        if (!row || !Number.isFinite(unit)) return;
        const qty = toInt(row.querySelector(SEL.qtyCell)?.textContent);
        const wallet = getWalletFromHeader();
        const afford = computeAfford(wallet, unit, qty);
        await ensureControlsOpen(row);
        const input = findAmountInputForRow(row);
        if (input){
          setInputValue(input, afford>0?afford:'');
          if (afford<=0) input.placeholder='Insufficient funds';
          // brief flash
          input.style.boxShadow='0 0 0 3px rgba(14,165,233,.55)';
          setTimeout(()=>{ input.style.boxShadow=''; }, 250);
          // optional: scroll the row into view so you see it fill
          row.scrollIntoView({behavior:'smooth', block:'center'});
        }
      }, {capture:true});
      // Position & visibility
      const pos = loadPos(FILL_POS_KEY, { left: window.innerWidth - 240, top: Math.round(window.innerHeight*0.18) + 60 });
      btn.style.left = pos.left + 'px'; btn.style.top = pos.top + 'px';
      const visible = localStorage.getItem(FILL_VIS_KEY);
      if (visible === 'hidden') btn.classList.add('hidden');
    }
    return btn;
  }

  function updateYesActive(){
    const btn = ensureYesChip();
    const dlg = findDialog();
    if (dlg) btn.classList.add('active'); else btn.classList.remove('active');
  }

  // ---------- Hotkeys ----------
  window.addEventListener('keydown', (e)=>{
    // Alt+Y: click YES
    if (e.altKey && !e.ctrlKey && e.code === 'KeyY'){
      const btn = ensureYesChip();
      if (!btn.classList.contains('hidden')) btn.click();
    }
    // Ctrl+Alt+Y: toggle YES
    if (e.altKey && e.ctrlKey && e.code === 'KeyY'){
      const btn = ensureYesChip();
      btn.classList.toggle('hidden');
      localStorage.setItem(YES_VIS_KEY, btn.classList.contains('hidden') ? 'hidden' : 'visible');
    }
    // Alt+F: click FILL MAX (cheapest)
    if (e.altKey && !e.ctrlKey && e.code === 'KeyF'){
      const btn = ensureFillChip();
      if (!btn.classList.contains('hidden')) btn.click();
    }
    // Ctrl+Alt+F: toggle FILL MAX
    if (e.altKey && e.ctrlKey && e.code === 'KeyF'){
      const btn = ensureFillChip();
      btn.classList.toggle('hidden');
      localStorage.setItem(FILL_VIS_KEY, btn.classList.contains('hidden') ? 'hidden' : 'visible');
    }
  }, true);

  // ---------- Observers ----------
  const dialogMO = new MutationObserver(()=>updateYesActive());
  dialogMO.observe(document.documentElement, {childList:true, subtree:true});

  // ---------- Bootstrap ----------
  ensureYesChip();
  ensureFillChip();
  updateYesActive();
})();
