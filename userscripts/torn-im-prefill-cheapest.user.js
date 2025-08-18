// ==UserScript==
// @name         Torn Item Market — Floating Fill Max + BUY + YES (Top Row) + Snap to Item Action
// @namespace    https://torn.city/
// @version      2.15.2
// @description  Floating, draggable chips for TOP listing: FILL MAX (max you can AFFORD), BUY, YES. Clicking an item grid's Action button snaps the chips over that button (centered). Chips stack (front→back) and clicked chip moves to back. Positions persist; snap doesn’t overwrite them. Hotkeys: Alt+F/B/Y to trigger (Ctrl+Alt+F/B/Y toggle visibility).
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
      position: fixed; z-index: 2147482000;
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

    .im-chip-buy{ border-color:#f59e0b; color:#f59e0b; background:rgba(245,158,11,.12); }
    .im-chip-buy:hover{ background:rgba(245,158,11,.20); }
  `);

  const SEL = {
    list: 'ul[class*="sellerList"]',
    rowWrapper: 'li[class*="rowWrapper"]',
    row: 'div[class*="sellerRow"]',
    price: 'div[class*="price"]',
    qtyCell: 'div[class*="available"]',
    showBtn: 'button[class*="showBuyControlsButton"]',
    amountInputs: 'input:not([type="checkbox"]):not([type="hidden"])',
    buttons: 'button, a, [role="button"]',
    itemActionBtn: 'button[class*="actionButton"]',
  };

  const isVisible = el => !!el && el.getBoundingClientRect().width>0 && el.getBoundingClientRect().height>0 && getComputedStyle(el).visibility!=='hidden';
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const parseMoney = s => { s=String(s||'').replace(/[^\d.]/g,''); return s?Math.floor(Number(s)):NaN; };
  const toInt = s => { const m=String(s||'').match(/\d[\d,]*/); return m?Number(m[0].replace(/[^\d]/g,'')):NaN; };

  function getRows(){
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`))
      .filter(r=>isVisible(r) && r.querySelector(SEL.price) && r.querySelector(SEL.qtyCell));
  }
  function getRowWrapper(el){ return el?.closest(SEL.rowWrapper) || el?.closest('li') || null; }

  // More robust wallet parser (tries multiple UI places)
  function getWalletFromHeader(){
    // Left sidebar "Money:" line
    const moneyLabel = Array.from(document.querySelectorAll('*'))
      .find(n => /money:?/i.test(n.textContent || '') && n.nextElementSibling && /\$/.test(n.nextElementSibling.textContent||''));
    if (moneyLabel){
      const v = parseMoney(moneyLabel.nextElementSibling.textContent);
      if (Number.isFinite(v)) return v;
    }
    // Any $… text near top bar
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

  async function ensureControlsOpen(row){
    const btn=row.querySelector(SEL.showBtn);
    if (btn) btn.click();
    await sleep(60);
  }
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

  // TOP visible row
  function getTopRow(){
    const rows = getRows();
    let top = null, bestY = Infinity;
    for (const row of rows){
      const y = row.getBoundingClientRect().top;
      if (y < bestY){ bestY = y; top = row; }
    }
    if (!top) return {row:null, unit:NaN, qty:NaN};
    const unit = parseMoney(top.querySelector(SEL.price)?.textContent);
    const qty  = toInt(top.querySelector(SEL.qtyCell)?.textContent);
    return { row: top, unit, qty };
  }

  // Find row's native BUY button
  function findNativeBuyButton(row){
    const wrap = getRowWrapper(row) || row;
    const btn = Array.from(wrap.querySelectorAll(SEL.buttons)).find(b=>{
      const t=(b.textContent||'').trim().toLowerCase();
      return t && /\bbuy\b/.test(t);
    });
    return btn || null;
  }

  // Confirm dialog helpers (for YES)
  function findDialog(){
    const list = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Dialog"], [class*="dialog"], .confirmWrapper, .ui-dialog, .popup, [class*="confirmWrapper"]');
    const vis = Array.from(list).filter(isVisible);
    return vis.pop() || null;
  }
  function findNativeYes(scope){
    const dlg = scope || document;
    const labels = /(^(yes|confirm|buy|purchase|ok|proceed)\b)|(\b(confirm purchase|confirm order|buy now)\b)/i;
    const btns = Array.from(dlg.querySelectorAll(SEL.buttons));
    let yes = btns.find(b=>labels.test((b.textContent||'').trim()));
    if (!yes) yes = dlg.querySelector('button[class*="confirmButton"], a[class*="confirmButton"], button[class*="primary"]');
    return yes || null;
  }

  // Floating chips
  const YES_POS_KEY='imYesFloatPos', YES_VIS_KEY='imYesFloatVisible';
  const FILL_POS_KEY='imFillFloatPos', FILL_VIS_KEY='imFillFloatVisible';
  const BUY_POS_KEY='imBuyFloatPos',  BUY_VIS_KEY='imBuyFloatVisible';
  const STACK_KEY='imChipsStack'; // ['fill','buy','yes'] front→back

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

  function makeChip({className, text, posKey, visKey, onClick, defaultPos, id}){
    let btn=document.querySelector(`.${className}`);
    if (!btn){
      btn=document.createElement('button');
      btn.dataset.imChipId = id;
      btn.className=`im-chip ${className}`;
      btn.textContent=text;
      document.body.appendChild(btn);
      makeDraggable(btn, posKey);
      btn.addEventListener('click', (e)=>{
        e.preventDefault(); e.stopPropagation();
        onClick?.();
        rotateStackToBack(id);
      }, {capture:true});
      const pos=loadPos(posKey, defaultPos);
      btn.style.left=pos.left+'px'; btn.style.top=pos.top+'px';
      const vis=localStorage.getItem(visKey); if (vis==='hidden') btn.classList.add('hidden');
    }
    return btn;
  }

  function ensureYesChip(){
    return makeChip({
      id:'yes',
      className:'im-yes',
      text:'YES',
      posKey:YES_POS_KEY,
      visKey:YES_VIS_KEY,
      defaultPos:{left:window.innerWidth-140, top:Math.round(window.innerHeight*0.18)},
      onClick:()=>{ const dlg=findDialog(); const yes=findNativeYes(dlg||document); if (yes) yes.click(); }
    });
  }
  function ensureFillChip(){
    return makeChip({
      id:'fill',
      className:'im-chip-fill im-fill-chip',
      text:'FILL MAX',
      posKey:FILL_POS_KEY,
      visKey:FILL_VIS_KEY,
      defaultPos:{left:window.innerWidth-240, top:Math.round(window.innerHeight*0.18)+60},
      onClick: async ()=>{
        const {row, unit, qty} = getTopRow();
        if (!row || !Number.isFinite(unit)) return;

        const wrap   = getRowWrapper(row);
        const wallet = getWalletFromHeader();

        // **** Max YOU CAN AFFORD (wallet/unit price), clamped to listing qty ****
        const afford = computeAfford(wallet, unit, qty);

        await ensureControlsOpen(row);
        const input = await findQtyInputWithRetries(wrap, 30, 50);
        if (!input) return;

        setInputValue(input, afford>0?afford:'');
        if (afford<=0) input.placeholder='Insufficient funds';

        input.style.boxShadow='0 0 0 3px rgba(14,165,233,.55)'; setTimeout(()=>{ input.style.boxShadow=''; }, 260);
        wrap?.scrollIntoView({behavior:'smooth', block:'center'});
      }
    });
  }
  function ensureBuyChip(){
    return makeChip({
      id:'buy',
      className:'im-chip-buy im-buy-chip',
      text:'BUY',
      posKey:BUY_POS_KEY,
      visKey:BUY_VIS_KEY,
      defaultPos:{left:window.innerWidth-140, top:Math.round(window.innerHeight*0.18)+60},
      onClick: async ()=>{
        const {row} = getTopRow();
        if (!row) return;
        await ensureControlsOpen(row);
        const wrap = getRowWrapper(row) || row;
        const buy = findNativeBuyButton(row);
        if (buy){ buy.click(); }
        else {
          const inp = await findQtyInputWithRetries(wrap, 10, 40);
          if (inp) inp.focus();
          await sleep(50);
          const buy2 = findNativeBuyButton(row);
          if (buy2) buy2.click();
        }
      }
    });
  }

  // ----- Stack manager -----
  const DEFAULT_STACK = ['fill','buy','yes']; // front → back
  function readStack(){
    try{
      const s = JSON.parse(localStorage.getItem(STACK_KEY) || '[]');
      if (Array.isArray(s) && s.length===3 && s.every(x=>['fill','buy','yes'].includes(x))) return s;
    }catch{}
    return DEFAULT_STACK.slice();
  }
  function writeStack(stack){
    localStorage.setItem(STACK_KEY, JSON.stringify(stack));
    applyStack(stack);
  }
  function applyStack(stack){
    const base = 2147483600;
    const map = {
      fill: document.querySelector('.im-fill-chip'),
      buy:  document.querySelector('.im-buy-chip'),
      yes:  document.querySelector('.im-yes'),
    };
    const [front, mid, back] = stack;
    if (map[front]) map[front].style.zIndex = base;
    if (map[mid])   map[mid].style.zIndex   = base - 1;
    if (map[back])  map[back].style.zIndex  = base - 2;
  }
  function rotateStackToBack(id){
    const stack = readStack();
    const i = stack.indexOf(id);
    if (i === -1) return;
    stack.splice(i,1);
    stack.push(id);
    writeStack(stack);
  }

  // ----- Snap chips to clicked item Action button (precise center + fan by stack) -----
  function snapChipsToRect(rect){
    const stack = readStack();                // e.g., ['fill','buy','yes'] front→back
    const orderToEl = {
      fill: document.querySelector('.im-fill-chip'),
      buy:  document.querySelector('.im-buy-chip'),
      yes:  document.querySelector('.im-yes'),
    };
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top  + rect.height / 2;
    const offsetsY = [0, 10, 20];             // gentle fan

    stack.forEach((id, idx)=>{
      const chip = orderToEl[id];
      if (!chip) return;
      const w = chip.offsetWidth || 100;
      const h = chip.offsetHeight || 36;
      const left = clamp(centerX - w/2, 4, window.innerWidth - w - 4);
      const top  = clamp(centerY - h/2 + offsetsY[idx], 4, window.innerHeight - h - 4);
      chip.style.left = left + 'px';
      chip.style.top  = top  + 'px';
    });
  }

  document.addEventListener('click', (e)=>{
    const btn = e.target.closest(SEL.itemActionBtn);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    requestAnimationFrame(()=>snapChipsToRect(r));
  }, true);

  // YES active highlight
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

    if (e.altKey && !e.ctrlKey && e.code==='KeyB'){ const b=ensureBuyChip(); if(!b.classList.contains('hidden')) b.click(); }
    if (e.altKey && e.ctrlKey && e.code==='KeyB'){ const b=ensureBuyChip(); b.classList.toggle('hidden'); localStorage.setItem(BUY_VIS_KEY, b.classList.contains('hidden')?'hidden':'visible'); }
  }, true);

  // Bootstrap
  ensureFillChip();
  ensureBuyChip();
  ensureYesChip();
  applyStack(readStack());
  updateYesActive();

  const dialogMO=new MutationObserver(()=>updateYesActive());
  dialogMO.observe(document.documentElement,{childList:true,subtree:true});
})();
