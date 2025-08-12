// ==UserScript==
// @name         Torn Market: View Listing Green Button v0.1.4
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      0.1.4
// @description  Adds a small green ✓ button next to each price input on View Listing (does nothing yet).
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

  // Only act on the View Listing tab
  const onViewListing = () => location.hash.includes('/viewListing');

  // styles – small green pill on the RIGHT of the price input
  GM_addStyle(`
    .bzj-green-btn {
      display:inline-flex; align-items:center; justify-content:center;
      font-size:12px; line-height:1; padding:2px 6px; border-radius:12px;
      border:1px solid #1f7a39; background:#23a455; color:#fff; cursor:pointer;
      margin-left:6px; user-select:none;
    }
    .bzj-green-btn:active { transform: translateY(1px); }
  `);

  const addButtons = (root = document) => {
    if (!onViewListing()) return;

    root
      .querySelectorAll('[class^=viewListingWrapper___] [class*=itemRowWrapper___] [class^=priceInputWrapper___]:not(.bzj-done)')
      .forEach(priceWrap => {
        const group = priceWrap.querySelector('.input-money-group');
        if (!group || group.querySelector('.bzj-green-btn')) {
          priceWrap.classList.add('bzj-done');
          return;
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bzj-green-btn';
        btn.title = 'Green button (placeholder)';
        btn.textContent = '✓';
        // placeholder click (no action yet)
        btn.addEventListener('click', () => {
          // no-op for now
        });

        // append to the RIGHT side of the price input group
        group.appendChild(btn);

        priceWrap.classList.add('bzj-done');
      });
  };

  // Initial pass
  addButtons(document);

  // Observe dynamic content
  const root = document.querySelector('#item-market-root') || document.body;
  const obs = new MutationObserver(muts => {
    if (!onViewListing()) return;
    for (const m of muts) addButtons(m.target);
  });
  obs.observe(root, { childList: true, subtree: true });

})();
