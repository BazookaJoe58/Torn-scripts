// ==UserScript==
// @name         Torn Market: View Listing Green Button (test)
// @namespace    https://github.com/your-username/your-repo
// @version      0.1.0
// @description  Adds a small green ✓ button next to each price input on View Listing (does nothing yet).
// @author       You
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(function() {
  'use strict';

  // --- styles for the tiny green pill ---
  GM_addStyle(`
    .silmaril-green-pill{
      display:inline-flex;align-items:center;justify-content:center;
      width:18px;height:18px;margin-left:4px;border-radius:4px;
      background:#27ae60;color:#fff;font-weight:700;font-size:12px;line-height:1;
      cursor:pointer;user-select:none;
    }
  `);

  const isViewListing = () => location.hash.includes('#/viewListing');

  // Safe query helper
  const $all = (root, sel) => (root ? root.querySelectorAll(sel) : []);

  // Inject one green button into a single price wrapper
  function injectGreenButton(priceWrapperEl){
    if (!priceWrapperEl || priceWrapperEl.__greenInjected) return;

    const group = priceWrapperEl.querySelector('.input-money-group');
    if (!group) return;

    // Don't duplicate
    if (group.querySelector('.silmaril-green-pill')) {
      priceWrapperEl.__greenInjected = true;
      return;
    }

    const pill = document.createElement('span');
    pill.className = 'silmaril-green-pill';
    pill.title = 'Green test button (no-op)';
    pill.textContent = '✓';
    pill.addEventListener('click', () => {
      console.log('[ViewGreenButton] Clicked (no-op)');
    });

    // Insert before the price input so it sits next to the existing icon/button
    const priceInput = group.querySelector('.input-money');
    group.insertBefore(pill, priceInput || group.firstChild);

    priceWrapperEl.__greenInjected = true;
  }

  // Scan current DOM for price wrappers on the view-listing page
  function scan() {
    if (!isViewListing()) return;
    const root = document.querySelector('#item-market-root');
    if (!root) return;

    // Only under the viewListing wrapper
    const priceWrappers = $all(root, '[class^=viewListingWrapper___] [class^=priceInputWrapper___]');
    priceWrappers.forEach(injectGreenButton);
  }

  // Observe React updates so our button doesn’t disappear
  const root = document.querySelector('#item-market-root');
  if (root) {
    const mo = new MutationObserver(muts => {
      if (!isViewListing()) return;
      for (const m of muts) {
        const t = m.target;
        // If a price wrapper or its subtree changed, try inject there
        if (String(t.className || '').indexOf('priceInputWrapper___') > -1) {
          injectGreenButton(t);
        } else {
          // Fallback: scan small area
          scan();
        }
      }
    });
    mo.observe(root, { childList: true, subtree: true });
  }

  // Initial pass
  scan();

  // Also re-scan when hash changes (navigating between tabs/routes)
  window.addEventListener('hashchange', scan);
})();
