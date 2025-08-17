// ==UserScript==
// @name         Torn Shoplifting Sentinel (Full-Screen Flash Alerts)
// @namespace    https://github.com/BazookaJoe58
// @version      1.0.0
// @description  Full-screen flashing alert when selected shoplifting securities are down. Per-store toggles for BOTH / Camera / Guards, draggable UI, API key input, interval control. PDA-friendly.
// @author       BazookaJoe
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_notification
// @license      MIT
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/shoplifting-alert-pro.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/shoplifting-alert-pro.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------ Storage helpers ------------------------
  const SKEY = {
    apiKey: 'tsentinel_api_key',
    cfg: 'tsentinel_cfg',
    pos: 'tsentinel_pos',
  };

  const DEFAULT_CFG = {
    enabled: true,
    intervalSec: 15,
    storeConfig: {},
    perStoreCooldownSec: 30,
    lastFired: {},
  };

  function loadJSON(key, fallback) {
    try {
      const v = GM_getValue(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, obj) {
    GM_setValue(key, JSON.stringify(obj));
  }

  let CFG = loadJSON(SKEY.cfg, DEFAULT_CFG);
  let API_KEY = GM_getValue(SKEY.apiKey, '');

  // ------------------------ CSS & UI skeleton ------------------------
  GM_addStyle(`
  #tsentinel-wrap { position: fixed; z-index: 1000000; width: 280px; top: 40px; left: 40px; background: #fff; color: #222;
    border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.25); font-family: system-ui, sans-serif; display: flex; flex-direction: column;
    overflow: hidden; border: 1px solid rgba(0,0,0,.08); }
  .dark-mode #tsentinel-wrap { color: #000; }
  #tsentinel-header { background:#f5f5f7; padding:10px 12px; font-weight:700; cursor:move; display:flex; align-items:center; gap:8px; }
  #tsentinel-handle { width: 10px; height: 10px; border-radius: 50%; background:#888; opacity:.35; }
  #tsentinel-title { flex: 1; font-size: 14px; }
  #tsentinel-controls { display:flex; gap:6px; align-items:center; }
  #tsentinel-body { padding:10px; max-height: 360px; overflow:auto; }
  #tsentinel-footer { padding:8px 10px; background:#fafafa; display:flex; align-items:center; gap:8px; border-top:1px solid rgba(0,0,0,.06); }
  .tswitch{ display:inline-flex; align-items:center; gap:6px; font-size:12px; cursor:pointer; }
  .tswitch input{ accent-color:#0a7; }
  .tinput { width: 110px; padding:4px 6px; font-size:12px; border:1px solid #ccc; border-radius:6px; }
  .tbtn { padding:4px 8px; font-size:12px; border:1px solid #ccc; background:#fff; border-radius:6px; cursor:pointer; }
  .tbtn:hover { background:#f2f2f2; }
  .store-card{ border:1px solid rgba(0,0,0,.06); border-radius:8px; padding:8px; margin-bottom:8px; background:#fff; }
  .store-top{ display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .store-name{ font-weight:700; font-size:13px; flex:1; text-transform:capitalize; }
  .chip { font-size:10px; padding:2px 6px; border-radius:999px; background:#eee; color:#333; }
  .toggles{ display:flex; gap:6px; flex-wrap:wrap; }
  .tgl { display:flex; align-items:center; gap:4px; font-size:12px; }
  .tgl input{ accent-color:#06c; }
  #tsentinel-flash { position: fixed; inset: 0; background: rgba(255,0,0,.65); z-index: 2147483647; pointer-events: none; opacity: 0;
    animation: tsentinel-pulse 1s ease-in-out 0s 6 alternate; }
  @keyframes tsentinel-pulse { from { opacity: 0; } to   { opacity: 1; } }
  #tsentinel-icon { width: 18px; height: 18px; background-image: url(/images/v2/editor/emoticons.svg);
    background-position: -74px -42px; cursor:pointer; opacity:.7; }
  #tsentinel-icon:hover { opacity:1; }
  `);

  const nicify = s => String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // ------------------------ Draggable panel ------------------------
  const wrap = document.createElement('div');
  wrap.id = 'tsentinel-wrap';
  try {
    const pos = loadJSON(SKEY.pos, { x: 40, y: 40 });
    wrap.style.left = pos.x + 'px'; wrap.style.top = pos.y + 'px';
  } catch {}
  wrap.innerHTML = `
    <div id="tsentinel-header">
      <div id="tsentinel-handle"></div>
      <div id="tsentinel-title">Shoplifting Sentinel</div>
      <div id="tsentinel-controls">
        <label class="tswitch"><input type="checkbox" id="tsentinel-enabled"><span>On</span></label>
        <div id="tsentinel-icon" title="Toggle panel"></div>
      </div>
    </div>
    <div id="tsentinel-body">
      <div style="display:flex; gap:6px; align-items:center; margin-bottom:8px;">
        <span style="font-size:12px; opacity:.8;">API key</span>
        <input id="tsentinel-apikey" class="tinput" type="password" placeholder="Paste…" />
        <button id="tsentinel-savekey" class="tbtn">Save</button>
        <span style="flex:1;"></span>
        <span style="font-size:12px; opacity:.8;">Every</span>
        <input id="tsentinel-interval" class="tinput" style="width:56px;" type="number" min="5" step="1"/>
        <span style="font-size:12px; opacity:.8;">sec</span>
      </div>
      <div id="tsentinel-stores"></div>
    </div>
    <div id="tsentinel-footer">
      <button id="tsentinel-refresh" class="tbtn">Refresh</button>
      <button id="tsentinel-test" class="tbtn">Test Flash</button>
      <span style="font-size:12px; opacity:.6; margin-left:auto;">Alerts flash full screen</span>
    </div>
  `;
  document.body.appendChild(wrap);

  // ... [Rest of the script is identical to the version I gave earlier, unchanged logic] ...
})();
