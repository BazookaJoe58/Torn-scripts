// ==UserScript==
// @name         Torn Item Market — Prefill Cheapest (List View + API wallet)
// @namespace    https://torn.city/
// @version      1.1.1
// @description  Prefills the amount ONLY on the cheapest visible listing. Uses Torn API (user?selections=money) if set; falls back to header wallet. No auto-buy.
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

  GM_addStyle(`
    .im-afford-badge{display:inline-block; margin-left:8px; padding:2px 6px; font-size:11px; line-height:1.2;
      border-radius:999px; background:rgba(20,20,20,.9); color:#cfead6; border:1px solid rgba(120,200,160,.45); white-space:nowrap; vertical-align:middle;}
    .im-afford-badge.im-zero{color:#f7d5d5; border-color:rgba(220,120,120,.5)}
    .im-flash{box-shadow:0 0 0 3px rgba(0,160,255,.55)!important; transition:box-shadow .25s ease}
    .im-cheapest-row{outline:2px dashed rgba(34,197,94,.55); outline-offset:2px; border-radius:6px}
    .im-api-pill{position:fixed; right:10px; bottom:10px; z-index:999999; background:#0f172a; color:#e5f1ff;
      border:1px solid #334155; border-radius:999px; padding:4px 8px; font-size:11px; cursor:pointer}
    .im-api-pill.ok{border-color:#22c55e} .im-api-pill.err{border-color:#ef4444}
  `);

  const SEL = {
    list: 'ul[class*="sellerList"]',
    rowWrapper: 'li[class*="rowWrapper"]',
    row: 'div[class*="sellerRow"]',
    price: 'div[class*="price"]',
    qty: 'div[class*="available"]',
    showBtn: 'button[class*="showBuyControlsButton"]',
    amountInput: 'input[type="number"], input[name*="amount" i], input[id*="amount" i], input[name*="qty" i], input[id*="qty" i]',
  };

  const isMarketPage = () => /page\.php\?sid=ItemMarket/i.test(location.href);
  const parseMoney = (txt) => { const s=String(txt||'').replace(/[^\d.]/g,''); return s?Math.floor(Number(s)):NaN; };
  const toInt = (txt) => { const m=String(txt||'').match(/\d[\d,]*/); return m?Number(m[0].replace(/[^\d]/g,'')):NaN; };
  const setInputValue = (input, value) => {
    const proto=Object.getPrototypeOf(input), setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    setter ? setter.call(input,String(value)) : (input.value=String(value));
    input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
  };
  const flash = (el) => { el.classList.add('im-flash'); setTimeout(()=>el.classList.remove('im-flash'),280); };

  // --- API wallet (optional) ---
  const KEY_STORE='torn_api_key_prefill_v1';
  let apiKey = GM_getValue(KEY_STORE,'');
  const apiPill=document.createElement('div'); apiPill.className='im-api-pill'; apiPill.textContent='API: off';
  document.body.appendChild(apiPill);
  apiPill.addEventListener('click', async ()=>{ await promptSetKey(); });

  GM_registerMenuCommand('Set Torn API Key…', async ()=>{ await promptSetKey(); });
  GM_registerMenuCommand('Clear Torn API Key', ()=>{ apiKey=''; GM_setValue(KEY_STORE,''); WALLET_CACHE={val:NaN,t:0}; apiPill.className='im-api-pill'; apiPill.textContent='API: off'; alert('API key cleared.'); });

  async function promptSetKey(){
    const k = prompt('Enter your Torn API key (stored locally in Tampermonkey):', apiKey || '');
    if (k===null) return;
    apiKey = (k||'').trim(); GM_setValue(KEY_STORE, apiKey); WALLET_CACHE={val:NaN,t:0};
    if (apiKey){ try{ await readWalletAPI(); apiPill.classList.add('ok'); apiPill.textContent='API: on'; }catch{ apiPill.classList.add('err'); apiPill.textContent='API: error'; } }
    else { apiPill.className='im-api-pill'; apiPill.textContent='API: off'; }
  }

  const httpGetJSON=(url)=>new Promise((res,rej)=>GM_xmlhttpRequest({method:'GET',url,headers:{Accept:'application/json'},
    onload:r=>{try{res({status:r.status,data:JSON.parse(r.responseText)})}catch(e){rej(e)}}, onerror:rej, ontimeout:()=>rej(new Error('timeout'))}));
  let WALLET_CACHE={val:NaN,t:0}; const WALLET_TTL_MS=10_000;

  async function readWalletAPI(){
    const now=Date.now(); if (now-WALLET_CACHE.t<WALLET_TTL_MS) return WALLET_CACHE.val;
    if (!apiKey) throw new Error('no_api_key');
    const {data}=await httpGetJSON(`https://api.torn.com/user/?selections=money&key=${encodeURIComponent(apiKey)}`);
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
    if (apiKey){ try{ const v=await readWalletAPI(); apiPill.classList.add('ok'); apiPill.classList.remove('err'); apiPill.textContent='API: on'; return v; }
      catch{ apiPill.classList.remove('ok'); apiPill.classList.add('err'); apiPill.textContent='API: error'; } }
    else { apiPill.classList.remove('ok','err'); apiPill.textContent='API: off'; }
    return readWalletHeader();
  }

  // --- list helpers ---
  const findRows = () => {
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)).filter(r=>r.offsetParent!==null);
  };
  const computeAfford = (wallet, unitPrice, qty) => {
    if (!Number.isFinite(wallet)||wallet<=0) return 0;
    if (!Number.isFinite(unitPrice)||unitPrice<=0) return 0;
    if (!Number.isFinite(qty)||qty<=0) qty=Infinity;
    return Math.max(0, Math.min(Math.floor(wallet/unitPrice), qty));
  };
  const ensureAffordBadge = (row, afford) => {
    const btn=row.querySelector(SEL.showBtn)||row;
    let badge = (btn.nextElementSibling&&btn.nextElementSibling.classList?.contains('im-afford-badge')) ? btn.nextElementSibling : null;
    if (!badge){ badge=document.createElement('span'); badge.className='im-afford-badge'; btn.insertAdjacentElement('afterend', badge); }
    badge.textContent=`Afford: ${Number(afford).toLocaleString()}`;
    badge.classList.toggle('im-zero', afford===0);
    return badge;
  };

  let lastCheapestRow=null;

  function pickCheapestRow(rows){
    let best=null, bestPrice=Infinity;
    for (const row of rows){
      const priceEl=row.querySelector(SEL.price);
      const p=parseMoney(priceEl?.textContent);
      if (Number.isFinite(p) && p<bestPrice){ best=row; bestPrice=p; }
    }
    return best;
  }

  function markCheapest(row){
    if (lastCheapestRow && lastCheapestRow!==row) lastCheapestRow.classList.remove('im-cheapest-row');
    if (row){ row.classList.add('im-cheapest-row'); lastCheapestRow=row; }
  }

  function hookCheapestPrefill(row){
    if (!row || row.__imCheapestHooked) return;
    row.__imCheapestHooked=true;

    // When the show-controls button is clicked, prefill once the input appears
    const btn=row.querySelector(SEL.showBtn);
    if (btn){
      btn.addEventListener('click', async ()=>{
        await prefillRowInput(row, /*refreshWallet*/true);
      });
    }

    // If user focuses the amount input manually, prefill again (refresh wallet)
    row.addEventListener('focusin', async (e)=>{
      const t=e.target;
      if (t instanceof HTMLInputElement && t.matches(SEL.amountInput)){
        await prefillRowInput(row, /*refreshWallet*/true, t);
      }
    }, {capture:true});
  }

  async function prefillRowInput(row, refreshWallet=false, specificInput=null){
    const priceEl=row.querySelector(SEL.price);
    const qtyEl=row.querySelector(SEL.qty);
    const unitPrice=parseMoney(priceEl?.textContent);
    const qty=toInt(qtyEl?.textContent);

    const wallet = refreshWallet ? await getWallet() : await Promise.resolve(readWalletHeader());
    const afford = computeAfford(wallet, unitPrice, qty);

    // ensure badge stays in sync
    ensureAffordBadge(row, afford);

    // wait for input to exist if not provided
    let input = specificInput || row.querySelector(SEL.amountInput);
    if (!input){
      const t0=performance.now();
      const poll=setInterval(()=>{
        if (performance.now()-t0>1200) return clearInterval(poll);
        input=row.querySelector(SEL.amountInput);
        if (input){
          setInputValue(input, afford>0?afford:'');
          if (afford<=0) input.placeholder='Insufficient funds';
          flash(input);
          clearInterval(poll);
        }
      },40);
      return;
    }
    setInputValue(input, afford>0?afford:'');
    if (afford<=0) input.placeholder='Insufficient funds';
    flash(input);
  }

  async function updateAll(){
    if (!isMarketPage()) return;

    const rows=findRows();
    // pick cheapest visible row
    const cheapest=pickCheapestRow(rows);
    markCheapest(cheapest);

    // Compute wallet once for badges (prefill refreshes as needed)
    const wallet=await getWallet();

    for (const row of rows){
      const priceEl=row.querySelector(SEL.price);
      const qtyEl=row.querySelector(SEL.qty);
      const unitPrice=parseMoney(priceEl?.textContent);
      const qty=toInt(qtyEl?.textContent);
      const afford=computeAfford(wallet, unitPrice, qty);

      // Always show badge (nice UX), but we only PREFILL on the cheapest row
      ensureAffordBadge(row, afford);

      if (row===cheapest){
        hookCheapestPrefill(row);
      }
    }
  }

  const start=()=>{
    setTimeout(updateAll,200);
    setTimeout(updateAll,800);
    const mo=new MutationObserver(()=>{ if (start._raf) cancelAnimationFrame(start._raf);
      start._raf=requestAnimationFrame(()=>setTimeout(updateAll,30)); });
    mo.observe(document.documentElement,{childList:true,subtree:true});
    setInterval(updateAll,4000);
  };

  if (isMarketPage()) start();
})();
