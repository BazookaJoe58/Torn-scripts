// ==UserScript==
// @name         Torn Item Market — Prefill (Right 25% Fill Max Overlay)
// @namespace    https://torn.city/
// @version      2.4.2
// @description  Rightmost 25% "Fill Max" overlay aligned to the native Buy/Confirm (anchored to its parent). Click to fill max affordable qty, overlay drops behind so the native Buy is clickable. No confirm bypass. Hard no-scroll.
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
    .im-fill-overlay {
      position:absolute;
      display:flex; align-items:center; justify-content:center;
      cursor:pointer; font-size:11px; font-weight:600;
      z-index: 9;
      background: rgba(22,163,74,.12);
      color: #16a34a;
      border-left: 1px solid #16a34a;
      border-radius: 0 8px 8px 0;
      pointer-events:auto; user-select:none; -webkit-user-select:none;
    }
    .im-fill-overlay:hover { background: rgba(22,163,74,.2) }
    .im-fill-overlay.im-done { z-index:-1; pointer-events:none; background:transparent; border-color:transparent }
    .im-flash { box-shadow:0 0 0 3px rgba(0,160,255,.55)!important; transition:box-shadow .25s ease }
  `);

  // ---------- Selectors ----------
  const SEL = {
    list: 'ul[class*="sellerList"]',
    rowWrapper: 'li[class*="rowWrapper"]',
    row: 'div[class*="sellerRow"]',
    price: 'div[class*="price"]',
    qtyCell: 'div[class*="available"]',
    showBtn: 'button[class*="showBuyControlsButton"]',
    amountInputs: 'input:not([type="checkbox"]):not([type="hidden"])',
    buyButtons: 'button, a',
  };

  // ---------- Utils ----------
  const parseMoney = (s)=>{ s=String(s||'').replace(/[^\d.]/g,''); return s?Math.floor(Number(s)):NaN; };
  const toInt = (s)=>{ const m=String(s||'').match(/\d[\d,]*/); return m?Number(m[0].replace(/[^\d]/g,'')):NaN; };
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const rowWrap = (row)=>row.closest(SEL.rowWrapper) || row.closest('li') || document.body;

  // Hard scroll lock wrapper to prevent Torn’s auto-centering
  async function withNoScroll(fn){
    const x = window.scrollX, y = window.scrollY;
    const restore = ()=>window.scrollTo(x,y);
    const styleId = 'im-nosmooth-style';
    if (!document.getElementById(styleId)){
      const s = document.createElement('style');
      s.id = styleId;
      s.textContent = `html,body{scroll-behavior:auto !important}`;
      document.head.appendChild(s);
    }
    const onScroll = ()=>restore();
    window.addEventListener('scroll', onScroll, {capture:true});
    try{
      restore();
      const pins = [0,16,32,64,96,128,160,200];
      const p = fn();
      for (const t of pins) setTimeout(restore, t);
      const out = await p;
      for (const t of pins) setTimeout(restore, t);
      requestAnimationFrame(restore);
      requestAnimationFrame(()=>requestAnimationFrame(restore));
      return out;
    } finally {
      setTimeout(()=>window.removeEventListener('scroll', onScroll, {capture:true}), 250);
      setTimeout(restore, 250);
    }
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
  function flash(el){ el.classList.add('im-flash'); setTimeout(()=>el.classList.remove('im-flash'),280); }

  function findAmountInputForRow(row){
    const li=rowWrap(row);
    const candidates=Array.from(li.querySelectorAll(SEL.amountInputs)).filter(inp=>{
      if (!(inp instanceof HTMLInputElement)) return false;
      if (inp.type==='checkbox'||inp.type==='hidden'||inp.disabled) return false;
      const r=inp.getBoundingClientRect(); return r.width>0 && r.height>0;
    });
    return candidates[0] || null;
  }

  function findNativeBuyButton(row){
    const li=rowWrap(row);
    const btns=Array.from(li.querySelectorAll(SEL.buyButtons)).filter(b=>{
      const txt=(b.textContent||'').trim().toLowerCase();
      if (!txt) return false;
      if (/show\s*buy/i.test(txt)) return false;
      return /buy|confirm|purchase/.test(txt);
    });
    const visible = btns.find(b=>b.getBoundingClientRect().width>0 && b.getBoundingClientRect().height>0);
    return visible || btns[0] || null;
  }

  async function ensureControlsOpen(row){
    const show=row.querySelector(SEL.showBtn);
    if (show) show.click();
    for (let i=0;i<20;i++){ await sleep(20); if (findAmountInputForRow(row)) break; }
  }

  // Position overlay relative to the Buy button, but anchored in the button's parent container.
  function positionOverlayOverRightQuarter(overlay, nativeBtn){
    const parent = overlay.parentElement;
    if (!parent) return;
    // Compute offsets within the parent
    const parentRect = parent.getBoundingClientRect();
    const btnRect    = nativeBtn.getBoundingClientRect();

    const top  = btnRect.top  - parentRect.top;
    const left = btnRect.left - parentRect.left;
    const w    = btnRect.width;
    const h    = btnRect.height;

    const ow   = Math.max(24, Math.round(w * 0.25)); // quarter width, min 24px
    const ox   = left + (w - ow);                    // rightmost quarter

    overlay.style.top    = `${top}px`;
    overlay.style.left   = `${ox}px`;
    overlay.style.width  = `${ow}px`;
    overlay.style.height = `${h}px`;
    overlay.style.borderRadius = '0 8px 8px 0';
  }

  // ---------- Core: create overlay anchored to the Buy's parent ----------
  async function placeOverlay(row){
    // find native Buy (or Confirm)
    let native=null;
    const start=performance.now();
    while (!native && performance.now()-start<3000){
      native = findNativeBuyButton(row);
      if (!native){ await ensureControlsOpen(row); await sleep(60); }
    }
    if (!native) return;

    // Use the Buy button's parent as the positioning context
    const container = native.parentElement || row;
    const cs = getComputedStyle(container);
    if (cs.position === 'static') container.style.position='relative';

    // Avoid duplicates
    if (container.querySelector(':scope > .im-fill-overlay')) return;

    // Create non-focusable overlay element
    const overlay = document.createElement('div');
    overlay.className = 'im-fill-overlay';
    overlay.setAttribute('role','button');
    overlay.setAttribute('aria-label','Fill Max');
    overlay.setAttribute('tabindex','-1');
    overlay.textContent = 'Fill Max';

    // Initial placement
    positionOverlayOverRightQuarter(overlay, native);

    // Keep aligned on size/position changes
    const ro = new ResizeObserver(()=>positionOverlayOverRightQuarter(overlay, native));
    ro.observe(container);
    ro.observe(native);
    // Also update on scroll (parent/row may move without resize)
    const realign = ()=>positionOverlayOverRightQuarter(overlay, native);
    window.addEventListener('scroll', realign, {passive:true});
    const mo = new MutationObserver(()=>positionOverlayOverRightQuarter(overlay, native));
    mo.observe(container, {attributes:true, childList:false, subtree:false});

    // Prevent default interactions/bubbling to avoid any native focus/scroll
    overlay.addEventListener('mousedown', (e)=>{ e.preventDefault(); e.stopPropagation(); }, {capture:true});
    overlay.addEventListener('click', (e)=>{
      e.preventDefault(); e.stopPropagation();

      withNoScroll(async ()=>{
        const unitPrice=parseMoney(row.querySelector(SEL.price)?.textContent);
        const qtyText=row.querySelector(SEL.qtyCell)?.textContent;
        const qty=toInt(qtyText);
        const wallet=getWalletFromHeader();
        const afford=computeAfford(wallet,unitPrice,qty);

        await ensureControlsOpen(row);   // guarded by withNoScroll

        const input=findAmountInputForRow(row);
        if (!input) return;

        setInputValue(input, afford>0?afford:'');
        if (afford<=0) input.placeholder='Insufficient funds';
        flash(input);

        // Drop behind so the native Buy is immediately clickable
        overlay.classList.add('im-done');
      });
    }, {capture:true});

    // Keyboard (Space/Enter) should not scroll page
    const killKeys = (e)=>{
      if (e.key === ' ' || e.key === 'Enter'){
        e.preventDefault(); e.stopPropagation();
        overlay.click();
      }
    };
    overlay.addEventListener('keydown', killKeys, {capture:true});
    overlay.addEventListener('keyup',   killKeys, {capture:true});

    // Insert overlay
    container.appendChild(overlay);
  }

  function getRows(){
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`))
      .filter(r=>r.offsetParent!==null);
  }

  function refresh(){
    for (const row of getRows()) placeOverlay(row);
  }

  // Observe and keep overlays in sync with React list updates
  const docMO=new MutationObserver(()=>{
    if (docMO._raf) cancelAnimationFrame(docMO._raf);
    docMO._raf=requestAnimationFrame(()=>setTimeout(refresh,30));
  });
  docMO.observe(document.documentElement,{childList:true,subtree:true});

  setTimeout(refresh,200);
  setTimeout(refresh,800);
  setInterval(refresh,2000);
})();
