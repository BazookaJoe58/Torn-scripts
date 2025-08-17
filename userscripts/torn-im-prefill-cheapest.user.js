// ==UserScript==
// @name         Torn Item Market — Prefill (Right 25% Fill Max Overlay)
// @namespace    https://torn.city/
// @version      2.5.0
// @description  Rightmost 25% "Fill Max" overlay aligned to native Buy/Confirm (anchored to parent). Hard no-scroll (locks viewport, patches scrollIntoView/scrollTo), fills max affordable, then overlay drops behind so native Buy is clickable. No confirm bypass.
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

  // Ultra-hard scroll lock (prevents any auto-centering)
  async function withNoScrollHard(fn){
    const x = window.scrollX, y = window.scrollY;

    // CSS: kill smooth behavior
    let styleNode = document.getElementById('im-nosmooth-style');
    if (!styleNode){
      styleNode = document.createElement('style');
      styleNode.id = 'im-nosmooth-style';
      styleNode.textContent = `html,body{scroll-behavior:auto!important;}`;
      document.head.appendChild(styleNode);
    }

    // Freeze viewport: lock body position
    const body = document.body;
    const prevBodyCss = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.left = `-${x}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    // Patch programmatic scroll calls
    const ElementProto = Element.prototype;
    const origSIV = ElementProto.scrollIntoView;
    const origScrollTo = window.scrollTo;

    ElementProto.scrollIntoView = function noop(){ /* blocked */ };
    window.scrollTo = function lockedScrollTo(){ /* blocked */ };

    // Block user inputs that cause scroll
    const blockEvt = e => { e.preventDefault(); e.stopPropagation(); };
    const unblockers = [
      ['wheel', {passive:false, capture:true}],
      ['touchmove', {passive:false, capture:true}],
      ['keydown', {capture:true}],
    ];
    const keyBlocker = e => {
      if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)) blockEvt(e);
    };
    window.addEventListener('wheel', blockEvt, {passive:false, capture:true});
    window.addEventListener('touchmove', blockEvt, {passive:false, capture:true});
    window.addEventListener('keydown', keyBlocker, {capture:true});

    try {
      // Ensure snapped to current pos
      window.scrollTo(x, y);
      const out = await fn();
      return out;
    } finally {
      // Restore patches & CSS & position
      ElementProto.scrollIntoView = origSIV;
      window.scrollTo = origScrollTo;

      window.removeEventListener('wheel', blockEvt, {capture:true});
      window.removeEventListener('touchmove', blockEvt, {capture:true});
      window.removeEventListener('keydown', keyBlocker, {capture:true});

      // Restore body lock -> actual scroll position
      body.style.position = prevBodyCss.position;
      body.style.top = prevBodyCss.top;
      body.style.left = prevBodyCss.left;
      body.style.width = prevBodyCss.width;
      body.style.overflow = prevBodyCss.overflow;

      // Re-apply original scroll
      window.scrollTo(x, y);
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
      if (/show\s*buy/i.test(txt)) return false; // toggle
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
    const parentRect = parent.getBoundingClientRect();
    const btnRect    = nativeBtn.getBoundingClientRect();

    const top  = btnRect.top  - parentRect.top;
    const left = btnRect.left - parentRect.left;
    const w    = btnRect.width;
    const h    = btnRect.height;

    const ow   = Math.max(24, Math.round(w * 0.25));
    const ox   = left + (w - ow);

    overlay.style.top    = `${top}px`;
    overlay.style.left   = `${ox}px`;
    overlay.style.width  = `${ow}px`;
    overlay.style.height = `${h}px`;
    overlay.style.borderRadius = '0 8px 8px 0';
  }

  // ---------- Core: overlay ----------
  async function placeOverlay(row){
    let native=null;
    const start=performance.now();
    while (!native && performance.now()-start<3000){
      native = findNativeBuyButton(row);
      if (!native){ await ensureControlsOpen(row); await sleep(60); }
    }
    if (!native) return;

    const container = native.parentElement || row;
    if (getComputedStyle(container).position === 'static') container.style.position='relative';

    if (container.querySelector(':scope > .im-fill-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'im-fill-overlay';
    overlay.setAttribute('role','button');
    overlay.setAttribute('aria-label','Fill Max');
    overlay.setAttribute('tabindex','-1');
    overlay.textContent = 'Fill Max';

    // Initial & reactive positioning
    positionOverlayOverRightQuarter(overlay, native);
    const ro = new ResizeObserver(()=>positionOverlayOverRightQuarter(overlay, native));
    ro.observe(container);
    ro.observe(native);
    const realign = ()=>positionOverlayOverRightQuarter(overlay, native);
    window.addEventListener('scroll', realign, {passive:true});
    const mo = new MutationObserver(()=>positionOverlayOverRightQuarter(overlay, native));
    mo.observe(container, {attributes:true, childList:false, subtree:false});

    // Block native interactions
    overlay.addEventListener('mousedown', (e)=>{ e.preventDefault(); e.stopPropagation(); }, {capture:true});
    overlay.addEventListener('click', (e)=>{
      e.preventDefault(); e.stopPropagation();

      withNoScrollHard(async ()=>{
        const unitPrice=parseMoney(row.querySelector(SEL.price)?.textContent);
        const qtyText=row.querySelector(SEL.qtyCell)?.textContent;
        const qty=toInt(qtyText);
        const wallet=getWalletFromHeader();
        const afford=computeAfford(wallet,unitPrice,qty);

        await ensureControlsOpen(row);

        const input=findAmountInputForRow(row);
        if (!input) return;

        setInputValue(input, afford>0?afford:'');
        if (afford<=0) input.placeholder='Insufficient funds';
        flash(input);

        overlay.classList.add('im-done');
      });
    }, {capture:true});

    const killKeys = (e)=>{
      if ([' ','Enter'].includes(e.key)){
        e.preventDefault(); e.stopPropagation();
        overlay.click();
      }
    };
    overlay.addEventListener('keydown', killKeys, {capture:true});
    overlay.addEventListener('keyup',   killKeys, {capture:true});

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

  const docMO=new MutationObserver(()=>{
    if (docMO._raf) cancelAnimationFrame(docMO._raf);
    docMO._raf=requestAnimationFrame(()=>setTimeout(refresh,30));
  });
  docMO.observe(document.documentElement,{childList:true,subtree:true});

  setTimeout(refresh,200);
  setTimeout(refresh,800);
  setInterval(refresh,2000);
})();
