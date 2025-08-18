// ==UserScript==
// @name         Torn Item Market — Prefill (Dialog MADE Yes top-right)
// @namespace    https://torn.city/
// @version      2.9.6
// @description  Restored stable build: Row Fill Max overlay (right 25%) + confirm dialog cloned “Yes” (top-right, just left of X). Adds light safety guards (debounce + try/catch). No layout changes, no heavy debug.
// @author       Baz
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Styles (unchanged) ----------
  GM_addStyle(`
    .im-fill-overlay{
      position:absolute; display:flex; align-items:center; justify-content:center;
      cursor:pointer; font-size:11px; font-weight:600;
      z-index:9; background:rgba(22,163,74,.12); color:#16a34a;
      border-left:1px solid #16a34a; border-radius:0 8px 8px 0;
      pointer-events:auto; user-select:none; -webkit-user-select:none;
    }
    .im-fill-overlay:hover{ background:rgba(22,163,74,.20) }
    .im-fill-overlay.im-done{ z-index:-1; pointer-events:none; background:transparent; border-color:transparent }
    .im-flash{ box-shadow:0 0 0 3px rgba(0,160,255,.55)!important; transition:box-shadow .25s ease }

    .im-yes-made {
      position:absolute !important;
      z-index:2147483646 !important;
      padding:6px 10px !important;
      border-radius:6px !important;
      border:1px solid var(--tt-color-green, #16a34a) !important;
      background:rgba(22,163,74,.12) !important;
      color:#16a34a !important;
      font-weight:600 !important;
      cursor:pointer !important;
      user-select:none !important;
      display:flex; align-items:center; justify-content:center;
      line-height:1 !important;
    }
    .im-yes-made:hover{ background:rgba(22,163,74,.20) !important; }
  `);

  // ---------- Selectors & utils (unchanged) ----------
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
  function rafDebounce(fn, delay=30){
    let af=null, t=null;
    return function(...args){
      if (af) cancelAnimationFrame(af);
      if (t) clearTimeout(t);
      af = requestAnimationFrame(()=>fn.apply(this,args));
      t = setTimeout(()=>{ if (af) cancelAnimationFrame(af); fn.apply(this,args); }, delay);
    };
  }
  const safe = (fn)=>(...a)=>{ try { return fn(...a); } catch(e){ console.debug('IM safe error:', e); } };

  function getRows(){
    const list = document.querySelector(SEL.list); if (!list) return [];
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

  // ---------- Row overlay (unchanged behavior) ----------
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
  const placeRowOverlay = safe(function(row){
    const native=findNativeBuyButton(row);
    if (!native) return;
    const container=native.parentElement || row;
    if (!container) return;
    if (getComputedStyle(container).position==='static') container.style.position='relative';
    if (container.querySelector(':scope > .im-fill-overlay')) return;

    const overlay=document.createElement('div');
    overlay.className='im-fill-overlay';
    overlay.textContent='Fill Max';
    positionOverlay(overlay, native);

    const ro=new ResizeObserver(()=>positionOverlay(overlay, native));
    ro.observe(container); ro.observe(native);
    window.addEventListener('scroll', rafDebounce(()=>positionOverlay(overlay, native), 60), {passive:true});

    overlay.addEventListener('mousedown',(e)=>{ e.preventDefault(); e.stopPropagation(); }, {capture:true});
    overlay.addEventListener('click', safe(async (e)=>{
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
    }), {capture:true});

    container.appendChild(overlay);
  });
  const refreshRows = safe(function(){
    for (const row of getRows()) placeRowOverlay(row);
  });

  // ---------- Confirm dialog helpers (unchanged visuals) ----------
  function findDialog(){
    const list = document.querySelectorAll(
      '[role="dialog"], [class*="modal"], [class*="Dialog"], [class*="dialog"], .confirmWrapper, .ui-dialog, .popup'
    );
    const vis = Array.from(list).filter(el=>{
      const r=el.getBoundingClientRect(); return r.width>0 && r.height>0;
    });
    return vis.pop() || null;
  }
  function findCloseX(dialog){
    return dialog.querySelector('button[aria-label="Close"], [class*="close"], .close, .ui-dialog-titlebar-close, [data-role="close"]');
  }
  function findNativeYes(dialog){
    const btns = dialog.querySelectorAll('button, a, [role="button"]');
    for (const b of btns){
      const t=(b.textContent||'').trim().toLowerCase();
      if (/(^|\b)(yes|confirm|buy|purchase|ok|proceed)(\b|!|\.|,)/.test(t)) return b;
    }
    const byClass = dialog.querySelector('button[class*="confirmButton"]');
    return byClass || null;
  }
  const makeYesTopRight = safe(function(dialog){
    if (!dialog || dialog.querySelector('.im-yes-made')) return;

    const yes=findNativeYes(dialog);
    if (!yes) return;

    const cs=getComputedStyle(dialog);
    if (cs.position==='static') dialog.style.position='relative';

    const made=document.createElement('button');
    made.type='button';
    made.className='im-yes-made';
    made.textContent=(yes.textContent||'Yes').trim();

    const pr = dialog.getBoundingClientRect();
    const xBtn = findCloseX(dialog);
    const xr  = xBtn ? xBtn.getBoundingClientRect() : {left: pr.right - 12, width: 12};
    const topPad = 8, gap = 8, width = Math.max(70, yes.getBoundingClientRect().width);

    made.style.top = `${topPad}px`;
    const rightPx = Math.max(8, (pr.right - xr.left) + gap);
    made.style.right = `${rightPx}px`;
    made.style.width = `${width}px`;
    const yh = yes.getBoundingClientRect().height;
    if (yh>0) made.style.height = `${yh}px`;

    made.addEventListener('click', (e)=>{
      e.preventDefault(); e.stopPropagation(); yes.click();
    }, {capture:true});

    dialog.appendChild(made);

    const pos = rafDebounce(()=>{
      const pr2 = dialog.getBoundingClientRect();
      const xr2 = (findCloseX(dialog)?.getBoundingClientRect()) || {left: pr2.right - 12, width: 12};
      const rightPx2 = Math.max(8, (pr2.right - xr2.left) + gap);
      made.style.right = `${rightPx2}px`;
    }, 60);
    const ro = new ResizeObserver(pos);
    ro.observe(dialog);
    window.addEventListener('scroll', pos, {passive:true});
  });

  // ---------- Observers (debounced & guarded) ----------
  const onDomChangeRows = rafDebounce(refreshRows, 60);
  const rowsMO = new MutationObserver(()=>onDomChangeRows());
  rowsMO.observe(document.documentElement, {childList:true, subtree:true});

  const onDialogSweep = rafDebounce(()=>{
    const dlg = findDialog();
    if (dlg) makeYesTopRight(dlg);
  }, 60);
  const dialogMO = new MutationObserver(()=>onDialogSweep());
  dialogMO.observe(document.documentElement, {childList:true, subtree:true});

  // periodic light sweeps (unchanged cadence)
  setTimeout(refreshRows,200);
  setTimeout(refreshRows,800);
  setInterval(refreshRows,2000);
  setInterval(()=>{ const dlg=findDialog(); if (dlg) makeYesTopRight(dlg); }, 300);
})();
