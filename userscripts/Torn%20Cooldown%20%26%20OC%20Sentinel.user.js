// ==UserScript==
// @name         Torn Cooldown & OC Sentinel
// @namespace    http://tampermonkey.net/
// @version      1.4.2
// @description  Semi-transparent full-screen flash + modal acknowledge for: Drug (0), Booster (≤20h), Education finish, OC finished / Not in OC, and Racing (not in race). PDA-friendly, draggable, minimisable (starts minimised). Single API key (Limited). Overlay is click-through; modal captures clicks. Author: BazookaJoe.
// @author       BazookaJoe
// @match        https://www.torn.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
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
  const POLL_MS = 3_600_000;            // 1 API sweep per hour
  const TICK_MS = 1_000;                // local countdown tick
  const OC_DOM_SCAN_MS = 10_000;        // lightweight DOM check for OC status
  const FLASH_INTERVAL_MS = 800;        // overlay flash speed
  const SNOOZE_MS = 5 * 60_000;         // Snooze 5m
  const BOOSTER_THRESHOLD_S = 20 * 3600;// 20 hours
  const NOT_IN_OC_COOLDOWN_MS = 30 * 60_000;
  const NOT_RACING_COOLDOWN_MS = 30 * 60_000;
  const REATTACH_MS = 3_000;            // periodic self-heal
  const SAVE_DEBOUNCE_MS = 400;

  // Always start minimised each load; open via pill button
  const FORCE_MIN_ON_LOAD = true;

  const STORAGE = {
    key: 'tcos_api_key_v5',
    keyV4: 'tcos_api_key_v4',
    keyV3: 'tcos_api_key_v3',
    toggles: 'tcos_toggles_v6',       // bumped for new toggle
    snooze: 'tcos_snooze_v6',
    last: 'tcos_last_v6',
    ends: 'tcos_ends_v5',
    pos: 'tcos_panel_pos_v1',
    pillPos: 'tcos_pill_pos_v1',
    minimized: 'tcos_panel_min_v1',
    lastPoll: 'tcos_last_poll_v1',
  };

  const ALERTS = {
    drug:    { key: 'drug',    label: 'Drug cooldown',            color: 'rgba(39,174,96,0.5)'  },
    booster: { key: 'booster', label: 'Booster cooldown (≤20h)',  color: 'rgba(41,128,185,0.5)' },
    edu:     { key: 'edu',     label: 'Education finished',       color: 'rgba(142,68,173,0.5)' },
    oc:      { key: 'oc',      label: 'OC finished / Not in OC',  color: 'rgba(192,57,43,0.5)'  },
    race:    { key: 'race',    label: 'Racing: Not in a race',    color: 'rgba(241,196,15,0.5)' }, // yellow
  };
  const DEFAULT_TOGGLES = { drug:true, booster:true, edu:true, oc:true, race:true };

  // =========================
  // State
  // =========================
  let API_KEY = '';
  let toggles = {};
  let snoozeUntil = {};
  let last = {};
  let ends = { drug:0, booster:0, edu:0, oc:0 };

  let flashTimer = null;
  let currentAlertKey = null;
  let pillTick = null;
  let pollTimer = null;
  let ocDomTimer = null;
  let ocUnknownStreak = 0;
  const OC_UNKNOWN_STREAK_MAX = 3;

  // DOM refs
  let overlay, panel, pill;
  let masterToggle, keyInput, drugToggle, boosterToggle, eduToggle, ocToggle, raceToggle;
  let testsBtn, testsMenu, pillOpenBtn;

  // Helpers
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtHMS = (sec) => {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  };
  const withinSnooze = (k) => Date.now() < (snoozeUntil[k] || 0);
  function setSnooze(k, ms = SNOOZE_MS) { snoozeUntil[k] = Date.now() + ms; persist(); }
  function clearSnooze(k){ snoozeUntil[k] = 0; }
  function secLeftFromEnd(endMs) { return Math.ceil((endMs - Date.now()) / 1000); }
  function setEndFromSeconds(key, seconds) { ends[key] = seconds > 0 ? (Date.now() + seconds * 1000) : 0; }
  const qs = (id) => document.getElementById(id);
  const root = () => document.body || document.documentElement;
  function safeAppend(el) { try { root().appendChild(el); } catch {} }
  const debounce = (fn, wait) => { let t=null; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; };

  // Styles
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

    #tcos-panel{position:fixed;bottom:16px;left:16px;width:360px;max-width:95vw;background:rgba(0,0,0,0.85);color:#eee;border:1px solid #444;border-radius:14px;z-index:2147483645;backdrop-filter:blur(4px);touch-action:none;display:none;}
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
    #tcos-foot{padding:8px 10px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #333;flex-wrap:wrap;}
    #tcos-foot .btn{cursor:pointer;border:0;border-radius:10px;padding:8px 10px;background:#3498db;color:#fff;font-weight:700;font-size:13px;}
    #tcos-foot .btn.ghost{background:#555;}

    #tcos-tests-wrap{position:relative;}
    #tcos-tests-menu{position:absolute;right:0;bottom:34px;display:none;min-width:200px;background:rgba(20,20,20,0.98);border:1px solid #444;border-radius:10px;padding:6px;z-index:2147483648;}
    #tcos-tests-menu button{width:100%;text-align:left;margin:2px 0;}

    /* Draggable pill with Open button */
    .tcos-pill{
      position:fixed; right:0; top:40%; transform:translateY(-50%);
      min-width:190px; padding:12px 12px 10px 12px; border-radius:10px 0 0 10px;
      background:rgba(0,0,0,0.78); color:#eee; border:1px solid #444;
      font-family:monospace; font-size:12px; z-index:2147483644; cursor:move; user-select:none;
    }
    .tcos-pill .row{display:flex;justify-content:space-between;gap:8px;}
    .tcos-pill .bar{display:grid;gap:4px;padding-top:24px;}
    .tcos-pill .open-ui{
      position:absolute; top:6px; left:8px; height:18px; padding:0 6px;
      display:inline-flex; align-items:center; justify-content:center;
      border-radius:6px; border:1px solid #555; background:rgba(255,255,255,0.10);
      color:#eee; cursor:pointer; font:700 11px/18px system-ui,-apple-system,Segoe UI,Roboto,Arial; user-select:none; z-index:1;
    }
    .tcos-pill .open-ui:hover{background:rgba(255,255,255,0.18);}
    .tcos-pill .open-ui:active{transform:scale(0.98);}
    #tcos-panel button:focus,#tcos-panel input:focus,#tcos-modal .btn:focus,.tcos-pill .open-ui:focus{outline:2px solid #fff;outline-offset:2px;}
  `);

  // Build UI (idempotent)
  function ensureUI() {
    // Remove any legacy side tab from older builds
    const oldTab = document.getElementById('tcos-minitab');
    if (oldTab && oldTab.remove) oldTab.remove();

    // Overlay + modal
    let modalWrap = qs('tcos-modal-wrap');
    if (!modalWrap) {
      modalWrap = document.createElement('div');
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
        </div>`;
      safeAppend(modalWrap);
    }
    let msgEl = qs('tcos-msg'), whyEl = qs('tcos-why');
    let ackBtn = qs('tcos-ack'), ackSnoozeBtn = qs('tcos-ack-snooze');

    overlay = qs('tcos-overlay') || (()=>{const d=document.createElement('div');d.id='tcos-overlay';safeAppend(d);return d;})();

    // Panel
    panel = qs('tcos-panel') || (()=>{const p=document.createElement('div');p.id='tcos-panel';p.innerHTML=`
      <div id="tcos-head">
        <div id="tcos-title">Cooldown & OC Sentinel</div>
        <input id="tcos-toggle" type="checkbox" checked>
      </div>
      <div id="tcos-body">
        <label><input type="checkbox" id="tcos-drug"> Drug</label>
        <label><input type="checkbox" id="tcos-booster"> Booster (≤20h)</label>
        <label><input type="checkbox" id="tcos-edu"> Education</label>
        <label class="full"><input type="checkbox" id="tcos-oc"> OC finished / Not in OC</label>
        <label class="full"><input type="checkbox" id="tcos-race"> Racing: Not in a race</label>
        <div class="full">
          <label for="tcos-key" style="display:block;margin-bottom:4px;">API Key (Limited recommended)</label>
          <input id="tcos-key" type="text" placeholder="Paste your API key">
        </div>
      </div>
      <div id="tcos-foot">
        <div id="tcos-tests-wrap">
          <button class="btn ghost" id="tcos-tests-btn">Tests ▾</button>
          <div id="tcos-tests-menu" role="menu" aria-label="Test alerts">
            <button class="btn ghost" id="tcos-test-drug">Test Drug</button>
            <button class="btn ghost" id="tcos-test-booster">Test Booster</button>
            <button class="btn ghost" id="tcos-test-edu">Test Edu</button>
            <button class="btn ghost" id="tcos-test-oc">Test OC</button>
            <button class="btn ghost" id="tcos-test-race">Test Racing</button>
          </div>
        </div>
        <button class="btn ghost" id="tcos-min">Minimise</button>
        <button class="btn" id="tcos-save">Save</button>
      </div>`; safeAppend(p); return p;})();

    // Pill
    pill = document.querySelector('.tcos-pill') || (()=>{const s=document.createElement('div');s.className='tcos-pill';s.innerHTML=`
      <div class="open-ui" id="tcos-open">Open</div>
      <div class="bar">
        <div class="row"><span>Drug</span><span id="pill-drug">--:--:--</span></div>
        <div class="row"><span>Booster</span><span id="pill-booster">--:--:--</span></div>
        <div class="row"><span>Edu</span><span id="pill-edu">--</span></div>
        <div class="row"><span>OC</span><span id="pill-oc">--</span></div>
        <div class="row"><span>Race</span><span id="pill-race">--</span></div>
      </div>`; safeAppend(s); return s;})();

    // Shortcuts & binds
    masterToggle   = qs('tcos-toggle');
    keyInput       = qs('tcos-key');
    drugToggle     = qs('tcos-drug');
    boosterToggle  = qs('tcos-booster');
    eduToggle      = qs('tcos-edu');
    ocToggle       = qs('tcos-oc');
    raceToggle     = qs('tcos-race');
    testsBtn       = qs('tcos-tests-btn');
    testsMenu      = qs('tcos-tests-menu');
    pillOpenBtn    = document.getElementById('tcos-open');

    bindOnce('tcos-ack', 'click', onAck);
    bindOnce('tcos-ack-snooze', 'click', onAckSnooze);
    bindOnce('tcos-save', 'click', onSave);
    bindOnce('tcos-min', 'click', () => setMinimised(true));

    if (pillOpenBtn && !pillOpenBtn.dataset.bound) {
      pillOpenBtn.addEventListener('click', (e)=>{ e.stopPropagation(); setMinimised(false); });
      pillOpenBtn.dataset.bound = '1';
    }
    if (testsBtn && !testsBtn.dataset.bound){
      testsBtn.addEventListener('click',(e)=>{e.stopPropagation();testsMenu.style.display=testsMenu.style.display==='block'?'none':'block';});
      document.addEventListener('click',(e)=>{ if(!testsMenu.contains(e.target) && e.target!==testsBtn) testsMenu.style.display='none';});
      addTest('tcos-test-drug',    ()=>{currentAlertKey='drug';  raiseAlert('drug','Test: Drug cooldown is now 0.');});
      addTest('tcos-test-booster', ()=>{currentAlertKey='booster';raiseAlert('booster','Test: Booster cooldown ≤ 20h.');});
      addTest('tcos-test-edu',     ()=>{currentAlertKey='edu';   raiseAlert('edu','Test: Education course finished.');});
      addTest('tcos-test-oc',      ()=>{currentAlertKey='oc';    raiseAlert('oc','Test: OC finished / Not in OC.');});
      addTest('tcos-test-race',    ()=>{currentAlertKey='race';  raiseAlert('race','Test: You are not in a race.');});
      testsBtn.dataset.bound='1';
    }
    if (!masterToggle.dataset.bound){
      masterToggle.addEventListener('change',()=>{ if(!masterToggle.checked) stopFlash(); pill.style.display=masterToggle.checked?'block':'none';});
      masterToggle.dataset.bound='1';
    }

    makePanelDraggable();
    makePillDraggable();

    if (masterToggle.checked) pill.style.display = 'block';

    // API key: save on type + blur
    if (!keyInput.dataset.bound) {
      const saveKey = debounce(async () => {
        API_KEY = keyInput.value.trim();
        await GM_setValue(STORAGE.key, API_KEY);
      }, SAVE_DEBOUNCE_MS);
      keyInput.addEventListener('input', () => { API_KEY = keyInput.value.trim(); saveKey(); });
      keyInput.addEventListener('blur', async () => {
        API_KEY = keyInput.value.trim();
        await GM_setValue(STORAGE.key, API_KEY);
      });
      keyInput.dataset.bound = '1';
    }

    function addTest(id, fn){
      const el = qs(id);
      if (el && !el.dataset.bound){ el.addEventListener('click', fn); el.dataset.bound='1'; }
    }

    // Ack handlers
    function onAck(){ if(currentAlertKey){ clearSnooze(currentAlertKey); persist(); } stopFlash(); }
    function onAckSnooze(){ if(currentAlertKey) setSnooze(currentAlertKey); stopFlash(); }

    // Modal controls
    function startFlash(color, reason, heading){
      qs('tcos-msg').textContent = heading || 'Attention';
      qs('tcos-why').textContent = reason || '';
      qs('tcos-modal-wrap').style.display = 'flex';

      overlay.style.background = 'transparent';
      if (flashTimer) clearInterval(flashTimer);
      let on = false;
      flashTimer = setInterval(()=>{ on=!on; overlay.style.backgroundColor = on ? color : 'rgba(0,0,0,0.0)'; }, FLASH_INTERVAL_MS);
    }
    function stopFlash(){ if(flashTimer) clearInterval(flashTimer); flashTimer=null; overlay.style.background='transparent'; qs('tcos-modal-wrap').style.display='none'; }
    function raiseAlert(alertKey, reasonText){ if(!toggles[alertKey]) return; if(withinSnooze(alertKey)) return;
      currentAlertKey=alertKey; const {color,label}=ALERTS[alertKey]; startFlash(color, reasonText, label); }

    // attach to global scope for other functions
    window.tcos_raiseAlert = raiseAlert;
    window.tcos_stopFlash  = stopFlash;
  }

  function bindOnce(id, evt, fn){ const el=qs(id); if(el && !el.dataset.bound){ el.addEventListener(evt, fn); el.dataset.bound='1'; } }

  // Persist
  async function migrateKey(){ const v5=await GM_getValue('tcos_api_key_v5',''); if(v5) return v5;
    const v4=await GM_getValue('tcos_api_key_v4',''); const v3=await GM_getValue('tcos_api_key_v3',''); const m=v4||v3||'';
    if(m) await GM_setValue('tcos_api_key_v5',m); return m; }
  async function loadPersisted() {
    API_KEY = await migrateKey() || await GM_getValue(STORAGE.key, '');
    const storedToggles = await GM_getValue(STORAGE.toggles, { ...DEFAULT_TOGGLES });
    // migrate old toggles: ensure 'race' exists
    toggles = { ...DEFAULT_TOGGLES, ...storedToggles };
    snoozeUntil = await GM_getValue(STORAGE.snooze, {});
    last = await GM_getValue(STORAGE.last, {});
    ends = await GM_getValue(STORAGE.ends, ends);
    const pos = await GM_getValue(STORAGE.pos, null);
    const pillPos = await GM_getValue(STORAGE.pillPos, null);

    let min = true;
    if (!FORCE_MIN_ON_LOAD) {
      const stored = await GM_getValue(STORAGE.minimized, undefined);
      min = (typeof stored === 'undefined') ? true : !!stored;
    }
    await GM_setValue(STORAGE.minimized, min);

    // Apply to UI
    keyInput.value = API_KEY || '';
    drugToggle.checked    = !!toggles.drug;
    boosterToggle.checked = !!toggles.booster;
    eduToggle.checked     = !!toggles.edu;
    ocToggle.checked      = !!toggles.oc;
    raceToggle.checked    = !!toggles.race;

    if (pos && typeof pos.x==='number' && typeof pos.y==='number'){
      panel.style.left = `${pos.x}px`; panel.style.top = `${pos.y}px`; panel.style.bottom='auto'; panel.style.right='auto';
    }
    if (pillPos && typeof pillPos.x==='number' && typeof pillPos.y==='number'){
      pill.style.left = `${pillPos.x}px`; pill.style.top = `${pillPos.y}px`; pill.style.right='auto'; pill.style.transform='translateY(0)';
    }

    setMinimised(min);
  }
  async function persist(){
    await GM_setValue(STORAGE.key, API_KEY);
    await GM_setValue(STORAGE.toggles, toggles);
    await GM_setValue(STORAGE.snooze, snoozeUntil);
    await GM_setValue(STORAGE.last, last);
    await GM_setValue(STORAGE.ends, ends);
  }

  // Flash helpers (access via window.tcos_*)
  function stopFlash(){ if(flashTimer) clearInterval(flashTimer); flashTimer=null; overlay.style.background='transparent'; const mw=qs('tcos-modal-wrap'); if(mw) mw.style.display='none'; }

  // XHR helper
  function xhrJSON(url){
    return new Promise((resolve,reject)=>{
      (GM.xmlHttpRequest||GM_xmlhttpRequest)({ method:'GET', url,
        onload:(res)=>{ try{ const data=JSON.parse(res.responseText);
          if (data?.error) return reject(new Error(data.error.error||'API error')); resolve(data);
        }catch(e){ reject(e); } }, onerror:reject });
    });
  }

  // Poll bookkeeping
  async function markPolled() {
    await GM_setValue(STORAGE.lastPoll, Date.now());
  }
  async function shouldPollNow() {
    const lastPoll = await GM_getValue(STORAGE.lastPoll, 0);
    return (Date.now() - lastPoll) >= POLL_MS;
  }

  // Server refresh (sets end-times + status flags)
  async function refreshFromServer() {
    if (!API_KEY) API_KEY = await GM_getValue(STORAGE.key, '');
    if (!qs('tcos-toggle')?.checked || !API_KEY) return;

    // Respect hourly schedule
    const ok = await shouldPollNow();
    if (!ok) return;

    // Cooldowns (drug/booster)
    try {
      if (toggles.drug || toggles.booster) {
        const cd = await xhrJSON(`https://api.torn.com/user/?selections=cooldowns&key=${encodeURIComponent(API_KEY)}`);
        const drugS = cd?.cooldowns?.drug ?? 0;
        const boosterS = cd?.cooldowns?.booster ?? 0;

        setEndFromSeconds('drug', drugS);
        setEndFromSeconds('booster', boosterS);

        if (toggles.drug && drugS === 0 && (last.drugS ?? 1) !== 0) {
          if (!withinSnooze('drug')) window.tcos_raiseAlert('drug','Drug cooldown is now 0.');
        }
        if (toggles.booster && boosterS > 0 && boosterS <= BOOSTER_THRESHOLD_S) {
          const wasAbove = (last.boosterS ?? (BOOSTER_THRESHOLD_S + 1)) > BOOSTER_THRESHOLD_S;
          if (wasAbove && !withinSnooze('booster')) {
            window.tcos_raiseAlert('booster', `Booster cooldown ≤ 20 hours (${fmtHMS(boosterS)} remaining).`);
          }
        }
        last.drugS = drugS;
        last.boosterS = boosterS;
      }
    } catch {}

    // Education
    try {
      if (toggles.edu) {
        const edu = await xhrJSON(`https://api.torn.com/user/?selections=education&key=${encodeURIComponent(API_KEY)}`);
        const timeLeft = edu?.education_timeleft ?? 0;
        setEndFromSeconds('edu', timeLeft);
        const wasActive = !!last.eduActive;
        const activeNow = (edu?.education_current ?? 0) > 0 || timeLeft > 0;
        if (wasActive && timeLeft === 0 && !withinSnooze('edu')) window.tcos_raiseAlert('edu','Education course finished.');
        last.eduActive = activeNow;
      }
    } catch {}

    // Organized Crime (v2)
    try {
      if (toggles.oc) {
        const v2 = await xhrJSON(`https://api.torn.com/v2/user/?selections=organizedcrime&key=${encodeURIComponent(API_KEY)}`);
        const oc = v2?.organizedCrime || v2?.organizedcrime || v2?.organized_crime;
        if (oc && (oc.status || oc.ready_at || oc.readyAt)) {
          const nowSec = Math.floor(Date.now()/1000);
          const readyEpoch = (oc.ready_at || oc.readyAt || nowSec);
          const left = Math.max(0, readyEpoch - nowSec);
          setEndFromSeconds('oc', left);

          const wasIn = !!last.ocInProgress;
          const nowIn = left > 0;
          if (wasIn && left === 0 && !withinSnooze('oc')) window.tcos_raiseAlert('oc','OC finished.');
          last.ocInProgress = nowIn;
          ocUnknownStreak = 0;
        }
      }
    } catch {}

    // Racing status (tries v2 then v1 gracefully)
    try {
      if (toggles.race) {
        // v2 attempt
        let inRace = null;
        try {
          const v2r = await xhrJSON(`https://api.torn.com/v2/user/?selections=racing&key=${encodeURIComponent(API_KEY)}`);
          // Heuristics: consider active race if a current event/queue exists
          const r = v2r?.racing || v2r?.race || v2r;
          if (r && (r.active === true || r?.status === 'racing' || r?.current || r?.queue?.length > 0)) inRace = true;
          if (inRace === null && (r?.active === false || r?.status === 'idle')) inRace = false;
        } catch {}
        // v1 fallback
        if (inRace === null) {
          const v1r = await xhrJSON(`https://api.torn.com/user/?selections=racing&key=${encodeURIComponent(API_KEY)}`);
          // Common shapes seen: { racing: { status: "Racing"|"Idle"|..., ... } }
          const r1 = v1r?.racing;
          if (r1 && (r1.status || r1?.in_race)) {
            const s = String(r1.status || (r1.in_race ? 'Racing' : 'Idle')).toLowerCase();
            inRace = s.includes('racing') || s.includes('queued') || !!r1.in_race;
          } else if (typeof r1 === 'string') {
            inRace = /racing|queued/i.test(r1);
          }
        }

        if (typeof inRace === 'boolean') {
          last.raceInProgress = inRace;
          if (!inRace) {
            const lastAlert = last.raceNotInAlertedAt || 0;
            if (Date.now() - lastAlert > NOT_RACING_COOLDOWN_MS && !withinSnooze('race')) {
              window.tcos_raiseAlert('race','You are not in a race.');
              last.raceNotInAlertedAt = Date.now();
            }
          }
        }
      }
    } catch {}

    await persist();
    await markPolled();
  }

  // OC DOM fallback (any Torn page)
  function scanOCDom() {
    if (!toggles.oc) return;

    // If we already have an end-time counting down, let the pill handle it
    if (ends.oc && secLeftFromEnd(ends.oc) > 0) return;

    const body=document.body;
    const matchText=(s)=>/organized\s*crime|organised\s*crime|\bOC\b/i.test(s||'');
    let ocNode = Array.from(body.querySelectorAll('[title],[aria-label],[data-title]'))
      .find(el=>matchText(el.getAttribute('title')||el.getAttribute('aria-label')||el.getAttribute('data-title')));
    if (!ocNode){
      const header=document.querySelector('#header, .header, .toolbar, #top-page, .content-wrapper')||body;
      const walker=document.createTreeWalker(header, NodeFilter.SHOW_TEXT, null); let n;
      while((n=walker.nextNode())){ if(matchText(n.nodeValue)){ ocNode=n.parentElement; break; } }
    }

    let secondsLeft=null, inProgress=false;
    if (ocNode){
      const scope = ocNode.closest('*')||ocNode;
      const cand = Array.from(scope.querySelectorAll('[data-timer],[data-countdown],[data-time-left],time,span,div'));
      for (const el of cand){
        const dt = el.getAttribute && (el.getAttribute('data-timer')||el.getAttribute('data-time-left')||el.getAttribute('data-countdown'));
        if (dt && /^\d+$/.test(dt)) { secondsLeft=parseInt(dt,10); inProgress=secondsLeft>0; break; }
        const txt=(el.textContent||'').trim(); const m=txt.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (m){ const h=+m[1],mi=+m[2],s=+(m[3]||0); secondsLeft=h*3600+mi*60+s; inProgress=secondsLeft>0; break; }
      }
    }

    if (inProgress){
      ocUnknownStreak=0; setEndFromSeconds('oc', secondsLeft||0); last.ocInProgress=true;
    } else {
      ocUnknownStreak++;
      if (ocUnknownStreak>=OC_UNKNOWN_STREAK_MAX){
        ends.oc=0; const wasIn=!!last.ocInProgress; last.ocInProgress=false;
        if (!wasIn){
          const lastAlert=last.ocNotInOcAlertedAt||0;
          if (Date.now()-lastAlert>NOT_IN_OC_COOLDOWN_MS && !withinSnooze('oc')){
            window.tcos_raiseAlert('oc','You are not in an OC.'); last.ocNotInOcAlertedAt=Date.now();
          }
        }
      }
    }
  }

  // Local tick (renders the pill every second from end-times)
  function renderPill(){
    const setText=(id,secs)=>{ const el=qs(id); if(el) el.textContent=fmtHMS(Math.max(0,secs)); };

    // drug / booster
    const drugLeft = ends.drug ? secLeftFromEnd(ends.drug) : 0;
    const boosterLeft = ends.booster ? secLeftFromEnd(ends.booster) : 0;
    setText('pill-drug', drugLeft);
    setText('pill-booster', boosterLeft);

    // education
    const eduLeft = ends.edu ? secLeftFromEnd(ends.edu) : 0;
    const eduEl=qs('pill-edu'); if (eduEl) eduEl.textContent = ends.edu && eduLeft>0 ? fmtHMS(eduLeft) : 'idle';

    // OC
    const ocLeft = ends.oc ? secLeftFromEnd(ends.oc) : 0;
    const ocEl=qs('pill-oc'); if (ocEl) ocEl.textContent = ends.oc ? (ocLeft>0?fmtHMS(ocLeft):'ready') : (last.ocInProgress===false?'not in OC':'…');

    // Racing
    const raceEl = qs('pill-race');
    if (raceEl) raceEl.textContent = (last.raceInProgress === true) ? 'in race' : (last.raceInProgress === false ? 'not racing' : '…');

    // client-side finish guards (no extra API calls)
    if (toggles.drug && drugLeft===0 && (last._drugWasZero!==true)){ if(!withinSnooze('drug')) window.tcos_raiseAlert('drug','Drug cooldown is now 0.'); last._drugWasZero=true; }
    else if (drugLeft>0){ last._drugWasZero=false; }

    if (toggles.oc && ends.oc && ocLeft===0 && (last._ocWasZero!==true)){ if(!withinSnooze('oc')) window.tcos_raiseAlert('oc','OC finished.'); last._ocWasZero=true; }
    else if (ocLeft>0){ last._ocWasZero=false; }
  }

  // Dragging
  function makePanelDraggable(){
    const head=qs('tcos-head'); if(!head || head.dataset.bound) return;
    let dragging=false, startX=0, startY=0;
    function onDown(e){ dragging=true; const r=panel.getBoundingClientRect();
      startX=(e.touches?e.touches[0].clientX:e.clientX)-r.left; startY=(e.touches?e.touches[0].clientY:e.clientY)-r.top; e.preventDefault(); }
    function onMove(e){ if(!dragging) return; const x=(e.touches?e.touches[0].clientX:e.clientX)-startX; const y=(e.touches?e.touches[0].clientY:e.clientY)-startY;
      panel.style.left=`${Math.max(4,Math.min(window.innerWidth-panel.offsetWidth-4,x))}px`;
      panel.style.top =`${Math.max(4,Math.min(window.innerHeight-panel.offsetHeight-4,y))}px`;
      panel.style.right='auto'; panel.style.bottom='auto'; }
    async function onUp(){ if(!dragging) return; dragging=false;
      await GM_setValue(STORAGE.pos,{ x:parseInt(panel.style.left||'16',10), y:parseInt(panel.style.top||(window.innerHeight-panel.offsetHeight-16),10) }); }
    head.addEventListener('mousedown',onDown); window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp);
    head.addEventListener('touchstart',onDown,{passive:false}); window.addEventListener('touchmove',onMove,{passive:false}); window.addEventListener('touchend',onUp);
    head.dataset.bound='1';
  }
  function makePillDraggable(){
    if (!pill || pill.dataset.bound) return;
    let dragging=false, offsetX=0, offsetY=0;

    // Don't start drag when clicking the open button
    const btn = document.getElementById('tcos-open');
    if (btn) {
      btn.addEventListener('mousedown', (e)=>e.stopPropagation());
      btn.addEventListener('touchstart', (e)=>{ e.stopPropagation(); }, {passive:false});
    }

    function onDown(e){ dragging=true; const r=pill.getBoundingClientRect(); const cx=e.touches?e.touches[0].clientX:e.clientX; const cy=e.touches?e.touches[0].clientY:e.clientY;
      offsetX=cx-r.left; offsetY=cy-r.top; pill.style.right='auto'; pill.style.transform='translateY(0)'; e.preventDefault(); }
    function onMove(e){ if(!dragging) return; const cx=e.touches?e.touches[0].clientX:e.clientX; const cy=e.touches?e.touches[0].clientY:e.clientY;
      const x=Math.max(4,Math.min(window.innerWidth-pill.offsetWidth-4,cx-offsetX)); const y=Math.max(4,Math.min(window.innerHeight-pill.offsetHeight-4,cy-offsetY));
      pill.style.left=`${x}px`; pill.style.top=`${y}px`; }
    async function onUp(){ if(!dragging) return; dragging=false; await GM_setValue(STORAGE.pillPos,{ x:parseInt(pill.style.left||'0',10), y:parseInt(pill.style.top||'0',10) }); }
    pill.addEventListener('mousedown',onDown); window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp);
    pill.addEventListener('touchstart',onDown,{passive:false}); window.addEventListener('touchmove',onMove,{passive:false}); window.addEventListener('touchend',onUp);
    pill.dataset.bound='1';
  }

  function setMinimised(min){
    if (min){ panel.style.display='none'; GM_setValue(STORAGE.minimized,true); }
    else { panel.style.display='block'; GM_setValue(STORAGE.minimized,false); }
  }

  function restorePillPosition(){
    GM_getValue(STORAGE.pillPos,null).then((pos)=>{ if(!pos){ pill.style.left=''; pill.style.top=''; pill.style.right='0'; pill.style.transform='translateY(-50%)'; } });
  }

  // Events
  async function onSave(){
    API_KEY = keyInput.value.trim();
    toggles = {
      drug:    !!drugToggle.checked,
      booster: !!boosterToggle.checked,
      edu:     !!eduToggle.checked,
      oc:      !!ocToggle.checked,
      race:    !!raceToggle.checked,
    };
    await persist();

    // Re-arm hourly poll
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshFromServer, POLL_MS);
    refreshFromServer();

    if (ocDomTimer) clearInterval(ocDomTimer);
    ocDomTimer = setInterval(scanOCDom, OC_DOM_SCAN_MS);
    scanOCDom();
  }

  // Init
  async function init(){
    ensureUI();

    if (FORCE_MIN_ON_LOAD) setMinimised(true);

    await loadPersisted();

    if (pillTick) clearInterval(pillTick);
    pillTick = setInterval(renderPill, TICK_MS);
    renderPill();

    // Hourly poller + “poll on visibility if stale”
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshFromServer, POLL_MS);
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        if (await shouldPollNow()) refreshFromServer();
      }
    });
    if (await shouldPollNow()) refreshFromServer();

    if (ocDomTimer) clearInterval(ocDomTimer);
    ocDomTimer = setInterval(scanOCDom, OC_DOM_SCAN_MS);
    scanOCDom();

    if (qs('tcos-toggle')?.checked) pill.style.display='block';

    // Self-heal
    const mo=new MutationObserver(()=>{
      if(!qs('tcos-panel')||!document.querySelector('.tcos-pill')||!qs('tcos-overlay')||!qs('tcos-modal-wrap')){
        ensureUI(); makePillDraggable();
      }
      const ghost=document.getElementById('tcos-minitab'); if (ghost && ghost.remove) ghost.remove();
    });
    mo.observe(document.documentElement,{childList:true,subtree:true});
    setInterval(()=>{ ensureUI(); makePillDraggable(); const ghost=document.getElementById('tcos-minitab'); if (ghost && ghost.remove) ghost.remove(); }, REATTACH_MS);
    restorePillPosition();
  }

  if (document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',init); window.addEventListener('load',ensureUI); }
  else { init(); }
})();
