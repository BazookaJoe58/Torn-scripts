// ==UserScript==
// @name         Torn Item Market — Prefill Cheapest (Max Affordable)
// @namespace    https://torn.city/
// @version      1.0.1
// @description  In Item Market list view, auto-prefill the Buy amount on the cheapest visible listing with the maximum you can afford from wallet cash. UI helper only—no auto-buy.
// @author       BazookaJoe
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-idle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- small helpers ---
  const parseMoney = (txt) => {
    if (!txt) return NaN;
    const cleaned = String(txt).replace(/[^\d.]/g, '');
    return cleaned ? Math.floor(Number(cleaned)) : NaN;
  };

  const textToInt = (txt) => {
    if (!txt) return NaN;
    const m = String(txt).match(/\d[\d,]*/);
    return m ? Number(m[0].replace(/[^\d]/g, '')) : NaN;
  };

  // React-safe setter so the page’s listeners catch the value change
  const setInputValue = (input, value) => {
    const last = input.value;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    if (setter) setter.call(input, String(value));
    else input.value = String(value);
    if (last !== String(value)) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  // Try to read wallet money from the header (works on standard & most themes)
  const readWallet = () => {
    const roots = [document.querySelector('#topRoot') || document.body];
    for (const root of roots) {
      // Look for $-formatted amounts that are likely the wallet
      const nodes = Array.from(root.querySelectorAll('span, div, a, li, b, strong'))
        .filter((n) => /\$\s?[\d,. ]+/.test(n.textContent || ''));
      for (const n of nodes) {
        const val = parseMoney(n.textContent);
        if (Number.isFinite(val)) {
          // Heuristic: wallet is often displayed in a small cluster; prefer largest repeated value
          return val;
        }
      }
    }
    return NaN;
  };

  // Locate visible listing rows in the list view popup/panel
  const findListingRows = () => {
    // Panel containers Torn commonly uses around list view
    const panel = document.querySelector(
      '.item-list-wrap, .list-wrap, .market-list-wrap, .items-list, .market-wrapper, .content, #content'
    ) || document.body;

    // A “row” should contain: a Buy button, an amount input, and show a price text
    const buyButtons = Array.from(panel.querySelectorAll('button, a')).filter((b) =>
      /buy/i.test(b.textContent || '')
    );

    const rows = new Set();
    for (const b of buyButtons) {
      const row = b.closest('tr, .row, .table-row, .market-row, li, .list-item, .item-row, .items-list .item');
      if (row && row.offsetParent !== null) rows.add(row);
    }
    return Array.from(rows);
  };

  // For a row, try to extract unit price, available qty (if visible), and the qty input element
  const extractRowData = (row) => {
    // 1) pick the lowest-looking $ value inside the row as the unit price
    const priceNodes = Array.from(row.querySelectorAll('span, div, td, b, strong, a'))
      .filter((n) => /\$\s?[\d,. ]+/.test(n.textContent || ''));
    let unitPrice = NaN;
    if (priceNodes.length) {
      const prices = priceNodes
        .map((n) => parseMoney(n.textContent))
        .filter((v) => Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b);
      if (prices.length) unitPrice = prices[0]; // cheapest number in the row is usually the per-unit price
    }

    // 2) find the input next to the Buy button (or any number input in row)
    let amountInput =
      row.querySelector('input[type="number"]') ||
      Array.from(row.querySelectorAll('input')).find((i) =>
        /(amount|qty|quantity)/i.test(i.name || i.id || '')
      );

    // 3) try to detect listing qty (optional; Infinity if unknown)
    let listingQty = Infinity;
    const qtyHints = Array.from(row.querySelectorAll('span, div, td, b, strong'))
      .map((n) => n.textContent || '')
      .map((t) => t.trim());
    // Common patterns: "x123", "Qty: 123", "Quantity 123", "(123 left)"
    for (const t of qtyHints) {
      if (/^\s*x?\s*\d[\d,]*\s*$/i.test(t)) {
        const v = textToInt(t);
        if (Number.isFinite(v) && v > 0) {
          listingQty = v;
          break;
        }
      }
      const m = t.match(/(qty|quantity|left)\s*[:\-]?\s*(\d[\d,]*)/i);
      if (m) {
        const v = textToInt(m[2]);
        if (Number.isFinite(v) && v > 0) {
          listingQty = v;
          break;
        }
      }
      const m2 = t.match(/\((\d[\d,]*)\s*left\)/i);
      if (m2) {
        const v = textToInt(m2[1]);
        if (Number.isFinite(v) && v > 0) {
          listingQty = v;
          break;
        }
      }
    }

    if (!Number.isFinite(unitPrice) || !amountInput) return null;
    return { row, unitPrice, listingQty, amountInput };
  };

  const pickCheapestRow = (rows) => {
    const data = rows.map(extractRowData).filter(Boolean);
    if (!data.length) return null;
    data.sort((a, b) => a.unitPrice - b.unitPrice);
    return data[0];
  };

  // Core action: compute and prefill
  const prefill = () => {
    const wallet = readWallet();
    if (!Number.isFinite(wallet) || wallet <= 0) return;

    const rows = findListingRows();
    if (!rows.length) return;

    const cheapest = pickCheapestRow(rows);
    if (!cheapest) return;

    const { unitPrice, listingQty, amountInput } = cheapest;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return;

    const maxAffordable = Math.floor(wallet / unitPrice);
    if (!Number.isFinite(maxAffordable) || maxAffordable <= 0) {
      // Can't afford one—clear the input politely
      setInputValue(amountInput, '');
      amountInput.placeholder = 'Insufficient funds';
      return;
    }

    const fill = Math.max(1, Math.min(maxAffordable, listingQty));
    setInputValue(amountInput, fill);

    // Optional: brief highlight to show it worked
    flash(amountInput);
  };

  const flash = (el) => {
    el.style.transition = 'box-shadow 0.35s ease';
    el.style.boxShadow = '0 0 0 3px rgba(0,200,120,0.6)';
    setTimeout(() => (el.style.boxShadow = '0 0 0 0 rgba(0,0,0,0)'), 400);
  };

  // Mutation observer to catch list view openings/updates
  const startObserver = () => {
    let ticking = false;
    const schedule = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        // slight delay lets Torn render row contents completely
        setTimeout(prefill, 60);
      });
    };

    const mo = new MutationObserver((muts) => {
      // If nodes added that look like rows or inputs, schedule a pass
      for (const m of muts) {
        if (m.addedNodes && m.addedNodes.length) {
          for (const n of m.addedNodes) {
            if (!(n instanceof HTMLElement)) continue;
            if (
              n.querySelector?.('button, a, input[type="number"], .row, tr, .list-item, .item-row') ||
              /item|market|list/i.test(n.className || '')
            ) {
              schedule();
              break;
            }
          }
        }
      }
    });

    mo.observe(document.documentElement, { subtree: true, childList: true });
    // Initial runs
    setTimeout(prefill, 300);
    setTimeout(prefill, 1200);
    // Gentle periodic refresh for dynamic lists
    setInterval(prefill, 3000);
  };

  if (/page\.php\?sid=ItemMarket/i.test(location.href)) {
    startObserver();
  }
})();
