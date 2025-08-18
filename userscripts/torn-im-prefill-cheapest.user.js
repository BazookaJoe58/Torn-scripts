// ==UserScript==
// @name         Torn Item Market — Prefill (Fill Max + Inline Yes Clone)
// @namespace    https://torn.city/
// @version      2.10.0
// @description  Row: rightmost 25% "Fill Max" overlay fills max affordable into qty. Confirm: clone the native "Yes" INSIDE the confirmButtons row (next to Torn’s Yes), forwarding click to the native handler. No confirm bypass—just UI helpers.
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
    /* Fill Max overlay (unchanged) */
    .im-fill-overlay{
      position:absolute; display:flex; align-items:center; justify-content:center;
      cursor:pointer; font-size:11px; font-weight:600;
      z-index:9; background:rgba(22,163,74,.12); color:#16a34a;
      border-left:1px solid #16a34a; border-radius:0 8px 8px 0;
      user-select:none;
    }
    .im-fill-overlay:hover{ background:rgba(22,163,74,.20) }
    .im-fill-overlay.im-done{ z-index:-1; pointer-events:none; background:transparent; border-color:transparent }
    .im-flash{ box-shadow:0 0 0 3px rgba(0,160,255,.55)!important; transition:box-shadow .25s ease }

    /* Inline YES clone inside confirmButtons */
    .im-yes-clone-inline{
      margin-left: 8px !important;
      padding: 6px 10px !important;
      border-radius: 6px !important;
      border: 1px solid var(--tt-color-green, #16a34a) !important;
      background: rgba(22,163,74,.12) !important;
      color: #16a34a !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      z-index: 2147483646 !important;
    }
    .im-yes-clone-inline:hover{ background: rgba(22,163,74,.20) !important; }
  `);

  // ---------- Selectors & utils ----------
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
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const parseMoney = (s)=>{ s=String(s||'').replace(/[^\d.]/g,''); return s?Math.floor(Number(s)):NaN; };
  const toInt = (s)=>{ const m=String(s||'').match(/\d[\d,]*/); return m?Number(m[0].replace(/[^\d]/g,'')):NaN; };

  // ---------- Fill Max (unchanged) ----------
  function getRows(){
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)).filter(r=>r.offsetParent!==null);
  }
  function findNativeBuyButton(row){
    const li=row.closest(SEL.rowWrapper) || row.closest('li') || document.body;
    const btns=Array.from(li.querySelectorAll(SEL.buyButtons)).filter(b=>{
      const t=(b.textContent||'').trim().toLowerCase();
      if (!t) return false;
      if (/show\s*buy/i.test(t)) return false;
      return /buy|confirm|purchase/.test(t);
    });
    const visible=btns.find(b=>b.getBoundingClientRect().width>0 && b.getBoundingClientRect().height>0);
    return visible || btns[0] || null;
  }
  async function ensureControlsOpen(row){
    const show=row.querySelector(SEL.showBtn);
    if (show) show.click();
    for (let i=0;i<20;i++){ await sleep(20); if (findAmountInputForRow(row)) break; }
  }
  function findAmountInputForRow(row){
    const li=row.closest(SEL.rowWrapper) || row.closest('li') || document.body;
    const cands=Array.from(li.querySelectorAll(SEL.amountInputs)).filter(inp=>{
      if (!(inp instanceof HTMLInputElement)) return false;
      if (inp.type==='checkbox'||inp.type==='hidden'||inp.disabled) return false;
      const r=inp.getBoundingClientRect(); return r.width>0 && r.height>0;
    });
    return cands[0] || null;
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
  function flash(el){ if(!el) return; el.classList.add('im-flash'); setTimeout(()=>el.classList.remove('im-flash'),280); }

  function positionOverlay(overlay, nativeBtn){
    const parent=overlay.parentElement; if (!parent) return;
    const pr=parent.getBoundingClientRect(), br=nativeBtn.getBoundingClientRect();
    const ow=Math.max(24, Math.round(br.width*0.25));
    overlay.style.top=`${br.top-pr.top}px`;
    overlay.style.left=`${br.left-pr.left + (br.width-ow)}px`;
    overlay.style.width=`${ow}px`;
    overlay.style.height=`${br.height}px`;
    overlay.style.borderRadius='0 8px 8px 0';
  }
  function placeRowOverlay(row){
    const native=findNativeBuyButton(row);
    if (!native) return;
    const container=native.parentElement || row;
    if (getComputedStyle(container).position==='static') container.style.position='relative';
    if (container.querySelector(':scope > .im-fill-overlay')) return;

    const overlay=document.createElement('div');
    overlay.className='im-fill-overlay';
    overlay.textContent='Fill Max';
    positionOverlay(overlay, native);

    const ro=new ResizeObserver(()=>positionOverlay(overlay, native));
    ro.observe(container); ro.observe(native);
    window.addEventListener('scroll', ()=>positionOverlay(overlay, native), {passive:true});

    overlay.addEventListener('mousedown',(e)=>{ e.preventDefault(); e.stopPropagation(); }, {capture:true});
    overlay.addEventListener('click', async (e)=>{
      e.preventDefault(); e.stopPropagation();
      const unit=parseMoney(row.querySelector(SEL.price)?.textContent);
      const qty=toInt(row.querySelector(SEL.qtyCell)?.textContent);
      const wallet=getWalletFromHeader();
      const afford=computeAfford(wallet, unit, qty);

      await ensureControlsOpen(row);
      const input=findAmountInputForRow(row);
      if (input){
        setInputValue(input, afford>0?afford:'');
        if (afford<=0) input.placeholder='Insufficient funds';
        flash(input);
      }
      overlay.classList.add('im-done');
    }, {capture:true});

    container.appendChild(overlay);
  }
  function refreshRows(){
    for (const row of getRows()) placeRowOverlay(row);
  }

  // ---------- Confirm dialog: inline clone of native "Yes" ----------
  function findDialog(){
    const list = document.querySelectorAll(
      // same family as your screenshot: confirmWrapper / confirmButtons live under here
      '[role="dialog"], [class*="modal"], [class*="Dialog"], [class*="dialog"], .confirmWrapper, .ui-dialog, .popup'
    );
    const vis = Array.from(list).filter(el=>{
      const r=el.getBoundingClientRect(); return r.width>0 && r.height>0;
    });
    return vis.pop() || null; // last visible (matches your working build)
  }

  function findNativeYes(dialog){
    const btns = dialog.querySelectorAll('button, a, [role="button"]');
    for (const b of btns){
      const t=(b.textContent||'').trim().toLowerCase();
      if (/(^|\b)(yes|confirm|buy|purchase|ok|proceed)(\b|!|\.|,)/.test(t)) return b;
    }
    // class hint from your inspector (e.g., confirmButton__…)
    return dialog.querySelector('button[class*="confirmButton"]');
  }

  function findButtonsContainer(dialog){
    // prefer the explicit confirm buttons container if present
    return dialog.querySelector('[class*="confirmButtons"]') || dialog;
  }

  function makeYesInline(dialog){
    if (!dialog || dialog.querySelector('.im-yes-clone-inline')) return;

    const nativeYes = findNativeYes(dialog);
    if (!nativeYes) return; // wait until native mounts

    // clone a clean button (don’t copy listeners)
    const cloned = document.createElement('button');
    cloned.type = 'button';
    cloned.className = 'im-yes-clone-inline';
    cloned.textContent = (nativeYes.textContent || 'Yes').trim();

    cloned.addEventListener('click', (e)=>{
      e.preventDefault(); e.stopPropagation();
      nativeYes.click(); // forward to Torn’s handler
    }, {capture:true});

    // append inside the same button row, after the native Yes
    const container = findButtonsContainer(dialog);
    if (nativeYes.nextSibling) nativeYes.parentNode.insertBefore(cloned, nativeYes.nextSibling);
    else container.appendChild(cloned);
  }

  // Observe for dialog mounts & build inline Yes
  const dialogMO = new MutationObserver(()=>{
    const dlg = findDialog();
    if (!dlg) return;
    let tries = 0;
    const iv = setInterval(()=>{
      tries++;
      makeYesInline(dlg);
      if (dlg.querySelector('.im-yes-clone-inline') || tries > 40) clearInterval(iv);
    }, 50);
  });
  dialogMO.observe(document.documentElement, {childList:true, subtree:true});

  // Safety sweep: if a dialog is already open
  setInterval(()=>{ const dlg=findDialog(); if (dlg) makeYesInline(dlg); }, 300);

  // ---------- Bootstrap ----------
  const docMO=new MutationObserver(()=>{
    if (docMO._raf) cancelAnimationFrame(docMO._raf);
    docMO._raf=requestAnimationFrame(()=>setTimeout(refreshRows,30));
  });
  docMO.observe(document.documentElement,{childList:true,subtree:true});

  setTimeout(refreshRows,200);
  setTimeout(refreshRows,800);
  setInterval(refreshRows,2000);
})();
