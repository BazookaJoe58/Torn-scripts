// ==UserScript==
// @name         Torn Shoplifting Sentinel (Full-Screen Flash Alerts)
// @namespace    https://github.com/BazookaJoe58
// @version      1.0.1
// @description  Full-screen flashing alert when selected shoplifting securities are down. Per-store toggles for BOTH / Camera / Guards, draggable UI, API key input, interval control. PDA-friendly. (Requires only a Public API key.)
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
    // storeConfig: { [storeKey]: { both: false, camera: false, guards: false } }
    storeConfig: {},
    perStoreCooldownSec: 30,
    lastFired: {}, // storeKey -> unix seconds
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

  /* Full-screen flashing overlay (persistent until Acknowledge) */
  #tsentinel-overlay {
    position: fixed; inset: 0; z-index: 2147483647; display: none;
    background: rgba(255,0,0,.75);
    animation: tsentinel-pulse 1s ease-in-out infinite;
  }
  @keyframes tsentinel-pulse { from { opacity: .35; } to { opacity: 1; } }

  #tsentinel-overlay-inner {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
    background: rgba(0,0,0,.75); color: #fff; padding: 18px 16px; border-radius: 12px;
    min-width: 260px; max-width: 90vw; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,.35);
    border: 1px solid rgba(255,255,255,.15);
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

  // ------------------------ Overlay (persistent until Acknowledge) ------------------------
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
    // desktop notification too
    try { if (typeof GM_notification === 'function') GM_notification({ title: 'Shoplifting Sentinel', text: reason || 'Alert', timeout: 4000 }); } catch {}
    const ov = ensureOverlay();
    ov.style.display = 'block';
    const reasonEl = ov.querySelector('#tsentinel-overlay-reason');
    if (reasonEl) reasonEl.textContent = reason || 'Security down';
  }

  // ------------------------ UI Build ------------------------
  function buildPanel() {
    if (document.getElementById('tsentinel-wrap')) return;

    const wrap = document.createElement('div');
    wrap.id = 'tsentinel-wrap';
    // restore position
    try {
      const pos = loadJSON(SKEY.pos, { x: 40, y: 40 });
      wrap.style.left = pos.x + 'px';
      wrap.style.top = pos.y + 'px';
    } catch {}

    wrap.innerHTML = `
      <div id="tsentinel-header">
        <div id="tsentinel-title">Shoplifting Sentinel</div>
        <div id="tsentinel-controls">
          <label class="tswitch" title="Enable/Disable polling"><input type="checkbox" id="tsentinel-enabled"><span>On</span></label>
          <div id="tsentinel-icon" title="Hide/Show Panel">S</div>
        </div>
      </div>
      <div id="tsentinel-body">
        <div style="display:flex; gap:6px; align-items:center; margin-bottom:8px; flex-wrap:wrap;">
          <span class="tlabel">API key (Public only)</span>
          <input id="tsentinel-apikey" class="tinput" type="password" placeholder="Paste…" />
          <button id="tsentinel-savekey" class="tbtn">Save</button>
          <span style="flex:1;"></span>
          <span class="tlabel">Every</span>
          <input id="tsentinel-interval" class="tinput" style="width:56px;" type="number" min="5" step="1"/>
          <span class="tlabel">sec</span>
        </div>
        <div id="tsentinel-stores">
          <div class="tlabel" style="padding:6px 0;opacity:.7;">Paste your Public API key and click Save to load stores…</div>
        </div>
      </div>
      <div id="tsentinel-footer">
        <button id="tsentinel-refresh" class="tbtn" title="Poll now">Refresh</button>
        <button id="tsentinel-test" class="tbtn" title="Test flash">Test Flash</button>
        <span style="font-size:12px; opacity:.6; margin-left:auto;">Requires only a Public API key</span>
      </div>
    `;
    document.body.appendChild(wrap);

    // Draggable
    (function makeDraggable() {
      const header = wrap.querySelector('#tsentinel-header');
      let sx=0, sy=0, ox=0, oy=0, dragging=false;
      header.addEventListener('mousedown', e => { dragging = true; sx = e.clientX; sy = e.clientY; ox = wrap.offsetLeft; oy = wrap.offsetTop; e.preventDefault(); });
      window.addEventListener('mousemove', e => { if (!dragging) return; const dx = e.clientX - sx, dy = e.clientY - sy; wrap.style.left = (ox + dx) + 'px'; wrap.style.top = (oy + dy) + 'px'; });
      window.addEventListener('mouseup', () => { if (dragging) saveJSON(SKEY.pos, { x: wrap.offsetLeft, y: wrap.offsetTop }); dragging = false; });
    })();

    // Wire controls
    const $enabled  = wrap.querySelector('#tsentinel-enabled');
    const $api      = wrap.querySelector('#tsentinel-apikey');
    const $saveKey  = wrap.querySelector('#tsentinel-savekey');
    const $interval = wrap.querySelector('#tsentinel-interval');
    const $stores   = wrap.querySelector('#tsentinel-stores');
    const $refresh  = wrap.querySelector('#tsentinel-refresh');
    const $test     = wrap.querySelector('#tsentinel-test');
    const $icon     = wrap.querySelector('#tsentinel-icon');

    $enabled.checked = !!CFG.enabled;
    $api.value = API_KEY || '';
    $interval.value = CFG.intervalSec;

    $icon.addEventListener('click', () => {
      wrap.style.display = (wrap.style.display === 'none') ? '' : 'none';
    });

    $saveKey.addEventListener('click', async () => {
      API_KEY = $api.value.trim();
      GM_setValue(SKEY.apiKey, API_KEY);
      await pingNow(true, $stores);
    });

    $enabled.addEventListener('change', () => {
      CFG.enabled = $enabled.checked; saveJSON(SKEY.cfg, CFG);
      if (CFG.enabled) startPolling(); else stopPolling();
    });

    $interval.addEventListener('change', () => {
      let v = parseInt($interval.value, 10);
      if (isNaN(v) || v < 5) v = 5;
      CFG.intervalSec = v; saveJSON(SKEY.cfg, CFG);
      restartPolling();
    });

    $refresh.addEventListener('click', () => pingNow(true, $stores));
    $test.addEventListener('click', () => {
      ensureOverlay();
      flashFullScreen('TEST — manual check');
    });

    // Render cached shops immediately (if any)
    const cached = loadJSON(SKEY.lastShops, null);
    if (cached && Array.isArray(cached)) renderStores(cached, $stores);

    // auto-start polling if enabled
    if (CFG.enabled) startPolling();
  }

  // ------------------------ Rendering ------------------------
  function renderStores(list, $storesEl) {
    const $stores = $storesEl || document.getElementById('tsentinel-stores');
    if (!$stores) return;

    $stores.innerHTML = '';
    list.forEach(({ key, status }) => {
      ensureStoreEntry(key);

      // derive down states
      let camDown = null, grdDown = null;
      status.forEach(d => {
        const t = (d.title || '').toLowerCase();
        if (t.includes('camera')) camDown = !!d.disabled;
        if (t.includes('guard'))  grdDown = !!d.disabled;
      });

      const card = document.createElement('div');
      card.className = 'store-card';
      card.innerHTML = `
        <div class="store-top">
          <div class="store-name">${nicify(key)}</div>
          <div class="chip">${
            camDown === null && grdDown === null ? '…' :
            camDown && grdDown ? 'Both down' :
            camDown ? 'Camera down' :
            grdDown ? 'Guards down' : 'All up'
          }</div>
        </div>
        <div class="toggles">
          <label class="tgl" title="Only alert if both Camera & Guards are down">
            <input type="checkbox" data-k="${key}" data-f="both"> Both
          </label>
          <label class="tgl" title="Alert when Camera is down (if Both is OFF)">
            <input type="checkbox" data-k="${key}" data-f="camera"> Camera
          </label>
          <label class="tgl" title="Alert when Guards are down (if Both is OFF)">
            <input type="checkbox" data-k="${key}" data-f="guards"> Guards
          </label>
        </div>
      `;
      $stores.appendChild(card);

      // set stored states
      const cfg = CFG.storeConfig[key];
      card.querySelector('input[data-f="both"]').checked   = !!cfg.both;
      card.querySelector('input[data-f="camera"]').checked = !!cfg.camera;
      card.querySelector('input[data-f="guards"]').checked = !!cfg.guards;

      // attach changes
      card.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.addEventListener('change', () => {
          const f = chk.dataset.f, k = chk.dataset.k;
          ensureStoreEntry(k);
          CFG.storeConfig[k][f] = chk.checked;
          saveJSON(SKEY.cfg, CFG);
        });
      });
    });
    saveJSON(SKEY.cfg, CFG);
  }

  // ------------------------ Polling & API ------------------------
  let timer = null, busy = false;

  function startPolling() { stopPolling(); timer = setInterval(pingNow, CFG.intervalSec * 1000); pingNow(); }
  function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }
  function restartPolling() { if (CFG.enabled) startPolling(); }

  async function fetchShoplifting() {
    if (!API_KEY) throw new Error('No API key set');
    const url = `https://api.torn.com/torn/?selections=shoplifting&key=${encodeURIComponent(API_KEY)}`;
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    const json = await res.json();
    if (json?.error) {
      const msg = json.error.error || 'API error';
      if (msg.toLowerCase().includes('key')) throw new Error('Incorrect API key');
      throw new Error(msg);
    }
    return json?.shoplifting || {};
  }

  async function pingNow(forceUI = false, $storesEl = null) {
    if (!CFG.enabled && !forceUI) return;
    if (busy) return;
    busy = true;
    try {
      const raw = await fetchShoplifting();
      const entries = Object.entries(raw).map(([key, status]) => ({ key, status }));

      // cache shops so toggles show on next load even before fetch
      saveJSON(SKEY.lastShops, entries);

      renderStores(entries, $storesEl);

      // Decide alerts
      const now = Math.floor(Date.now() / 1000);
      entries.forEach(({ key, status }) => {
        ensureStoreEntry(key);
        const cfg = CFG.storeConfig[key];

        let camDown = null, grdDown = null;
        status.forEach(d => {
          const t = (d.title || '').toLowerCase();
          if (t.includes('camera')) camDown = !!d.disabled;
          if (t.includes('guard'))  grdDown = !!d.disabled;
        });
        if (camDown === null && grdDown === null) return;

        let shouldAlert = false;
        if (cfg.both) {
          shouldAlert = (camDown === true && grdDown === true);
        } else {
          if (cfg.camera && camDown === true) shouldAlert = true;
          if (cfg.guards && grdDown === true) shouldAlert = true;
        }

        if (shouldAlert) {
          const last = CFG.lastFired[key] || 0;
          if (now - last >= (CFG.perStoreCooldownSec || 30)) {
            CFG.lastFired[key] = now;
            saveJSON(SKEY.cfg, CFG);

            const parts = [];
            if (cfg.both) parts.push('Both securities');
            else {
              if (cfg.camera && camDown) parts.push('Camera');
              if (cfg.guards && grdDown) parts.push('Guards');
            }
            const which = parts.join(' & ') || 'Security';
            const reason = `${nicify(key)} — ${which} down`;

            flashFullScreen(reason);
          }
        }
      });
    } catch (e) {
      if (String(e.message || e).toLowerCase().includes('api key')) {
        const $api = document.getElementById('tsentinel-apikey');
        if ($api) { $api.style.outline = '2px solid #e33'; setTimeout(() => ($api.style.outline = ''), 1500); }
      }
      // console.warn('[Shoplifting Sentinel]', e);
    } finally { busy = false; }
  }

  // ------------------------ Bootstrap ------------------------
  function ready(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return fn();
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }
  ready(() => {
    const tryMount = () => { if (!document.body) return void setTimeout(tryMount, 200); buildPanel(); };
    tryMount();

    // Tiny "S" button in status bar for quick toggle
    const injectStatusIcon = () => {
      const bar = document.querySelector('ul[class*=status-icons]');
      if (!bar) return setTimeout(injectStatusIcon, 1000);
      if (bar.querySelector('.tsentinel-entry')) return;
      const li = document.createElement('li'); li.className = 'tsentinel-entry';
      const btn = document.createElement('div'); btn.id = 'tsentinel-icon'; btn.textContent = 'S';
      btn.title = 'Shoplifting Sentinel – toggle panel';
      btn.addEventListener('click', () => {
        const panel = document.getElementById('tsentinel-wrap');
        if (panel) panel.style.display = (panel.style.display === 'none') ? '' : 'none';
      });
      li.appendChild(btn); bar.prepend(li);
    };
    injectStatusIcon();
  });
})();
