// ==UserScript==
// @name         Torn Market: View Listing Green Button v0.1.5
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      0.1.5
// @description  Adds a small green ✓ button next to each price input on View Listing (does nothing yet). View Listing page only.
// @author       BazookaJoe
// @license      MIT
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://*.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @homepageURL  https://github.com/BazookaJoe58/Torn-scripts
// @supportURL   https://github.com/BazookaJoe58/Torn-scripts/issues
// @downloadURL  https://raw.githubusercontent.com/BazookaJoe58/Torn-scripts/main/userscripts/torn-market-view-green-button.user.js
// @updateURL    https://raw.githubusercontent.com/BazookaJoe58/Torn-scripts/main/userscripts/torn-market-view-green-button.user.js
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    .silm-gb-btn{
      display:inline-flex; align-items:center; justify-content:center;
      margin-left:6px; padding:0 8px; min-width:24px; height:26px;
      border:1px solid #1fa950; border-radius:6px;
      background:#0b2; color:#fff; font-weight:700; cursor:pointer;
      box-shadow:inset 0 0 0 1px #0a3a18; user-select:none;
    }
    .silm-gb-btn:hover{filter:brightness(1.05)}
  `);

  const root = document.querySelector('#item-market-root');
  if (!root) return;

  const isInViewListing = (el) => {
    // ensure we only add buttons under the View Listing wrapper
    let n = el;
    while (n) {
      if (String(n.className || '').includes('viewListingWrapper___')) return true;
      n = n.parentElement;
    }
    return false;
  };

  const addButton = (priceWrapper) => {
    if (!priceWrapper || !isInViewListing(priceWrapper)) return;

    const group = priceWrapper.querySelector('.input-money-group');
    if (!group || group.querySelector('.silm-gb-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'silm-gb-btn';
    btn.title = 'Green button (placeholder)';
    btn.textContent = '✓';

    // Put it on the RIGHT side of the price input
    group.appendChild(btn);
  };

  const scan = (ctx = document) => {
    ctx
      .querySelectorAll(
        '[class*=itemRowWrapper___]:not(.silm-gb-processed) > [class*=itemRow___]:not([class*=grayedOut___]) [class^=priceInputWrapper___]'
      )
      .forEach((priceWrapper) => {
        const wrap = priceWrapper.closest('[class*=itemRowWrapper___]');
        if (wrap) wrap.classList.add('silm-gb-processed');
        addButton(priceWrapper);
      });
  };

  // Initial pass (safe to run; addButton checks it's really View Listing)
  scan(root);

  // Watch DOM updates from the SPA
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.target;
      if (!t) continue;
      const cls = String(t.className || '');
      if (cls.includes('viewListingWrapper___') || cls.includes('priceInputWrapper___')) {
        scan(t);
      }
    }
  });
  mo.observe(root, { childList: true, subtree: true });
})();
