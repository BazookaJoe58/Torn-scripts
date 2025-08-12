// ==UserScript==
// @name         Torn Market: View Listing Green Button v0.4.0
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      0.4.0
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

  // ---------- Config / storage helpers ----------
  const KEY_API = 'tmvgb_public_api_key';

  const getKey = () => GM_getValue(KEY_API, '');
  const setKey = (k) => GM_setValue(KEY_API, k || '');

  GM_registerMenuCommand('Set / Edit Torn PUBLIC API key', () => {
    const cur = getKey();
    const input = prompt('Enter your Torn PUBLIC API key (16 chars):', cur || '');
    if (input === null) return; // cancelled
    if (input && input.length === 16) {
      setKey(input);
      alert('Saved ✓');
    } else {
      alert('That does not look like a 16-character PUBLIC key.');
    }
  });

  GM_registerMenuCommand('Clear API key', () => {
    setKey('');
    alert('API key cleared.');
  });

  // ---------- Styles ----------
  GM_addStyle(`
    .tmvgb-btn.input-money-symbol{margin-left:6px}
    .tmvgb-btn .tmvgb-k{width:20px;height:20px;border-radius:4px;border:none;cursor:pointer}
    .tmvgb-k{background:#22c55e;color:#fff;font-weight:700;line-height:20px;display:inline-block;text-align:center}
    .tmvgb-k:active{transform:scale(0.96)}
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

  // ---------- Small utilities ----------
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

  const number = (n) => new Intl.NumberFormat('en-US').format(n);

  function findParent(el, predicate){
    let cur = el;
    while (cur){
      if (predicate(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function itemIdFromImg(img){
    // e.g. https://www.torn.com/images/items/884/large.png
    const m = img?.src?.match(/\/items\/(\d+)\//);
    return m ? parseInt(m[1], 10) : null;
  }

  // Create one reusable popup
  const popup = document.createElement('div');
  popup.className = 'tmvgb-popup';
  popup.style.display = 'none';
  document.body.appendChild(popup);

  // Close popup on outside click / ESC
  document.addEventListener('click', (e) => {
    if (popup.style.display === 'none') return;
    if (!popup.contains(e.target) && !e.target.closest('.tmvgb-btn')){
      popup.style.display = 'none';
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') popup.style.display = 'none';
  });

  // ---------- API ----------
  function apiMarketListings(itemId, apiKey){
    return new Promise((resolve, reject) => {
      const url = `https://api.torn.com/v2/market?id=${itemId}&selections=itemMarket&key=${apiKey}`;
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (res) => {
          try{
            const data = JSON.parse(res.responseText);
            if (data?.error){
              return resolve({ error: data.error });
            }
            resolve({ ok: true, item: data.itemmarket?.item, listings: data.itemmarket?.listings || [] });
          }catch(err){
            reject(err);
          }
        },
        onerror: (err) => reject(err)
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
  function injectButton(priceWrapper){
    if (priceWrapper.querySelector('.tmvgb-btn')) return;

    const wrapperRow = findParent(priceWrapper, el => String(el.className).includes('itemRowWrapper___'));
    if (!wrapperRow) return;

    const img = wrapperRow.querySelector('[class*=viewInfoButton] img');
    const itemId = itemIdFromImg(img);
    if (!itemId) return;

    const btnWrap = document.createElement('span');
    btnWrap.className = 'tmvgb-btn input-money-symbol';
    btnWrap.title = 'Show cheapest 5 market listings';

    const k = document.createElement('span');
    k.className = 'tmvgb-k';
    k.textContent = '✓';
    btnWrap.appendChild(k);

    // place on the RIGHT of the price input
    priceWrapper.querySelector('.input-money-group')?.appendChild(btnWrap);

    btnWrap.addEventListener('click', async (e) => {
      e.stopPropagation();

      let apiKey = getKey();
      if (!apiKey || apiKey.length !== 16){
        const got = prompt('Enter your Torn PUBLIC API key (16 chars):', apiKey || '');
        if (!got) return;
        if (got.length !== 16) { alert('That key does not look valid.'); return; }
        setKey(got);
        apiKey = got;
      }

      // show loading near the button
      const rect = btnWrap.getBoundingClientRect();
      popup.style.left = (window.scrollX + rect.left - 10) + 'px';
      popup.style.top  = (window.scrollY + rect.bottom + 6) + 'px';
      popup.innerHTML = `<div class="tmvgb-muted">Loading listings…</div>`;
      popup.style.display = 'block';

      try{
        const res = await apiMarketListings(itemId, apiKey);
        if (res?.error){
          const msg = res.error?.error || `API error (code ${res.error?.code || '?'})`;
          popup.innerHTML = `<div class="tmvgb-muted">${msg}</div>`;
          return;
        }
        const html = renderListingsHtml(res.item?.name, res.listings || []);
        popup.innerHTML = html;
      }catch(err){
        popup.innerHTML = `<div class="tmvgb-muted">Failed to load listings.</div>`;
        console.error('[tmvgb] fetch failed', err);
      }
    });
  }

  // ---------- Observe View Listing and add buttons ----------
  function onMutations(muts){
    for (const m of muts){
      const t = m.target;
      // Only on the ViewListing tab
      if (!location.hash.includes('#/viewListing')) continue;

      // when the main wrapper appears or rows update
      if (String(t.className || '').includes('viewListingWrapper___') ||
          String(t.className || '').includes('priceInputWrapper___')){
        $$('.viewListingWrapper___ [class*=itemRowWrapper___] [class*=itemRow___]:not([class*=grayedOut___]) [class^=priceInputWrapper___]')
          .forEach(injectButton);
      }
    }
  }

  const root = document.querySelector('#item-market-root');
  if (!root) return;

  // seed once (in case the content is already there)
  setTimeout(() => {
    if (location.hash.includes('#/viewListing')){
      $$('.viewListingWrapper___ [class*=itemRowWrapper___] [class*=itemRow___]:not([class*=grayedOut___]) [class^=priceInputWrapper___]')
        .forEach(injectButton);
    }
  }, 500);

  const mo = new MutationObserver(onMutations);
  mo.observe(root, { childList: true, subtree: true });
})();
