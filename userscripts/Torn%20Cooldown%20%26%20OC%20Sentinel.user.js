// ==UserScript==
// @name         Torn Cooldown & OC Sentinel
// @namespace    http://tampermonkey.net/
// @version      1.3.1
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

  // =========================
  // Config
  // =========================
  const POLL_MS = 30_000;
  const TICK_MS = 1_000;
  const OC_DOM_SCAN_MS = 10_000;
  const FLASH_INTERVAL_MS = 800;
  const SNOOZE_MS = 5 * 60_000;
  const BOOSTER_THRESHOLD_S = 20 * 3600;
  const NOT_IN_OC_COOLDOWN_MS = 30 * 60_000;

  const STORAGE = {
    key: 'tcos_api_key_v4',
    toggles: 'tcos_toggles_v4',
    snooze: 'tcos_snooze_v4',
    last: 'tcos_last_v4',
    ends: 'tcos_ends_v4',
    pos: 'tcos_panel_pos_v1',
    minimized: 'tcos_panel_min_v1',
  };

  const ALERTS = {
    drug:   { key: 'drug',   label: 'Drug cooldown',           color: 'rgba(39,174,96,0.5)'  }, // green
    booster:{ key: 'booster',label: 'Booster cooldown (≤20h)', color: 'rgba(41,128,185,0.5)' }, // blue
    edu:    { key: 'edu',    label: 'Education finished',      color: 'rgba(142,68,173,0.5)' }, // purple
    oc:     { key: 'oc',     label: 'OC finished / Not in OC', color: 'rgba(192,57,43,0.5)'  }, // red
  };
  const DEFAULT_TOGGLES = { drug:true, booster:true, edu:true, oc:true };

  // =========================
  // State
  // =========================
  let API_KEY = '';
  let toggles = {};
  let snoozeUntil = {};
  let last = {};
  let ends = { drug:0, booster:0, edu:0, oc:0 };

  let flashTimer = null;
  let flashOn = false;
  let currentAlertKey = null;
  let pillTick = null;
  let pollTimer = null;
  let ocDomTimer = null;
  let ocUnknownStreak = 0;
  const OC_UNKNOWN_STREAK_MAX = 3;

  // =========================
  // Helpers
  // =========================
  const pad2 = (n) => String(n).padStart(2, '0');
  function fmtHMS(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }
  const withinSnooze = (k) => Date.now() < (snoozeUntil[k] || 0);
  function setSnooze(k, ms = SNOOZE_MS) { snoozeUntil[k] = Date.now() + ms; persist(); }
  function clearSnooze(k){ snoozeUntil[k] = 0; }

  function secLeftFromEnd(endMs) { return Math.ceil((endMs - Date.now()) / 1000); }
  function setEndFromSeconds(key, seconds) { ends[key] = seconds > 0 ? (Date.now() + seconds * 1000) : 0; }

  // =========================
  // Styles
  // =========================
  GM_addStyle(`
    #tcos-overlay{position:fixed;inset:0;background:rgba(0,0,0,0);z-index:2147483646;pointer-events:none;transition:background-color 120ms linear;}
    #tcos-modal-wrap{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:2147483647;pointer-events:none;}
    #tcos-modal{pointer-events:auto;max-width:92vw;width:360px;background:rgba(20,20,20,0.95);color:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,0.5);font-family:system-ui,-apple-system,Segoe UI,Roboto,"Helvetica Neue",Arial;}
    #tcos-modal h3{margin:0 0 8px;font-size:18px;}
    #tcos-modal p{margin:6px 0 12px;line-height:1.35;font-size:14px;opacity:.9;}
    #tcos-modal .row{display:flex;gap:8px;flex-wrap:wrap;}
    #tcos-modal .btn{cursor:pointer;border:0;border-radius:10px;padding:10px 12px;background:#2ecc71;color:#111;font-weight:700;font-size:14px;}
    #tcos-modal .btn.secondary{background:#bdc3c7;}
    #tcos-modal .why{font-size:12px;opacity:.8;margin-top:4px;}

    #tcos-panel{position:fixed;bottom:16px;left:16px;width:340px;max-width:95vw;background:rgba(0,0,0,0.85);color:#eee;border:1px solid #444;border-radius:14px;z-index:2147483645;backdrop-filter:blur(4px);touch-action:none;}
    #tcos-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;cursor:move;gap:8px;background:rgba(255,255,255,0.06);border-top-left-radius:14px;border-top-right-radius:14px;}
    #tcos-title{font-weight:800;font-size:14px;}
    #tcos-toggle{appearance:none;width:44px;height:26px;border-radius:26px;background:#777;position:relative;outline:none;cursor:pointer;}
    #tcos-toggle:checked{background:#2ecc71;}
    #tcos-toggle::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left 150ms ease;}
    #tcos-toggle:checked::after{left:21px;}

    #tcos-body{padding:10px;display:grid;gap:10px;grid-template-columns:1fr 1fr;}
    #tcos-body label{display:flex;gap:6px;align-items:center;font-size:13px;}
    #tcos-body .full{grid-column:1 / -1;}
    #tcos-body input[type="checkbox"]{transform:scale(1.1);}
    #tcos-body input[type="text"]{width:100%;padding:8px 10px;border-radius:10px;border:1px solid #555;background:#111;color:#eee;font-size:13px;}
    #tcos-foot{padding:8px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #333;flex-wrap:wrap;}
    #tcos-foot .btn{cursor:pointer;border:0;border-radius:10px;padding:8px 10px;background:#3498db;color:#fff;font-weight:700;font-size:13px;}
    #tcos-foot .btn.ghost{background:#555;}

    #tcos-tests-wrap{position:relative;}
    #tcos-tests-menu{position:absolute;right:0;bottom:34px;display:none;min-width:180px;background:rgba(20,20,20,0.98);border:1px solid #444;border-radius:10px;padding:6px;z-index:2147483648;}
    #tcos-tests-menu button{width:100%;text-align:left;margin:2px 0;}

    #tcos-minitab{position:fixed;left:0;top:40%;transform:translateY(-50%);padding:10px 6px;background:rgba(0,0,0,0.85);color:#fff;border-top-right-radius:10px;border-bottom-right-radius:10px;border:1px solid #444;border-left:0;z-index:2147483645;cursor:pointer;font-weight:800;font-size:12px;writing-mode:vertical-rl;text-orientation:mixed;display:none;user-select:none;}

    .tcos-pill{position:fixed;right:10px;bottom:10px;min-width:140px;padding:8px 10px;border-radius:10px;background:rgba(0,0,0,0.75);color:#eee;border:1px solid #444;font-family:monospace;font-size:12px;z-index:2147483644}
    .tcos-pill div{display:flex;justify-content:space-between;gap:8px;}
    #tcos-panel button:focus,#tcos-panel input:focus,#tcos-modal .btn:focus{outline:2px solid #fff;outline-offset:2px;}
  `);

  // (code continues, with bank references fully stripped out from toggles, ends, alerts, pills, refresh, etc.)
})();
