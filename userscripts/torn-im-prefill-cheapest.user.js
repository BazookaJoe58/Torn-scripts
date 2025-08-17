// ==UserScript==
// @name         Torn Item Market — Half-Overlay Fill Max on native Buy
// @namespace    https://torn.city/
// @version      2.3.3
// @description  Places a Fill Max overlay over HALF of Torn's native Buy/Confirm. Click once to fill max; overlay then drops behind (no pointer events) so the real Buy is clickable. No bypasses.
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Styles ----------
  GM_addStyle(`
    .im-fill-overlay {
      position: absolute;
      top: 0; left: 0;
      height: 100%; width: 50%;
      display: flex; align-items: center; justify-content: center;
      border-radius: 8px 0 0 8px;
      cursor: pointer; font-size: 12px; font-weight: 600;
      z-index: 9;
      background: rgba(22, 163, 74, 0.12);
      color: #16a34a;
      border: 1px solid #16a34a;
      border-right: none;
      backdrop-filter: blur(1px);
      pointer-events: auto;
      user-select: none;
    }
    .im-fill-overlay:hover { background: rgba(22, 163, 74, 0.2); }
    .im-fill-overlay.im-done {
      z-index: -1; pointer-events: none; background: transparent; border-color: transparent;
    }
    .im-flash { box-shadow: 0 0 0 3px rgba(0,160,255,.55) !important; transition: box-shadow .25s ease; }
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
    if (!candidates.length) return null;
    const toggle=row.querySelector(SEL.showBtn);
    return candidates.sort((a,b)=>{
      const an=a.type==='number'?0:1, bn=b.type==='number'?0:1;
      if (an!==bn) return an-bn;
      if (toggle){
        const tr=toggle.getBoundingClientRect(), cx=tr.left+tr.width/2, cy=tr.top+tr.height/2;
        const d=(x)=>{const r=x.getBoundingClientRect(); return Math.hypot(cx-(r.left+r.width/2), cy-(r.top+r.height/2));};
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
      if (/show\s*buy/i.test(txt)) return false;
      return /buy|confirm|purchase/.test(txt);
    });
    const visible=btns.filter(b=>b.getBoundingClientRect().width>0 && b.getBoundingClientRect().height>0);
    return visible[0] || btns[0] || null;
  }

  async function ensureControlsOpen(row){
    const show=row.querySelector(SEL.showBtn);
    if (show) show.click();
    for (let i=0;i<20;i++){ await sleep(20); if (findAmountInputForRow(row)) break; } // ~400ms
  }

  // ---------- Core: half overlay on native Buy ----------
  async function placeHalfOverlayOnBuy(row){
    // wait for native Buy to mount
    let native=null;
    const start=performance.now();
    while (!native && performance.now()-start<3000){
      native = findNativeBuyButton(row);
      if (!native){ await ensureControlsOpen(row); await sleep(60); }
    }
    if (!native) return;

    // use the native's parent as positioning context
    const container = native.parentElement || row;
    const cs = getComputedStyle(container);
    if (cs.position === 'static') container.style.position = 'relative';

    // avoid duplicates
    if (container.querySelector(':scope > .im-fill-overlay')) return;

    // create overlay covering the LEFT half
    const overlay = document.createElement('button');
    overlay.type='button';
    overlay.className='im-fill-overlay';
    overlay.textContent='Fill Max';
    container.appendChild(overlay);

    overlay.addEventListener('click', async ()=>{
      // compute and fill
      const unitPrice = parseMoney(row.querySelector(SEL.price)?.textContent);
      const qtyText = row.querySelector(SEL.qtyCell)?.textContent;
      const qty = toInt(qtyText);
      const wallet = getWalletFromHeader();
      const afford = computeAfford(wallet, unitPrice, qty);

      await ensureControlsOpen(row);

      let input=null, t0=performance.now();
      while (!input && performance.now()-t0<3000){
        await sleep(40);
        input=findAmountInputForRow(row);
      }
      if (!input){ alert('Could not find amount input for this listing.'); return; }

      setInputValue(input, afford>0?afford:'');
      if (afford<=0) input.placeholder='Insufficient funds';
      input.scrollIntoView({block:'center', inline:'nearest'});
      flash(input); input.focus();

      // drop behind and let the native Buy be clickable
      overlay.classList.add('im-done');
      native.focus();
    });
  }

  function getRows(){
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)).filter(r=>r.offsetParent!==null);
  }

  async function refresh(){
    for (const row of getRows()) placeHalfOverlayOnBuy(row);
  }

  const mo=new MutationObserver(()=>{ if (mo._raf) cancelAnimationFrame(mo._raf); mo._raf=requestAnimationFrame(()=>setTimeout(refresh,30)); });
  mo.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(refresh,200);
  setTimeout(refresh,800);
  setInterval(refresh,2000);
})();
