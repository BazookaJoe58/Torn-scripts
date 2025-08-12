// ==UserScript==
// @name         Torn Market Suite (Starter)
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      0.1.0
// @description  Starter scaffold; updates from GitHub raw
// @author       BazookaJoe
// @license      MIT
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @homepageURL  https://github.com/BazookaJoe58/Torn-scripts
// @supportURL   https://github.com/BazookaJoe58/Torn-scripts/issues
// @downloadURL  https://raw.githubusercontent.com/BazookaJoe58/Torn-scripts/main/userscripts/torn-market-suite.user.js
// @updateURL    https://raw.githubusercontent.com/BazookaJoe58/Torn-scripts/main/userscripts/torn-market-suite.user.js
// ==/UserScript==

(function () {
  'use strict';
  const tag = document.createElement('div');
  tag.textContent = 'TMS v0.1.0';
  tag.style.cssText = 'position:fixed;bottom:8px;right:8px;padding:4px 8px;font:12px/1.2 system-ui;border:1px solid #999;border-radius:6px;background:#fff;opacity:.9;z-index:999999;';
  document.body.appendChild(tag);
  setTimeout(() => tag.remove(), 3000);
})();
