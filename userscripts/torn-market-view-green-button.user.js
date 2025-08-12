// ==UserScript==
// @name         Torn Market: View Listing Green Button v0.3.0
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      0.3.0
// @description  View Listing only: adds a small green ✓ button next to each price input; click it to show the item's market value. Menu lets you save/edit your Torn API key.
// @author       BazookaJoe
// @license      MIT
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://*.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
//
// @homepageURL  https://github.com/BazookaJoe58/Torn-scripts
// @supportURL   https://github.com/BazookaJoe58/Torn-scripts/issues
// @downloadURL https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-market-view-green-button.user.js
// @updateURL   https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-market-view-green-button.user.js
//
// The next 4 lines are read by your “Commit to GitHub” bridge userscript:
// @gitOwner     BazookaJoe58
// @gitRepo      Torn-scripts
// @gitBranch    main
// @gitPath      userscripts/torn-market-view-green-button.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Menu: API key ----------
  const KEY_NAME = 'tornApiKey';
  GM_registerMenuCommand('Set Torn API key', async () => {
    const existing = GM_getValue(KEY_NAME, '');
    const k = prompt('Enter PUBLIC Torn API key (16 chars):', existing || '');
    if (k !== null) GM_setValue(KEY_NAME, k.trim());
  });
  GM_registerMenuCommand('Show current key (masked)', () => {
    const k = GM_getValue(KEY_NAME, '');
    if (!k) return alert('No key saved yet.');
    const masked = k.replace(/^(.{2}).+(.{2})$/, '$1************$2');
    alert(`Saved key: ${masked}`);
  });
  GM_registerMenuCommand('Clear API key', () => {
    GM_setValue(KEY_NAME, '');
    alert('API key cleared.');
  });

  // ---------- Styles ----------
  GM_addStyle(`
    .bj-gbtn{display:inline-flex;align-items:center;justify-content:center;
      width:22px;height:22px;margin-left:6px;border-radius:999px;border:none;
      background:#16a34a;color:#fff;cursor:pointer;font-weight:700;line-height:1}
    .bj-gbtn:disabled{opacity:.5;cursor:not-allowed}
    .bj-toast{position:absolute;z-index:99999;padding:8px 10px;border-radius:8px;
      background:#111827;color:#f8fafc;border:1px solid #374151;font-size:12px;box-shadow:0 6px 18px #0007}
  `);

  // ---------- Page routing guard ----------
  const onViewListing = () =>
    location.href.includes('page.php?sid=ItemMarket') && location.hash.includes('#/viewListing');

  // ---------- Observer to add buttons ----------
  let observerStarted = false;
  const start = () => {
    if (!onViewListing()) return;
    if (observerStarted) return;
    observerStarted = true;

    const root = document.querySelector('#item-market-root') || document.body;
    const obs = new MutationObserver(() => scanAndAttach());
    obs.observe(root, {subtree:true, childList:true});
    scanAndAttach();
  };

  window.addEventListener('hashchange', () => setTimeout(() => {
    observerStarted = false;
    start();
  }, 50));
  start();

  function scanAndAttach(){
    // price input wrappers on View Listing
    document.querySelectorAll(
      '[class^=viewListingWrapper___] [class*=itemRowWrapper___]:not(.bj-processed) [class^=priceInputWrapper___]'
    ).forEach(wrap => {
      const row = findUp(wrap, el => String(el.className).includes('itemRowWrapper___'));
      if (!row) return;
      row.classList.add('bj-processed');

      const group = wrap.querySelector('.input-money-group');
      if (!group || group.querySelector('.bj-gbtn')) return;

      const btn = document.createElement('button');
      btn.className = 'bj-gbtn';
      btn.title = 'Show market value';
      btn.textContent = '✓';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const itemId = getItemIdFromRow(row);
        if (!itemId) return toast(btn, 'Item ID not found');
        const key = GM_getValue(KEY_NAME, '').trim();
        if (!key || key.length !== 16) {
          toast(btn, 'Set your API key from the Tampermonkey menu');
          return;
        }
        btn.disabled = true;
        try {
          const mv = await fetchMarketValue(itemId, key);
          if (typeof mv === 'number') {
            toast(btn, `Market value: $${mv.toLocaleString()}`);
          } else {
            toast(btn, mv || 'No data');
          }
        } finally {
          btn.disabled = false;
        }
      });

      // place to the right of the price input
      group.appendChild(btn);
    });
  }

  // ---------- Helpers ----------
  function findUp(el, predicate){
    let cur = el;
    while (cur && cur !== document.body){
      if (predicate(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function getItemIdFromRow(row){
    // works on View Listing: the item image src contains /{id}/
    const img = row.querySelector('img');
    if (!img || !img.src) return null;
    const m = img.src.match(/\/(\d+)\//);
    return m ? parseInt(m[1], 10) : null;
  }

  function fetchMarketValue(itemId, apiKey){
    const url = `https://api.torn.com/torn/${itemId}?selections=items&key=${apiKey}`;
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            if (data?.error) {
              resolve(`Error ${data.error.code}: ${data.error.error}`);
              return;
            }
            const mv = data?.items?.[itemId]?.market_value;
            resolve(typeof mv === 'number' ? mv : 'No market value');
          } catch {
            resolve('Bad response');
          }
        },
        onerror: () => resolve('Request failed'),
        ontimeout: () => resolve('Timed out'),
      });
    });
  }

  function toast(anchorEl, msg){
    const rect = anchorEl.getBoundingClientRect();
    const t = document.createElement('div');
    t.className = 'bj-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    const top = window.scrollY + rect.top - t.offsetHeight - 8;
    const left = window.scrollX + rect.left - (t.offsetWidth / 2) + (anchorEl.offsetWidth / 2);
    t.style.top = `${Math.max(10, top)}px`;
    t.style.left = `${Math.max(10, left)}px`;
    setTimeout(() => t.remove(), 2500);
  }
})();
