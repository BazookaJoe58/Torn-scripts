// ==UserScript==
// @name         Torn Item Market — Prefill (Right 25% Fill Max Overlay)
// @namespace    https://torn.city/
// @version      2.4.0
// @description  Adds a rightmost 25% overlay on Torn's native Buy/Confirm; click once to fill the max you can afford, then the overlay drops behind so the native Buy is clickable. No confirm bypass. No scrolling.
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
    .im-fill-overlay{
      position:absolute; top:0; right:0; height:100%; width:25%;
      display:flex; align-items:center; justify-content:center;
      border-radius:0 8px 8px 0; cursor:pointer; font-size:11px; font-weight:600;
      z-index:9; background:rgba(22,163,74,.12); color:#16a34a; border-left:1px solid #16a34a;
      pointer-events:auto; user-select:none; -webkit-user-select:none
    }
    .im-fill-overlay:hover{ background:rgba(22,163,74,.2) }
    .im-fill-overlay.im-done{ z-index:-1; pointer-events:none; background:transparent; border-color:transparent }
    .im-flash{ box-shadow:0 0 0 3px rgba(0,160,255,.55)!important; transition:box-shadow .25s ease }
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

  function getWalletFromHeader(){
    const root=document.querySelector('#topRoot')||document.body;
    for (const n of root.querySelectorAll('span,div,a,li,b,strong')){
      const t=n.textContent||'';
      if (/\$\s?[\d,. ]+/.test(t)){
        const v=parseMoney(t);
        if (Number.isFinite(v) && v>=0) return v;
      }
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
    // Satisfy React-like handlers
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
      if (/show\s*buy/i.test(txt)) return false; // ignore the toggle
      return /buy|confirm|purchase/.test(txt);
    });
    const visible = btns.find(b=>b.getBoundingClientRect().width>0 && b.getBoundingClientRect().height>0);
    return visible || btns[0] || null;
  }

  async function ensureControlsOpen(row){
    const show=row.querySelector(SEL.showBtn);
    if (show) show.click();
    for (let i=0;i<20;i++){ await sleep(20); if (findAmountInputForRow(row)) break; } // ~400ms
  }

  // ---------- Core: place 25% overlay on the right of native Buy ----------
  async function placeOverlay(row){
    let native=null;
    const start=performance.now();
    while (!native && performance.now()-start<3000){
      native = findNativeBuyButton(row);
      if (!native){ await ensureControlsOpen(row); await sleep(60); }
    }
    if (!native) return;

    // Anchor overlay to the native button element itself
    const container = native;
    if (getComputedStyle(container).position === 'static') container.style.position='relative';

    // Avoid duplicates
    if (container.querySelector(':scope > .im-fill-overlay')) return;

    // Use <div> to avoid focus/scroll side-effects of nested buttons
    const overlay=document.createElement('div');
    overlay.className='im-fill-overlay';
    overlay.setAttribute('role','button');
    overlay.setAttribute('aria-label','Fill Max');
    overlay.setAttribute('tabindex','-1');
    overlay.textContent='Fill Max';

    // Prevent default interactions and bubbling (no scroll/jump)
    overlay.addEventListener('mousedown', (e)=>{ e.preventDefault(); e.stopPropagation(); }, {capture:true});
    overlay.addEventListener('click', async (e)=>{
      e.preventDefault();
      e.stopPropagation();

      const unitPrice=parseMoney(row.querySelector(SEL.price)?.textContent);
      const qtyText=row.querySelector(SEL.qtyCell)?.textContent;
      const qty=toInt(qtyText);
      const wallet=getWalletFromHeader();
      const afford=computeAfford(wallet,unitPrice,qty);

      await ensureControlsOpen(row);
      const input=findAmountInputForRow(row);
      if (!input){ alert('Could not find amount input.'); return; }

      setInputValue(input, afford>0?afford:'');
      if (afford<=0) input.placeholder='Insufficient funds';
      flash(input);

      // After fill: drop overlay behind so native Buy is immediately clickable
      overlay.classList.add('im-done');
    }, {capture:true});

    // Trap keyboard to avoid page scroll on Space/Enter
    const killKeys = (e)=>{
      if (e.key === ' ' || e.key === 'Enter'){
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

  // Observe and keep overlays in sync with React list updates
  const mo=new MutationObserver(()=>{
    if (mo._raf) cancelAnimationFrame(mo._raf);
    mo._raf=requestAnimationFrame(()=>setTimeout(refresh,30));
  });
  mo.observe(document.documentElement,{childList:true,subtree:true});

  setTimeout(refresh,200);
  setTimeout(refresh,800);
  setInterval(refresh,2000);
})();
