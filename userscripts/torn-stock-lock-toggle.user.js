// ==UserScript==
// @name         Torn Stock Lock Toggle v1.1.0
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      1.1.0
// @description  Lock a stock to prevent accidental selling. Lock state is saved per stock ID, sticks even if list order changes. Also disables the Sell input box.
// @author       BazookaJoe
// @license      MIT
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/BazookaJoe58/Torn-scripts
// @supportURL   https://github.com/BazookaJoe58/Torn-scripts/issues
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-stock-lock-toggle.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-stock-lock-toggle.user.js
// @commit-to    BazookaJoe58/Torn-scripts/main/userscripts/torn-stock-lock-toggle.user.js
// ==/UserScript==

(() => {
  'use strict';

  const onStocksPage = /\/page\.php\?sid=stocks/.test(location.href);
  if (!onStocksPage) return;

  const CONFIG = {
    storageKey: 'torn.stock.locked',
    sels: {
      header: 'ul.title-black',
      headerDividendLi: 'li#dividend',
      listContainer: 'div.stockMarket___iB18v',
      row: 'ul.stock___ElSDB',                 // <ul id="{stockID}">
      dividendCell: 'li#dividendTab',
      // Panel appears right after the row with id like #panel-ownedTab
      panel: (row) => row?.nextElementSibling?.id?.startsWith('panel-') ? row.nextElementSibling : null,
      // Within panel (hashed classes differ, so use contains fragments)
      sellBlock: '[class*="sellBlock"]',
      sellInput: 'input.input-money, input[class*="input-money"]',
      sellBtn: 'button[class*="sell"]',
      transSellBtn: 'li[class*="sell"] button', // transaction list Sell buttons
    }
  };

  // ---------- storage ----------
  const store = {
    read() { try {return JSON.parse(localStorage.getItem(CONFIG.storageKey)||'{}')||{};} catch {return {}} },
    write(map) { localStorage.setItem(CONFIG.storageKey, JSON.stringify(map||{})); },
    get(id) { return !!this.read()[id]; },
    set(id, locked) {
      const m = this.read();
      if (locked) m[id] = true; else delete m[id];
      this.write(m);
    }
  };

  // ---------- styles ----------
  (function addStyles(){
    const css = `
      .tslt-col-title { text-align:center; padding:0 10px; }
      .tslt-cell { text-align:center; padding: 12px 10px; display:flex; align-items:center; justify-content:center; gap:8px; }
      .tslt-lock {
        appearance:none; border:1px solid #5a5a5a; background:#2a2a2a; color:#ddd;
        padding:6px 10px; border-radius:7px; cursor:pointer; font:600 12px/1 system-ui,Segoe UI,Arial;
        transition: filter .15s, transform .03s, background .15s, border-color .15s;
      }
      .tslt-lock:hover { filter:brightness(1.08); }
      .tslt-lock:active { transform:scale(.98); }
      .tslt-lock.locked { background:#1c2a1c; border-color:#2d8f2d; color:#aef0ae; }
      .tslt-lock .tag { opacity:.85; }
      .tslt-row-locked { position:relative; }
      .tslt-row-locked::after {
        content:'LOCKED'; position:absolute; right:8px; top:8px;
        padding:2px 6px; font:700 10px/1 system-ui,Segoe UI,Arial;
        color:#aef0ae; border:1px solid #2d8f2d; border-radius:5px; background:#0e1a0e; opacity:.9;
      }
      /* Dim & block Sell button and amount box when locked */
      .tslt-locked-panel [class*="sellBlock"] { position:relative; }
      .tslt-locked-panel [class*="sellBlock"]::after{
        content:'LOCKED'; position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        background:#0008; color:#aef0ae; border:1px solid #2d8f2d; border-radius:8px; font:700 12px/1 system-ui,Segoe UI,Arial;
      }
      .tslt-locked-panel button[class*="sell"] { opacity:.35; cursor:not-allowed !important; pointer-events:none !important; }
      .tslt-locked-panel input.input-money,
      .tslt-locked-panel input[class*="input-money"] { opacity:.5; pointer-events:none !important; }
    `;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  })();

  // ---------- header "Lock" column ----------
  function ensureHeader() {
    const header = document.querySelector(CONFIG.sels.header);
    if (!header || header.querySelector('.tslt-col-title')) return;
    const after = header.querySelector(CONFIG.sels.headerDividendLi);
    const li = document.createElement('li');
    li.className = 'tslt-col-title';
    li.textContent = 'Lock';
    (after?.parentNode)?.insertBefore(li, after.nextSibling);
  }

  // ---------- per-row lock cell ----------
  function attachLockCell(row) {
    if (!row || row.querySelector('.tslt-cell')) return;
    const stockID = row.id;
    if (!stockID) return;

    const divCell = row.querySelector(CONFIG.sels.dividendCell);
    if (!divCell) return;

    const cell = document.createElement('li');
    cell.className = 'tslt-cell';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tslt-lock';
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Lock this stock to prevent accidental selling';
    const icon = document.createElement('span'); icon.textContent = '🔓';
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'Lock';
    btn.append(icon, tag);
    cell.appendChild(btn);
    divCell.parentNode.insertBefore(cell, divCell.nextSibling);

    const apply = (locked) => {
      btn.classList.toggle('locked', locked);
      btn.setAttribute('aria-pressed', String(!!locked));
      icon.textContent = locked ? '🔒' : '🔓';
      tag.textContent = locked ? 'Locked' : 'Lock';
      row.classList.toggle('tslt-row-locked', !!locked);
      // also update the sell panel if it's open
      const panel = CONFIG.sels.panel(row);
      if (panel) setPanelLocked(panel, stockID, locked);
    };

    // initial
    apply(store.get(stockID));

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = !store.get(stockID);
      store.set(stockID, next);
      apply(next);
    });
  }

  // ---------- sell panel locking ----------
  function setPanelLocked(panelEl, stockID, locked) {
    if (!panelEl) return;
    panelEl.classList.toggle('tslt-locked-panel', !!locked);

    // Inputs
    panelEl.querySelectorAll(CONFIG.sels.sellInput).forEach(inp => {
      try {
        if (locked) {
          inp.setAttribute('readonly', 'true');
          inp.setAttribute('disabled', 'true');
          // extra: block user input events
          const stopper = (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); };
          ['input','keydown','keypress','keyup','paste','wheel','mousedown','click','focus'].forEach(type => {
            inp.addEventListener(type, stopper, true);
          });
        } else {
          inp.removeAttribute('readonly');
          inp.removeAttribute('disabled');
        }
      } catch {}
    });

    // Buttons already visually blocked via CSS; also guard programmatically
    panelEl.querySelectorAll(CONFIG.sels.sellBtn).forEach(btn => {
      if (locked) {
        btn.dataset.tsltDisabled = '1';
      } else {
        delete btn.dataset.tsltDisabled;
      }
    });
  }

  // When a panel appears or re-renders, sync its locked state
  function wirePanelForRow(row) {
    const panel = CONFIG.sels.panel(row);
    if (!panel) return;
    const stockID = row.id;
    setPanelLocked(panel, stockID, store.get(stockID));
  }

  // ---------- global guards ----------
  function globalClickGuard(e) {
    // If it's a Sell button anywhere and its row is locked, block
    const path = e.composedPath ? e.composedPath() : [];
    const btn = path.find(el => el?.tagName === 'BUTTON' && (el.className||'').includes('sell'));
    if (!btn) return;

    // find owning row <ul.id=stockID>
    let row = null;
    for (const el of path) {
      if (el?.matches?.(CONFIG.sels.row)) { row = el; break; }
      if (el?.id?.startsWith?.('panel-')) {
        const prev = el.previousElementSibling;
        if (prev?.matches?.(CONFIG.sels.row)) { row = prev; break; }
      }
    }
    if (!row) return;

    const stockID = row.id;
    if (store.get(stockID)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toast(`Stock <b>${stockID}</b> is <b>locked</b>. Unlock it to sell.`);
    }
  }

  function toast(html, ms=2000){
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:999999;padding:10px 14px;background:#111;color:#eee;border:1px solid #444;border-radius:10px;box-shadow:0 6px 24px #0008;font:13px/1.4 system-ui,Segoe UI,Arial;max-width:60ch';
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), ms);
  }

  // ---------- scanning & observers ----------
  function scan() {
    ensureHeader();
    document.querySelectorAll(CONFIG.sels.row).forEach(row => {
      attachLockCell(row);
      wirePanelForRow(row);
    });
  }

  function waitForRoot(timeout=12000){
    return new Promise((resolve,reject)=>{
      const check = ()=> document.querySelector('#stockmarketroot') ? resolve() : null;
      if (check()) return;
      const mo = new MutationObserver(()=>check() && (mo.disconnect(), resolve()));
      mo.observe(document.documentElement,{childList:true,subtree:true});
      setTimeout(()=>{ mo.disconnect(); resolve(); }, timeout); // soft-timeout: proceed anyway
    });
  }

  async function init(){
    await waitForRoot();
    scan();

    // Global click guard (capture)
    document.addEventListener('click', globalClickGuard, true);

    // Observe for React re-renders
    const root = document.querySelector(CONFIG.sels.listContainer) || document.body;
    new MutationObserver((muts)=>{
      // If rows/panels show up or content changes, resync
      let needs = false;
      for (const m of muts) {
        if ([...m.addedNodes].some(n => n.nodeType===1 && (n.matches?.(CONFIG.sels.row) || n.id?.startsWith?.('panel-')))) { needs = true; break; }
        if (m.target?.id?.startsWith?.('panel-')) { needs = true; break; }
      }
      if (needs) scan();
    }).observe(root, {childList:true, subtree:true});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {once:true});
  } else {
    init();
  }
})();
