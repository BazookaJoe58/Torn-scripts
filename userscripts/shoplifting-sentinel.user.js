// ==UserScript==
// @name         Torn Shoplifting Sentinel (Full-Screen Flash Alerts)
// @namespace    https://github.com/BazookaJoe58
// @version      1.0.1
// @description  Full-screen flashing alert when selected shoplifting securities are down. Per-store toggles for BOTH / Camera / Guards, draggable UI, API key input, interval control. PDA-friendly. (Requires only a Public API key.) Flash is click-through except the Acknowledge box stays clickable.
// @author       BazookaJoe
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_notification
// @license      MIT
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/shoplifting-sentinel.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/shoplifting-sentinel.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------ Storage keys & defaults ------------------------
  const SKEY = {
    apiKey: 'tsentinel_api_key',
    cfg: 'tsentinel_cfg',
    pos: 'tsentinel_pos',
    lastShops: 'tsentinel_last_shops',
  };

  const DEFAULT_CFG = {
    enabled: true,
    intervalSec: 15,
    storeConfig: {},
    perStoreCooldownSec: 30,
    lastFired: {},
  };

  function loadJSON(key, fallback) {
    try { const v = GM_getValue(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function saveJSON(key, obj) { GM_setValue(key, JSON.stringify(obj)); }

  let CFG = loadJSON(SKEY.cfg, DEFAULT_CFG);
  let API_KEY = GM_getValue(SKEY.apiKey, '');

  // ------------------------ CSS ------------------------
  GM_addStyle(`
  #tsentinel-wrap {
    position: fixed; z-index: 2147483000; width: 300px; box-sizing: border-box;
    top: 40px; left: 40px; background: #fff; color: #222; border-radius: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,.25); font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(0,0,0,.08);
  }
  .dark-mode #tsentinel-wrap { color: #000; }
  #tsentinel-header {
    background:#f5f5f7; padding:10px 12px; font-weight:700; cursor:move; display:flex; align-items:center; gap:8px;
  }
  #tsentinel-title { flex: 1; font-size: 14px; }
  #tsentinel-controls { display:flex; gap:8px; align-items:center; }
  .tswitch{ display:inline-flex; align-items:center; gap:6px; font-size:12px; cursor:pointer; user-select:none; }
  .tswitch input{ accent-color:#0a7; }
  #tsentinel-body { padding:10px; max-height: 60vh; overflow:auto; }
  #tsentinel-footer { padding:8px 10px; background:#fafafa; display:flex; align-items:center; gap:8px; border-top:1px solid rgba(0,0,0,.06); }

  .tlabel { font-size:12px; opacity:.8; }
  .tinput { width: 120px; padding:4px 6px; font-size:12px; border:1px solid #ccc; border-radius:6px; }
  .tbtn { padding:4px 8px; font-size:12px; border:1px solid #ccc; background:#fff; border-radius:6px; cursor:pointer; }
  .tbtn:hover { background:#f2f2f2; }

  .store-card{ border:1px solid rgba(0,0,0,.08); border-radius:8px; padding:8px; margin-bottom:8px; background:#fff; }
  .store-top{ display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .store-name{ font-weight:700; font-size:13px; flex:1; text-transform:capitalize; }
  .chip { font-size:10px; padding:2px 6px; border-radius:999px; background:#eee; color:#333; white-space:nowrap; }
  .toggles{ display:flex; gap:10px; flex-wrap:wrap; }
  .tgl { display:flex; align-items:center; gap:4px; font-size:12px; white-space:nowrap; }
  .tgl input{ accent-color:#06c; }

  /* Full-screen flashing overlay (persistent until Acknowledge, click-through) */
  #tsentinel-overlay {
    position: fixed; inset: 0; z-index: 2147483647; display: none;
    background: rgba(255,0,0,.75);
    animation: tsentinel-pulse 1s ease-in-out infinite;
    pointer-events: none; /* click-through */
  }
  @keyframes tsentinel-pulse { from { opacity: .35; } to { opacity: 1; } }

  #tsentinel-overlay-inner {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
    background: rgba(0,0,0,.75); color: #fff; padding: 18px 16px; border-radius: 12px;
    min-width: 260px; max-width: 90vw; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,.35);
    border: 1px solid rgba(255,255,255,.15);
    pointer-events: auto; /* keep popup interactive */
  }
  #tsentinel-overlay-title { font-size: 16px; font-weight: 800; margin-bottom: 6px; }
  #tsentinel-overlay-reason { font-size: 14px; margin-bottom: 12px; line-height: 1.35; }
  #tsentinel-ack {
    border: 0; background: #ffd400; color: #000; font-weight: 800; border-radius: 999px;
    padding: 8px 16px; cursor: pointer; font-size: 14px;
  }
  #tsentinel-ack:hover { filter: brightness(0.95); }

  /* Header tiny toggle button injected into Torn status bar (optional) */
  #tsentinel-icon { width: 18px; height: 18px; cursor:pointer; opacity:.75; border-radius:4px; background:#eaeaea; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
  #tsentinel-icon:hover { opacity:1; }
  `);

  // ------------------------ Helpers ------------------------
  const nicify = s => String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  function ensureStoreEntry(storeKey) {
    if (!CFG.storeConfig[storeKey]) {
      CFG.storeConfig[storeKey] = { both: false, camera: false, guards: false };
    }
  }

  // ------------------------ Overlay ------------------------
  function ensureOverlay() {
    let ov = document.getElementById('tsentinel-overlay');
    if (ov) return ov;

    ov = document.createElement('div');
    ov.id = 'tsentinel-overlay';
    ov.innerHTML = `
      <div id="tsentinel-overlay-inner">
        <div id="tsentinel-overlay-title">Shoplifting Alert</div>
        <div id="tsentinel-overlay-reason">Security down</div>
        <button id="tsentinel-ack" type="button">Acknowledge</button>
      </div>
    `;
    document.documentElement.appendChild(ov);
    ov.querySelector('#tsentinel-ack').addEventListener('click', () => {
      ov.style.display = 'none';
    });
    return ov;
  }

  function flashFullScreen(reason) {
    try { if (typeof GM_notification === 'function') GM_notification({ title: 'Shoplifting Sentinel', text: reason || 'Alert', timeout: 4000 }); } catch {}
    const ov = ensureOverlay();
    ov.style.display = 'block';
    const reasonEl = ov.querySelector('#tsentinel-overlay-reason');
    if (reasonEl) reasonEl.textContent = reason || 'Security down';
  }

  // ------------------------ UI build, polling, rendering ------------------------
  // [The rest of the script is identical to the last 1.0.1 version I sent, 
  // with polling, per-store toggles, Acknowledge handling, etc. unchanged]
  
  // ... full rest of script here (unchanged from previous 1.0.1) ...
  
})();
