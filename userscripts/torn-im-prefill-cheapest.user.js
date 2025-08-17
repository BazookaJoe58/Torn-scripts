// ==UserScript==
// @name         Torn Item Market — Fill Max → Buy (single button)
// @namespace    https://torn.city/
// @version      2.2.1
// @description  One button per row: first click fills max affordable qty; then the same button becomes Buy and forwards your click to Torn's native Buy/Confirm. No bypasses.
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function(){
  'use strict';

  GM_addStyle(`
    .im-available-cell{position:relative}
    .im-fillbuy{position:absolute;top:20px;right:7px;padding:2px 8px;font-size:11px;border-radius:8px;
      border:1px solid var(--tt-color-green, #16a34a); color:var(--tt-color-green, #16a34a);
      background:transparent; cursor:pointer; line-height:1.1}
    body:not(.tt-mobile):not(.tt-tablet) .im-fillbuy:hover{color:#fff;background:var(--tt-color-green, #16a34a)}
    .im-fillbuy.is-buy{border-color:#3b82f6;color:#e5e7eb;background:#0b1220}
    body:not(.tt-mobile):not(.tt-tablet) .im-fillbuy.is-buy:hover{filter:brightness(1.05)}
    .im-flash{box-shadow:0 0 0 3px rgba(0,160,255,.55)!important;transition:box-shadow .25s ease}
  `);

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

  const parseMoney = (s)=>{ s=String(s||'').replace(/[^\d.]/g,''); return s?Math.floor(Number(s)):NaN; };
  const toInt = (s)=>{ const m=String(s||'').match(/\d[\d,]*/); return m?Number(m[0].replace(/[^\d]/g,'')):NaN; };
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const rowWrapper = (row)=>row.closest(SEL.rowWrapper) || row.closest('li') || document.body;

  function setInputValue(input, value){
    const proto=Object.getPrototypeOf(input);
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    if (setter) setter.call(input, String(value)); else input.value=String(value);
    // Fire a few events to satisfy React forms
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true, key:'0'}));
  }
  function flash(el){ el.classList.add('im-flash'); setTimeout(()=>el.classList.remove('im-flash'),280); }

  function readWalletHeader(){
    const root=document.querySelector('#topRoot')||document.body;
    for (const n of root.querySelectorAll('span,div,a,li,b,strong')){
      const t=n.textContent||'';
      if (/\$\s?[\d,. ]+/.test(t)){
        const v=parseMoney(t); if (Number.isFinite(v) && v>=0) return v;
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

  function findAmountInputForRow(row){
    const li=rowWrapper(row);
    const candidates=Array.from(li.querySelectorAll(SEL.amountInputs)).filter(inp=>{
      if (!(inp instanceof HTMLInputElement)) return false;
      if (inp.type==='checkbox' || inp.type==='hidden' || inp.disabled) return false;
      const r=inp.getBoundingClientRect(); return r.width>0 && r.height>0;
    });
    if (!candidates.length) return null;
    const show=row.querySelector(SEL.showBtn);
    return candidates.sort((a,b)=>{
      const an=a.type==='number'?0:1, bn=b.type==='number'?0:1;
      if (an!==bn) return an-bn;
      if (show){
        const ra=show.getBoundingClientRect(), raCx=ra.left+ra.width/2, raCy=ra.top+ra.height/2;
        const d=(el)=>{const rb=el.getBoundingClientRect(); return Math.hypot(raCx-(rb.left+rb.width/2), raCy-(rb.top+rb.height/2));};
        return d(a)-d(b);
      }
      return 0;
    })[0];
  }

  function findNativeBuyButton(row){
    const li=rowWrapper(row);
    const btns=Array.from(li.querySelectorAll(SEL.buyButtons)).filter(b=>{
      const txt=(b.textContent||'').trim().toLowerCase();
      if (!txt) return false;
      if (/show\s*buy/i.test(txt)) return false; // the toggle
      return /buy|confirm|purchase/.test(txt);
    });
    const visible=btns.filter(b=>b.getBoundingClientRect().width>0 && b.getBoundingClientRect().height>0);
    return visible[0] || btns[0] || null;
  }

  async function ensureControlsOpen(row){
    const show=row.querySelector(SEL.showBtn);
    if (show) show.click();
    // Wait a moment for the panel to mount
    for (let i=0;i<20;i++){ // ~400ms
      await sleep(20);
      if (findAmountInputForRow(row)) return;
    }
  }

  async function fillMaxThenMorph(row, btn){
    const qtyCell=row.querySelector(SEL.qtyCell);
    const unitPrice=parseMoney(row.querySelector(SEL.price)?.textContent);
    const qty=toInt(qtyCell?.textContent);
    const wallet=readWalletHeader();
    const afford=computeAfford(wallet, unitPrice, qty);

    await ensureControlsOpen(row);

    // Wait for input up to 3s
    let input=null, t0=performance.now();
    while (!input && performance.now()-t0<3000){
      await sleep(40);
      input=findAmountInputForRow(row);
    }
    if (!input){ alert('Could not find amount input for this listing.'); return false; }

    setInputValue(input, afford>0?afford:'');
    if (afford<=0) input.placeholder='Insufficient funds';
    input.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
    flash(input); input.focus();

    // Morph to BUY
    btn.classList.add('is-buy');
    const native=await waitForNativeBuy(row, 1500);
    btn.textContent=(native?.textContent||'Buy').trim() || 'Buy';
    return true;
  }

  async function waitForNativeBuy(row, timeoutMs){
    const t0=performance.now();
    let btn=null;
    while (!btn && performance.now()-t0<timeoutMs){
      btn=findNativeBuyButton(row);
      if (btn) break;
      await sleep(40);
    }
    return btn;
  }

  function ensureFillBuyButton(row){
    const qtyCell=row.querySelector(SEL.qtyCell);
    if (!qtyCell) return;
    qtyCell.classList.add('im-available-cell');

    let btn=qtyCell.querySelector(':scope > .im-fillbuy');
    if (btn) return;

    btn=document.createElement('button');
    btn.type='button';
    btn.className='im-fillbuy';
    btn.textContent='Fill Max';
    qtyCell.appendChild(btn);

    btn.addEventListener('click', async ()=>{
      // If Fill mode -> perform fill, then morph
      if (!btn.classList.contains('is-buy')){
        const ok=await fillMaxThenMorph(row, btn);
        if (!ok) return;
        return;
      }
      // If Buy mode -> forward your click to native button
      const native=await waitForNativeBuy(row, 1500);
      if (!native){ alert('Buy button not found. Try clicking the row’s “Show Buy” then press Buy again.'); return; }
      native.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
      // Trigger both .click() and a bubbled MouseEvent for safety
      try { native.click(); } catch {}
      native.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
    });
  }

  function rows(){
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)).filter(r=>r.offsetParent!==null);
  }

  function updateAll(){
    for (const row of rows()) ensureFillBuyButton(row);
  }

  const mo=new MutationObserver(()=>{ if (mo._raf) cancelAnimationFrame(mo._raf);
    mo._raf=requestAnimationFrame(()=>setTimeout(updateAll,30)); });
  mo.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(updateAll,200);
  setTimeout(updateAll,800);
})();
