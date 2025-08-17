// ==UserScript==
// @name         Torn Item Market — Prefill Cheapest (Max Affordable)
// @namespace    https://torn.city/
// @version      1.0.0
// @description  In Item Market list view, auto-prefill the Buy amount on the cheapest listing with the maximum you can afford from wallet cash. UI helper only—no auto-buy.
// @author       BazookaJoe
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-end
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function() {
  'use strict';

  // ---------------------------
  // Config
  // ---------------------------
  const STORAGE = {
    walletFallback: 'torn_im_prefill_cheapest_wallet_fallback',
    lastSeenItemName: 'torn_im_prefill_cheapest_last_item',
    lastRun: 'torn_im_prefill_cheapest_last_run_ts'
  };

  // If Torn header cash can’t be read reliably, we’ll show a tiny inline box
  const INLINE_WALLET_UI_ID = 'im-prefill-inline-wallet';

  GM_addStyle(`
    #${INLINE_WALLET_UI_ID} {
      position: sticky;
      top: 0;
      z-index: 9999;
      display: inline-flex;
      gap: 6px;
      align-items: center;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(0,0,0,0.35);
      backdrop-filter: blur(4px);
      font-size: 12px;
      margin: 6px 0;
    }
    #${INLINE_WALLET_UI_ID} input {
      width: 110px;
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid #666;
      outline: none;
      background: #121212;
      color: #ddd;
      font-size: 12px;
    }
    #${INLINE_WALLET_UI_ID} button {
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid #666;
      background: #1a1a1a;
      color: #ddd;
      cursor: pointer;
    }
    #${INLINE_WALLET_UI_ID} .status {
      opacity: 0.8;
    }
    .im-prefill-hint {
      font-size: 11px;
      opacity: 0.85;
      margin-left: 6px;
    }
  `);

  // ---------------------------
  // Utilities
  // ---------------------------
  const parseMoney = (txt) => {
    if (!txt) return NaN;
    // Handle formats: $1,234,567 or 1,234,567 or $ 1 234 567
    const cleaned = String(txt).replace(/[^\d.]/g, '');
    // Torn is integer dollars for wallet; ignore decimals if present
    return cleaned ? Math.floor(Number(cleaned)) : NaN;
  };

  const findWalletCash = () => {
    // Try a few likely candidates—aim to be resilient
    const candidates = [
      '#barMoney',           // classic id in some themes
      '.bar-money',          // generic class
      '[data-money]',        // data attribute if available
      '.user-money',
      // Torn’s top bar often has an element with money—scan any $-looking text
      '#topRoot, body'
    ];

    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (!el) continue;

      // If it's a broad node like body, do a more targeted scan inside it
      if (sel === '#topRoot' || sel === 'body') {
        const moneyish = Array.from(el.querySelectorAll('span, div, a, li, b'))
          .filter(n => /\$\s?[\d,. ]{1,}/.test(n.textContent || ''));
        for (const n of moneyish) {
          const val = parseMoney(n.textContent);
          if (Number.isFinite(val) && val >= 0) return val;
        }
      } else {
        const val = parseMoney(el.textContent);
        if (Number.isFinite(val) && val >= 0) return val;
      }
    }

    // Fallback from stored manual entry
    const stored = GM_getValue(STORAGE.walletFallback, null);
    if (stored && Number.isFinite(stored)) return stored;

    return NaN;
  };

  const nearestContainerForInlineWallet = () => {
    // Try to place inline widget near the opened item list panel
    // Common container heuristics for IM list view (robust to theme/DOM changes)
    const panelCandidates = [
      '.item-list-wrap', '.list-wrap', '.market-list-wrap',
      '.content', '#content', '.items-list', '.market-wrapper'
    ];
    for (const sel of panelCandidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // Fallback to body
    return document.body;
  };

  const ensureInlineWalletUI = (currentWalletVal) => {
    if (document.getElementById(INLINE_WALLET_UI_ID)) {
      // Update status
      const status = document.querySelector(`#${INLINE_WALLET_UI_ID} .status`);
      if (status) {
        status.textContent = Number.isFinite(currentWalletVal)
          ? `Wallet: $${currentWalletVal.toLocaleString()}`
          : `Wallet: unknown (enter below)`;
      }
      return;
    }

    const host = nearestContainerForInlineWallet();
    const box = document.createElement('div');
    box.id = INLINE_WALLET_UI_ID;

    const label = document.createElement('span');
    label.textContent = 'Prefill: using wallet';
    box.appendChild(label);

    const status = document.createElement('span');
    status.className = 'status';
    status.textContent = Number.isFinite(currentWalletVal)
      ? `Wallet: $${currentWalletVal.toLocaleString()}`
      : `Wallet: unknown (enter below)`;
    box.appendChild(status);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter wallet $ (e.g. 1,250,000)';
    input.value = GM_getValue(STORAGE.walletFallback, '') || '';
    box.appendChild(input);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Use';
    saveBtn.addEventListener('click', () => {
      const v = parseMoney(input.value);
      if (Number.isFinite(v) && v >= 0) {
        GM_setValue(STORAGE.walletFallback, v);
        status.textContent = `Wallet set: $${v.toLocaleString()}`;
      } else {
        status.textContent = `Invalid amount`;
      }
    });
    box.appendChild(saveBtn);

    const hint = document.createElement('span');
    hint.className = 'im-prefill-hint';
    hint.textContent = 'Note: Script only pre-fills. You still click Buy.';
    box.appendChild(hint);

    // Insert at top of the list container
    if (host.firstChild) {
      host.insertBefore(box, host.firstChild);
    } else {
      host.appendChild(box);
    }
  };

  const textToNumber = (txt) => {
    if (!txt) return NaN;
    return Number(String(txt).replace(/[^\d.]/g, ''));
  };

  // Try to detect list rows for the currently opened item
  const findListingRows = () => {
    // Heuristics: a row should contain a price, a quantity, a Buy button, and an amount input
    // We’ll gather candidates by presence of a buy button-like element
    const root = document.body;
    const buyCandidates = Array.from(root.querySelectorAll('button, a'))
      .filter(el => /buy/i.test(el.textContent || ''));

    const rows = new Set();
    buyCandidates.forEach(btn => {
      const row = btn.closest('tr, .row, li, .market-row, .table-row, .list-item, .item-row');
      if (row) rows.add(row);
    });

    return Array.from(rows);
  };

  const extractPriceQtyAndInput = (row) => {
    // Find price
    let price = NaN;
    // Scan for $-looking text nodes
    const priceEl = Array.from(row.querySelectorAll('span, div, td, b, strong'))
      .find(n => /\$\s?[\d,. ]{1,}/.test(n.textContent || ''));
    if (priceEl) price = parseMoney(priceEl.textContent);

    // Find max qty for this listing (if shown). If not visible, assume large.
    let qty = NaN;
    const qtyEl = Array.from(row.querySelectorAll('span, div, td, b, strong'))
      .find(n => /(x|qty|quantity)/i.test(n.textContent || '') || /^\s*\d+\s*x\s*$/i.test(n.textContent || ''));
    if (qtyEl) {
      // Try parse a leading/trailing number
      const m = (qtyEl.textContent || '').match(/\d[\d,]*/);
      if (m) qty = textToNumber(m[0]);
    }

    // Find amount input (the one next to Buy)
    const inputEl = Array.from(row.querySelectorAll('input'))
      .find(inp => /amount|qty|quantity/i.test(inp.name || inp.id || '') || inp.type === 'number');

    // Ignore rows without essential fields
    if (!Number.isFinite(price) || !inputEl) return null;

    return { price, qty: Number.isFinite(qty) ? qty : Infinity, input: inputEl, row };
  };

  const pickCheapest = (rowsData) => {
    // Sort by unit price asc
    const filtered = rowsData.filter(Boolean);
    if (!filtered.length) return null;
    filtered.sort((a, b) => a.price - b.price);
    return filtered[0];
  };

  const prefillCheapest = () => {
    const wallet = findWalletCash();
    ensureInlineWalletUI(wallet);

    const rows = findListingRows();
    if (!rows.length) return;

    const rowsData = rows.map(extractPriceQtyAndInput).filter(Boolean);
    if (!rowsData.length) return;

    const cheapest = pickCheapest(rowsData);
    if (!cheapest) return;

    if (!Number.isFinite(wallet)) {
      // Can’t compute max affordable—skip fill
      return;
    }

    // Torn item market listings are per unit (price each). Max we can afford:
    const maxAffordable = Math.floor(wallet / cheapest.price);
    if (maxAffordable <= 0) {
      // User can’t afford 1—leave it blank
      cheapest.input.value = '';
      cheapest.input.placeholder = 'Insufficient funds';
      dispatchInputEvents(cheapest.input);
      return;
    }

    const amountToFill = Math.max(1, Math.min(maxAffordable, cheapest.qty));
    cheapest.input.value = String(amountToFill);
    dispatchInputEvents(cheapest.input);
  };

  const dispatchInputEvents = (input) => {
    // Let Torn’s own listeners react
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // Focus/blur can help some frameworks recompute
    input.focus({ preventScroll: true });
    setTimeout(() => input.blur(), 10);
  };

  // ---------------------------
  // Detect opening of list panel & changes
  // ---------------------------
  const observeForListView = () => {
    const mo = new MutationObserver((muts) => {
      // Run lightly—debounce by timestamp
      const now = Date.now();
      const last = GM_getValue(STORAGE.lastRun, 0);
      if (now - last < 150) return;
      GM_setValue(STORAGE.lastRun, now);

      // If an item panel / list view appears or changes, try prefill
      prefillCheapest();
    });

    mo.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    // Also run once after load
    setTimeout(prefillCheapest, 500);
    setInterval(prefillCheapest, 3000); // gentle refresh for dynamic updates
  };

  // Only run on item market page
  const onIMPage = /page\.php\?sid=ItemMarket/i.test(location.href);
  if (!onIMPage) return;

  observeForListView();

})();
