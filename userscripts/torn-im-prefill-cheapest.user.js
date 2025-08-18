// ==UserScript==
// @name         Torn Item Market — Prefill (Row Fill Max + Dialog Yes Clone)
// @namespace    https://torn.city/
// @version      2.9.4
// @description  Row: rightmost 25% "Fill Max" overlay that fills max affordable into the qty input. Dialog: adds a NEW "Yes" (top-right, left of the close X) that forwards to the native Yes. No confirm bypass; only UI helpers.
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
    /* Row overlay: rightmost 25% of the native Buy */
    .im-fill-overlay{
      position:absolute; display:flex; align-items:center; justify-content:center;
      cursor:pointer; font-size:11px; font-weight:600;
      z-index:9999; background:rgba(22,163,74,.12); color:#16a34a;
      border-left:1px solid #16a34a; border-radius:0 8px 8px 0;
      pointer-events:auto; user-select:none; -webkit-user-select:none;
    }
    .im-fill-overlay:hover{ background:rgba(22,163,74,.20) }
    .im-fill-overlay.im-done{ z-index:-1; pointer-events:none; background:transparent; border-color:transparent }
    .im-flash{ box-shadow:0 0 0 3px rgba(0,160,255,.55)!important; transition:box-shadow .25s ease }

    /* NEW top-right Yes button inside confirm dialog */
    .im-yes-made {
      position:absolute !important;
      z-index:2147483646 !important;
      padding:6px 10px !important;
      border-radius:6px !important;
      border:1px solid #16a34a !important;
      background:rgba(22,163,74,.12) !important;
      color:#16a34a !important;
      font-weight:600 !important;
      cursor:pointer !important;
      user-select:none !important;
      display:flex; align-items:center; justify-content:center;
      line-height:1 !important;
    }
    .im-yes-made:hover{ background:rgba(22,163,74,.20) !important; }
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
  const inViewport = (el)=>{ const r=el.getBoundingClientRect(); return r.width>0 && r.height>0; };
  const flash = (el)=>{ el && el.classList.add('im-flash'); setTimeout(()=>el && el.classList.remove('im-flash'), 280); };

  function getRows(){
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)).filter(inViewport);
  }
  function findNativeBuyButton(row){
    const li=row.closest(SEL.rowWrapper) || row.closest('li') || document.body;
    const btns=Array.from(li.querySelectorAll(SEL.buyButtons)).filter(b=>{
      const t=(b.textContent||'').trim().toLowerCase();
      if (!t) return false;
      if (/show\s*buy/i.test(t)) return false; // skip expand toggle
      return /buy|confirm|purchase/.test(t);
    });
    const visible=btns.find(inViewport);
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
    // Prefer header roots; return the first reasonable $… value
    const scopes = [
      document.querySelector('#topRoot'),
      document.querySelector('#headerRoot'),
      document.querySelector('header'),
      document.body
    ].filter(Boolean);
    for (const root of scopes){
      for (const n of root.querySelectorAll('span,div,a,li,b,strong')){
        const t=(n.textContent||'').trim();
        if (!t) continue;
        if (!/\$\s?[\d,. ]+/.test(t)) continue;
        if (t.length > 20) continue; // avoid huge listing strings
        const v=parseMoney(t);
        if (Number.isFinite(v) && v>=0) return v;
      }
    }
    return NaN;
  }
  function computeAfford(wallet, unitPrice, qty){
    if (!Number.isFinite(qty) || qty<=0) qty=Infinity; // be lenient
    if (!Number.isFinite(wallet)||wallet<=0) return 0;
    if (!Number.isFinite(unitPrice)||unitPrice<=0) return 0;
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

  // ---------- Row overlay (Fill Max) ----------
  function positionOverlay(overlay, nativeBtn){
    const parent=overlay.parentElement; if (!parent) return;
    const pr=parent.getBoundingClientRect(), br=nativeBtn.getBoundingClientRect();
    const ow=Math.max(24, Math.round(br.width*0.25));
    overlay.style.top  = `${br.top-pr.top}px`;
    overlay.style.left = `${br.left-pr.left + (br.width-ow)}px`;
    overlay.style.width= `${ow}px`;
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
      const qty =toInt(row.querySelector(SEL.qtyCell)?.textContent);
      const wallet=getWalletFromHeader();
      const afford=computeAfford(wallet, unit, qty);

      await ensureControlsOpen(row);
      const input=findAmountInputForRow(row);
      if (!input) return;

      if (afford>0){
        setInputValue(input, afford);
        flash(input);
      } else {
        input.placeholder='Insufficient funds';
        flash(input);
      }

      overlay.classList.add('im-done'); // drop behind; native Buy remains clickable
    }, {capture:true});

    container.appendChild(overlay);
  }
  function refreshRows(){
    for (const row of getRows()) placeRowOverlay(row);
  }

  // ---------- Confirm dialog (clone Yes, top-right) ----------
  function findDialog(){
    const qs = [
      '[role="dialog"][aria-modal="true"]',
      '[role="dialog"]',
      '[class*="modal"]',
      '[class*="Dialog"]',
      '[class*="dialog"]',
      '.confirmWrapper',
      '.ui-dialog',
      '.popup',
      '[data-testid*="confirm"]',
      '[data-test*="confirm"]'
    ].join(',');
    const all = document.querySelectorAll(qs);
    let best=null, area=0;
    for (const el of all){
      const r=el.getBoundingClientRect();
      if (r.width>0 && r.height>0){
        const a=r.width*r.height;
        if (a>area){ best=el; area=a; }
      }
    }
    return best;
  }
  function findCloseX(dialog){
    return dialog.querySelector('button[aria-label="Close"], [class*="close"], .close, .ui-dialog-titlebar-close, [data-role="close"], [data-testid*="close"]');
  }
  function findNativeYes(dialog){
    if (!dialog) return null;
    const btns = dialog.querySelectorAll('button, a, [role="button"]');
    for (const b of btns){
      const t=(b.textContent||'').trim().toLowerCase();
      if (/(^|\b)(yes|confirm|buy|purchase|ok|proceed)(\b|!|\.|,)/.test(t)) return b;
    }
    // Common class names Torn uses for the confirm/yes action
    return dialog.querySelector('button[class*="confirm"], a[class*="confirm"], button[class*="primary"]');
  }
  function makeYesTopRight(dialog){
    if (!dialog || dialog.querySelector('.im-yes-made')) return;

    const yes=findNativeYes(dialog);
    if (!yes) return;

    const cs=getComputedStyle(dialog);
    if (cs.position==='static') dialog.style.position='relative';

    const made=document.createElement('button');
    made.type='button';
    made.className='im-yes-made';
    made.textContent=(yes.textContent||'Yes').trim();

    const posIt = () => {
      const pr = dialog.getBoundingClientRect();
      const xBtn = findCloseX(dialog);
      const xr  = xBtn ? xBtn.getBoundingClientRect() : {left: pr.right - 12, width: 12};
      const gap = 8;

      const baseW = (findNativeYes(dialog)?.getBoundingClientRect().width) || 90;
      const baseH = (findNativeYes(dialog)?.getBoundingClientRect().height) || 28;

      made.style.width  = `${Math.max(70, baseW)}px`;
      made.style.height = `${Math.max(28, baseH)}px`;
      made.style.top    = `8px`;
      // same baseline as your confirmed-working build (no extra nudge)
      made.style.right  = `${Math.max(8, (pr.right - xr.left) + gap)}px`;
    };

    made.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); findNativeYes(dialog)?.click(); }, {capture:true});
    dialog.appendChild(made);

    posIt();
    const ro=new ResizeObserver(posIt);
    ro.observe(dialog);
    window.addEventListener('scroll', posIt, {passive:true});
  }

  // Build Yes clone when dialog appears (like your original, with retries)
  const dialogMO = new MutationObserver(()=>{
    const dlg = findDialog();
    if (dlg){
      let tries = 0;
      const iv = setInterval(()=>{
        tries++;
        makeYesTopRight(dlg);
        if (dlg.querySelector('.im-yes-made') || tries>40) clearInterval(iv);
      }, 50);
    }
  });
  dialogMO.observe(document.documentElement, {childList:true, subtree:true});

  // Also: hook Buy/Confirm clicks; try up to ~5s to catch slower renders
  document.addEventListener('click', (ev)=>{
    const t = ev.target;
    if (!t) return;
    const txt = (t.textContent || '').toLowerCase();
    if (!/(^|\b)(buy|purchase|confirm)(\b|!|\.|,)/.test(txt)) return;

    let tries = 0;
    const iv = setInterval(()=>{
      tries++;
      const dlg = findDialog();
      if (dlg){
        makeYesTopRight(dlg);
        if (dlg.querySelector('.im-yes-made')) clearInterval(iv);
      }
      if (tries > 100) clearInterval(iv); // ~5s
    }, 50);
  }, true);

  // Safety sweep
  setInterval(()=>{ const dlg=findDialog(); if (dlg) makeYesTopRight(dlg); }, 300);

  // ---------- Bootstrap rows ----------
  const docMO=new MutationObserver(()=>{
    if (docMO._raf) cancelAnimationFrame(docMO._raf);
    docMO._raf=requestAnimationFrame(()=>setTimeout(refreshRows,30));
  });
  docMO.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(refreshRows,200);
  setTimeout(refreshRows,800);
  setInterval(refreshRows,2000);
})();
