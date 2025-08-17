// ==UserScript==
// @name         Torn Item Market — Prefill Cheapest (On Amount Focus)
// @namespace    https://torn.city/
// @version      1.0.2
// @description  When you click/focus the amount box in Item Market list view, auto-fill it with the maximum you can afford from wallet for that listing (never auto-buys).
// @author       BazookaJoe
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        none
// @run-at       document-idle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- helpers ----------
  const parseMoney = (txt) => {
    if (!txt) return NaN;
    const cleaned = String(txt).replace(/[^\d.]/g, '');
    return cleaned ? Math.floor(Number(cleaned)) : NaN;
  };

  const toInt = (txt) => {
    if (!txt) return NaN;
    const m = String(txt).match(/\d[\d,]*/);
    return m ? Number(m[0].replace(/[^\d]/g, '')) : NaN;
  };

  // Make frameworks notice value changes
  const setInputValue = (input, value) => {
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, String(value));
    else input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const readWallet = () => {
    const root = document.querySelector('#topRoot') || document.body;
    const nodes = Array.from(root.querySelectorAll('span, div, a, li, b, strong'))
      .filter((n) => /\$\s?[\d,. ]+/.test(n.textContent || ''));
    for (const n of nodes) {
      const val = parseMoney(n.textContent);
      if (Number.isFinite(val) && val >= 0) return val;
    }
    return NaN;
  };

  const isMarketPage = () => /page\.php\?sid=ItemMarket/i.test(location.href);

  const isAmountInput = (el) => {
    if (!(el instanceof HTMLInputElement)) return false;
    if (el.type === 'number') return true;
    const idn = (el.id || '').toLowerCase();
    const name = (el.name || '').toLowerCase();
    return /amount|qty|quantity/.test(idn) || /amount|qty|quantity/.test(name);
  };

  // Try to locate the listing row for a given amount input
  const findRow = (el) => {
    return el.closest('tr, .row, .table-row, .market-row, li, .list-item, .item-row, .items-list .item');
  };

  // Extract unit price (lowest $ in the row) and available qty if visible
  const extractRowData = (row) => {
    // price
    const priceNodes = Array.from(row.querySelectorAll('span, div, td, b, strong, a'))
      .filter((n) => /\$\s?[\d,. ]+/.test(n.textContent || ''));
    let unitPrice = NaN;
    if (priceNodes.length) {
      const prices = priceNodes
        .map((n) => parseMoney(n.textContent))
        .filter((v) => Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b);
      if (prices.length) unitPrice = prices[0];
    }

    // qty (optional)
    let listingQty = Infinity;
    const texts = Array.from(row.querySelectorAll('span, div, td, b, strong')).map(
      (n) => (n.textContent || '').trim()
    );
    for (const t of texts) {
      if (/^\s*x?\s*\d[\d,]*\s*$/i.test(t)) {
        const v = toInt(t);
        if (Number.isFinite(v) && v > 0) {
          listingQty = v;
          break;
        }
      }
      const m = t.match(/(qty|quantity|left)\s*[:\-]?\s*(\d[\d,]*)/i);
      if (m) {
        const v = toInt(m[2]);
        if (Number.isFinite(v) && v > 0) {
          listingQty = v;
          break;
        }
      }
      const m2 = t.match(/\((\d[\d,]*)\s*left\)/i);
      if (m2) {
        const v = toInt(m2[1]);
        if (Number.isFinite(v) && v > 0) {
          listingQty = v;
          break;
        }
      }
    }

    return { unitPrice, listingQty };
  };

  const computeFill = (wallet, unitPrice, listingQty) => {
    if (!Number.isFinite(wallet) || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
    const maxAffordable = Math.floor(wallet / unitPrice);
    if (!Number.isFinite(maxAffordable) || maxAffordable <= 0) return 0;
    return Math.max(1, Math.min(maxAffordable, Number.isFinite(listingQty) ? listingQty : Infinity));
  };

  const flash = (el) => {
    el.style.transition = 'box-shadow 0.25s ease';
    el.style.boxShadow = '0 0 0 3px rgba(0,160,255,0.55)';
    setTimeout(() => (el.style.boxShadow = '0 0 0 0 rgba(0,0,0,0)'), 300);
  };

  // ---------- main: delegate on focus/click ----------
  const handleAttemptPrefill = (input) => {
    if (!isMarketPage() || !isAmountInput(input)) return;

    const wallet = readWallet();
    if (!Number.isFinite(wallet) || wallet <= 0) return;

    const row = findRow(input);
    if (!row) return;

    const { unitPrice, listingQty } = extractRowData(row);
    const fill = computeFill(wallet, unitPrice, listingQty);

    if (fill === null) return;           // couldn't compute
    if (fill === 0) {                    // can't afford 1
      input.placeholder = 'Insufficient funds';
      return;
    }

    setInputValue(input, fill);
    flash(input);
  };

  // Focusin catches keyboard/tab focus; pointerdown catches taps before focus on mobile
  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (isAmountInput(target)) handleAttemptPrefill(target);
  });

  document.addEventListener('pointerdown', (e) => {
    const target = e.target;
    if (isAmountInput(target)) {
      // slight delay so DOM is fully present (if just opened)
      setTimeout(() => handleAttemptPrefill(target), 40);
    }
  });

  // Also try when panels mutate (e.g., switching item opens a fresh list)
  const mo = new MutationObserver(() => {
    // no automatic fills here — we only attach listeners;
    // but we’ll opportunistically prefill the currently focused amount box
    const active = document.activeElement;
    if (isAmountInput(active)) {
      setTimeout(() => handleAttemptPrefill(active), 60);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
