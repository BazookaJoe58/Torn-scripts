// ==UserScript==
// @name         Torn Stock Lock Toggle v1.0.0
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      1.0.0
// @description  Lock a stock to prevent accidental selling. Lock state is saved per stock ID, so it sticks even if list order changes.
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

  // Only run on the stock market page
  const isStocksPage = () => /\/page\.php\?sid=stocks/.test(location.href);
  if (!isStocksPage()) return;

  const CONFIG = {
    storageKey: 'torn.stock.locked', // localStorage object map: { [stockID: string]: true|false }
    selectors: {
      header: 'ul.title-black',                           // header row with column titles
      headerDividendLi: 'li#dividend',                    // the "Dividend" column (we'll insert after it)
      listContainer: 'div.stockMarket___iB18v',           // wraps all stock <ul>s
      stockRow: 'ul.stock___ElSDB',                       // each stock row is a <ul id="{stockID}">
      nameCell: 'li#nameTab',
      priceCell: 'li#priceTab',
      ownedCell: 'li#ownedTab',
      dividendCell: 'li#dividendTab',
      dropdownPanelPrefix: '#panel-ownedTab',             // panel opens under the row; we’ll catch sells globally
      anySellButton: 'button[class*="sellButton"]',       // defensive
      anySellClassPart: 'sellButton',                     // used in delegation guard
    }
  };

  // ---- Storage helpers (persist by stockID) ----
  const store = {
    read() {
      try { return JSON.parse(localStorage.getItem(CONFIG.storageKey) || '{}') || {}; }
      catch { return {}; }
    },
    write(map) {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(map || {}));
    },
    get(id) { return !!this.read()[id]; },
    set(id, locked) {
      const m = this.read();
      if (locked) m[id] = true; else delete m[id];
      this.write(m);
    }
  };

  // ---- Styles ----
  addStyles();
  function addStyles() {
    const css = `
      /* Column header for Lock */
      .tslt-col-title { text-align:center; padding:0 10px; }

      /* Lock cell and button */
      .tslt-cell { text-align:center; padding: 12px 10px; display:flex; align-items:center; justify-content:center; gap:8px; }
      .tslt-lock {
        appearance:none; border:1px solid #5a5a5a; background:#2a2a2a; color:#ddd;
        padding:6px 10px; border-radius:7px; cursor:pointer; font: 600 12px/1 system-ui,Segoe UI,Arial;
        transition: filter .15s ease, transform .03s ease, background .15s ease, border-color .15s ease;
      }
      .tslt-lock:hover { filter:brightness(1.08); }
      .tslt-lock:active { transform: scale(.98); }
      .tslt-lock.locked { background:#1c2a1c; border-color:#2d8f2d; color:#aef0ae; }
      .tslt-lock .tag { opacity:.8; font-weight:600; }

      /* Row affordance when locked */
      .tslt-row-locked { position: relative; }
      .tslt-row-locked::after {
        content:'LOCKED'; position:absolute; right:8px; top:8px;
        padding:2px 6px; font:700 10px/1 system-ui,Segoe UI,Arial;
        color:#aef0ae; border:1px solid #2d8f2d; border-radius:5px; background:#0e1a0e; opacity:.9;
      }

      /* Disable all SELL buttons visually when locked */
      .tslt-row-locked button[class*="sellButton"] { opacity:.4; cursor:not-allowed !important; }
      .tslt-row-locked button[class*="sell___"]    { opacity:.4; cursor:not-allowed !important; }

      /* Keep our lock button clickable even if parents get pointer-events:none elsewhere */
      .tslt-cell .tslt-lock { pointer-events:auto; }
    `;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---- Insert "Lock" column header (after Dividend) ----
  function ensureHeader() {
    const header = document.querySelector(CONFIG.selectors.header);
    if (!header || header.querySelector('.tslt-col-title')) return;

    const divCol = header.querySelector(CONFIG.selectors.headerDividendLi);
    const li = document.createElement('li');
    li.className = 'tslt-col-title';
    li.textContent = 'Lock';
    if (divCol && divCol.parentNode) {
      divCol.parentNode.insertBefore(li, divCol.nextSibling);
    } else {
      header.appendChild(li);
    }
  }

  // ---- Build + attach one lock cell for a row ----
  function attachLockCell(row) {
    if (!row || row.querySelector('.tslt-cell')) return;
    const stockID = row.id; // Torn uses <ul id="{stockID}">
    if (!stockID) return;

    const dividendCell = row.querySelector(CONFIG.selectors.dividendCell);
    if (!dividendCell) return;

    // Create lock cell
    const cell = document.createElement('li');
    cell.className = 'tslt-cell';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tslt-lock';
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Lock this stock to prevent accidental selling';

    const pad = document.createElement('span');
    pad.textContent = '🔓';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'Lock';

    btn.appendChild(pad);
    btn.appendChild(tag);
    cell.appendChild(btn);

    // Insert after the Dividend cell
    dividendCell.parentNode.insertBefore(cell, dividendCell.nextSibling);

    // Sync UI from storage
    const apply = (locked) => {
      btn.classList.toggle('locked', locked);
      btn.setAttribute('aria-pressed', String(!!locked));
      pad.textContent = locked ? '🔒' : '🔓';
      tag.textContent = locked ? 'Locked' : 'Lock';
      row.classList.toggle('tslt-row-locked', !!locked);
    };
    apply(store.get(stockID));

    // Toggle handler
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const now = !store.get(stockID);
      store.set(stockID, now);
      apply(now);
    });
  }

  // ---- Guard all sell actions for locked rows ----
  function sellGuard(e) {
    // If it's not a click, ignore
    if (e.type !== 'click') return;

    // Find a "sell" button from the event path
    const path = e.composedPath ? e.composedPath() : [];
    const sellBtn = path.find(el =>
      el && el.nodeType === 1 &&
      el.tagName === 'BUTTON' &&
      (el.className || '').includes(CONFIG.selectors.anySellClassPart)
    );
    if (!sellBtn) return;

    // Ascend to the associated stock row <ul id="{stockID}">
    let row = null;
    for (const el of path) {
      if (!el || el.nodeType !== 1) continue;
      if (el.matches && el.matches(CONFIG.selectors.stockRow)) { row = el; break; }
      // Sometimes sell buttons live inside the panel under the row; try to find the previous sibling stock row
      if (el.id && el.id.startsWith('panel-')) {
        // The panel is usually the direct sibling after the row
        const prev = el.previousElementSibling;
        if (prev && prev.matches(CONFIG.selectors.stockRow)) { row = prev; break; }
      }
    }
    if (!row) return;

    const stockID = row.id;
    if (store.get(stockID)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      // Quick tiny toast
      showToast(`Stock ${stockID} is <b>locked</b>. Unlock it to sell.`);
    }
  }

  // Minimal toast
  function showToast(html, ms = 2200) {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed; right:14px; bottom:14px; z-index:999999;
      padding:10px 14px; background:#111; color:#eee;
      border:1px solid #444; border-radius:10px; box-shadow:0 6px 24px #0008;
      font: 13px/1.4 system-ui,Segoe UI,Arial; max-width:60ch;
    `;
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), ms);
  }

  // ---- Scan + wire all rows ----
  function scanRows() {
    ensureHeader();
    document.querySelectorAll(CONFIG.selectors.stockRow).forEach(attachLockCell);
  }

  // ---- Init (wait for #stockmarketroot presence) ----
  function waitForRoot(timeout = 15000) {
    return new Promise((resolve, reject) => {
      const targetSel = '#stockmarketroot';
      if (document.querySelector(targetSel)) return resolve();
      const mo = new MutationObserver(() => {
        if (document.querySelector(targetSel)) { mo.disconnect(); resolve(); }
      });
      mo.observe(document.documentElement, {childList:true, subtree:true});
      setTimeout(() => { mo.disconnect(); reject(new Error('Timeout waiting for stockmarketroot')); }, timeout);
    });
  }

  async function init() {
    try {
      await waitForRoot();
    } catch (_) {
      // Fallback: proceed anyway – some pages may not expose the root id immediately
    }

    // First pass
    scanRows();

    // Global sell guard
    document.addEventListener('click', sellGuard, true); // capture phase to stop React handlers

    // React re-renders: watch the list container
    const root = document.querySelector(CONFIG.selectors.listContainer) || document.body;
    new MutationObserver((muts) => {
      // If rows added/changed, rescan just in case
      if (muts.some(m => Array.from(m.addedNodes).some(n => n.nodeType === 1 && n.matches && n.matches(CONFIG.selectors.stockRow)))) {
        scanRows();
      }
      // Also rescan periodically when content mutates (sorting, filters)
      scanRows();
    }).observe(root, {childList:true, subtree:true});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
