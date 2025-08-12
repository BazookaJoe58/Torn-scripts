// ==UserScript==
// @name         Torn Stock Toggle (Per-Stock, Robust)
// @namespace    http://tampermonkey.net/
// @version      2.0.2
// @description  Per-stock lock toggle that persists and survives reorders/re-renders on Torn's Stocks page
// @author       BazookaJoe
// @license      MIT
// @match        https://www.torn.com/*
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-stock-toggle.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-stock-toggle.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'tst.v2.state'; // { "id:123": {disabled:true}, ... }
  const ROW_MARK = 'data-tst-row';
  const TOGGLE_CLASS = 'tst-toggle';
  const DIM_CLASS = 'tst-dim';

  // ---------------- Storage ----------------
  const store = {
    all() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
      catch { return {}; }
    },
    get(key) { return this.all()[key] || null; },
    set(key, partial) {
      const m = this.all();
      m[key] = { ...(m[key] || {}), ...(partial || {}) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
    }
  };

  // ---------------- Styles ----------------
  function addStyles() {
    if (document.getElementById('tst-styles')) return;
    const s = document.createElement('style');
    s.id = 'tst-styles';
    s.textContent = `
      .${DIM_CLASS} {
        opacity: .55 !important;
        filter: grayscale(.2);
        pointer-events: none !important;
      }
      .${DIM_CLASS} .${TOGGLE_CLASS} { pointer-events: auto !important; }

      .${TOGGLE_CLASS} {
        position: absolute;
        top: 6px;
        right: 8px;
        width: 42px;
        height: 22px;
        border-radius: 9999px;
        appearance: none;
        background: rgba(255,255,255,.14);
        border: 2px solid rgba(255,255,255,.25);
        cursor: pointer;
        transition: background .2s ease, border-color .2s ease, transform .05s ease;
        z-index: 2;
      }
      .${TOGGLE_CLASS}::before {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        transition: left .2s ease;
      }
      .${TOGGLE_CLASS}:checked {
        background: #28a745;
        border-color: rgba(40,167,69,.8);
      }
      .${TOGGLE_CLASS}:checked::before { left: 22px; }
      .${TOGGLE_CLASS}:active { transform: scale(.98); }

      [${ROW_MARK}] { position: relative; }
    `;
    document.head.appendChild(s);
  }

  // ---------------- Helpers ----------------
  const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const closestRow = (el) => el.closest(`li,div,section,article`);

  function stockKeyFromLink(a) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/stockID=(\d+)/i);
    return m ? `id:${m[1]}` : null;
  }

  function ensureRowMarked(row) {
    if (!row) return;
    if (!row.hasAttribute(ROW_MARK)) row.setAttribute(ROW_MARK, '1');
  }

  function applyState(row, disabled) {
    row.classList.toggle(DIM_CLASS, !!disabled);
  }

  function makeToggle(initial, onChange) {
    const t = document.createElement('input');
    t.type = 'checkbox';
    t.className = TOGGLE_CLASS;
    t.checked = !!initial;
    t.title = 'Lock/unlock this stock row';
    t.addEventListener('change', () => onChange(t.checked));
    return t;
  }

  // Inject a toggle for a given stock link (id anchored)
  function injectForLink(a) {
    const key = stockKeyFromLink(a);
    if (!key) return;

    const row = closestRow(a);
    if (!row) return;

    ensureRowMarked(row);

    // Avoid double-injection; still sync state if already present
    if (row.querySelector(`input.${TOGGLE_CLASS}[data-key="${key}"]`)) {
      const state = store.get(key);
      applyState(row, state && state.disabled);
      return;
    }

    const state = store.get(key);
    const toggle = makeToggle(state && state.disabled, (checked) => {
      store.set(key, { disabled: checked });
      applyState(row, checked);
    });
    toggle.dataset.key = key;

    // Place in top-right of row
    row.appendChild(toggle);
    applyState(row, state && state.disabled);
  }

  // Scan the page for any stock links and inject toggles
  function scan() {
    const links = $all('a[href*="stockID="]');
    links.forEach(injectForLink);
  }

  // MutationObserver to keep things working across re-renders
  function observe() {
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach((n) => {
            if (!(n instanceof HTMLElement)) return;
            if (n.matches && n.matches('a[href*="stockID="]')) {
              injectForLink(n);
            } else {
              const inner = n.querySelectorAll && n.querySelectorAll('a[href*="stockID="]');
              if (inner && inner.length) inner.forEach(injectForLink);
            }
          });
        } else if (m.type === 'attributes' && m.target instanceof HTMLElement) {
          if (m.target.matches('a[href*="stockID="]')) injectForLink(m.target);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'class'] });
  }

  // Handle SPA URL changes (pushState/hashchange/popstate)
  function hookSpaNavigation() {
    const kick = () => setTimeout(scan, 30);
    const _ps = history.pushState;
    history.pushState = function () { _ps.apply(this, arguments); kick(); };
    window.addEventListener('popstate', kick);
    window.addEventListener('hashchange', kick);
  }

  // -------- init --------
  function init() {
    addStyles();
    scan();
    observe();
    hookSpaNavigation();
  }

  // Start once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
