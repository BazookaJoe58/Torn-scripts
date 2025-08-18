// ==UserScript==
// @name         Torn Item Market — Prefill (Fill Max + Dialog Yes Clone w/ Visual Debug)
// @namespace    https://torn.city/
// @version      2.9.8
// @description  Row: right-25% "Fill Max" overlay. Confirm dialog: clone Yes inside same dialog; highlight dialog & native Yes for debugging; fallback floating YES if hidden. Toggle outlines: Alt+Y. No confirm bypass—just UI helpers.
// @author       Baz
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SHOW_OUTLINES_DEFAULT = false; // press Alt+Y to toggle live

  GM_addStyle(`
    /* Fill Max overlay */
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

    /* In-dialog clone Yes */
    .im-yes-made{
      position:absolute !important;
      z-index:2147483646 !important;
      padding:6px 10px !important;
      border-radius:6px !important;
      border:1px solid var(--tt-color-green, #16a34a) !important;
      background:rgba(22,163,74,.12) !important;
      color:#16a34a !important; font-weight:600 !important; cursor:pointer !important;
      display:flex; align-items:center; justify-content:center; line-height:1 !important;
    }
    .im-yes-made:hover{ background:rgba(22,163,74,.20) !important; }

    /* Fallback floating YES */
    .im-yes-fb{
      position: fixed; right: 24px; bottom: 18%;
      z-index: 2147483647; padding: 10px 14px; border-radius: 10px;
      border: 2px solid var(--tt-color-green, #16a34a);
      background: rgba(22,163,74,.12); color: #16a34a; font-weight: 800; letter-spacing: .3px;
      box-shadow: 0 8px 30px rgba(0,0,0,.35); cursor: pointer; user-select: none;
    }
    .im-yes-fb.hidden{ display:none!important; }
    .im-yes-fb:hover{ background: rgba(22,163,74,.20); }

    /* Debug outlines */
    .im-outline-dialog{
      outline: 2px dashed #ff6; outline-offset: 2px; position: relative;
    }
    .im-outline-yes{
      box-shadow: 0 0 0 3px rgba(50,200,255,.7) !important;
      position: relative;
    }
  `);

  // ---------- helpers ----------
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
  const parseMoney = s => { s=String(s||'').replace(/[^\d.]/g,''); return s?Math.floor(Number(s)):NaN; };
  const toInt = s => { const m=String(s||'').match(/\d[\d,]*/); return m?Number(m[0].replace(/[^\d]/g,'')):NaN; };
  const safe = fn => (...a)=>{ try{ return fn(...a); }catch{} };

  // ---------- Fill Max ----------
  function getRows(){
    const list=document.querySelector(SEL.list); if (!list) return [];
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)).filter(r=>r.offsetParent);
  }
  function findNativeBuyButton(row){
    const li=row.closest(SEL.rowWrapper)||row.closest('li')||document.body;
    const btns=Array.from(li.querySelectorAll(SEL.buyButtons)).filter(b=>{
      const t=(b.textContent||'').trim().toLowerCase();
      if (!t) return false;
      if (/show\s*buy/i.test(t)) return false;
      return /(buy|confirm|purchase)/.test(t);
    });
    const vis=btns.find(b=>b.offsetParent);
    return vis||btns[0]||null;
  }
  async function ensureControlsOpen(row){
    const show=row.querySelector(SEL.showBtn); if (show) show.click();
    for (let i=0;i<20;i++){ await sleep(20); if (findAmountInputForRow(row)) break; }
  }
  function findAmountInputForRow(row){
    const li=row.closest(SEL.rowWrapper)||row.closest('li')||document.body;
    const cands=Array.from(li.querySelectorAll(SEL.amountInputs)).filter(inp=>{
      if (!(inp instanceof HTMLInputElement)) return false;
      if (inp.type==='checkbox'||inp.type==='hidden'||inp.disabled) return false;
      const r=inp.getBoundingClientRect(); return r.width>0 && r.height>0;
    });
    return cands[0]||null;
  }
  function getWalletFromHeader(){
    const root=document.querySelector('#topRoot')||document.body;
    for (const n of root.querySelectorAll('span,div,a,li,b,strong')){
      const t=n.textContent||'';
      if (/\$\s?[\d,. ]+/.test(t)){ const v=parseMoney(t); if (Number.isFinite(v)) return v; }
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
    const native=findNativeBuyButton(row); if (!native) return;
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
        input.classList.add('im-flash'); setTimeout(()=>input.classList.remove('im-flash'),280);
      }
      overlay.classList.add('im-done');
    }), {capture:true});

    container.appendChild(overlay);
  });
  const refreshRows = safe(()=>{ for (const r of getRows()) placeRowOverlay(r); });

  // ---------- Confirm dialog ----------
  let outlinesOn = SHOW_OUTLINES_DEFAULT;

  function findDialogsAll(){
    const qs = [
      '[role="dialog"]',
      '[class*="modal"]', '[class*="Dialog"]', '[class*="dialog"]',
      '.confirmWrapper', '.ui-dialog', '.popup'
    ].join(',');
    const arr = Array.from(document.querySelectorAll(qs)).filter(el=>{
      const r=el.getBoundingClientRect(); return r.width>0 && r.height>0;
    });
    // prefer the largest visible (usually the active confirm)
    arr.sort((a,b)=> (b.getBoundingClientRect().width*b.getBoundingClientRect().height) - (a.getBoundingClientRect().width*a.getBoundingClientRect().height));
    return arr;
  }
  function findDialog(){ return findDialogsAll()[0] || null; }

  function clearDialogOutlines(){
    document.querySelectorAll('.im-outline-dialog').forEach(el=>el.classList.remove('im-outline-dialog'));
    document.querySelectorAll('.im-outline-yes').forEach(el=>el.classList.remove('im-outline-yes'));
  }

  function findNativeYes(dialog){
    const scope = dialog || document;
    const labels = /(^(yes|confirm|buy|purchase|ok|proceed|agree)\b)|(\b(confirm purchase|confirm order|buy now)\b)/i;
    const btns = Array.from(scope.querySelectorAll('button, a, [role="button"]'));
    let found = btns.find(b=>labels.test((b.textContent||'').trim()));
    // class-based fallback
    if (!found) found = scope.querySelector('button[class*="confirm"], a[class*="confirm"], button[class*="primary"]');
    return found || null;
  }

  function ensureFallback(){
    let fb = document.querySelector('.im-yes-fb');
    if (!fb){
      fb = document.createElement('button');
      fb.className = 'im-yes-fb hidden';
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

  const makeYesTopRight = safe(function(dialog){
    if (!dialog || dialog.querySelector('.im-yes-made')) return;

    const yes = findNativeYes(dialog);
    if (!yes) return; // we’ll rely on fallback until native Yes mounts

    // ensure positioned container
    const cs = getComputedStyle(dialog);
    if (cs.position==='static') dialog.style.position='relative';

    const made = document.createElement('button');
    made.type = 'button';
    made.className = 'im-yes-made';
    made.textContent = (yes.textContent || 'Yes').trim();

    // position: top-right, just left of "X"
    const pr = dialog.getBoundingClientRect();
    const xBtn = dialog.querySelector('button[aria-label="Close"], [class*="close"], .close, .ui-dialog-titlebar-close, [data-role="close"]');
    const xr  = xBtn ? xBtn.getBoundingClientRect() : {left: pr.right - 12, width: 12};
    const gap = 8, topPad = 8;
    const baseW = Math.max(70, yes.getBoundingClientRect().width || 90);
    const baseH = Math.max(28, yes.getBoundingClientRect().height || 28);

    made.style.top = `${topPad}px`;
    made.style.right = `${Math.max(8, (pr.right - xr.left) + gap)}px`;
    made.style.width = `${baseW}px`;
    made.style.height = `${baseH}px`;

    made.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); yes.click(); }, {capture:true});
    dialog.appendChild(made);
  });

  function sweepDialog(){
    const dlg = findDialog();
    const fb  = ensureFallback();

    clearDialogOutlines();
    if (!dlg){
      fb.classList.add('hidden');
      return;
    }

    // visual outline (toggle Alt+Y)
    if (outlinesOn) dlg.classList.add('im-outline-dialog');

    // try to build in-dialog clone
    makeYesTopRight(dlg);

    // highlight native yes if present
    const nativeYes = findNativeYes(dlg);
    if (nativeYes && outlinesOn) nativeYes.classList.add('im-outline-yes');

    // show fallback while a dialog is visible; hide when closed
    if (nativeYes) fb.classList.remove('hidden');
    else fb.classList.remove('hidden'); // still show; it will click whatever primary appears
  }

  // Alt+Y toggles outlines
  window.addEventListener('keydown', (e)=>{
    if (e.altKey && e.code === 'KeyY'){
      outlinesOn = !outlinesOn;
      sweepDialog();
    }
  });

  // ---------- observers ----------
  const rowsMO = new MutationObserver(()=>refreshRows());
  rowsMO.observe(document.documentElement, {childList:true, subtree:true});

  const dialogMO = new MutationObserver(()=>sweepDialog());
  dialogMO.observe(document.documentElement, {childList:true, subtree:true});

  // also hook Buy/Confirm clicks to retry for a bit while dialog mounts
  document.addEventListener('click', (ev)=>{
    const t = ev.target;
    if (!t) return;
    const txt = (t.textContent || '').toLowerCase();
    if (!/(^|\b)(buy|purchase|confirm)(\b|!|\.|,)/.test(txt)) return;

    let tries = 0;
    const iv = setInterval(()=>{
      tries++;
      sweepDialog();
      const dlg = findDialog();
      if ((dlg && dlg.querySelector('.im-yes-made')) || tries>60) clearInterval(iv);
    }, 50);
  }, true);

  // ---------- bootstrap ----------
  setTimeout(refreshRows, 200);
  setTimeout(refreshRows, 800);
  setInterval(refreshRows, 2000);
  setInterval(sweepDialog, 400);
})();
