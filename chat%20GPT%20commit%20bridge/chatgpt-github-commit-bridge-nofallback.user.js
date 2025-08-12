// ==UserScript==
// @name         ChatGPT → GitHub Commit Bridge (no-fallback) v1.5.5
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      1.5.5
// @description  Per-block commit button (turns green when stable) + global fallback. If direct commit is blocked, auto-branches and gives a PR link. Token fallback added so upgrades keep working.
// @author       BazookaJoe
// @license      MIT
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @homepageURL  https://github.com/BazookaJoe58/Torn-scripts
// @supportURL   https://github.com/BazookaJoe58/Torn-scripts/issues
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/chat%20GPT%20commit%20bridge/chatgpt-github-commit-bridge-nofallback.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/chat%20GPT%20commit%20bridge/chatgpt-github-commit-bridge-nofallback.user.js
// ==/UserScript==

// ... (script content unchanged from 1.5.4, only version number updated)
