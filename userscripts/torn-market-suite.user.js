// ==UserScript==
// @name         Torn Market: View Listing Green Button (test)
// @namespace    https://github.com/<your-username>/<your-repo>
// @version      0.1.2
// @description  Adds a small green ✓ button next to each price input on View Listing (does nothing yet).
// @author       You
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://*.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @downloadURL  https://raw.githubusercontent.com/<your-username>/<your-repo>/main/torn-market-view-green-button.user.js
// @updateURL    https://raw.githubusercontent.com/<your-username>/<your-repo>/main/torn-market-view-green-button.user.js
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    .tmk-green-pill{
      display:inline-flex;align-items:center;justify-content:center;
      width:18px;height:18px;margin-left:6px;border-radius:4px;
      background:#27ae60;color:#fff;font-weight:700;font-size:12px;line-height:1;
      cursor:pointer;user-select:none;
    }
  `);

  const isViewListing = () => location.hash.includes('#/viewListing');
  const $all = (root, sel) => (root ? root.querySelectorAll(sel) : []);

  function injectGreenButton(priceWrapperEl) {
    if (!priceWrapperEl || priceWrapperEl.dataset.tmkGreenInjected === '1') return;

    const group = priceWrapperEl.querySelector('.input-money-group');
    if (!group) return;

    // Prevent duplicates
    if (group.querySelector('.tmk-green-pill')) {
      priceWrapperEl.dataset.tmkGreenInjected = '1';
      return;
    }

    const pill = document.createElement('span');
    pill.className = 'tmk-green-pill';
    pill.title = 'Green test button (no-op)';
    pill.setAttribute('aria-label', 'Green test button');
    pill.textContent = '✓';
    pill.addEventListener('click', () => {
      console.log('[TMK Green] click (no-op)');
    });

    const priceInput = group.querySelector('.input-money');
    if (priceInput) {
      // Insert on the RIGHT side of the price input
      group.insertBefore(pill, priceInput.nextSibling);
    } else {
      group.appendChild(pill); // fallback
    }

    priceWrapperEl.dataset.tmkGreenInjected = '1';
  }

  function scan() {
    if (!isViewListing()) return;
    const root = document.querySelector('#item-market-root');
    if (!root) return;

    const priceWrappers = $all(root, '[class^=viewListingWrapper___] [class^=priceInputWrapper___]');
    priceWrappers.forEach(injectGreenButton);
  }

  const root = document.querySelector('#item-market-root');
  if (root) {
    const mo = new MutationObserver(muts => {
      if (!isViewListing()) return;
      for (const m of muts) {
        const t = m.target;
        if (String(t.className || '').includes('priceInputWrapper___')) {
          injectGreenButton(t);
        }
      }
    });
    mo.observe(root, { childList: true, subtree: true });
  }

  scan();
  window.addEventListener('hashchange', scan);
})();
