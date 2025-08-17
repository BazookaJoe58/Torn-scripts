// ==UserScript==
// @name         Torn Item Market — Afford Badges (List View Debug)
// @namespace    https://torn.city/
// @version      1.0.4
// @description  Shows "Afford: N" next to the Buy button for each listing in Item Market list view (based on wallet, price, and qty). No prefilling, no auto-buy.
// @author       BazookaJoe
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_addStyle
// @run-at       document-idle
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-afford-badges.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-im-afford-badges.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- styles ----------
  GM_addStyle(`
    .im-afford-badge {
      display:inline-block;
      margin-left:8px;
      padding:2px 6px;
      font-size:11px;
      line-height:1.2;
      border-radius:999px;
      background:rgba(20,20,20,.9);
      color:#cfead6;
      border:1px solid rgba(120,200,160,.45);
      white-space:nowrap;
    }
    .im-afford-badge.im-zero {
      color:#f7d5d5;
      border-color:rgba(220,120,120,.5);
    }
  `);

  // ---------- helpers ----------
  const parseMoney = (txt) => {
    if (!txt) return NaN;
    // "$844,999" -> 844999
    const cleaned = String(txt).replace(/[^\d.]/g, '');
    return cleaned ? Math.floor(Number(cleaned)) : NaN;
  };

  const toInt = (txt) => {
    if (!txt) return NaN;
    const m = String(txt).match(/\d[\d,]*/);
    return m ? Number(m[0].replace(/[^\d]/g, '')) : NaN;
  };

  const readWallet = () => {
    // Best-effort scan of the top bar for a $-formatted amount
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

  // Your DOM (class fragments from the dump)
  const SEL = {
    list: 'ul[class*="sellerList"]',
    rowWrapper: 'li[class*="rowWrapper"]',
    row: 'div[class*="sellerRow"]',
    price: 'div[class*="price"]',
    qty: 'div[class*="available"]',
    buyBtn: 'button[class*="showBuyControlsButton"]'
  };

  const findRows = () => {
    const list = document.querySelector(SEL.list);
    if (!list) return [];
    // Each LI wrapper contains the .sellerRow
    return Array.from(list.querySelectorAll(`${SEL.rowWrapper} > ${SEL.row}`))
      .filter(r => r.offsetParent !== null);
  };

  const ensureBadgeHost = (row) => {
    // Prefer to attach next to the Buy button; otherwise append at end of row
    const buy = row.querySelector(SEL.buyBtn);
    return buy || row;
  };

  const ensureBadge = (host) => {
    let badge = host.querySelector(':scope > .im-afford-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'im-afford-badge';
      badge.textContent = 'Afford: —';
      if (host === rowOrNull(host).querySelector?.(SEL.buyBtn)) {
        // place right after the buy button
        host.insertAdjacentElement('afterend', badge);
      } else {
        host.appendChild(badge);
      }
    }
    return badge;
  };

  function rowOrNull(el){ return el && el.closest ? el.closest(SEL.row) : null; }

  const updateRow = (row, wallet) => {
    const priceEl = row.querySelector(SEL.price);
    const qtyEl = row.querySelector(SEL.qty);
    if (!priceEl || !qtyEl) return;

    const unitPrice = parseMoney(priceEl.textContent);
    const qty = toInt(qtyEl.textContent);

    if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(qty) || qty <= 0) return;

    const maxByMoney = Math.floor(wallet / unitPrice);
    const afford = Math.max(0, Math.min(maxByMoney, qty));

    const host = ensureBadgeHost(row);
    const badge = ensureBadge(host);
    badge.textContent = `Afford: ${afford.toLocaleString()}`;
    badge.classList.toggle('im-zero', afford === 0);
  };

  const updateAll = () => {
    if (!isMarketPage()) return;
    const wallet = readWallet();
    const rows = findRows();
    for (const r of rows) updateRow(r, wallet);
  };

  // ---------- observers & timers ----------
  const start = () => {
    // Initial passes (let the list render)
    setTimeout(updateAll, 200);
    setTimeout(updateAll, 800);

    // Observe list changes (pagination, sort, "Show more", etc.)
    const mo = new MutationObserver(() => {
      if (start._raf) cancelAnimationFrame(start._raf);
      start._raf = requestAnimationFrame(() => setTimeout(updateAll, 30));
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Periodic refresh (wallet can change; list updates)
    setInterval(updateAll, 2000);
  };

  if (isMarketPage()) start();
})();
