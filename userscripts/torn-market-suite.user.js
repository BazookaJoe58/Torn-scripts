// ==UserScript==
// @name         Torn Market: View Listing Green Button (test)
// @namespace    https://github.com/<your-username>/<your-repo>
// @version      0.2.0
// @description  Adds a small green ✓ button next to each price input on View Listing (does nothing yet). Includes TM menu to set an API key.
// @author       You
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://*.torn.com/page.php?sid=ItemMarket*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @downloadURL  https://raw.githubusercontent.com/<your-username>/<your-repo>/main/torn-market-view-green-button.user.js
// @updateURL    https://raw.githubusercontent.com/<your-username>/<your-repo>/main/torn-market-view-green-button.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ===== API KEY STORAGE =====
  const KEY_NAME = 'tmk_api_key';

  function getApiKey() {
    return (GM_getValue(KEY_NAME, '') || '').trim();
  }
  function maskKey(k) {
    if (!k) return '(not set)';
    return k.length <= 8 ? '****' : `${k.slice(0, 4)}…${k.slice(-4)}`;
  }
  function isLikelyTornKey(k) {
    return /^[A-Za-z0-9]{16}$/.test(k);
  }
  function setApiKeyFlow() {
    const current = getApiKey();
    const input = prompt(
      `Enter your PUBLIC Torn API key (16 chars):`,
      current || ''
    );
    if (input === null) return; // cancelled
    const trimmed = input.trim();
    if (!isLikelyTornKey(trimmed)) {
      alert('That does not look like a valid 16-char key. Try again.');
      return;
    }
    GM_setValue(KEY_NAME, trimmed);
    try {
      GM_notification({
        title: 'Torn Market (test)',
        text: `API key saved: ${maskKey(trimmed)}`,
        timeout: 3000,
      });
    } catch {
      alert(`API key saved: ${maskKey(trimmed)}`);
    }
  }
  function clearApiKeyFlow() {
    const had = getApiKey();
    GM_setValue(KEY_NAME, '');
    try {
      GM_notification({
        title: 'Torn Market (test)',
        text: had ? 'API key cleared.' : 'No API key was set.',
        timeout: 2500,
      });
    } catch {
      alert(had ? 'API key cleared.' : 'No API key was set.');
    }
  }

  // Register Tampermonkey menu commands (show in the dropdown)
  try {
    GM_registerMenuCommand(`Set API Key (current: ${maskKey(getApiKey())})`, setApiKeyFlow);
    GM_registerMenuCommand('Clear API Key', clearApiKeyFlow);
  } catch (e) {
    console.warn('[TMK View Test] Menu registration failed:', e);
  }

  // ===== UI: Green Button (no-op) =====
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
      console.log('[TMK Green] click (no-op). API key status:', maskKey(getApiKey()));
    });

    const priceInput = group.querySelector('.input-money');
    if (priceInput) {
      // Place on the RIGHT of the price input
      group.insertBefore(pill, priceInput.nextSibling);
    } else {
      group.appendChild(pill);
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
