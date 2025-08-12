// PATH: userscripts/torn-market-suite.user.js
// COMMIT: chore: bump to v0.1.4 (confirm auto-update)

// ==UserScript==
// @name         Torn Market Suite (Starter)
// @name         Torn Market: View Listing Green Button v0.1.4
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      0.1.5
// @description  Starter scaffold; updates from GitHub raw
// @version      0.1.4
// @description  Adds a small green ✓ button next to each price input on View Listing (does nothing yet).
// @author       BazookaJoe
// @license      MIT
// @match        https://www.torn.com/*
// @name         Torn Market: View Listing Green Button (test)
// @namespace    https://github.com/<your-username>/<your-repo>
// @version      0.1.2
// @description  Adds a small green ✓ button next to each price input on View Listing (does nothing yet).
// @author       You
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://*.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @homepageURL  https://github.com/BazookaJoe58/Torn-scripts
// @supportURL   https://github.com/BazookaJoe58/Torn-scripts/issues
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-market-suite.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-market-suite.user.js
// ==/UserScript==

(function () {
  'use strict';
  const tag = document.createElement('div');
  tag.textContent = 'TMS v0.1.4';
  tag.style.cssText = 'position:fixed;bottom:8px;right:8px;padding:4px 8px;font:12px/1.2 system-ui;border:1px solid #999;border-radius:6px;background:#fff;opacity:.9;z-index:999999;';
  document.body.appendChild(tag);
  setTimeout(() => tag.remove(), 3000);

  // Only act on the View Listing tab
  const onViewListing = () => location.hash.includes('/viewListing');

  // styles – small green pill on the RIGHT of the price input
  GM_addStyle(`
    .tmk-green-pill{
      display:inline-flex;align-items:center;justify-content:center;
      width:18px;height:18px;margin-left:6px;border-radius:4px;
      background:#27ae60;color:#fff;font-weight:700;font-size:12px;line-height:1;
      cursor:pointer;user-select:none;
    .bzj-green-btn {
      display:inline-flex; align-items:center; justify-content:center;
      font-size:12px; line-height:1; padding:2px 6px; border-radius:12px;
      border:1px solid #1f7a39; background:#23a455; color:#fff; cursor:pointer;
      margin-left:6px; user-select:none;
    }
    .bzj-green-btn:active { transform: translateY(1px); }
  `);

  const isViewListing = () => location.hash.includes('#/viewListing');
  const $all = (root, sel) => (root ? root.querySelectorAll(sel) : []);

  function injectGreenButton(priceWrapperEl) {
    if (!priceWrapperEl || priceWrapperEl.dataset.tmkGreenInjected === '1') return;

    const group = priceWrapperEl.querySelector('.input-money-group');
    if (!group) return;
  const addButtons = (root = document) => {
    if (!onViewListing()) return;

    // Prevent duplicates
    if (group.querySelector('.tmk-green-pill')) {
      priceWrapperEl.dataset.tmkGreenInjected = '1';
      return;
    }
    root
      .querySelectorAll('[class^=viewListingWrapper___] [class*=itemRowWrapper___] [class^=priceInputWrapper___]:not(.bzj-done)')
      .forEach(priceWrap => {
        const group = priceWrap.querySelector('.input-money-group');
        if (!group || group.querySelector('.bzj-green-btn')) {
          priceWrap.classList.add('bzj-done');
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
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bzj-green-btn';
        btn.title = 'Green button (placeholder)';
        btn.textContent = '✓';
        // placeholder click (no action yet)
        btn.addEventListener('click', () => {
          // no-op for now
        });

    const priceInput = group.querySelector('.input-money');
    if (priceInput) {
      // Insert on the RIGHT side of the price input
      group.insertBefore(pill, priceInput.nextSibling);
    } else {
      group.appendChild(pill); // fallback
    }
        // append to the RIGHT side of the price input group
        group.appendChild(btn);

    priceWrapperEl.dataset.tmkGreenInjected = '1';
  }
        priceWrap.classList.add('bzj-done');
      });
  };

  function scan() {
    if (!isViewListing()) return;
    const root = document.querySelector('#item-market-root');
    if (!root) return;
  // Initial pass
  addButtons(document);

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
  // Observe dynamic content
  const root = document.querySelector('#item-market-root') || document.body;
  const obs = new MutationObserver(muts => {
    if (!onViewListing()) return;
    for (const m of muts) addButtons(m.target);
  });
  obs.observe(root, { childList: true, subtree: true });

  scan();
  window.addEventListener('hashchange', scan);
})();
