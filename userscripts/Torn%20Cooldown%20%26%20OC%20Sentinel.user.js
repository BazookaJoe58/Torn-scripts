// ==UserScript==
// @name         Torn Cooldown & OC Sentinel
// @namespace    http://tampermonkey.net/
// @version      1.4.6
// @description  Alerts for Drug, Booster (≤20h), Education, OC, Racing. Semi-transparent flash + modal acknowledge (1h snooze). PDA-friendly, draggable UI/pill. Single Limited API key. Author: BazookaJoe.
// @author       BazookaJoe
// @match        https://www.torn.com/*
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

  // --- config ---
  const POLL_MS = 3_600_000; // hourly API sweep
  const TICK_MS = 1000;      // pill refresh tick
  const FLASH_INTERVAL_MS = 800;
  const ACK_SNOOZE_MS = 60*60*1000; // 1h
  const SNOOZE_MS = 5*60*1000;      // 5m
  const BOOSTER_THRESHOLD_S = 20*3600;
  const DOM_SCAN_MS = 5000; // scan sidebar for cooldowns

  const STORAGE = {
    key: 'tcos_api_key_v5',
    ends: 'tcos_ends_v7',
    snooze: 'tcos_snooze_v7',
    toggles: 'tcos_toggles_v7'
  };

  const ALERTS = {
    drug:    { label: 'Drug cooldown',            color: 'rgba(39,174,96,0.5)' },
    booster: { label: 'Booster cooldown (≤20h)',  color: 'rgba(41,128,185,0.5)' },
    edu:     { label: 'Education finished',       color: 'rgba(142,68,173,0.5)' },
    oc:      { label: 'OC finished / Not in OC',  color: 'rgba(192,57,43,0.5)' },
    race:    { label: 'Racing: Not in a race',    color: 'rgba(241,196,15,0.5)' }
  };

  let API_KEY = '';
  let ends = { drug:0, booster:0, edu:0, oc:0 };
  let snoozeUntil = {};
  let currentAlertKey = null;
  let flashTimer = null;

  // --- helpers ---
  const qs = id => document.getElementById(id);
  const fmtHMS = s => {
    if (s < 0) s = 0;
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
    return [h,m,sec].map(x=>String(x).padStart(2,'0')).join(':');
  };
  const secLeft = end => Math.ceil((end - Date.now())/1000);
  const withinSnooze = k => Date.now() < (snoozeUntil[k]||0);
  const setSnooze = (k,ms) => { snoozeUntil[k]=Date.now()+ms; GM_setValue(STORAGE.snooze,snoozeUntil); };

  // --- DOM cooldown scanner (Drug/Booster from sidebar) ---
  function scanCooldownsDom(){
    const side=document.querySelector('#sidebar, .sidebar')||document;
    const rows=[...side.querySelectorAll('li,div,span')];
    for (const r of rows){
      const txt=(r.textContent||'').trim().toLowerCase();
      const timerEl=r.querySelector('[data-timer],[data-time-left]')||r;
      let secs=null;
      if (timerEl && (timerEl.dataset.timer||timerEl.dataset.timeLeft)){
        secs=parseInt(timerEl.dataset.timer||timerEl.dataset.timeLeft,10);
      } else {
        const m=txt.match(/(\d+):(\d{2})(?::(\d{2}))?/);
        if (m){secs=(+m[1])*3600+(+m[2])*60+(+m[3]||0);}
      }
      if (secs){
        if (/drug/i.test(txt)) ends.drug=Date.now()+secs*1000;
        if (/booster/i.test(txt)) ends.booster=Date.now()+secs*1000;
      }
    }
  }

  // --- alert modal ---
  function startFlash(key,msg){
    const {color,label}=ALERTS[key];
    qs('tcos-msg').textContent=label;
    qs('tcos-why').textContent=msg;
    qs('tcos-modal-wrap').style.display='flex';
    if (flashTimer) clearInterval(flashTimer);
    let on=false;
    flashTimer=setInterval(()=>{qs('tcos-overlay').style.backgroundColor=on?color:'transparent';on=!on;},FLASH_INTERVAL_MS);
  }
  function stopFlash(){clearInterval(flashTimer);flashTimer=null;qs('tcos-overlay').style.background='transparent';qs('tcos-modal-wrap').style.display='none';}
  function raiseAlert(key,msg){if(withinSnooze(key))return;currentAlertKey=key;startFlash(key,msg);}
  function onAck(){if(currentAlertKey)setSnooze(currentAlertKey,ACK_SNOOZE_MS);stopFlash();}
  function onSnooze(){if(currentAlertKey)setSnooze(currentAlertKey,SNOOZE_MS);stopFlash();}

  // --- UI ---
  GM_addStyle(`#tcos-overlay{position:fixed;inset:0;z-index:2147483646;}
    #tcos-modal-wrap{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:2147483647;}
    #tcos-modal{background:#222;padding:12px;border-radius:8px;color:#fff;}
    .tcos-pill{position:fixed;right:0;top:40%;background:#000a;color:#fff;padding:8px;border-radius:8px 0 0 8px;font:12px monospace;}
  `);
  function buildUI(){
    if(!qs('tcos-overlay')){const d=document.createElement('div');d.id='tcos-overlay';document.body.appendChild(d);}
    if(!qs('tcos-modal-wrap')){const w=document.createElement('div');w.id='tcos-modal-wrap';w.innerHTML=`<div id="tcos-modal">
      <h3 id="tcos-msg">Attention</h3><p id="tcos-why"></p>
      <button id="tcos-ack">Acknowledge (1h)</button>
      <button id="tcos-snooze">Snooze 5m</button></div>`;document.body.appendChild(w);
      qs('tcos-ack').onclick=onAck;qs('tcos-snooze').onclick=onSnooze;}
    if(!document.querySelector('.tcos-pill')){const p=document.createElement('div');p.className='tcos-pill';
      p.innerHTML=`Drug:<span id="pill-drug">--</span><br>Booster:<span id="pill-booster">--</span>`;document.body.appendChild(p);}
  }

  // --- tick ---
  function render(){
    const d=secLeft(ends.drug);qs('pill-drug').textContent=d>0?fmtHMS(d):'ready';
    const b=secLeft(ends.booster);qs('pill-booster').textContent=b>0?fmtHMS(b):'ready';
    if(d===0 && !withinSnooze('drug'))raiseAlert('drug','Drug cooldown is now 0.');
    if(b>0&&b<=BOOSTER_THRESHOLD_S && !withinSnooze('booster'))raiseAlert('booster','Booster cooldown ≤20h.');
  }

  // --- init ---
  async function init(){
    buildUI();
    snoozeUntil=await GM_getValue(STORAGE.snooze,{});
    ends=await GM_getValue(STORAGE.ends,ends);
    setInterval(scanCooldownsDom,DOM_SCAN_MS);
    setInterval(render,TICK_MS);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
