// ==UserScript==
// @name         Torn Item Market — Prefill + Buy/Fill Max (List View + API wallet)
// @namespace    https://torn.city/
// @version      1.3.0
// @description  Afford badges, Fill Max in Qty cell, Buy Max per row. Uses Torn API (user?selections=money) if set; header fallback. No confirmation bypass; stays compliant.
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

  // ---------- Styles ----------
  GM_addStyle(`
    .im-afford-badge{display:inline-block;margin-left:8px;padding:2px 6px;font-size:11px;line-height:1.2;border-radius:999px;
      background:rgba(20,20,20,.9);color:#cfead6;border:1px solid rgba(120,200,160,.45);white-space:nowrap;vertical-align:middle}
    .im-afford-badge.im-zero{color:#f7d5d5;border-color:rgba(220,120,120,.5)}
    .im-flash{box-shadow:0 0 0 3px rgba(0,160,255,.55)!important;transition:box-shadow .25s ease}
    .im-cheapest-row{outline:2px dashed rgba(34,197,94,.55);outline-offset:2px;border-radius:6px}

    .im-api-pill{position:fixed;right:10px;bottom:10px;z-index:999999;background:#0f172a;color:#e5f1ff;border:1px solid #334155;
      border-radius:999px;padding:4px 8px;font-size:11px;cursor:pointer}
    .im-api-pill.ok{border-color:#22c55e}.im-api-pill.err{border-color:#ef4444}

    .im-buymax{margin-left:6px;padding:2px 8px;font-size:11px;border-radius:8px;border:1px solid #374151;background:#101827;color:#e5e7eb;cursor:pointer}
    .im-buymax:hover{filter:brightness(1.1)}
    .im-buymax[disabled]{opacity:.5;cursor:not-allowed}

    .im-available-cell{position:relative}
    .im-fillmax{position:absolute;top:20px;right:7px;padding:2px 6px;font-size:11px;border-radius:8px;border:1px solid var(--tt-color-green, #16a34a);
      color:var(--tt-color-green, #16a34a);background:transparent;cursor:pointer;line-height:1.1}
    body:not(.tt-mobile):not(.tt-tablet) .im-fillmax:hover{color:#fff;background:var(--tt-color-green, #16a34a)}
  `);

  // ---------- Selectors (from your DOM) ----------
  const SEL = {
    list: 'ul[class*="sellerList"]',
    rowWrapper: 'li[class*="rowWrapper"]',
    row: 'div[class*="sellerRow"]',
    price: 'div[class*="price"]',
    qtyCell: 'div[class*="available"]',
    qtyText: 'div[class*="available"]',
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

  // ---------- API wallet (optional) ----------
  const KEY_STORE='torn_api_key_prefill_v1';
  let apiKey=GM_getValue(KEY_STORE,'');
  const apiPill=document.createElement('div'); apiPill.className='im-api-pill'; apiPill.textContent='API: off';
  document.body.appendChild(apiPill);
  apiPill.addEventListener('click', ()=>promptSetKey());
  GM_registerMenuCommand('Set Torn API Key…', ()=>promptSetKey());
  GM_registerMenuCommand('Clear Torn API Key', ()=>{ apiKey=''; GM_setValue(KEY_STORE,''); WALLET_CACHE={val:NaN,t:0}; apiPill.className='im-api-pill'; apiPill.textContent='API: off'; alert('API key cleared.'); });

  async function promptSetKey(){
    const k=prompt('Enter your Torn API key (stored locally in Tampermonkey):', apiKey||'');
    if (k===null) return;
    apiKey=(k||'').trim(); GM_setValue(KEY_STORE,apiKey); WALLET_CACHE={val:NaN,t:0};
    if (apiKey){ try{ await readWalletAPI(); apiPill.classList.add('ok'); apiPill.classList.remove('err'); apiPill.textContent='API: on'; }
      catch{ apiPill.classList.remove('ok'); apiPill.classList.add('err'); apiPill.textContent='API: error'; } }
    else { apiPill.className='im-api-pill'; apiPill.textContent='API: off'; }
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
      try{ const v=await readWalletAPI(); apiPill.classList.add('ok'); apiPill.classList.remove('err'); apiPill.textContent='API: on'; return v; }
      catch{ apiPill.classList.remove('ok'); apiPill.classList.add('err'); apiPill.textContent='API: error'; }
    } else { apiPill.classList.remove('ok','err'); apiPill.textContent='API: off'; }
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

  const ensureAffordBadge = (row, afford) => {
    const btn=row.querySelector(SEL.showBtn) || row;
    let badge=(btn.nextElementSibling && btn.nextElementSibling.classList?.contains('im-afford-badge')) ? btn.nextElementSibling : null;
    if (!badge){ badge=document.createElement('span'); badge.className='im-afford-badge'; btn.insertAdjacentElement('afterend', badge); }
    badge.textContent=`Afford: ${Number(afford).toLocaleString()}`;
    badge.classList.toggle('im-zero', afford===0);
    return badge;
  };

  // ---------- Fill Max button (in Qty cell) ----------
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
        const priceEl=row.querySelector(SEL.price);
        const unitPrice=parseMoney(priceEl?.textContent);
        const qty=toInt(row.querySelector(SEL.qtyText)?.textContent);
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

  // ---------- Buy Max button (per row) ----------
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
          const qty=toInt(row.querySelector(SEL.qtyText)?.textContent);
          const wallet=await getWallet();
          const afford=computeAfford(wallet, unitPrice, qty);
          ensureAffordBadge(row, afford);

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
        } finally { buyMax.disabled=false; }
      });
    }
  }

  // ---------- Cheapest row helpers ----------
  let lastCheapestRow=null;
  function pickCheapestRow(rows){
    let best=null, bestPrice=Infinity;
    for (const row of rows){
      const p=parseMoney(row.querySelector(SEL.price)?.textContent);
      if (Number.isFinite(p) && p<bestPrice){ best=row; bestPrice=p; }
    }
    return best;
  }
  function markCheapest(row){
    if (lastCheapestRow && lastCheapestRow!==row) lastCheapestRow.classList.remove('im-cheapest-row');
    if (row){ row.classList.add('im-cheapest-row'); lastCheapestRow=row; }
  }

  // ---------- Main refresh ----------
  async function updateAll(){
    if (!isMarketPage()) return;
    const rows=findRows();
    const cheapest=pickCheapestRow(rows);
    markCheapest(cheapest);

    const wallet=await getWallet();
    for (const row of rows){
      const unitPrice=parseMoney(row.querySelector(SEL.price)?.textContent);
      const qty=toInt(row.querySelector(SEL.qtyText)?.textContent);
      const afford=computeAfford(wallet, unitPrice, qty);
      ensureAffordBadge(row, afford);
      ensureFillMax(row);
      ensureBuyMaxButton(row);
    }
  }

  // ---------- Observe & kick ----------
  const mo=new MutationObserver(()=>{ if (mo._raf) cancelAnimationFrame(mo._raf);
    mo._raf=requestAnimationFrame(()=>setTimeout(updateAll,30)); });
  mo.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(updateAll,200);
  setTimeout(updateAll,800);
  setInterval(updateAll,4000);
})();
