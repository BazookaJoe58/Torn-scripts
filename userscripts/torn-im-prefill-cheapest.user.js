// ==UserScript==
// @name         Torn Item Market — Fill Max & Buy Max
// @namespace    https://torn.city/
// @version      2.0.0
// @description  Adds “Fill Max” (in Qty cell) and “Buy Max” (per row). Uses Torn API (user?selections=money) if set; falls back to header wallet. No confirmation bypass.
// @author       BazookaJoe
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-idle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Styles (minimal) ----------
  GM_addStyle(`
    .im-buymax{margin-left:6px;padding:2px 8px;font-size:11px;border-radius:8px;border:1px solid #374151;background:#101827;color:#e5e7eb;cursor:pointer}
    .im-buymax:hover{filter:brightness(1.08)}
    .im-buymax[disabled]{opacity:.5;cursor:not-allowed}

    .im-available-cell{position:relative}
    .im-fillmax{position:absolute;top:20px;right:7px;padding:2px 6px;font-size:11px;border-radius:8px;border:1px solid var(--tt-color-green, #16a34a);
      color:var(--tt-color-green, #16a34a);background:transparent;cursor:pointer;line-height:1.1}
    body:not(.tt-mobile):not(.tt-tablet) .im-fillmax:hover{color:#fff;background:var(--tt-color-green, #16a34a)}

    .im-flash{box-shadow:0 0 0 3px rgba(0,160,255,.55)!important;transition:box-shadow .25s ease}
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
  const isMarketPage = () => /page\.php\?sid=ItemMarket/i.test(location.href);
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

  // ---------- Optional Torn API wallet ----------
  const KEY_STORE='torn_api_key_fillbuy_v1';
  let apiKey=GM_getValue(KEY_STORE,'');
  GM_registerMenuCommand('Set Torn API Key…', ()=>promptSetKey());
  GM_registerMenuCommand('Clear Torn API Key', ()=>{ apiKey=''; GM_setValue(KEY_STORE,''); WALLET_CACHE={val:NaN,t:0}; alert('API key cleared.'); });

  async function promptSetKey(){
    const k=prompt('Enter your Torn API key (stored locally in Tampermonkey):', apiKey||'');
    if (k===null) return;
    apiKey=(k||'').trim(); GM_setValue(KEY_STORE,apiKey); WALLET_CACHE={val:NaN,t:0};
    if (apiKey){ try{ await readWalletAPI(); alert('API key OK.'); }catch{ alert('API key error. Falling back to header wallet.'); } }
  }

  const httpGetJSON=(url)=>new Promise((res,rej)=>GM_xmlhttpRequest({method:'GET',url,headers:{Accept:'application/json'},
    onload:r=>{try{res(JSON.parse(r.responseText))}catch(e){rej(e)}},onerror:rej,ontimeout:()=>rej(new Error('timeout'))}));

  let WALLET_CACHE={val:NaN,t:0}; const WALLET_TTL_MS=10_000;
  async function readWalletAPI(){
    const now=Date.now(); if (now-WALLET_CACHE.t<WALLET_TTL_MS) return WALLET_CACHE.val;
    if (!apiKey) throw new Error('no_api_key');
    const data=await httpGetJSON(`https://api.torn.com/user/?selections=money&key=${encodeURIComponent(apiKey)}`);
    if (data?.error) throw new Error(`api_error_${data.error?.code||'x'}`);
    const val=Number(data?.money_onhand); if (!Number.isFinite(val)) throw new Error('no_money_onhand');
    WALLET_CACHE={val,t:now}; return val;
  }
  function readWalletHeader(){
    const root=document.querySelector('#topRoot')||document.body;
    for (const n of Array.from(root.querySelectorAll('span,div,a,li,b,strong')).filter(n=>/\$\s?[\d,. ]+/.test(n.textContent||''))){
      const v=parseMoney(n.textContent); if (Number.isFinite(v)&&v>=0) return v;
    }
    return NaN;
  }
  async function getWallet(){
    if (apiKey){
      try{ return await readWalletAPI(); }catch{/* fall through to header */ }
    }
    return readWalletHeader();
  }

  // ---------- DOM helpers ----------
  const findRows = () => {
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)).filter(r=>r.offsetParent!==null);
  };
  const rowWrapper = (row)=>row.closest(SEL.rowWrapper) || row.closest('li') || document.body;

  function findAmountInputForRow(row){
    const li=rowWrapper(row);
    const candidates=Array.from(li.querySelectorAll(SEL.amountInputs)).filter(inp=>{
      if (!(inp instanceof HTMLInputElement)) return false;
      if (inp.type==='checkbox' || inp.type==='hidden' || inp.disabled) return false;
      const rect=inp.getBoundingClientRect(); return rect.width>0 && rect.height>0;
    });
    if (!candidates.length) return null;
    const btn=row.querySelector(SEL.showBtn);
    return candidates.sort((a,b)=>{
      const an=a.type==='number'?0:1, bn=b.type==='number'?0:1;
      if (an!==bn) return an-bn;
      if (btn){ const aD=distance(btn,a), bD=distance(btn,b); return aD-bD; }
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

  const distance=(a,b)=>{const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
    return Math.hypot((ra.left+ra.width/2)-(rb.left+rb.width/2),(ra.top+ra.height/2)-(rb.top+rb.height/2));};

  const computeAfford = (wallet, unitPrice, qty) => {
    if (!Number.isFinite(wallet) || wallet<=0) return 0;
    if (!Number.isFinite(unitPrice) || unitPrice<=0) return 0;
    if (!Number.isFinite(qty) || qty<=0) qty=Infinity;
    return Math.max(0, Math.min(Math.floor(wallet/unitPrice), qty));
  };

  // ---------- Feature 1: Fill Max (in Qty cell) ----------
  function ensureFillMax(row){
    const qtyCell=row.querySelector(SEL.qtyCell);
    if (!qtyCell) return;
    qtyCell.classList.add('im-available-cell');

    let btn=qtyCell.querySelector(':scope > .im-fillmax');
    if (!btn){
      btn=document.createElement('button');
      btn.type='button';
      btn.className='im-fillmax';
      btn.textContent='Fill Max';
      qtyCell.appendChild(btn);

      btn.addEventListener('click', async ()=>{
        const unitPrice=parseMoney(row.querySelector(SEL.price)?.textContent);
        const qty=toInt(qtyCell?.textContent);
        const wallet=await getWallet();
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
      });
    }
  }

  // ---------- Feature 2: Buy Max (per row) ----------
  function ensureBuyMaxButton(row){
    const anchor=row.querySelector(SEL.showBtn) || row;
    let buyMax = (anchor.parentElement && anchor.parentElement.querySelector?.(':scope > .im-buymax')) || null;
    if (!buyMax){
      buyMax=document.createElement('button');
      buyMax.type='button';
      buyMax.className='im-buymax';
      buyMax.textContent='Buy Max';
      anchor.insertAdjacentElement('afterend', buyMax);

      buyMax.addEventListener('click', async (e)=>{
        buyMax.disabled=true;
        try{
          const unitPrice=parseMoney(row.querySelector(SEL.price)?.textContent);
          const qty=toInt(row.querySelector(SEL.qtyCell)?.textContent || row.querySelector(SEL.qtyCell)?.textContent);
          const wallet=await getWallet();
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
          if (afford<=0){ input.placeholder='Insufficient funds'; flash(input); return; }
          flash(input);

          const nativeBuy=findNativeBuyButton(row);
          if (!nativeBuy){ input.focus(); return; }
          if (e.shiftKey){ nativeBuy.click(); } else { nativeBuy.focus(); }
        } finally {
          buyMax.disabled=false;
        }
      });
    }
  }

  // ---------- Main ----------
  function updateAll(){
    if (!isMarketPage()) return;
    const rows = findRows();
    for (const row of rows){
      ensureFillMax(row);
      ensureBuyMaxButton(row);
    }
  }

  const mo=new MutationObserver(()=>{ if (mo._raf) cancelAnimationFrame(mo._raf);
    mo._raf=requestAnimationFrame(()=>setTimeout(updateAll,30)); });
  mo.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(updateAll,200);
  setTimeout(updateAll,800);
})();
