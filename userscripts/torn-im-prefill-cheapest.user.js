// ==UserScript==
// @name         Torn Item Market — Fill Max → Buy (single button)
// @namespace    https://torn.city/
// @version      2.2.0
// @description  Adds a Fill Max button in the Qty cell. On first click, fills the max affordable qty; the same button then turns into Buy and forwards your click to Torn's native Buy/Confirm. No confirmation bypass, no auto-clicks without your action.
// @author       BazookaJoe
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_addStyle
// @run-at       document-idle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- Minimal styles ---
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

  // --- Selectors from your DOM dump ---
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

  // --- Utils ---
  const parseMoney = (s)=>{ s=String(s||'').replace(/[^\d.]/g,''); return s?Math.floor(Number(s)):NaN; };
  const toInt = (s)=>{ const m=String(s||'').match(/\d[\d,]*/); return m?Number(m[0].replace(/[^\d]/g,'')):NaN; };
  const setInputValue = (input, value) => {
    const proto=Object.getPrototypeOf(input);
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    if (setter) setter.call(input,String(value)); else input.value=String(value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  };
  const flash = (el)=>{ el.classList.add('im-flash'); setTimeout(()=>el.classList.remove('im-flash'),280); };
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

  function readWalletHeader(){
    // Very lightweight header scrape for $X,XXX
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

  const getWallet = () => readWalletHeader();

  const rowWrapper = (row)=>row.closest(SEL.rowWrapper) || row.closest('li') || document.body;

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
        const d=(A,B)=>{const ra=show.getBoundingClientRect(), rb=B.getBoundingClientRect(); return Math.hypot((ra.left+ra.width/2)-(rb.left+rb.width/2),(ra.top+ra.height/2)-(rb.top+rb.height/2));};
        return d(0,a)-d(0,b);
      }
      return 0;
    })[0];
  }

  function findNativeBuyButton(row){
    const li=rowWrapper(row);
    const btns=Array.from(li.querySelectorAll(SEL.buyButtons)).filter(b=>{
      const txt=(b.textContent||'').trim().toLowerCase();
      if (!txt) return false;
      if (/show\s*buy/i.test(txt)) return false;
      return /buy|confirm/i.test(txt);
    });
    const visible=btns.filter(b=>b.getBoundingClientRect().height>0 && b.getBoundingClientRect().width>0);
    return visible[0] || btns[0] || null;
  }

  function computeAfford(wallet, unitPrice, qty){
    if (!Number.isFinite(wallet)||wallet<=0) return 0;
    if (!Number.isFinite(unitPrice)||unitPrice<=0) return 0;
    if (!Number.isFinite(qty)||qty<=0) qty=Infinity;
    return Math.max(0, Math.min(Math.floor(wallet/unitPrice), qty));
  }

  // --- Core feature: one button per row that morphs from Fill Max -> Buy ---
  function ensureFillBuyButton(row){
    const qtyCell=row.querySelector(SEL.qtyCell);
    if (!qtyCell) return;
    qtyCell.classList.add('im-available-cell');

    let btn=qtyCell.querySelector(':scope > .im-fillbuy');
    if (!btn){
      btn=document.createElement('button');
      btn.type='button';
      btn.className='im-fillbuy';
      btn.textContent='Fill Max';
      qtyCell.appendChild(btn);

      btn.addEventListener('click', async ()=>{
        // First click: if we're still in Fill mode, fill and morph to Buy
        if (!btn.classList.contains('is-buy')){
          const unitPrice=parseMoney(row.querySelector(SEL.price)?.textContent);
          const qty=toInt(qtyCell?.textContent);
          const wallet=getWallet();
          const afford=computeAfford(wallet, unitPrice, qty);

          const show=row.querySelector(SEL.showBtn);
          if (show) show.click();

          let input=null, t0=performance.now();
          while (!input && performance.now()-t0<3000){
            await sleep(40);
            input=findAmountInputForRow(row);
          }
          if (!input){ alert('Could not find amount input for this listing.'); return; }

          setInputValue(input, afford>0?afford:'');
          if (afford<=0) input.placeholder='Insufficient funds';
          flash(input); input.focus();

          // Morph to Buy
          const nativeBuy=findNativeBuyButton(row);
          btn.classList.add('is-buy');
          btn.textContent=(nativeBuy?.textContent||'Buy').trim() || 'Buy';
          return;
        }

        // Subsequent clicks: forward to native Buy/Confirm
        const nativeBuy=findNativeBuyButton(row);
        if (nativeBuy && nativeBuy.click) nativeBuy.click();
      });
    }
  }

  function findRows(){
    const list=document.querySelector(SEL.list);
    if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)).filter(r=>r.offsetParent!==null);
  }

  function updateAll(){
    for (const row of findRows()){
      ensureFillBuyButton(row);
    }
  }

  const mo=new MutationObserver(()=>{ if (mo._raf) cancelAnimationFrame(mo._raf);
    mo._raf=requestAnimationFrame(()=>setTimeout(updateAll,30)); });
  mo.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(updateAll,200);
  setTimeout(updateAll,800);
})();
