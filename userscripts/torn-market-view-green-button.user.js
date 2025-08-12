// ==UserScript==
// @name         Torn Market: View Listing Green Button v0.4.3
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      0.4.3
// @description  Adds a small green ✓ button next to each price input on View Listing. Clicking it shows the 5 cheapest current item-market listings for that item. Includes a menu to set/edit a Torn PUBLIC API key.
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
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-market-view-green-button.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-market-view-green-button.user.js
// ==/UserScript==

(function () {
  'use strict';
  console.log('[TMVGB] loaded v0.4.3');

  // ---------- Config / storage ----------
  const KEY_API = 'tmvgb_public_api_key';
  const getKey = () => GM_getValue(KEY_API, '');
  const setKey = (k) => GM_setValue(KEY_API, k || '');

  GM_registerMenuCommand('Set / Edit Torn PUBLIC API key', () => {
    const cur = getKey();
    const input = prompt('Enter your Torn PUBLIC API key (16 chars):', cur || '');
    if (input === null) return;
    if (input && input.trim().length === 16) {
      setKey(input.trim());
      alert('Saved ✓');
    } else {
      alert('That does not look like a 16-character PUBLIC key.');
    }
  });
  GM_registerMenuCommand('Clear API key', () => { setKey(''); alert('API key cleared.'); });

  // ---------- Styles ----------
  GM_addStyle(`
    .tmvgb-btn{display:inline-flex;align-items:center;vertical-align:middle}
    .tmvgb-k{display:inline-flex;align-items:center;justify-content:center;
      width:20px;height:20px;border-radius:4px;border:none;cursor:pointer;
      background:#22c55e;color:#fff;font-weight:700;line-height:20px}
    .tmvgb-k:active{transform:scale(.96)}
    .tmvgb-popup{
      position:absolute; z-index: 99999; max-width: 320px;
      background: var(--tooltip-bg-color, #222); color: var(--info-msg-font-color, #ddd);
      border: 1px solid rgba(255,255,255,.15); border-radius: 8px; padding: 10px 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,.35); font-size: 12.5px;
    }
    .tmvgb-popup h4{margin:0 0 6px 0; font-size:13px}
    .tmvgb-row{display:flex; gap:8px; justify-content:space-between}
    .tmvgb-row + .tmvgb-row{margin-top:4px}
    .tmvgb-muted{opacity:.8}
  `);

  // ---------- Utils ----------
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
  const number = (n) => new Intl.NumberFormat('en-US').format(n);
  const onViewListing = () => location.hash.includes('#/viewListing');

  function findParent(el, predicate){
    let cur = el;
    while (cur){
      if (predicate(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  function itemIdFromImg(img){
    const m = img?.src?.match(/\/items\/(\d+)\//);
    return m ? parseInt(m[1], 10) : null;
  }

  // ---------- Popup (one instance) ----------
  const popup = document.createElement('div');
  popup.className = 'tmvgb-popup';
  popup.style.display = 'none';
  document.body.appendChild(popup);

  document.addEventListener('click', (e) => {
    if (popup.style.display === 'none') return;
    if (!popup.contains(e.target) && !e.target.closest('.tmvgb-btn')){
      popup.style.display = 'none';
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') popup.style.display = 'none'; });

  // ---------- API ----------
  function apiMarketListings(itemId, apiKey){
    return new Promise((resolve) => {
      const url = `https://api.torn.com/v2/market?id=${itemId}&selections=itemMarket&key=${apiKey}`;
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 15000,
        onload: (res) => {
          try{
            const data = JSON.parse(res.responseText);
            if (data?.error){
              const code = data.error.code;
              const msg =
                code === 2 ? 'Invalid API key.' :
                code === 9 ? 'Torn API temporarily disabled — try again soon.' :
                `API error ${code}: ${data.error.error}`;
              return resolve({ error: msg });
            }
            resolve({ ok: true, item: data.itemmarket?.item, listings: data.itemmarket?.listings || [] });
          }catch{
            resolve({ error: 'Bad response' });
          }
        },
        onerror: () => resolve({ error: 'Request failed' }),
        ontimeout: () => resolve({ error: 'Timed out' }),
      });
    });
  }

  function renderListingsHtml(itemName, listings){
    if (!listings || listings.length === 0) {
      return `<h4>${itemName || 'Item'}</h4><div class="tmvgb-muted">No live listings found.</div>`;
    }
    const top = listings.slice(0, 5).map(l =>
      `<div class="tmvgb-row"><span>${l.amount} ×</span><strong>$${number(l.price)}</strong></div>`
    ).join('');
    return `<h4>${itemName || 'Item'} — Cheapest 5</h4>${top}`;
  }

  // ---------- Button injection ----------
  const BTN_SIZE = 20;  // keep in sync with CSS
  const BTN_GAP  = 4;
  const OFFSET_PX = 4 * (BTN_SIZE + BTN_GAP); // ~ four button widths

  function injectButton(priceWrapper){
    // make sure we only add once per row
    if (priceWrapper.querySelector(':scope > .tmvgb-btn')) return;

    const wrapperRow = findParent(priceWrapper, el => String(el.className).includes('itemRowWrapper'));
    if (!wrapperRow) return;

    const img = wrapperRow.querySelector('[class*=viewInfoButton] img');
    const itemId = itemIdFromImg(img);
    if (!itemId) return;

    const btnWrap = document.createElement('span');
    btnWrap.className = 'tmvgb-btn';
    btnWrap.title = 'Show cheapest 5 market listings';
    btnWrap.style.marginLeft = OFFSET_PX + 'px';      // << push it right
    btnWrap.style.position = 'relative';              // follow normal flow, no overlap

    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'tmvgb-k';
    k.textContent = '✓';
    btnWrap.appendChild(k);

    // Append as a SIBLING of the input group (not inside it), so it won't overlay the input
    priceWrapper.appendChild(btnWrap);

    btnWrap.addEventListener('click', async (e) => {
      e.stopPropagation();

      let apiKey = getKey();
      if (!apiKey || apiKey.length !== 16){
        const got = prompt('Enter your Torn PUBLIC API key (16 chars):', apiKey || '');
        if (!got) return;
        if (got.trim().length !== 16) { alert('That key does not look valid.'); return; }
        setKey(got.trim());
        apiKey = got.trim();
      }

      const rect = btnWrap.getBoundingClientRect();
      popup.style.left = (window.scrollX + rect.left - 10) + 'px';
      popup.style.top  = (window.scrollY + rect.bottom + 6) + 'px';
      popup.innerHTML = `<div class="tmvgb-muted">Loading listings…</div>`;
      popup.style.display = 'block';

      const res = await apiMarketListings(itemId, apiKey);
      if (res?.error){
        popup.innerHTML = `<div class="tmvgb-muted">${res.error}</div>`;
        return;
      }
      popup.innerHTML = renderListingsHtml(res.item?.name, res.listings || []);
    });
  }

  function scanAll(){
    if (!onViewListing()) return;
    // Looser class matching so minor hash changes don't break us
    $$('[class*="viewListingWrapper"] [class*="itemRowWrapper"] [class*="itemRow"]:not([class*="grayedOut"]) [class*="priceInputWrapper"]')
      .forEach(injectButton);
  }

  function startObserver(root){
    scanAll();
    setInterval(() => { if (onViewListing()) scanAll(); }, 1500);
    const mo = new MutationObserver(() => { if (onViewListing()) scanAll(); });
    mo.observe(root, { childList: true, subtree: true });
    window.addEventListener('hashchange', () => setTimeout(() => { if (onViewListing()) scanAll(); }, 100));
  }

  function waitForRoot(){
    const existing = document.querySelector('#item-market-root');
    if (existing) { startObserver(existing); return; }
    const mo = new MutationObserver(() => {
      const r = document.querySelector('#item-market-root');
      if (r){ mo.disconnect(); startObserver(r); }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  waitForRoot();
})();
