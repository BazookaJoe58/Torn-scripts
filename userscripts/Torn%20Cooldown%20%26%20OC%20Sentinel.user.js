// ==UserScript==
// @name         Torn Cooldown & OC Sentinel
// @namespace    http://tampermonkey.net/
// @version      1.1.1
// @description  PDA-friendly sentinel with semi-transparent fullscreen flashing overlays + modal Acknowledge: Drug CD (0), Booster CD (<=20h), Education finish, Bank investment finish, and OC finished/not in OC. Overlay is click-through; modal captures clicks. Public API key only. OC status read from any Torn page DOM (no extra scopes). Minimizable control panel.
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
  const CHECK_INTERVAL_MS = 30_000;               // API poll cadence
  const OC_DOM_SCAN_INTERVAL_MS = 10_000;         // DOM scan cadence for OC
  const FLASH_INTERVAL_MS = 800;                  // overlay flash speed
  const ACK_SNOOZE_MS = 5 * 60_000;               // 5 min per-alert snooze
  const BOOSTER_ALERT_THRESHOLD_S = 20 * 3600;    // 20 hours
  const NOT_IN_OC_ALERT_COOLDOWN_MS = 30 * 60_000;// 30 min between "not in OC" alerts

  const STORAGE = {
    apiKey: 'tcos_api_key',
    toggles: 'tcos_toggles_v1',
    snoozeUntil: 'tcos_snooze_until_v1',
    lastStates: 'tcos_last_states_v1',
    panelPos: 'tcos_panel_pos_v1',
    minimized: 'tcos_panel_min_v1',
  };

  // Alerts + colors (now semi-transparent)
  const ALERTS = {
    drug:   { key: 'drug',   label: 'Drug cooldown',            color: 'rgba(39,174,96,0.5)'  }, // green
    booster:{ key: 'booster',label: 'Booster cooldown (≤20h)',  color: 'rgba(41,128,185,0.5)' }, // blue
    edu:    { key: 'edu',    label: 'Education finished',       color: 'rgba(142,68,173,0.5)' }, // purple
    bank:   { key: 'bank',   label: 'Bank investment finished', color: 'rgba(243,156,18,0.5)' }, // orange
    oc:     { key: 'oc',     label: 'OC finished / Not in OC',  color: 'rgba(192,57,43,0.5)'  }, // red
  };
  const DEFAULT_TOGGLES = { drug:true, booster:true, edu:true, bank:true, oc:true };

  // =========================
  // State
  // =========================
  let API_KEY = '';
  let toggles = {};
  let snoozeUntil = {};
  let lastStates = {};
  let mainTimer = null;
  let ocDomTimer = null;
  let flashTimer = null;
  let flashOn = false;
  let currentAlertKey = null;

  // =========================
  // Helpers
  // =========================
  const pad2 = (n) => String(n).padStart(2, '0');
  function formatHMS(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }
  const withinSnooze = (k) => Date.now() < (snoozeUntil[k] || 0);
  function setSnooze(k, ms = ACK_SNOOZE_MS) { snoozeUntil[k] = Date.now() + ms; persist(); }
  function clearSnooze(k){ snoozeUntil[k] = 0; }

  // =========================
  // Styles
  // =========================
  GM_addStyle(`
    /* Fullscreen flashing overlay (click-through) */
    #tcos-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0);
      z-index: 2147483646;
      pointer-events: none;
      transition: background-color 150ms linear;
    }
    /* Modal (captures clicks) */
    #tcos-modal-wrap {
      position: fixed; inset: 0;
      display: none;
      align-items: center; justify-content: center;
      z-index: 2147483647;
      pointer-events: none;
    }
    #tcos-modal {
      pointer-events: auto;
      max-width: 92vw; width: 360px;
      background: rgba(20,20,20,0.95);
      color: #fff; border-radius: 14px;
      padding: 14px 16px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans";
    }
    #tcos-modal h3 { margin: 0 0 8px; font-size: 18px; }
    #tcos-modal p  { margin: 6px 0 12px; line-height: 1.35; font-size: 14px; opacity: 0.9; }
    #tcos-modal .row { display:flex; gap:8px; flex-wrap: wrap; }
    #tcos-modal .btn { cursor:pointer; border:0; border-radius:10px; padding:10px 12px; background:#2ecc71; color:#111; font-weight:700; font-size:14px; }
    #tcos-modal .btn.secondary { background:#bdc3c7; }
    #tcos-modal .why { font-size:12px; opacity:0.8; margin-top:4px; }

    /* Panel + minimised tab */
    #tcos-panel {
      position: fixed; bottom: 16px; left: 16px;
      width: 320px; max-width: 95vw;
      background: rgba(0,0,0,0.85);
      color: #eee; border: 1px solid #444; border-radius: 14px;
      z-index: 2147483645; backdrop-filter: blur(4px);
      touch-action: none;
    }
    #tcos-head { display:flex; align-items:center; justify-content: space-between; padding:8px 10px; cursor: move; gap:8px; background: rgba(255,255,255,0.06); border-top-left-radius:14px; border-top-right-radius:14px; }
    #tcos-title { font-weight:800; font-size:14px; }
    #tcos-toggle { appearance:none; width:44px; height:26px; border-radius:26px; background:#777; position:relative; outline:none; cursor:pointer; }
    #tcos-toggle:checked { background:#2ecc71; }
    #tcos-toggle::after{ content:""; position:absolute; top:3px; left:3px; width:20px; height:20px; border-radius:50%; background:#fff; transition:left 150ms ease; }
    #tcos-toggle:checked::after{ left:21px; }

    #tcos-body { padding:10px; display:grid; gap:10px; grid-template-columns:1fr 1fr; }
    #tcos-body label { display:flex; gap:6px; align-items:center; font-size:13px; }
    #tcos-body .full { grid-column:1 / -1; }
    #tcos-body input[type="checkbox"]{ transform:scale(1.1); }
    #tcos-body input[type="text"]{ width:100%; padding:8px 10px; border-radius:10px; border:1px solid #555; background:#111; color:#eee; font-size:13px; }

    #tcos-foot { padding:8px 10px; display:flex; gap:8px; justify-content:flex-end; border-top:1px solid #333; flex-wrap: wrap; }
    #tcos-foot .btn { cursor:pointer; border:0; border-radius:10px; padding:8px 10px; background:#3498db; color:#fff; font-weight:700; font-size:13px; }
    #tcos-foot .btn.ghost { background:#555; }

    /* Tests menu (compact) */
    #tcos-tests-wrap { position: relative; }
    #tcos-tests-menu {
      position: absolute; right:0; bottom: 34px;
      display:none; min-width: 180px;
      background: rgba(20,20,20,0.98); border:1px solid #444; border-radius:10px; padding:6px;
      z-index: 2147483648;
    }
    #tcos-tests-menu button { width:100%; text-align:left; margin:2px 0; }

    /* Minimise tab */
    #tcos-minitab {
      position: fixed; left:0; top: 40%;
      transform: translateY(-50%);
      padding:10px 6px;
      background: rgba(0,0,0,0.85); color:#fff; border-top-right-radius:10px; border-bottom-right-radius:10px;
      border:1px solid #444; border-left: 0;
      z-index: 2147483645; cursor:pointer;
      font-weight:800; font-size:12px; writing-mode: vertical-rl; text-orientation: mixed;
      display:none; user-select:none;
    }

    /* Status pill */
    .tcos-pill {
      position: fixed; right: 10px; bottom: 10px;
      min-width: 120px; padding: 6px 10px; border-radius: 10px;
      background: rgba(0,0,0,0.75); color: #eee; border:1px solid #444;
      font-family: monospace; font-size:12px; z-index: 2147483644;
    }
    .tcos-pill span { display:inline-block; min-width: 60px; text-align: right; }

    #tcos-panel button:focus, #tcos-panel input:focus, #tcos-modal .btn:focus { outline: 2px solid #fff; outline-offset: 2px; }
  `);

  // =========================
  // DOM: overlay + modal
  // =========================
  const overlay = document.createElement('div');
  overlay.id = 'tcos-overlay';
  document.body.appendChild(overlay);

  const modalWrap = document.createElement('div');
  modalWrap.id = 'tcos-modal-wrap';
  modalWrap.innerHTML = `
    <div id="tcos-modal" role="dialog" aria-modal="true" aria-labelledby="tcos-title-h3">
      <h3 id="tcos-title-h3">Attention</h3>
      <p id="tcos-msg">Something needs your attention.</p>
      <div class="why" id="tcos-why"></div>
      <div class="row">
        <button class="btn" id="tcos-ack">Acknowledge</button>
        <button class="btn secondary" id="tcos-ack-snooze">Snooze 5m</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalWrap);
  const msgEl = modalWrap.querySelector('#tcos-msg');
  const whyEl = modalWrap.querySelector('#tcos-why');
  const ackBtn = modalWrap.querySelector('#tcos-ack');
  const ackSnoozeBtn = modalWrap.querySelector('#tcos-ack-snooze');

  // =========================
  // Control Panel + Minimise
  // =========================
  const panel = document.createElement('div');
  panel.id = 'tcos-panel';
  panel.innerHTML = `
    <div id="tcos-head">
      <div id="tcos-title">Cooldown & OC Sentinel</div>
      <input id="tcos-toggle" type="checkbox" checked>
    </div>
    <div id="tcos-body">
      <label><input type="checkbox" id="tcos-drug"> Drug</label>
      <label><input type="checkbox" id="tcos-booster"> Booster (≤20h)</label>
      <label><input type="checkbox" id="tcos-edu"> Education</label>
      <label><input type="checkbox" id="tcos-bank"> Bank</label>
      <label class="full"><input type="checkbox" id="tcos-oc"> OC finished / Not in OC</label>
      <div class="full">
        <label for="tcos-key" style="display:block;margin-bottom:4px;">Public API Key</label>
        <input id="tcos-key" type="text" placeholder="Paste your Public API key">
      </div>
    </div>
    <div id="tcos-foot">
      <div id="tcos-tests-wrap">
        <button class="btn ghost" id="tcos-tests-btn">Tests ▾</button>
        <div id="tcos-tests-menu" role="menu" aria-label="Test alerts">
          <button class="btn ghost" id="tcos-test-drug">Test Drug</button>
          <button class="btn ghost" id="tcos-test-booster">Test Booster</button>
          <button class="btn ghost" id="tcos-test-edu">Test Edu</button>
          <button class="btn ghost" id="tcos-test-bank">Test Bank</button>
          <button class="btn ghost" id="tcos-test-oc">Test OC</button>
        </div>
      </div>
      <button class="btn ghost" id="tcos-min">Minimise</button>
      <button class="btn" id="tcos-save">Save</button>
    </div>
  `;
  document.body.appendChild(panel);

  const miniTab = document.createElement('div');
  miniTab.id = 'tcos-minitab';
  miniTab.textContent = 'Sentinel';
  document.body.appendChild(miniTab);

  // Status pill
  const pill = document.createElement('div');
  pill.className = 'tcos-pill';
  pill.style.display = 'none';
  pill.innerHTML = `
    <div>Drug: <span id="pill-drug">--:--:--</span></div>
    <div>Booster: <span id="pill-booster">--:--:--</span></div>
    <div>Edu: <span id="pill-edu">--</span></div>
    <div>Bank: <span id="pill-bank">--</span></div>
    <div>OC: <span id="pill-oc">--</span></div>
  `;
  document.body.appendChild(pill);

  // Shortcuts
  const qs = (id) => document.getElementById(id);
  const masterToggle = qs('tcos-toggle');
  const keyInput = qs('tcos-key');
  const drugToggle = qs('tcos-drug');
  const boosterToggle = qs('tcos-booster');
  const eduToggle = qs('tcos-edu');
  const bankToggle = qs('tcos-bank');
  const ocToggle = qs('tcos-oc');

  // =========================
  // Persist
  // =========================
  async function loadPersisted() {
    API_KEY = await GM_getValue(STORAGE.apiKey, '');
    toggles = await GM_getValue(STORAGE.toggles, { ...DEFAULT_TOGGLES });
    snoozeUntil = await GM_getValue(STORAGE.snoozeUntil, {});
    lastStates = await GM_getValue(STORAGE.lastStates, {});
    const pos = await GM_getValue(STORAGE.panelPos, null);
    const min = await GM_getValue(STORAGE.minimized, false);

    keyInput.value = API_KEY || '';
    drugToggle.checked = !!toggles.drug;
    boosterToggle.checked = !!toggles.booster;
    eduToggle.checked = !!toggles.edu;
    bankToggle.checked = !!toggles.bank;
    ocToggle.checked = !!toggles.oc;

    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      panel.style.left = `${pos.x}px`;
      panel.style.top = `${pos.y}px`;
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
    }
    setMinimised(min);
  }
  async function persist() {
    await GM_setValue(STORAGE.apiKey, API_KEY);
    await GM_setValue(STORAGE.toggles, toggles);
    await GM_setValue(STORAGE.snoozeUntil, snoozeUntil);
    await GM_setValue(STORAGE.lastStates, lastStates);
  }

  // =========================
  // Flash / Modal
  // =========================
  function startFlash(color, reason, heading) {
    msgEl.textContent = heading || 'Attention';
    whyEl.textContent = reason || '';
    modalWrap.style.display = 'flex';

    overlay.style.background = 'transparent';
    if (flashTimer) clearInterval(flashTimer);
    flashOn = false;
    flashTimer = setInterval(() => {
      flashOn = !flashOn;
      overlay.style.backgroundColor = flashOn ? color : 'rgba(0,0,0,0.0)';
    }, FLASH_INTERVAL_MS);
  }
  function stopFlash() {
    if (flashTimer) clearInterval(flashTimer);
    flashTimer = null;
    flashOn = false;
    overlay.style.background = 'transparent';
    modalWrap.style.display = 'none';
  }
  function raiseAlert(alertKey, reasonText) {
    if (!toggles[alertKey]) return;
    if (withinSnooze(alertKey)) return;
    currentAlertKey = alertKey;
    const { color, label } = ALERTS[alertKey];
    startFlash(color, reasonText, label);
  }
  ackBtn.addEventListener('click', () => {
    if (currentAlertKey) { clearSnooze(currentAlertKey); persist(); }
    stopFlash();
  });
  ackSnoozeBtn.addEventListener('click', () => {
    if (currentAlertKey) setSnooze(currentAlertKey);
    stopFlash();
  });

  // =========================
  // API: cooldowns/edu/bank (Public key)
  // =========================
  function apiGet(selections) {
    if (!API_KEY) return Promise.reject(new Error('No API key'));
    const url = `https://api.torn.com/user/?selections=${encodeURIComponent(selections)}&key=${encodeURIComponent(API_KEY)}`;
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: 'GET', url,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            if (data?.error) return reject(new Error(data.error.error));
            resolve(data);
          } catch (e) { reject(e); }
        },
        onerror: (e) => reject(e),
      });
    });
  }

  async function checkAll() {
    if (!masterToggle.checked) return;

    // Cooldowns
    try {
      if (API_KEY && (toggles.drug || toggles.booster)) {
        const cd = await apiGet('cooldowns');
        const drugS = cd?.cooldowns?.drug ?? 0;
        const boosterS = cd?.cooldowns?.booster ?? 0;

        qs('pill-drug').textContent = formatHMS(drugS);
        qs('pill-booster').textContent = formatHMS(boosterS);

        // Drug finished
        if (toggles.drug && drugS === 0 && (lastStates.drugS ?? 1) !== 0) {
          if (!withinSnooze('drug')) raiseAlert('drug', 'Drug cooldown is now 0.');
        }

        // Booster threshold cross (only alert as we go from >20h to <=20h)
        if (toggles.booster && boosterS > 0 && boosterS <= BOOSTER_ALERT_THRESHOLD_S) {
          const wasAbove = (lastStates.boosterS ?? (BOOSTER_ALERT_THRESHOLD_S + 1)) > BOOSTER_ALERT_THRESHOLD_S;
          if (wasAbove && !withinSnooze('booster')) {
            raiseAlert('booster', `Booster cooldown ≤ 20 hours (${formatHMS(boosterS)} remaining).`);
          }
        }

        lastStates.drugS = drugS;
        lastStates.boosterS = boosterS;
      }
    } catch {}

    // Education + Bank
    try {
      if (API_KEY && (toggles.edu || toggles.bank)) {
        const [edu, money] = await Promise.allSettled([
          toggles.edu ? apiGet('education') : Promise.resolve(null),
          toggles.bank ? apiGet('money') : Promise.resolve(null),
        ]);

        if (toggles.edu && edu.status === 'fulfilled') {
          const timeLeft = edu.value?.education_timeleft ?? 0;
          const active = (edu.value?.education_current ?? 0) > 0 || timeLeft > 0;
          qs('pill-edu').textContent = active ? formatHMS(timeLeft) : 'idle';

          if ((lastStates.eduActive ?? false) && timeLeft === 0) {
            if (!withinSnooze('edu')) raiseAlert('edu', 'Education course finished.');
          }
          lastStates.eduActive = active;
          lastStates.eduTimeLeft = timeLeft;
        }

        if (toggles.bank && money.status === 'fulfilled') {
          const bank = money.value?.bank || {};
          const bankTimeLeft = bank?.time_left ?? 0;
          const bankActive = (bank?.amount ?? 0) > 0 && bankTimeLeft >= 0;
          qs('pill-bank').textContent = bankActive ? formatHMS(bankTimeLeft) : 'idle';

          if ((lastStates.bankActive ?? false) && bankTimeLeft === 0) {
            if (!withinSnooze('bank')) raiseAlert('bank', 'Bank investment finished.');
          }
          lastStates.bankActive = bankActive;
          lastStates.bankTimeLeft = bankTimeLeft;
        }
      }
    } catch {}

    pill.style.display = masterToggle.checked ? 'block' : 'none';
    await persist();
  }

  // =========================
  // OC from ANY page (DOM)
  // =========================
  // Heuristics:
  // 1) If we find an OC timer/icon globally (header/toolbar widgets often include a data-timer),
  //    treat as "in progress" and show remaining.
  // 2) If no OC UI elements are found for multiple scans, treat as "not in OC"
  //    but rate-limit alerts to avoid false positives.
  // 3) If a countdown reaches 0 -> alert "OC finished".
  let ocUnknownStreak = 0;
  const OC_UNKNOWN_STREAK_MAX = 3; // ~30s at 10s cadence before concluding "not in OC"

  function scanOCDom() {
    // Look for a generic OC widget:
    // - elements with title/tooltips mentioning Organized Crime or OC
    // - data-timer attributes adjacent to OC labels
    const body = document.body;
    const textCandidates = Array.from(body.querySelectorAll('[title],[aria-label],[data-title]'));
    const matchText = (s) => /organized\s*crime|organised\s*crime|\bOC\b/i.test(s || '');

    let ocNode = textCandidates.find(el => matchText(el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('data-title')));
    if (!ocNode) {
      // fallback: scan common header toolbars for “OC” text
      const header = document.querySelector('#header, .header, .toolbar, #top-page, .content-wrapper') || body;
      const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (matchText(node.nodeValue)) { ocNode = node.parentElement; break; }
      }
    }

    // Try to find a timer value nearby (data-timer, or a hh:mm(:ss))
    let secondsLeft = null;
    let inProgress = false;

    if (ocNode) {
      // search up to a small subtree around ocNode
      const scope = ocNode.closest('*') || ocNode;
      const candidateTimers = Array.from(scope.querySelectorAll('[data-timer], [data-time-left], [data-countdown], time, span, div'));
      for (const el of candidateTimers) {
        const dt = el.getAttribute && (el.getAttribute('data-timer') || el.getAttribute('data-time-left') || el.getAttribute('data-countdown'));
        if (dt && /^\d+$/.test(dt)) {
          secondsLeft = parseInt(dt, 10);
          inProgress = secondsLeft > 0;
          break;
        }
        const txt = (el.textContent || '').trim();
        const m = txt.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (m) {
          const h = parseInt(m[1], 10), mi = parseInt(m[2], 10), s = parseInt(m[3] || '0', 10);
          secondsLeft = h * 3600 + mi * 60 + (isNaN(s) ? 0 : s);
          inProgress = secondsLeft > 0;
          break;
        }
      }
    }

    if (inProgress) {
      ocUnknownStreak = 0;
      qs('pill-oc').textContent = formatHMS(secondsLeft ?? 0);

      // Finished transition
      const wasIn = !!lastStates.ocInProgress;
      if (wasIn && (secondsLeft === 0)) {
        if (!withinSnooze('oc')) raiseAlert('oc', 'OC finished.');
      }
      lastStates.ocInProgress = true;
      lastStates.ocSecondsLeft = Number.isFinite(secondsLeft) ? secondsLeft : lastStates.ocSecondsLeft ?? null;
      return;
    }

    // No visible OC widget detected
    ocUnknownStreak++;
    if (ocUnknownStreak >= OC_UNKNOWN_STREAK_MAX) {
      const wasIn = !!lastStates.ocInProgress;
      qs('pill-oc').textContent = 'not in OC';
      if (!wasIn) {
        // Rate-limit "not in OC"
        const last = lastStates.ocNotInOcAlertedAt || 0;
        if (Date.now() - last > NOT_IN_OC_ALERT_COOLDOWN_MS && !withinSnooze('oc')) {
          raiseAlert('oc', 'You are not in an OC.');
          lastStates.ocNotInOcAlertedAt = Date.now();
        }
      }
      lastStates.ocInProgress = false;
      lastStates.ocSecondsLeft = null;
    } else {
      // transient unknown
      qs('pill-oc').textContent = '…';
    }
  }

  // =========================
  // Draggable + Minimise
  // =========================
  (function makeDraggable() {
    const head = document.getElementById('tcos-head');
    let dragging = false, startX = 0, startY = 0;

    function onDown(e) {
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      startY = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - startX;
      const y = (e.touches ? e.touches[0].clientY : e.clientY) - startY;
      panel.style.left = `${Math.max(4, Math.min(window.innerWidth - panel.offsetWidth - 4, x))}px`;
      panel.style.top  = `${Math.max(4, Math.min(window.innerHeight - panel.offsetHeight - 4, y))}px`;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    }
    async function onUp() {
      if (!dragging) return;
      dragging = false;
      await GM_setValue(STORAGE.panelPos, {
        x: parseInt(panel.style.left || '16', 10),
        y: parseInt(panel.style.top  || (window.innerHeight - panel.offsetHeight - 16), 10),
      });
    }
    head.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    head.addEventListener('touchstart', onDown, { passive:false });
    window.addEventListener('touchmove', onMove, { passive:false });
    window.addEventListener('touchend', onUp);
  })();

  function setMinimised(min) {
    if (min) {
      panel.style.display = 'none';
      miniTab.style.display = 'block';
      GM_setValue(STORAGE.minimized, true);
    } else {
      panel.style.display = 'block';
      miniTab.style.display = 'none';
      GM_setValue(STORAGE.minimized, false);
    }
  }

  qs('tcos-min').addEventListener('click', () => setMinimised(true));
  miniTab.addEventListener('click', () => setMinimised(false));

  // =========================
  // Events
  // =========================
  // Save
  qs('tcos-save').addEventListener('click', async () => {
    API_KEY = keyInput.value.trim();
    toggles = {
      drug: !!drugToggle.checked,
      booster: !!boosterToggle.checked,
      edu: !!eduToggle.checked,
      bank: !!bankToggle.checked,
      oc: !!ocToggle.checked,
    };
    await persist();

    if (API_KEY && !mainTimer) mainTimer = setInterval(checkAll, CHECK_INTERVAL_MS);
    checkAll();

    if (!ocDomTimer) ocDomTimer = setInterval(scanOCDom, OC_DOM_SCAN_INTERVAL_MS);
    scanOCDom();
  });

  // Master toggle
  masterToggle.addEventListener('change', () => {
    if (!masterToggle.checked) {
      stopFlash();
      pill.style.display = 'none';
    } else {
      pill.style.display = 'block';
      checkAll();
      scanOCDom();
    }
  });

  // Tests compact menu
  const testsBtn = qs('tcos-tests-btn');
  const testsMenu = qs('tcos-tests-menu');
  testsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    testsMenu.style.display = testsMenu.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', (e) => {
    if (!testsMenu.contains(e.target) && e.target !== testsBtn) testsMenu.style.display = 'none';
  });

  // Test buttons
  qs('tcos-test-drug').addEventListener('click', () => { currentAlertKey = 'drug';   raiseAlert('drug',   'Test: Drug cooldown is now 0.'); });
  qs('tcos-test-booster').addEventListener('click', () => { currentAlertKey = 'booster';raiseAlert('booster','Test: Booster cooldown ≤ 20h.'); });
  qs('tcos-test-edu').addEventListener('click', () => { currentAlertKey = 'edu';    raiseAlert('edu',    'Test: Education course finished.'); });
  qs('tcos-test-bank').addEventListener('click', () => { currentAlertKey = 'bank';   raiseAlert('bank',   'Test: Bank investment finished.'); });
  qs('tcos-test-oc').addEventListener('click', () => { currentAlertKey = 'oc';     raiseAlert('oc',     'Test: OC finished / Not in OC.'); });

  // =========================
  // Init
  // =========================
  (async function init() {
    await loadPersisted();

    if (API_KEY) {
      if (!mainTimer) mainTimer = setInterval(checkAll, CHECK_INTERVAL_MS);
      checkAll();
    }
    if (!ocDomTimer) ocDomTimer = setInterval(scanOCDom, OC_DOM_SCAN_INTERVAL_MS);
    scanOCDom();

    pill.style.display = masterToggle.checked ? 'block' : 'none';
  })();

})();
