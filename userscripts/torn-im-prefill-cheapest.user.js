// ==UserScript==
// @name         Torn Item Market — Prefill (Row Fill Max + Dialog Yes Clone) + Debug
// @namespace    https://torn.city/
// @version      2.9.5
// @description  Row: rightmost 25% "Fill Max" overlay that fills max affordable into the qty input. Dialog: adds a NEW "Yes" (top-right, left of the close X) that forwards to the native Yes. Includes rich debugging UI/logs to troubleshoot DOM/parse timing. (Alt+D toggle debug panel)
// @author       Baz
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = true; // flip to false later

  // --- debug panel ---
  const IMDBG = {
    panel:null, lines:[],
    log(...a){ if(!DEBUG) return; console.log('IMDBG:',...a); this.push(a.join(' ')); },
    push(msg){ if(!DEBUG) return; this.lines.push(msg); if(this.lines.length>12) this.lines.shift(); this.render(); },
    render(){ if(!DEBUG) return; if(!this.panel){ 
      this.panel=document.createElement('div'); this.panel.id='imdbg-panel';
      this.panel.innerHTML='<b>IMDBG</b><pre></pre>'; 
      Object.assign(this.panel.style,{position:'fixed',left:'6px',bottom:'6px',background:'rgba(0,0,0,.7)',color:'#0f0',font:'11px monospace',padding:'6px',border:'1px solid #333',zIndex:999999});
      document.body.appendChild(this.panel);
    }
      this.panel.querySelector('pre').textContent=this.lines.join('\n');
    }
  };
  window.addEventListener('keydown',e=>{ if(e.altKey&&e.code==='KeyD'){ if(IMDBG.panel) IMDBG.panel.style.display=IMDBG.panel.style.display==='none'?'block':'none'; else IMDBG.render(); } });

  GM_addStyle(`
    .im-fill-overlay{position:absolute;display:flex;align-items:center;justify-content:center;cursor:pointer;
      font-size:11px;font-weight:600;z-index:9999;background:rgba(22,163,74,.12);color:#16a34a;
      border-left:1px solid #16a34a;border-radius:0 8px 8px 0;user-select:none}
    .im-fill-overlay:hover{background:rgba(22,163,74,.2)}
    .im-flash{box-shadow:0 0 0 3px rgba(0,160,255,.55)!important;transition:box-shadow .25s ease}
    .im-yes-made{position:absolute!important;z-index:2147483646!important;padding:6px 10px!important;border-radius:6px!important;
      border:1px solid #16a34a!important;background:rgba(22,163,74,.12)!important;color:#16a34a!important;font-weight:600!important;cursor:pointer!important}
  `);

  const SEL={
    list:'ul[class*="sellerList"]',
    rowWrapper:'li[class*="rowWrapper"]',
    row:'div[class*="sellerRow"]',
    price:'div[class*="price"]',
    qtyCell:'div[class*="available"]',
    showBtn:'button[class*="showBuyControlsButton"]',
    amountInputs:'input:not([type="checkbox"]):not([type="hidden"])',
    buyButtons:'button,a'
  };
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const parseMoney=s=>{s=String(s||'').replace(/[^\d.]/g,'');return s?Math.floor(Number(s)):NaN;};
  const toInt=s=>{const m=String(s||'').match(/\d[\d,]*/);return m?Number(m[0].replace(/[^\d]/g,'')):NaN;};
  const flash=el=>{if(!el) return;el.classList.add('im-flash');setTimeout(()=>el.classList.remove('im-flash'),280);};

  function getRows(){const list=document.querySelector(SEL.list);if(!list)return[];return[...list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`)].filter(r=>r.offsetParent);}
  function findNativeBuyButton(row){
    const li=row.closest(SEL.rowWrapper)||row.closest('li'); if(!li)return null;
    const btns=[...li.querySelectorAll(SEL.buyButtons)].filter(b=>(b.textContent||'').match(/buy|confirm|purchase/i));
    const vis=btns.find(b=>b.offsetParent); if(DEBUG) IMDBG.log('Buy btns found:',btns.length); return vis||btns[0]||null;
  }
  async function ensureControlsOpen(row){const show=row.querySelector(SEL.showBtn);if(show)show.click();for(let i=0;i<20;i++){await sleep(20);if(findAmountInputForRow(row))break;}}
  function findAmountInputForRow(row){
    const li=row.closest(SEL.rowWrapper)||row.closest('li');if(!li)return null;
    const c=[...li.querySelectorAll(SEL.amountInputs)].filter(inp=>inp.offsetParent);
    if(DEBUG) IMDBG.log('Inputs:',c.length);return c[0]||null;
  }
  function getWalletFromHeader(){for(const root of [document.querySelector('#topRoot'),document.body]){for(const n of root.querySelectorAll('span,div,a,li,b,strong')){const t=n.textContent||'';if(/\$[\d,.]+/.test(t)){const v=parseMoney(t);if(Number.isFinite(v))return v;}}}return NaN;}
  function computeAfford(wallet,unit,qty){if(!Number.isFinite(qty)||qty<=0)qty=Infinity;if(!wallet||!unit)return 0;return Math.max(0,Math.min(Math.floor(wallet/unit),qty));}
  function setInputValue(input,val){input.value=val;input.dispatchEvent(new Event('input',{bubbles:true}));}

  function placeRowOverlay(row){
    const native=findNativeBuyButton(row); if(!native)return;
    const container=native.parentElement;if(getComputedStyle(container).position==='static')container.style.position='relative';
    if(container.querySelector('.im-fill-overlay'))return;
    const ov=document.createElement('div');ov.className='im-fill-overlay';ov.textContent='Fill Max';
    Object.assign(ov.style,{top:0,right:0,bottom:0,width:'25%'});
    ov.onclick=async e=>{
      e.stopPropagation();const unit=parseMoney(row.querySelector(SEL.price)?.textContent);
      const qty=toInt(row.querySelector(SEL.qtyCell)?.textContent);
      const wallet=getWalletFromHeader();const afford=computeAfford(wallet,unit,qty);
      IMDBG.log('Fill clicked unit',unit,'qty',qty,'wallet',wallet,'afford',afford);
      await ensureControlsOpen(row);const inp=findAmountInputForRow(row);
      if(inp){setInputValue(inp,afford);flash(inp);}else IMDBG.log('No input found');
    };
    container.appendChild(ov);
  }
  function refreshRows(){for(const r of getRows())placeRowOverlay(r);}

  // Confirm dialog clone
  function findDialog(){return [...document.querySelectorAll('[role="dialog"],.ui-dialog,[class*="modal"]')].find(d=>d.offsetParent);}
  function findNativeYes(dlg){return dlg?.querySelector('button, a');}
  function makeYesTopRight(dlg){if(!dlg||dlg.querySelector('.im-yes-made'))return;const yes=findNativeYes(dlg);if(!yes)return;
    dlg.style.position='relative';const made=document.createElement('button');made.className='im-yes-made';made.textContent=(yes.textContent||'Yes');
    made.style.top='8px';made.style.right='36px';made.onclick=e=>{e.stopPropagation();yes.click();};
    dlg.appendChild(made);IMDBG.log('Yes clone injected');}

  new MutationObserver(()=>refreshRows()).observe(document.documentElement,{childList:true,subtree:true});
  new MutationObserver(()=>{const dlg=findDialog();if(dlg)makeYesTopRight(dlg);}).observe(document.documentElement,{childList:true,subtree:true});

  setInterval(refreshRows,2000);
})();
