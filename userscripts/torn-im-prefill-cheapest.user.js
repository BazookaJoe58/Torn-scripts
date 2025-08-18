// ==UserScript==
// @name         Torn Item Market — Prefill (Fill Max + Dialog Yes Clone w/ Fallback)
// @namespace    https://torn.city/
// @version      2.9.7
// @description  Row: rightmost 25% "Fill Max" overlay that fills max affordable into the qty input. Dialog: clone Yes in the dialog top-right; ALSO show a viewport-fixed YES fallback (bottom-right) so it's always reachable. No confirm bypass; only UI helpers.
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
    /* Fill Max overlay (rightmost 25% of native Buy) */
    .im-fill-overlay{
      position:absolute; display:flex; align-items:center; justify-content:center;
      cursor:pointer; font-size:11px; font-weight:600;
      z-index:9; background:rgba(22,163,74,.12); color:#16a34a;
      border-left:1px solid #16a34a; border-radius:0 8px 8px 0;
      pointer-events:auto; user-select:none; -webkit-user-select:none;
    }
    .im-fill-overlay:hover{ background:rgba(22,163,74,.20) }
    .im-fill-overlay.im-done{ z-index:-1; pointer-events:none; background:transparent; border-color:transparent }
    .im-flash{ box-shadow:0 0 0 3px rgba(0,160,255,.55)!important; transition:box-shadow .25s ease }

    /* In-dialog Yes clone (top-right, left of X) */
    .im-yes-made {
      position:absolute !important;
      z-index:2147483646 !important;
      padding:6px 10px !important;
      border-radius:6px !important;
      border:1px solid var(--tt-color-green, #16a34a) !important;
      background:rgba(22,163,74,.12) !important;
      color:#16a34a !important;
      font-weight:600 !important;
      cursor:pointer !important;
      user-select:none !important;
      display:flex; align-items:center; justify-content:center;
      line-height:1 !important;
    }
    .im-yes-made:hover{ background:rgba(22,163,74,.20) !important; }

    /* Viewport-fixed fallback YES (always visible) */
    .im-yes-fallback {
      position: fixed !important;
      right: 24px; bottom: 18%;
      z-index: 2147483647 !important;
      padding: 10px 14px;
      border-radius: 10px;
      border: 2px solid var(--tt-color-green, #16a34a);
      background: rgba(22,163,74,.12);
      color: #16a34a; font-weight: 800; letter-spacing: .3px;
      box-shadow: 0 8px 30px rgba(0,0,0,.35);
      cursor: pointer; user-select: none;
    }
    .im-yes-fallback:hover{ background: rgba(22,163,74,.20); }
    .im-yes-fallback.hidden{ display:none !important; }
  `);

  // ---------- Utils ----------
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
  const flash = (el)=>{ if(!el) return; el.classList.add('im-flash'); setTimeout(()=>el.classList.remove('im-flash'),280); };
  const safe = (fn)=>(...a)=>{ try { return fn(...a); } catch(e){ /* swallow */ } };

  // ---------- Row helpers ----------
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

  // ---------- Fill Max overlay ----------
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
  const placeRowOverlay = safe(function(row){
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
    overlay.addEventListener('click', safe(async (e)=>{
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
    }), {capture:true});

    container.appendChild(overlay);
  });
  const refreshRows = safe(function(){
    for (const row of getRows()) placeRowOverlay(row);
  });

  // ---------- Confirm dialog Yes clone + fallback ----------
  function findDialog(){
    const list = document.querySelectorAll(
      '[role="dialog"], [class*="modal"], [class*="Dialog"], [class*="dialog"], .confirmWrapper, .ui-dialog, .popup'
    );
    const vis = Array.from(list).filter(el=>{
      const r=el.getBoundingClientRect(); return r.width>0 && r.height>0;
    });
    return vis.pop() || null;
  }
  function findCloseX(dialog){
    return dialog?.querySelector('button[aria-label="Close"], [class*="close"], .close, .ui-dialog-titlebar-close, [data-role="close"]');
  }
  function findNativeYes(dialog){
    const scope = dialog || document;
    const btns = scope.querySelectorAll('button, a, [role="button"]');
    for (const b of btns){
      const t=(b.textContent||'').trim().toLowerCase();
      if (/(^|\b)(yes|confirm|buy|purchase|ok|proceed|agree)(\b|!|\.|,)/.test(t)) return b;
    }
    return scope.querySelector('button[class*="confirm"], a[class*="confirm"], button[class*="primary"]');
  }

  // In-dialog clone (top-right)
  const makeYesTopRight = safe(function(dialog){
    if (!dialog || dialog.querySelector('.im-yes-made')) return;
    const yes=findNativeYes(dialog); if (!yes) return;

    const cs=getComputedStyle(dialog);
    if (cs.position==='static') dialog.style.position='relative';

    const made=document.createElement('button');
    made.type='button';
    made.className='im-yes-made';
    made.textContent=(yes.textContent||'Yes').trim();

    const pr = dialog.getBoundingClientRect();
    const xBtn = findCloseX(dialog);
    const xr  = xBtn ? xBtn.getBoundingClientRect() : {left: pr.right - 12, width: 12};
    const topPad = 8, gap = 8, width = Math.max(70, yes.getBoundingClientRect().width||90);

    made.style.top = `${topPad}px`;
    made.style.right = `${Math.max(8, (pr.right - xr.left) + gap)}px`;
    made.style.width = `${width}px`;
    const yh = yes.getBoundingClientRect().height;
    if (yh>0) made.style.height = `${yh}px`;

    made.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); yes.click(); }, {capture:true});
    dialog.appendChild(made);
  });

  // Viewport-fixed fallback button (always visible)
  function ensureFallbackYes(){
    let fb = document.querySelector('.im-yes-fallback');
    if (!fb){
      fb = document.createElement('button');
      fb.className = 'im-yes-fallback hidden';
      fb.textContent = 'YES';
      fb.addEventListener('click', (e)=>{
        e.preventDefault(); e.stopPropagation();
        const dlg = findDialog();
        const yes = findNativeYes(dlg || document);
        if (yes) yes.click();
      }, {capture:true});
      document.body.appendChild(fb);
    }
    return fb;
  }
  function showFallbackIfNeeded(){
    const dlg = findDialog();
    const yes = findNativeYes(dlg || document);
    const fb = ensureFallbackYes();

    // If a dialog is visible AND we can find a native Yes, show fallback to guarantee access.
    if (dlg && yes){
      fb.classList.remove('hidden');
    } else {
      fb.classList.add('hidden');
    }
  }

  // ---------- Observers ----------
  const rowsMO = new MutationObserver(()=>refreshRows());
  rowsMO.observe(document.documentElement, {childList:true, subtree:true});

  const dialogMO = new MutationObserver(()=>{
    const dlg = findDialog();
    if (dlg) makeYesTopRight(dlg);
    showFallbackIfNeeded();
  });
  dialogMO.observe(document.documentElement, {childList:true, subtree:true});

  // Also hook Buy/Confirm clicks — poll a moment while dialog mounts
  document.addEventListener('click', (ev)=>{
    const t = ev.target;
    if (!t) return;
    const txt = (t.textContent || '').toLowerCase();
    if (!/(^|\b)(buy|purchase|confirm)(\b|!|\.|,)/.test(txt)) return;

    let tries = 0;
    const iv = setInterval(()=>{
      tries++;
      const dlg = findDialog();
      if (dlg) makeYesTopRight(dlg);
      showFallbackIfNeeded();
      if ((dlg && dlg.querySelector('.im-yes-made')) || tries>60) clearInterval(iv);
    }, 50);
  }, true);

  // ---------- Bootstrap ----------
  setTimeout(refreshRows,200);
  setTimeout(refreshRows,800);
  setInterval(refreshRows,2000);
  setInterval(()=>{ const dlg=findDialog(); if (dlg) makeYesTopRight(dlg); showFallbackIfNeeded(); }, 400);
})();
