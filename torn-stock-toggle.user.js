// ==UserScript==
// @name         Torn Stock Toggle (Per-Stock Persistent)
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Adds a per-stock toggle on the Torn Stocks page with persistent state that doesn't shift when the list reorders
// @author       BazookaJoe
// @license      MIT
// @match        https://www.torn.com/*
// @downloadURL  https://github.com/BazookaJoe58/torn-scripts/raw/refs/heads/main/torn-stock-toggle.user.js
// @updateURL    https://github.com/BazookaJoe58/torn-scripts/raw/refs/heads/main/torn-stock-toggle.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // -------- Config (selectors are made resilient on purpose) --------
  const CONFIG = {
    storageKey: 'tst.v2.state', // localStorage map: { [stockKey]: { disabled: boolean } }
    pageMatch: /[?&]sid=stocks\b/i,
    selectors: {
      header: '.title-black, ul[class*="title"], ul[class*="header"]',
      listContainer: 'ul[class*="stockMarket"], div[class*="stockMarket"]',
      row: 'li[class*="stock___"], li[class*="stockItem"], div[class*="stock___"], div[class*="stockItem"]',
      nameLink: 'a[href*="stockID="], a[href*="stocks#/p=overview"]',
      dividendCell: 'li[class*="Dividend"], li[class*="stockDividend"], div[class*="Dividend"], div[class*="stockDividend"]',
      profitCell: 'li[class*="profit"], li[class*="Profit"], div[class*="profit"], div[class*="Profit"]'
    },
    classes: {
      rowDim: 'tst--row-dimmed',
      toggle: 'tst--toggle'
    }
  };

  // -------- Storage helpers --------
  const store = {
    load() {
      try {
        const raw = localStorage.getItem(CONFIG.storageKey);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
