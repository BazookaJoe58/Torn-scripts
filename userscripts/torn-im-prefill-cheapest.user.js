// ==UserScript==
// @name         Torn Item Market — Quarter-Overlay Fill Max on Buy (Right Aligned)
// @namespace    https://torn.city/
// @version      2.3.5
// @description  Places a Fill Max overlay over the rightmost 25% of Torn's native Buy/Confirm button. Click once to fill max; overlay then drops behind so native Buy works normally.
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    .im-fill-overlay {
      position: absolute;
      top: 0;
      right: 0;              /* anchor to far right */
      height: 100%;
      width: 25%;            /* quarter width */
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 0 8px 8px 0;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      z-index: 9;
      background: rgba(22, 163, 74, 0.12);
      color: #16a34a;
      border-left: 1px solid #16a34a;
      pointer-events: auto;
      user-select: none;
    }
    .im-fill-overlay:hover {
      background: rgba(22, 163, 74, 0.2);
    }
    .im-fill-overlay.im-done {
      z-index: -1;
      pointer-events: none;
      background: transparent;
      border-color: transparent;
    }
    .im-flash {
      box-shadow: 0 0 0 3px rgba(0,160,255,.55) !important;
      transition: box-shadow .25s ease;
    }
  `);

  // --- helpers (same as before) ---
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
  const parseMoney = (s)=>{ s=String(s||'').replace(/[^\d.]/g,''); return s?Math.floor(Number(s)):NaN; };
  const toInt = (s)=>{ const m=String(s||'').match(/\d[\d,]*/); return m?Number(m[0].replace(/[^\d]/g,'')):NaN; };
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const rowWrapper = (row)=>row.closest(SEL.rowWrapper) || row.closest('li') || document.body;

  function getWalletFromHeader(){
    const root=document.querySelector('#topRoot')||document.body;
    for (const n of root.querySelectorAll('span,div,a,li,b,strong')){
      const t=n.textContent||''; if (/\$\s?[\d,. ]+/.test(t)){ const v=parseMoney(t); if (Number.isFinite(v) && v>=0) return v; }
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
    if (setter) setter.call(input, String(value)); else input.value=String(value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true, key:'0'}));
  }
  function flash(el){ el.classList.add('im-flash'); setTimeout(()=>el.classList.remove('im-flash'),280); }

  function findAmountInputForRow(row){
    const li=rowWrapper(row);
    const candidates=Array.from(li.querySelectorAll(SEL.amountInputs)).filter(inp=>{
      if (!(inp instanceof HTMLInputElement)) return false;
      if (inp.type==='checkbox'||inp.type==='hidden'||inp.disabled) return false;
      const r=inp.getBoundingClientRect(); return r.width>0 && r.height>0;
    });
    return candidates[0]||null;
  }
  function findNativeBuyButton(row){
    const li=rowWrapper(row);
    const btns=Array.from(li.querySelectorAll(SEL.buyButtons)).filter(b=>{
      const txt=(b.textContent||'').trim().toLowerCase();
      if (!txt) return false;
      if (/show\s*buy/i.test(txt)) return false;
      return /buy|confirm|purchase/.test(txt);
    });
    return btns.find(b=>b.getBoundingClientRect().width>0 && b.getBoundingClientRect().height>0) || null;
  }
  async function ensureControlsOpen(row){
    const show=row.querySelector(SEL.showBtn);
    if (show) show.click();
    for (let i=0;i<20;i++){ await sleep(20); if (findAmountInputForRow(row)) break; }
  }

  async function placeOverlay(row){
    let native=null;
    const start=performance.now();
    while (!native && performance.now()-start<3000){
      native = findNativeBuyButton(row);
      if (!native){ await ensureControlsOpen(row); await sleep(60); }
    }
    if (!native) return;

    const container = native;
    if (getComputedStyle(container).position === 'static') container.style.position='relative';
    if (container.querySelector(':scope > .im-fill-overlay')) return;

    const overlay=document.createElement('button');
    overlay.type='button';
    overlay.className='im-fill-overlay';
    overlay.textContent='Fill Max';
    container.appendChild(overlay);

    overlay.addEventListener('click', async ()=>{
      const unitPrice=parseMoney(row.querySelector(SEL.price)?.textContent);
      const qtyText=row.querySelector(SEL.qtyCell)?.textContent;
      const qty=toInt(qtyText);
      const wallet=getWalletFromHeader();
      const afford=computeAfford(wallet,unitPrice,qty);

      await ensureControlsOpen(row);
      let input=findAmountInputForRow(row);
      if (!input){ alert('No input found.'); return; }

      setInputValue(input, afford>0?afford:'');
      if (afford<=0) input.placeholder='Insufficient funds';
      input.scrollIntoView({block:'center', inline:'nearest'});
      flash(input); input.focus();

      overlay.classList.add('im-done');
      native.focus();
    });
  }

  function getRows(){
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)).filter(r=>r.offsetParent!==null);
  }
  async function refresh(){ for (const row of getRows()) placeOverlay(row); }

  const mo=new MutationObserver(()=>{ if (mo._raf) cancelAnimationFrame(mo._raf); mo._raf=requestAnimationFrame(()=>setTimeout(refresh,30)); });
  mo.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(refresh,200);
  setTimeout(refresh,800);
  setInterval(refresh,2000);
})();
