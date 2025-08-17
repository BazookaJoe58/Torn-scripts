// ==UserScript==
// @name         Torn Cooldown & OC Sentinel
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  PDA-friendly sentinel with full-screen flashing overlays and modal acknowledge: Drug CD (0), Booster CD (<=20h), Education finish, Bank investment finish, and OC finished/not in OC. Overlay is click-through; modal captures clicks. Public API key only.
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

  // -----------------------------
  // Config (tweak as desired)
  // -----------------------------
  const CHECK_INTERVAL_MS = 30_000;         // API poll cadence
  const OC_CHECK_INTERVAL_MS = 60_000;      // Faction page poll cadence (for OC status)
  const FLASH_INTERVAL_MS = 1_000;          // Overlay flash speed
  const ACK_SNOOZE_MS = 5 * 60_000;         // Snooze per alert after acknowledge (5 min)
  const BOOSTER_ALERT_THRESHOLD_S = 20 * 3600; // 20 hours (alert when <= this)
  const STORAGE = {
    apiKey: 'torn_api_key',
    toggles: 'tcos_toggles_v1',
    snoozeUntil: 'tcos_snooze_until_v1',
    lastStates: 'tcos_last_states_v1',
    panelPos: 'tcos_panel_pos_v1',
  };

  // Alert keys (used for toggles/snoozes/colors/messages)
  const ALERTS = {
    drug:   { key: 'drug',   label: 'Drug cooldown',            color: '#27ae60' }, // green
    booster:{ key: 'booster',label: 'Booster cooldown (≤20h)',  color: '#2980b9' }, // blue
    edu:    { key: 'edu',    label: 'Education finished',       color: '#8e44ad' }, // purple
    bank:   { key: 'bank',   label: 'Bank investment finished', color: '#f39c12' }, // orange
    oc:     { key: 'oc',     label: 'OC finished / Not in OC',  color: '#c0392b' }, // red
  };

  const DEFAULT_TOGGLES = {
    drug: true,
    booster: true,
    edu:   true,
    bank:  true,
    oc:    true,
  };

  // -----------------------------
  // State
  // -----------------------------
  let API_KEY = '';
  let mainTimer = null;
  let ocTimer = null;
  let flashTimer = null;
  let flashOn = false;

  // in-memory mirrors (persisted via GM_*):
  // toggles: {alertKey: bool}
  // snoozeUntil: {alertKey: timestampMS}
  // lastStates: {e.g., boosterSeconds, eduActive, bankActive, ocInProgress, ocEndEpoch}
  let toggles = {};
  let snoozeUntil = {};
  let lastStates = {};

  // -----------------------------
  // Styles (overlay is click-through; modal captures input)
  // -----------------------------
  GM_addStyle(`
    /* Fullscreen flashing overlay (pointer-events none = click-through) */
    #tcos-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.0);
      z-index: 2147483646;
      pointer-events: none;
      transition: background-color 150ms linear;
    }
    /* Modal wrapper (captures clicks) */
    #tcos-modal-wrap {
      position: fixed; inset: 0;
      display: none;
      align-items: center; justify-content: center;
      z-index: 2147483647;
      pointer-events: none; /* pass through except the modal itself */
    }
    #tcos-modal {
      pointer-events: auto;
      max-width: 92vw; width: 360px;
      background: rgba(20,20,20,0.95);
      color: #fff; border-radius: 14px;
      padding: 14px 16px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
    }
    #tcos-modal h3 { margin: 0 0 8px; font-size: 18px; }
    #tcos-modal p  { margin: 6px 0 12px; line-height: 1.35; font-size: 14px; opacity: 0.9; }
    #tcos-modal .row { display:flex; gap:8px; flex-wrap: wrap; }
    #tcos-modal .btn {
      user-select:none; cursor:pointer;
      border:0; border-radius:10px; padding:10px 12px;
      background:#2ecc71; color:#111; font-weight:700; font-size: 14px;
    }
    #tcos-modal .btn.secondary { background:#bdc3c7; }
    #tcos-modal .why { font-size:12px; opacity:0.8; margin-top:4px; }

    /* PDA-friendly, draggable control panel */
    #tcos-panel {
      position: fixed; bottom: 16px; left: 16px;
      width: 320px; max-width: 95vw;
      background: rgba(0,0,0,0.85);
      color: #eee; border: 1px solid #444; border-radius: 14px;
      z-index: 2147483645;
      backdrop-filter: blur(4px);
      touch-action: none;
    }
    #tcos-head {
      display:flex; align-items:center; justify-content: space-between;
      padding: 8px 10px; cursor: move; gap: 8px;
      background: rgba(255,255,255,0.06);
      border-top-left-radius: 14px; border-top-right-radius: 14px;
    }
    #tcos-title { font-weight: 800; font-size: 14px; }
    #tcos-toggle { appearance:none; width:44px; height:26px; border-radius: 26px; background:#777; position:relative; outline:none; cursor:pointer; }
    #tcos-toggle:checked { background:#2ecc71; }
    #tcos-toggle::after{
      content:""; position:absolute; top:3px; left:3px; width:20px; height:20px; border-radius:50%;
      background:#fff; transition:left 150ms ease;
    }
    #tcos-toggle:checked::after{ left:21px; }
    #tcos-body { padding:10px; display:grid; gap:10px; grid-template-columns: 1fr 1fr; }
    #tcos-body label { display:flex; gap:6px; align-items:center; font-size:13px; }
    #tcos-body input[type="checkbox"] { transform: scale(1.1); }
    #tcos-body .full { grid-column: 1 / -1; }
    #tcos-body input[type="text"]{
      width:100%; padding:8px 10px; border-radius:10px; border:1px solid #555; background:#111; color:#eee; font-size:13px;
    }
    #tcos-foot { padding: 8px 10px; display:flex; gap:8px; justify-content:flex-end; border-top: 1px solid #333; }
    #tcos-foot .btn { cursor:pointer; border:0; border-radius:10px; padding:8px 10px; background:#3498db; color:#fff; font-weight:700; font-size: 13px; }
    #tcos-foot .btn.ghost { background:#555; }

    /* Small pill timers */
    .tcos-pill {
      position: fixed; right: 10px; bottom: 10px;
      min-width: 120px; padding: 6px 10px; border-radius: 10px;
      background: rgba(0,0,0,0.75); color: #eee; border:1px solid #444;
      font-family: monospace; font-size:12px; z-index: 2147483644;
    }
    .tcos-pill span { display:inline-block; min-width: 60px; text-align: right; }

    /* Accessible focus */
    #tcos-panel button:focus, #tcos-panel input:focus, #tcos-modal .btn:focus { outline: 2px solid #fff; outline-offset: 2px; }
  `);

  // -----------------------------
  // UI Elements
  // -----------------------------
  const overlay = document.createElement('div');      // click-through color flash
  overlay.id = 'tcos-overlay';
  document.body.appendChild(overlay);

  const modalWrap = document.createElement('div');    // modal container
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

  const modal = modalWrap.querySelector('#tcos-modal');
  const msgEl = modalWrap.querySelector('#tcos-msg');
  const whyEl = modalWrap.querySelector('#tcos-why');
  const ackBtn = modalWrap.querySelector('#tcos-ack');
  const ackSnoozeBtn = modalWrap.querySelector('#tcos-ack-snooze');

  // Draggable panel
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
      <button class="btn ghost" id="tcos-test-drug">Test Drug</button>
      <button class="btn ghost" id="tcos-test-booster">Test Booster</button>
      <button class="btn ghost" id="tcos-test-edu">Test Edu</button>
      <button class="btn ghost" id="tcos-test-bank">Test Bank</button>
      <button class="btn ghost" id="tcos-test-oc">Test OC</button>
      <button class="btn" id="tcos-save">Save</button>
    </div>
  `;
  document.body.appendChild(panel);

  // Tiny status pills (for quick glance)
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

  const qs = (id) => document.getElementById(id);
  const masterToggle = qs('tcos-toggle');
  const keyInput = qs('tcos-key');
  const drugToggle = qs('tcos-drug');
  const boosterToggle = qs('tcos-booster');
  const eduToggle = qs('tcos-edu');
  const bankToggle = qs('tcos-bank');
  const ocToggle = qs('tcos-oc');

  // -----------------------------
  // Helpers
  // -----------------------------
  const pad2 = (n) => String(n).padStart(2, '0');
  function formatHMS(totalSeconds) {
    if (totalSeconds < 0 || !Number.isFinite(totalSeconds)) totalSeconds = 0;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }

  async function loadPersisted() {
    API_KEY = await GM_getValue(STORAGE.apiKey, '');
    toggles = await GM_getValue(STORAGE.toggles, { ...DEFAULT_TOGGLES });
    snoozeUntil = await GM_getValue(STORAGE.snoozeUntil, {});
    lastStates = await GM_getValue(STORAGE.lastStates, {});
    const pos = await GM_getValue(STORAGE.panelPos, null);

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
  }

  async function persist() {
    await GM_setValue(STORAGE.apiKey, API_KEY);
    await GM_setValue(STORAGE.toggles, toggles);
    await GM_setValue(STORAGE.snoozeUntil, snoozeUntil);
    await GM_setValue(STORAGE.lastStates, lastStates);
  }

  function withinSnooze(alertKey) {
    const until = snoozeUntil[alertKey] || 0;
    return Date.now() < until;
  }

  function setSnooze(alertKey, ms = ACK_SNOOZE_MS) {
    snoozeUntil[alertKey] = Date.now() + ms;
    persist();
  }

  function clearSnooze(alertKey) {
    snoozeUntil[alertKey] = 0;
  }

  // -----------------------------
  // Overlay / Modal controls
  // -----------------------------
  let currentAlertKey = null;

  function startFlash(color, reason, heading = 'Attention') {
    // Set modal content
    msgEl.textContent = heading;
    whyEl.textContent = reason || '';
    // Show modal (captures clicks), overlay flashes behind and is click-through
    modalWrap.style.display = 'flex';

    // Start color flashing
    overlay.style.background = 'transparent';
    flashOn = false;
    if (flashTimer) clearInterval(flashTimer);
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

  ackBtn.addEventListener('click', () => {
    if (currentAlertKey) {
      clearSnooze(currentAlertKey); // acknowledge (no snooze) ends current and allows immediate re-alerts on new state
      persist();
    }
    stopFlash();
  });

  ackSnoozeBtn.addEventListener('click', () => {
    if (currentAlertKey) setSnooze(currentAlertKey);
    stopFlash();
  });

  function raiseAlert(alertKey, reasonText) {
    if (!toggles[alertKey]) return;
    if (withinSnooze(alertKey)) return;

    currentAlertKey = alertKey;
    const { color, label } = ALERTS[alertKey];
    startFlash(color, reasonText, label);
  }

  // -----------------------------
  // API Calls
  // -----------------------------
  function apiGet(selections) {
    if (!API_KEY) return Promise.reject(new Error('No API key'));
    const url = `https://api.torn.com/user/?selections=${encodeURIComponent(selections)}&key=${encodeURIComponent(API_KEY)}`;
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: 'GET',
        url,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            if (data?.error) return reject(new Error(data.error.error));
            resolve(data);
          } catch (e) {
            reject(e);
          }
        },
        onerror: (e) => reject(e),
      });
    });
  }

  // Organized Crime status scraping from faction page (no extra API scopes)
  async function readOCStatus() {
    try {
      const resp = await fetch('/factions.php?step=your', { credentials: 'same-origin' });
      const html = await resp.text();

      // Quick text heuristics to reduce DOM coupling:
      const lower = html.toLowerCase();

      // Common phrases:
      const notInOCPhrases = [
        'you are not currently in an organized crime',
        'you are not currently in an organised crime',
        'no organized crime in progress',
        'no organised crime in progress',
      ];
      let notInOC = notInOCPhrases.some(p => lower.includes(p));

      // Try to find a time remaining (look for data-timer or hh:mm:ss-ish)
      // Simplistic search for something like data-timer or countdown strings
      let inProgress = false;
      let secondsLeft = null;

      // data-timer="12345"
      const timerAttr = html.match(/data-timer\s*=\s*["'](\d+)["']/i);
      if (timerAttr) {
        inProgress = true;
        secondsLeft = parseInt(timerAttr[1], 10);
      }

      // fallback: look for xx:xx(:xx) patterns near "organized crime"
      if (!inProgress) {
        const ocBlock = lower.indexOf('organized crime') >= 0 ? lower.indexOf('organized crime') : lower.indexOf('organised crime');
        if (ocBlock >= 0) {
          const slice = html.slice(Math.max(0, ocBlock - 500), Math.min(html.length, ocBlock + 800));
          const hhmmss = slice.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
          if (hhmmss) {
            inProgress = true;
            const h = parseInt(hhmmss[1] || '0', 10);
            const m = parseInt(hhmmss[2] || '0', 10);
            const s = parseInt(hhmmss[3] || '0', 10);
            secondsLeft = (h * 3600) + (m * 60) + (isNaN(s) ? 0 : s);
          }
        }
      }

      if (inProgress) {
        return { inProgress: true, secondsLeft: Number.isFinite(secondsLeft) ? secondsLeft : null };
      }
      if (notInOC) return { inProgress: false, secondsLeft: null };

      // Unknown (don’t spam—treat as unchanged)
      return { inProgress: lastStates.ocInProgress ?? false, secondsLeft: lastStates.ocSecondsLeft ?? null };
    } catch {
      // On errors, keep last known
      return { inProgress: lastStates.ocInProgress ?? false, secondsLeft: lastStates.ocSecondsLeft ?? null };
    }
  }

  // -----------------------------
  // Main polling
  // -----------------------------
  async function checkAll() {
    if (!masterToggle.checked) return;

    // Fetch cooldowns + edu + bank in two calls to reduce rate:
    // cooldowns
    try {
      if (API_KEY && (toggles.drug || toggles.booster)) {
        const cd = await apiGet('cooldowns');
        const drugS = cd?.cooldowns?.drug ?? 0;
        const boosterS = cd?.cooldowns?.booster ?? 0;

        // Update pills
        qs('pill-drug').textContent = formatHMS(drugS);
        qs('pill-booster').textContent = formatHMS(boosterS);

        // Drug finished
        if (toggles.drug && drugS === 0) {
          if ((lastStates.drugS ?? 1) !== 0) {
            // transitioned to 0
            if (!withinSnooze('drug')) raiseAlert('drug', 'Drug cooldown is now 0.');
          }
        }
        // Booster ≤ 20h (but not negative)
        if (toggles.booster && boosterS > 0 && boosterS <= BOOSTER_ALERT_THRESHOLD_S) {
          // Only alert once as we cross the threshold downward
          const wasAbove = (lastStates.boosterS ?? (BOOSTER_ALERT_THRESHOLD_S + 1)) > BOOSTER_ALERT_THRESHOLD_S;
          if (wasAbove && !withinSnooze('booster')) {
            raiseAlert('booster', `Booster cooldown ≤ 20 hours (${formatHMS(boosterS)} remaining).`);
          }
        }

        lastStates.drugS = drugS;
        lastStates.boosterS = boosterS;
      }
    } catch (e) {
      // ignore soft errors
    }

    // education + bank
    try {
      if (API_KEY && (toggles.edu || toggles.bank)) {
        const [edu, money] = await Promise.allSettled([
          toggles.edu ? apiGet('education') : Promise.resolve(null),
          toggles.bank ? apiGet('money') : Promise.resolve(null),
        ]);

        // Education
        if (toggles.edu && edu.status === 'fulfilled') {
          const timeLeft = edu.value?.education_timeleft ?? 0; // seconds
          const active = (edu.value?.education_current ?? 0) > 0 || timeLeft > 0;
          qs('pill-edu').textContent = active ? formatHMS(timeLeft) : 'idle';

          // finished transition (was active, now 0)
          if ((lastStates.eduActive ?? false) && timeLeft === 0) {
            if (!withinSnooze('edu')) raiseAlert('edu', 'Education course finished.');
          }
          lastStates.eduActive = active;
          lastStates.eduTimeLeft = timeLeft;
        }

        // Bank
        if (toggles.bank && money.status === 'fulfilled') {
          const bank = money.value?.bank || {};
          const bankTimeLeft = bank?.time_left ?? 0; // seconds
          const bankActive = (bank?.amount ?? 0) > 0 && bankTimeLeft >= 0;
          qs('pill-bank').textContent = bankActive ? formatHMS(bankTimeLeft) : 'idle';

          if ((lastStates.bankActive ?? false) && bankTimeLeft === 0) {
            if (!withinSnooze('bank')) raiseAlert('bank', 'Bank investment finished.');
          }
          lastStates.bankActive = bankActive;
          lastStates.bankTimeLeft = bankTimeLeft;
        }
      }
    } catch (e) {
      // ignore
    }

    // Pills visible only when master on
    pill.style.display = masterToggle.checked ? 'block' : 'none';

    await persist();
  }

  async function checkOC() {
    if (!masterToggle.checked || !toggles.oc) return;
    const { inProgress, secondsLeft } = await readOCStatus();

    // Update pill
    if (inProgress) {
      qs('pill-oc').textContent = secondsLeft != null ? formatHMS(secondsLeft) : '…';
    } else {
      qs('pill-oc').textContent = 'not in OC';
    }

    // Transition logic:
    const wasIn = !!lastStates.ocInProgress;
    if (wasIn && (!inProgress || (secondsLeft === 0))) {
      // finished
      if (!withinSnooze('oc')) raiseAlert('oc', inProgress ? 'OC finished.' : 'You are no longer in an OC.');
    }
    if (!wasIn && !inProgress) {
      // alert when not in OC (entering "not in OC" state), but avoid spamming
      const lastMark = lastStates.ocNotInOcAlertedAt || 0;
      if (Date.now() - lastMark > 30 * 60_000 && !withinSnooze('oc')) {
        raiseAlert('oc', 'You are not in an OC.');
        lastStates.ocNotInOcAlertedAt = Date.now();
      }
    }

    lastStates.ocInProgress = inProgress;
    lastStates.ocSecondsLeft = secondsLeft;
    await persist();
  }

  // -----------------------------
  // Draggable panel (touch + mouse)
  // -----------------------------
  (function makeDraggable() {
    const head = qs('tcos-head');
    let dragging = false;
    let startX = 0, startY = 0;
    let rect = null;

    function onDown(e) {
      dragging = true;
      rect = panel.getBoundingClientRect();
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
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
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

    head.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  })();

  // -----------------------------
  // Event wiring
  // -----------------------------
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
    if (API_KEY && !mainTimer) {
      mainTimer = setInterval(checkAll, CHECK_INTERVAL_MS);
      checkAll();
    }
    if (!ocTimer) {
      ocTimer = setInterval(checkOC, OC_CHECK_INTERVAL_MS);
      checkOC();
    }
  });

  masterToggle.addEventListener('change', () => {
    if (!masterToggle.checked) {
      stopFlash();
      pill.style.display = 'none';
    } else {
      pill.style.display = 'block';
      checkAll();
      checkOC();
    }
  });

  // Test buttons
  qs('tcos-test-drug').addEventListener('click', () => { currentAlertKey = 'drug';  raiseAlert('drug',  'Test: Drug cooldown is now 0.'); });
  qs('tcos-test-booster').addEventListener('click', () => { currentAlertKey = 'booster'; raiseAlert('booster','Test: Booster cooldown ≤ 20h.'); });
  qs('tcos-test-edu').addEventListener('click', () => { currentAlertKey = 'edu';   raiseAlert('edu',   'Test: Education course finished.'); });
  qs('tcos-test-bank').addEventListener('click', () => { currentAlertKey = 'bank';  raiseAlert('bank',  'Test: Bank investment finished.'); });
  qs('tcos-test-oc').addEventListener('click', () => { currentAlertKey = 'oc';    raiseAlert('oc',    'Test: OC finished / Not in OC.'); });

  // -----------------------------
  // Init
  // -----------------------------
  (async function init() {
    await loadPersisted();

    // Start timers if we can
    if (API_KEY) {
      mainTimer = setInterval(checkAll, CHECK_INTERVAL_MS);
      checkAll();
    }
    ocTimer = setInterval(checkOC, OC_CHECK_INTERVAL_MS);
    checkOC();

    // Show pills if on
    pill.style.display = masterToggle.checked ? 'block' : 'none';
  })();

})();
