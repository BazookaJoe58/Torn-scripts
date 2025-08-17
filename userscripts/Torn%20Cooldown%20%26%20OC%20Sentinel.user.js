// ==UserScript==
// @name         Torn Cooldown & OC Sentinel
// @namespace    http://tampermonkey.net/
// @version      1.3.3
// @description  Semi-transparent full-screen flash + modal acknowledge for: Drug (0), Booster (≤20h), Education finish, OC finished / Not in OC. PDA-friendly, draggable, minimisable. Single API key (Limited recommended). Overlay is click-through; modal captures clicks. Author: BazookaJoe.
// @author       BazookaJoe
// @match        https://www.torn.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM.xmlHttpRequest
// @connect      api.torn.com
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/Torn%20Cooldown%20%26%20OC%20Sentinel.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/Torn%20Cooldown%20%26%20OC%20Sentinel.user.js
// ==/UserScript==

(function () {
  'use strict';

  // … all the same code as 1.3.2 …

  GM_addStyle(`
    /* … existing styles … */

    #tcos-minitab{
      position:fixed;
      right:0;                      /* moved from left to right */
      top:40%;
      transform:translateY(-50%);
      padding:10px 6px;
      background:rgba(0,0,0,0.85);
      color:#fff;
      border-top-left-radius:10px;
      border-bottom-left-radius:10px;
      border:1px solid #444;
      border-right:0;
      z-index:2147483645;
      cursor:pointer;
      font-weight:800;
      font-size:12px;
      writing-mode:vertical-rl;
      text-orientation:mixed;
      display:none;
      user-select:none;
    }

    .tcos-pill{
      position:fixed;
      right:0;                      /* attach under mini-tab */
      top:calc(40% + 70px);         /* just below the mini-tab */
      transform:translateY(-50%);
      min-width:140px;
      padding:8px 10px;
      border-radius:10px 0 0 10px;  /* rounded on left side */
      background:rgba(0,0,0,0.75);
      color:#eee;
      border:1px solid #444;
      font-family:monospace;
      font-size:12px;
      z-index:2147483644
    }
    .tcos-pill div{display:flex;justify-content:space-between;gap:8px;}
  `);

  // … rest of script unchanged …

})();
