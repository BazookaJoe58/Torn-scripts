// ==UserScript==
// @name         Torn Item Market — Debug: Show Max Affordable per Listing
// @namespace    https://torn.city/
// @version      1.0.3
// @description  In Item Market list view, show a small badge above each listing's amount box with how many you can afford from your current wallet. No prefilling, no auto-buy—debug display only.
// @author       BazookaJoe
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_addStyle
// @run-at       document-idle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-prefill-cheapest.user.js
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    .im-afford-wrap{position:relative;display:inline-block}
    .im-afford-badge{
      position:absolute;
      bottom:100%;
      left:0;
      transform:translateY(-4px);
      font-size:11px;
      line-height:1;
      padding:3px 6px;
      border-radius:7px;
      background:rgba(20,20,20,.85);
      color:#cfead6;
      border:1px solid rgba(120,200,160,.45);
      white-space:nowrap;
      pointer-events:none;
      z-index:5;
      box-shadow:0 2px 6px rgba(0,0,0,.25);
    }
    .im-afford-badge.im-zero { color:#f7d5d5; border-color:rgba(220,120,120,.5) }
  `);

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

  const readWallet = () => {
    // Best-effort scan; works on standard top bar and most themes
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

  // Try to get the listing "row" for any element
  const findRow = (el) =>
    el?.closest?.('tr, .row, .table-row, .market-row, li, .list-item, .item-row, .items-list .item') || null;

  // Find candidate listing rows by presence of a Buy button
  const findListingRows = () => {
    const panel =
      document.querySelector(
        '.item-list-wrap, .list-wrap, .market-list-wrap, .items-list, .market-wrapper, .content, #content'
      ) || document.body;

    const buys = Array.from(panel.querySelectorAll('button, a')).filter((b) => /buy/i.test(b.textContent || ''));
    const rows = new Set();
    for (const b of buys) {
      const r = findRow(b);
      if (r && r.offsetParent !== null) rows.add(r);
    }
    return Array.from(rows);
  };

  // Extract unit price, listing qty (if visible), and the amount input in this row
  const extractRowParts = (row) => {
    // Amount input (usually next to Buy)
    const amountInput =
      row.querySelector('input[type="number"]') ||
      Array.from(row.querySelectorAll('input')).find((i) =>
        /(amount|qty|quantity)/i.test(i.name || i.id || '')
      );

    // Price: pick smallest $ in the row (per-unit price)
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

    // Listing quantity (optional)
    let listingQty = Infinity;
    const texts = Array.from(row.querySelectorAll('span, div, td, b, strong')).map((n) =>
      (n.textContent || '').trim()
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

    if (!amountInput || !Number.isFinite(unitPrice)) return null;
    return { amountInput, unitPrice, listingQty };
  };

  const computeAffordable = (wallet, unitPrice, listingQty) => {
    if (!Number.isFinite(wallet) || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
    const maxByMoney = Math.floor(wallet / unitPrice);
    if (!Number.isFinite(maxByMoney) || maxByMoney < 0) return null;
    const maxByQty = Number.isFinite(listingQty) ? listingQty : Infinity;
    // Display what you can actually buy right now (clamped by listing qty if available)
    return Math.max(0, Math.min(maxByMoney, maxByQty));
  };

  // Insert a small badge directly above the amount input (without breaking layout)
  const ensureBadge = (amountInput) => {
    // Wrap input once with a relative container so badge can sit above it
    if (!amountInput.parentElement.classList.contains('im-afford-wrap')) {
      const wrap = document.createElement('span');
      wrap.className = 'im-afford-wrap';
      amountInput.parentElement.insertBefore(wrap, amountInput);
      wrap.appendChild(amountInput);
    }
    const wrap = amountInput.parentElement;
    let badge = wrap.querySelector(':scope > .im-afford-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'im-afford-badge';
      badge.textContent = 'Afford: —';
      wrap.insertBefore(badge, wrap.firstChild);
    }
    return badge;
  };

  const updateRowBadge = (row, wallet) => {
    const parts = extractRowParts(row);
    if (!parts) return;
    const { amountInput, unitPrice, listingQty } = parts;
    const badge = ensureBadge(amountInput);

    const afford = computeAffordable(wallet, unitPrice, listingQty);
    if (afford === null) {
      badge.textContent = 'Afford: —';
      badge.classList.remove('im-zero');
      return;
    }
    badge.textContent = `Afford: ${afford.toLocaleString()}`;
    if (afford === 0) badge.classList.add('im-zero');
    else badge.classList.remove('im-zero');
  };

  const updateAll = () => {
    if (!isMarketPage()) return;
    const wallet = readWallet();
    const rows = findListingRows();
    for (const r of rows) updateRowBadge(r, wallet);
  };

  // ---------- observers & timers ----------
  const start = () => {
    // Initial & delayed passes (let Torn render)
    setTimeout(updateAll, 200);
    setTimeout(updateAll, 800);

    // Mutation observer for panel/list changes
    const mo = new MutationObserver(() => {
      // Small debounce via rAF helps on big DOM changes
      if (start._raf) cancelAnimationFrame(start._raf);
      start._raf = requestAnimationFrame(() => setTimeout(updateAll, 40));
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Periodic refresh (wallet can change or rows can lazy-render)
    setInterval(updateAll, 2500);
  };

  if (isMarketPage()) start();
})();
