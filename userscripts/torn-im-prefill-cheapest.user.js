// ==UserScript==
// @name         Torn Item Market — Prefill (Dialog MADE Yes adjusted right)
// @namespace    https://torn.city/
// @version      2.9.3
// @description  Adds a NEW “Yes” button in Torn’s confirm dialog (top-right, just left of the X). Clicking it forwards to the native Yes. Also keeps the row Fill Max overlay on Buy (25% right overlay). No confirm bypass, only UI sugar. Adjusted Yes button to sit ~20% further right.
// @author       Baz
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @downloadURL  https://raw.githubusercontent.com/BazookaJoe58/Torn-scripts/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://raw.githubusercontent.com/BazookaJoe58/Torn-scripts/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
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
  `);

  function findDialog(){
    const list = document.querySelectorAll(
      '[role="dialog"], [class*="modal"], [class*="Dialog"], [class*="dialog"], .confirmWrapper, .ui-dialog, .popup'
    );
    return Array.from(list).find(el=>{
      const r=el.getBoundingClientRect(); return r.width>0 && r.height>0;
    }) || null;
  }
  function findCloseX(dialog){
    return dialog.querySelector('button[aria-label="Close"], [class*="close"], .close, .ui-dialog-titlebar-close, [data-role="close"]');
  }
  function findNativeYes(dialog){
    const btns = dialog.querySelectorAll('button, a, [role="button"]');
    for (const b of btns){
      const t=(b.textContent||'').trim().toLowerCase();
      if (/(^|\b)(yes|confirm|buy|purchase|ok|proceed)(\b|!|\.|,)/.test(t)) return b;
    }
    return dialog.querySelector('button[class*="confirmButton"]') || null;
  }

  function makeYesTopRight(dialog){
    if (!dialog || dialog.querySelector('.im-yes-made')) return;
    const yes=findNativeYes(dialog);
    if (!yes) return;

    if (getComputedStyle(dialog).position==='static') dialog.style.position='relative';

    const made=document.createElement('button');
    made.type='button';
    made.className='im-yes-made';
    made.textContent=(yes.textContent||'Yes').trim();

    const posIt=()=>{
      const pr = dialog.getBoundingClientRect();
      const xBtn = findCloseX(dialog);
      const xr  = xBtn ? xBtn.getBoundingClientRect() : {left: pr.right - 12, width: 12};
      const width = Math.max(70, yes.getBoundingClientRect().width);
      made.style.width = `${width}px`;
      made.style.height = `${yes.getBoundingClientRect().height}px`;

      const topPad = 8, gap = 8;
      made.style.top = `${topPad}px`;

      // normal offset
      let rightPx = Math.max(8, (pr.right - xr.left) + gap);

      // shift it 20% of its width further right
      rightPx -= Math.floor(width * 0.2);

      made.style.right = `${rightPx}px`;
    };

    made.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); yes.click(); }, {capture:true});
    dialog.appendChild(made);

    posIt();
    const ro=new ResizeObserver(()=>posIt());
    ro.observe(dialog);
    window.addEventListener('scroll', ()=>posIt(), {passive:true});
  }

  const dialogMO = new MutationObserver(()=>{
    const dlg = findDialog();
    if (dlg){
      let tries=0;
      const iv=setInterval(()=>{
        tries++;
        makeYesTopRight(dlg);
        if (dlg.querySelector('.im-yes-made')||tries>40) clearInterval(iv);
      },50);
    }
  });
  dialogMO.observe(document.documentElement,{childList:true,subtree:true});
  setInterval(()=>{ const dlg=findDialog(); if (dlg) makeYesTopRight(dlg); }, 300);
})();
