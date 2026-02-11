// ==UserScript==
// @name         Torn Market Suite (MV/PD + Corner % + List stack $ then %) - Toggleable Panel
// @namespace    http://tampermonkey.net/
// @version      5.1.7
// @description  Three-tab UI (Main/MV/PD). Full-tile/row overlay (T5/T6 semi-transparent). Grid: corner $ + corner % + orange after-tax profit (>0 only); List: tax lines then $ delta then % delta under price. PD overlay only on the single cheapest listing vs the next higher price. Panel opens/closes via MS toggle, has a close (×) button, and supports Esc. Fonts +1px. MS tab always visible. Auto-refreshes MV every 5 min. Author: BazookaJoe.
// @author       BazookaJoe
// @license      MIT
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/imarket.php*
// @match        https://www.torn.com/bazaar.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM.xmlHttpRequest
//
// ===== Auto-update (GitHub raw refs path) =====
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-market-suite.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/torn-market-suite.user.js
// @homepageURL  https://github.com/BazookaJoe58/Torn-scripts
// @supportURL   https://github.com/BazookaJoe58/Torn-scripts/issues
// ==/UserScript==

(function () {
  'use strict';

  const RENDER_DEBOUNCE = 300;

  const K = {
    API_KEY: 'TMS_apiKey_v1',
    MV_CACHE: 'TMS_mvCache_v1',
    MASTER: 'TMS_master_v1',

    MV_ENABLED: 'TMS_mvEnabled_v1',
    MV_DOLLAR: 'TMS_mvDollarMode_v1',
    MV_PERCENT: 'TMS_mvPercentMode_v1',
    MV_D_THR: 'TMS_mvDollarThresholds_v1',
    MV_P_THR: 'TMS_mvPercentThresholds_v1',

    PD_ENABLED: 'TMS_pdEnabled_v1',
    PD_DOLLAR: 'TMS_pdDollarMode_v1',
    PD_PERCENT: 'TMS_pdPercentMode_v1',
    PD_D_THR: 'TMS_pdDollarThresholds_v1',
    PD_P_THR: 'TMS_pdPercentThresholds_v1',

    SHOW_TAX: 'TMS_showTax_v1',
    SHOW_PCT: 'TMS_showPct_v1',
    SHOW_DOL: 'TMS_showDol_v1',

    PERF_VISIBLE: 'TMS_visibleOnly_v1',
    PERF_MAXPASS: 'TMS_maxPerPass_v1',
  };

  const DEF_DOLLAR  = { tier6: 200000, tier5: 50000, tier4: 40000, tier3: 30000, tier2: 20000, tier1: 10000 };
  const DEF_PERCENT = { tier6:    20, tier5:    13, tier4:    12, tier3:    11, tier2:    10, tier1:     9 };

  const S = {
    apiKey: '',
    mv: {},

    master: true,

    mvEnabled: true,
    mvDollarMode: true,
    mvPercentMode: true,
    mvDollarThresholds: { ...DEF_DOLLAR },
    mvPercentThresholds: { ...DEF_PERCENT },

    pdEnabled: true,
    pdDollarMode: true,
    pdPercentMode: true,
    pdDollarThresholds: { ...DEF_DOLLAR },
    pdPercentThresholds: { ...DEF_PERCENT },

    showTax: true,
    showPct: true,
    showDol: true,

    visibleOnly: true,
    maxPerPass: 60,
  };

  const save = (k, v) => GM_setValue(k, typeof v === 'string' ? v : JSON.stringify(v));
  const load = (k, d) => GM_getValue(k, d);

  function loadState() {
    S.apiKey = load(K.API_KEY, '');
    try { S.mv = JSON.parse(load(K.MV_CACHE, '{}')); } catch {}

    S.master = JSON.parse(load(K.MASTER, true));

    S.mvEnabled = JSON.parse(load(K.MV_ENABLED, true));
    S.mvDollarMode = JSON.parse(load(K.MV_DOLLAR, true));
    S.mvPercentMode = JSON.parse(load(K.MV_PERCENT, true));
    try { S.mvDollarThresholds   = JSON.parse(load(K.MV_D_THR, JSON.stringify(DEF_DOLLAR))); } catch {}
    try { S.mvPercentThresholds  = JSON.parse(load(K.MV_P_THR, JSON.stringify(DEF_PERCENT))); } catch {}

    S.pdEnabled = JSON.parse(load(K.PD_ENABLED, true));
    S.pdDollarMode = JSON.parse(load(K.PD_DOLLAR, true));
    S.pdPercentMode = JSON.parse(load(K.PD_PERCENT, true));
    try { S.pdDollarThresholds   = JSON.parse(load(K.PD_D_THR, JSON.stringify(DEF_DOLLAR))); } catch {}
    try { S.pdPercentThresholds  = JSON.parse(load(K.PD_P_THR, JSON.stringify(DEF_PERCENT))); } catch {}

    S.showTax = JSON.parse(load(K.SHOW_TAX, true));
    S.showPct = JSON.parse(load(K.SHOW_PCT, true));
    S.showDol = JSON.parse(load(K.SHOW_DOL, true));

    S.visibleOnly = JSON.parse(load(K.PERF_VISIBLE, true));
    S.maxPerPass = parseInt(load(K.PERF_MAXPASS, 60), 10);
  }

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
  }
  const parsePrice = (txt) => {
    const m = txt?.match(/\$([0-9,]+)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  };
  const getItemIdFromScope = (scope) => {
    const img = scope.querySelector('img.torn-item, img[src*="/images/items/"]');
    const m = img?.src.match(/\/images\/items\/(\d+)\//);
    return m ? m[1] : null;
  };

  function apiGET(url) {
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: 'GET', url,
        onload: r => { try {
          const d = JSON.parse(r.responseText);
          if (d.error) reject(new Error(d.error.error));
          else resolve(d);
        } catch { reject(new Error('Bad JSON')); } },
        onerror: () => reject(new Error('Network error')),
      });
    });
  }
  async function refreshMV(click = true) {
    if (!S.apiKey) { if (click) alert('Set your Torn API key first.'); return; }
    try {
      const data = await apiGET(`https://api.torn.com/torn/?selections=items&key=${S.apiKey}`);
      const out = {};
      for (const id in data.items) out[id] = data.items[id].market_value;
      S.mv = out; save(K.MV_CACHE, out);
      if (click) alert('Market values refreshed.');
      handleChange();
    } catch (e) { if (click) alert(`API error: ${e.message}`); }
  }

  function buildUI() {
    if (document.getElementById('tms-floating')) return;

    GM_addStyle(`
      /* Targets positioned for overlays */
      div[class*="itemTile"], ul[class*="items-list"]>li, .seller-info, #fullListingsView tr, #topCheapestView tr { position: relative !important; }

      #tms-toggle { position: fixed; top: 120px; right: 0; width: 36px; height: 50px; background:#333; color:#fff; border:1px solid #555; border-right:none; border-top-left-radius:8px; border-bottom-left-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-weight:700; z-index:100000; }
      #tms-toggle.hidden { display:flex !important; }

      #tms-floating { position: fixed; top: 120px; right: -360px; width: 340px; z-index: 2000; background:#333; color:#eee; border:1px solid #555; border-right:none; border-top-left-radius:10px; border-bottom-left-radius:10px; box-shadow:-2px 2px 10px rgba(0,0,0,.5); padding: 12px; transition:right .25s; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
      #tms-floating.open { right: 0 !important; }
      #tms-floating h3 { margin:0 0 8px; text-align:center; border-bottom:1px solid #555; padding-bottom:8px; font-size:1.05em; position:relative; }

      #tms-close { position:absolute; right:6px; top:50%; transform:translateY(-50%); background:#444; color:#fff; border:none; border-radius:6px; width:26px; height:26px; font-weight:700; cursor:pointer; line-height:1; }
      #tms-close:hover { background:#555; }

      .tms-tabs { display:flex; gap:6px; margin-bottom:10px; }
      .tms-tab { flex:1; text-align:center; padding:8px 10px; background:#444; border-radius:8px; cursor:pointer; font-weight:700; }
      .tms-tab.active { background:#2e9e4f; }

      .tms-card { border:1px solid #444; border-radius:8px; padding:10px; margin-bottom:10px; background:#2b2b2b; }
      .tms-hidden { display:none; }

      .tms-row { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:6px 0; }
      .tms-switch { position:relative; width:50px; height:26px; }
      .tms-switch input { opacity:0; width:0; height:0; }
      .tms-slider { position:absolute; inset:0; background:#777; border-radius:26px; transition:.2s; }
      .tms-slider:before { content:""; position:absolute; width:20px; height:20px; left:3px; bottom:3px; background:#fff; border-radius:50%; transition:.2s; }
      input:checked + .tms-slider { background:#2e9e4f; }
      input:checked + .tms-slider:before { transform:translateX(24px); }
      .tms-input { width:100%; padding:10px 12px; border-radius:6px; border:1px solid #555; background:#1f1f1f; color:#eee; font-size:15px; }

      .tms-grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
      .tms-grid-row { display:grid; grid-template-columns: auto 1fr; gap:8px; align-items:center; }
      .tms-grid-row input { padding:9px 10px; font-size:15px; }

      .tms-btn { width:100%; margin-top:6px; padding:10px 12px; border:none; border-radius:6px; background:#007bff; color:#fff; font-weight:600; cursor:pointer; }
      .tms-btn.green { background:#2e9e4f; }
      .tms-btn.ghost { background:#444; }

      [data-tms-scope] { position: relative !important; }
      .tms-cover { position: absolute; inset: 0; border-radius: 8px; pointer-events: none; z-index: 1; }

      .tms-profit-tag { position:absolute; top:4px; right:4px; background:rgba(40,167,69,.9); color:#fff; padding:2px 6px; border-radius:4px; font-size:12px; font-weight:700; z-index:2; pointer-events:none; }
      .tms-profit-tag.neg { background:rgba(220,53,69,.9); }
      .tms-corner-pct { position:absolute; top:24px; right:4px; padding:1px 6px; border-radius:4px; font-size:12px; font-weight:700; z-index:2; pointer-events:none; color:#fff; }
      .tms-corner-pct.neg { background:rgba(0,103,0,.9); }
      .tms-corner-pct.pos { background:rgba(153,0,0,.9); }

      .tms-corner-tax { position:absolute; top:44px; right:4px; padding:1px 6px; border-radius:4px; font-size:12px; font-weight:700; z-index:2; pointer-events:none; color:#fff; background:rgba(255,152,0,.9); }

      .tms-underprice { display:flex; flex-direction:column; align-items:flex-start; gap:2px; margin-top:2px; width:100%; z-index:2; position:relative; }
      .tms-badge { display:inline-flex; align-items:center; gap:4px; font-weight:700; font-size:7px; padding:2px 2px; border-radius:4px; white-space:nowrap; color:#fff; }
      .tms-badge.dol.neg { background:rgba(0,103,0,.9); }
      .tms-badge.dol.pos { background:rgba(153,0,0,.9); }
      .tms-badge.pct.neg { background:rgba(0,103,0,.9); }
      .tms-badge.pct.pos { background:rgba(153,0,0,.9); }

      .tms-mini { display:inline-flex; flex-direction:column; line-height:1.1; }
      .tms-mini span { font-size:8px; font-weight:700; white-space:nowrap; }
      .tms-mini .tax { color:#4CAF50; }
      .tms-mini .baz { color:#FF9800; }

      .tms-cover.tmh-profit-1{background-color:rgba(76,175,80,0.22)!important}
      .tms-cover.tmh-profit-2{background-color:rgba(76,175,80,0.40)!important}
      .tms-cover.tmh-profit-3{background-color:rgba(76,175,80,0.58)!important}
      .tms-cover.tmh-profit-4{background-color:rgba(76,175,80,0.74)!important}
      .tms-cover.tmh-profit-5{background-color:rgba(76,175,80,0.62)!important}
      .tms-cover.tmh-profit-6{background-color:rgba(255,215,0,0.60)!important}
      .tms-cover.tmh-profit-partial{background-color:rgba(52,152,219,0.35)!important}

      .tms-cover.tmh-diff-1{background-color:rgba(231,76,60,0.20)!important}
      .tms-cover.tmh-diff-2{background-color:rgba(231,76,60,0.38)!important}
      .tms-cover.tmh-diff-3{background-color:rgba(231,76,60,0.56)!important}
      .tms-cover.tmh-diff-4{background-color:rgba(231,76,60,0.72)!important}
      .tms-cover.tmh-diff-5{background-color:rgba(231,76,60,0.60)!important}
      .tms-cover.tmh-diff-6{background-color:rgba(192,57,43,0.58)!important}
    `);

    // --- Panel (tabs) ---
    const panel = document.createElement('div');
    panel.id = 'tms-floating';
    panel.innerHTML = `
      <h3>
        Torn Market Suite
        <button id="tms-close" title="Close">×</button>
      </h3>
      <div class="tms-tabs">
        <div class="tms-tab active" data-tab="main">Main</div>
        <div class="tms-tab" data-tab="mv">MV Highlight</div>
        <div class="tms-tab" data-tab="pd">Price Diff</div>
      </div>

      <div id="tms-tab-main">
        <div class="tms-card">
          <div class="tms-row"><label>Enabled</label><label class="tms-switch"><input id="tms-master" type="checkbox"><span class="tms-slider"></span></label></div>
          <div class="tms-row"><label>Show % / $ (list/grid)</label><label class="tms-switch"><input id="tms-pct" type="checkbox"><span class="tms-slider"></span></label></div>
          <div class="tms-row"><label>Show after-tax</label><label class="tms-switch"><input id="tms-tax" type="checkbox"><span class="tms-slider"></span></label></div>
          <div class="tms-row"><label>Visible only</label><label class="tms-switch"><input id="tms-vis" type="checkbox"><span class="tms-slider"></span></label></div>
          <div class="tms-row"><label>Max per pass</label><input id="tms-max" type="number" min="10" step="10" class="tms-input" /></div>
        </div>
        <div class="tms-card">
          <div class="tms-row" style="flex-direction:column; align-items:stretch;">
            <label style="margin-bottom:6px;">Torn API key</label>
            <input id="tms-key" type="password" class="tms-input" placeholder="Enter Torn API key" />
            <button id="tms-save" class="tms-btn">Save key</button>
            <button id="tms-refresh" class="tms-btn green">Refresh Market Values</button>
          </div>
        </div>
      </div>

      <div class="tms-hidden" id="tms-tab-mv">
        <div class="tms-card">
          <div class="tms-row"><label>Enabled</label><label class="tms-switch"><input id="tms-mv-enabled" type="checkbox"><span class="tms-slider"></span></label></div>
          <div class="tms-row"><label>$ mode</label><label class="tms-switch"><input id="tms-mv-dollar" type="checkbox"><span class="tms-slider"></span></label></div>
          <div class="tms-row"><label>% mode</label><label class="tms-switch"><input id="tms-mv-percent" type="checkbox"><span class="tms-slider"></span></label></div>
          <div class="tms-grid" style="margin-top:8px;">
            <div><div style="font-weight:600;margin-bottom:4px;">$ Thresholds</div><div id="tms-mv-dollar-grid"></div><button id="tms-save-mv-dollar" class="tms-btn green">Save $</button></div>
            <div><div style="font-weight:600;margin-bottom:4px;">% Thresholds</div><div id="tms-mv-percent-grid"></div><button id="tms-save-mv-percent" class="tms-btn green">Save %</button></div>
          </div>
          <button id="tms-reset-mv" class="tms-btn ghost">Reset MV defaults</button>
        </div>
      </div>

      <div class="tms-hidden" id="tms-tab-pd">
        <div class="tms-card">
          <div class="tms-row"><label>Enabled</label><label class="tms-switch"><input id="tms-pd-enabled" type="checkbox"><span class="tms-slider"></span></label></div>
          <div class="tms-row"><label>$ mode</label><label class="tms-switch"><input id="tms-pd-dollar" type="checkbox"><span class="tms-slider"></span></label></div>
          <div class="tms-row"><label>% mode</label><label class="tms-switch"><input id="tms-pd-percent" type="checkbox"><span class="tms-slider"></span></label></div>
          <div class="tms-grid" style="margin-top:8px;">
            <div><div style="font-weight:600;margin-bottom:4px;">$ Thresholds</div><div id="tms-pd-dollar-grid"></div><button id="tms-save-pd-dollar" class="tms-btn green">Save $</button></div>
            <div><div style="font-weight:600;margin-bottom:4px;">% Thresholds</div><div id="tms-pd-percent-grid"></div><button id="tms-save-pd-percent" class="tms-btn green">Save %</button></div>
          </div>
          <button id="tms-reset-pd" class="tms-btn ghost">Reset PD defaults</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    const toggle = document.createElement('div');
    toggle.id = 'tms-toggle'; toggle.textContent = 'MS';
    document.body.appendChild(toggle);

    toggle.addEventListener('click', () => panel.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'tms-toggle') {
        const p = document.getElementById('tms-floating');
        if (p) p.classList.toggle('open');
      }
    });
    panel.querySelector('#tms-close')?.addEventListener('click', () => panel.classList.remove('open'));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.remove('open'); });

    const tabs = panel.querySelectorAll('.tms-tab');
    const pages = {
      main: panel.querySelector('#tms-tab-main'),
      mv:   panel.querySelector('#tms-tab-mv'),
      pd:   panel.querySelector('#tms-tab-pd'),
    };
    tabs.forEach(t => t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.remove('active'));
      Object.values(pages).forEach(p => p.classList.add('tms-hidden'));
      t.classList.add('active');
      pages[t.dataset.tab].classList.remove('tms-hidden');
    }));

    const renderGrid = (root, thr, isPercent=false) => {
      root.innerHTML = '';
      for (let i = 6; i >= 1; i--) {
        const row = document.createElement('div');
        row.className = 'tms-grid-row';
        row.innerHTML = `<label>Tier ${i} ≥</label><input type="number" step="${isPercent?'0.1':'1'}" class="tms-input" data-tier="${i}" value="${thr[`tier${i}`]}">`;
        root.appendChild(row);
      }
    };
    const readGrid = (root, thr) => {
      root.querySelectorAll('input[type="number"]').forEach(inp => {
        const v = parseFloat(inp.value);
        if (!Number.isNaN(v)) thr[`tier${inp.dataset.tier}`] = v;
      });
    };

    const $ = s => panel.querySelector(s);
    $('#tms-master').checked = S.master;
    $('#tms-pct').checked   = S.showPct;
    $('#tms-tax').checked   = S.showTax;
    $('#tms-vis').checked   = S.visibleOnly;
    $('#tms-max').value     = String(S.maxPerPass);
    $('#tms-key').value     = S.apiKey || '';

    $('#tms-mv-enabled').checked = S.mvEnabled;
    $('#tms-mv-dollar').checked  = S.mvDollarMode;
    $('#tms-mv-percent').checked = S.mvPercentMode;
    renderGrid($('#tms-mv-dollar-grid'),  S.mvDollarThresholds,  false);
    renderGrid($('#tms-mv-percent-grid'), S.mvPercentThresholds, true);

    $('#tms-pd-enabled').checked = S.pdEnabled;
    $('#tms-pd-dollar').checked  = S.pdDollarMode;
    $('#tms-pd-percent').checked = S.pdPercentMode;
    renderGrid($('#tms-pd-dollar-grid'),  S.pdDollarThresholds,  false);
    renderGrid($('#tms-pd-percent-grid'), S.pdPercentThresholds, true);

    $('#tms-master').addEventListener('change', e => { S.master = e.target.checked; save(K.MASTER, S.master); handleChange(); });
    $('#tms-pct').addEventListener('change', e => { S.showPct = e.target.checked; save(K.SHOW_PCT, S.showPct); handleChange(); });
    $('#tms-tax').addEventListener('change', e => { S.showTax = e.target.checked; save(K.SHOW_TAX, S.showTax); handleChange(); });
    $('#tms-vis').addEventListener('change', e => { S.visibleOnly = e.target.checked; save(K.PERF_VISIBLE, S.visibleOnly); handleChange(); });
    $('#tms-max').addEventListener('change', e => { const v = parseInt(e.target.value, 10); S.maxPerPass = isNaN(v)?60:Math.max(10,v); save(K.PERF_MAXPASS, S.maxPerPass); handleChange(); });

    $('#tms-key').addEventListener('keydown', e => { if (e.key === 'Enter') $('#tms-save').click(); });
    $('#tms-save').addEventListener('click', () => { S.apiKey = $('#tms-key').value.trim(); save(K.API_KEY, S.apiKey); alert('API key saved.'); });
    $('#tms-refresh').addEventListener('click', () => refreshMV(true));

    $('#tms-mv-enabled').addEventListener('change', e => { S.mvEnabled = e.target.checked; save(K.MV_ENABLED, S.mvEnabled); handleChange(); });
    $('#tms-mv-dollar').addEventListener('change',  e => { S.mvDollarMode = e.target.checked; save(K.MV_DOLLAR, S.mvDollarMode); handleChange(); });
    $('#tms-mv-percent').addEventListener('change', e => { S.mvPercentMode = e.target.checked; save(K.MV_PERCENT, S.mvPercentMode); handleChange(); });

    $('#tms-pd-enabled').addEventListener('change', e => { S.pdEnabled = e.target.checked; save(K.PD_ENABLED, S.pdEnabled); handleChange(); });
    $('#tms-pd-dollar').addEventListener('change',  e => { S.pdDollarMode = e.target.checked; save(K.PD_DOLLAR, S.pdDollarMode); handleChange(); });
    $('#tms-pd-percent').addEventListener('change', e => { S.pdPercentMode = e.target.checked; save(K.PD_PERCENT, S.pdPercentMode); handleChange(); });

    $('#tms-save-mv-dollar').addEventListener('click', () => { readGrid($('#tms-mv-dollar-grid'),  S.mvDollarThresholds);  save(K.MV_D_THR, S.mvDollarThresholds);  alert('MV $ thresholds saved.'); handleChange(); });
    $('#tms-save-mv-percent').addEventListener('click', () => { readGrid($('#tms-mv-percent-grid'), S.mvPercentThresholds); save(K.MV_P_THR, S.mvPercentThresholds); alert('MV % thresholds saved.'); handleChange(); });
    $('#tms-reset-mv').addEventListener('click', () => {
      S.mvDollarThresholds = { ...DEF_DOLLAR };
      S.mvPercentThresholds = { ...DEF_PERCENT };
      renderGrid($('#tms-mv-dollar-grid'),  S.mvDollarThresholds);
      renderGrid($('#tms-mv-percent-grid'), S.mvPercentThresholds, true);
      save(K.MV_D_THR, S.mvDollarThresholds); save(K.MV_P_THR, S.mvPercentThresholds);
      alert('MV thresholds reset.'); handleChange();
    });

    $('#tms-save-pd-dollar').addEventListener('click', () => { readGrid($('#tms-pd-dollar-grid'),  S.pdDollarThresholds);  save(K.PD_D_THR, S.pdDollarThresholds);  alert('PD $ thresholds saved.'); handleChange(); });
    $('#tms-save-pd-percent').addEventListener('click', () => { readGrid($('#tms-pd-percent-grid'), S.pdPercentThresholds); save(K.PD_P_THR, S.pdPercentThresholds); alert('PD % thresholds saved.'); handleChange(); });
    $('#tms-reset-pd').addEventListener('click', () => {
      S.pdDollarThresholds = { ...DEF_DOLLAR };
      S.pdPercentThresholds = { ...DEF_PERCENT };
      renderGrid($('#tms-pd-dollar-grid'),  S.pdDollarThresholds);
      renderGrid($('#tms-pd-percent-grid'), S.pdPercentThresholds, true);
      save(K.PD_D_THR, S.pdDollarThresholds); save(K.PD_P_THR, S.pdPercentThresholds);
      alert('PD thresholds reset.'); handleChange();
    });
  }

  const tierClass = (thr, value, prefix) => {
    if (value >= thr.tier6) return `${prefix}-6`;
    if (value >= thr.tier5) return `${prefix}-5`;
    if (value >= thr.tier4) return `${prefix}-4`;
    if (value >= thr.tier3) return `${prefix}-3`;
    if (value >= thr.tier2) return `${prefix}-2`;
    if (value >= thr.tier1) return `${prefix}-1`;
    return '';
  };

  function ensureScope(el){
    if (!el.hasAttribute('data-tms-scope')) el.setAttribute('data-tms-scope', '1');
    let cover = el.querySelector(':scope > .tms-cover');
    if (!cover){
      cover = document.createElement('div');
      cover.className = 'tms-cover';
      el.prepend(cover);
    }
    return cover;
  }
  function setCoverClass(cover, cls){
    cover.className = 'tms-cover';
    if (cls) cover.classList.add(cls);
  }

  function addCornerProfit(scope, delta) {
    scope.querySelector(':scope > .tms-profit-tag')?.remove();
    const t = document.createElement('div');
    t.className = 'tms-profit-tag' + (delta < 0 ? ' neg' : '');
    t.textContent = `$${delta.toLocaleString()}`;
    scope.appendChild(t);
  }
  function addCornerPct(scope, pct) {
    if (!S.showPct) return;
    scope.querySelector(':scope > .tms-corner-pct')?.remove();
    const t = document.createElement('div');
    t.className = 'tms-corner-pct ' + (pct > 0 ? 'neg' : 'pos');
    t.textContent = `${pct > 0 ? '-' : '+'}${Math.abs(pct)}%`;
    scope.appendChild(t);
  }
  function addCornerTaxProfit(scope, netProfit) {
    scope.querySelector(':scope > .tms-corner-tax')?.remove();
    const t = document.createElement('div');
    t.className = 'tms-corner-tax';
    t.textContent = `$${netProfit.toLocaleString()}`;
    scope.appendChild(t);
  }

  function buildUnderPrice(price, mv) {
    const wrap = document.createElement('div');
    wrap.className = 'tms-underprice';

    if (S.showTax) {
      const tax = document.createElement('div');
      tax.className = 'tms-mini';
      tax.innerHTML = `
        <span class="baz">($${Math.floor(price * 0.857).toLocaleString()})</span>
        <span class="tax">($${Math.floor(price * 0.95).toLocaleString()})</span>`;
      wrap.appendChild(tax);
    }

    // Only add $/% deltas if MV exists
    if (mv != null && (S.showPct || S.showDol)) {
      const moneyDelta = mv - price;
      const b$ = document.createElement('span');
      b$.className = 'tms-badge dol ' + (moneyDelta > 0 ? 'neg' : 'pos');
      b$.textContent = `${moneyDelta > 0 ? '-' : '+'}$${Math.abs(moneyDelta).toLocaleString()}`;
      wrap.appendChild(b$);

      if (S.showPct) {
        const pct = Math.round((moneyDelta / Math.max(mv,1)) * 100);
        const bPct = document.createElement('span');
        bPct.className = 'tms-badge pct ' + (pct > 0 ? 'neg' : 'pos');
        bPct.textContent = `${pct > 0 ? '-' : '+'}${Math.abs(pct)}%`;
        wrap.appendChild(bPct);
      }
    }

    return wrap;
  }

  function applyMVHighlight(scope, price) {
    if (!S.mvEnabled) return '';
    const id = getItemIdFromScope(scope);
    const mv = id ? S.mv[id] : null;
    if (price == null || mv == null) return '';
    const profit = Math.round(mv - price);
    addCornerProfit(scope, profit);
    addCornerPct(scope, Math.round(((mv - price) / Math.max(mv,1)) * 100));
    const d = S.mvDollarMode ? tierClass(S.mvDollarThresholds, profit, 'tmh-profit') : '';
    const p = S.mvPercentMode ? tierClass(S.mvPercentThresholds, mv > 0 ? (profit / mv) * 100 : 0, 'tmh-profit') : '';
    if (S.mvDollarMode && S.mvPercentMode) {
      if (d && p) {
        const dt = +d.slice(-1), pt = +p.slice(-1);
        return `tmh-profit-${Math.min(dt, pt)}`;
      } else if (d || p) return 'tmh-profit-partial';
      return '';
    }
    return d || p || '';
  }

  function applyPDDiscountHighlight(thisPrice, nextPrice) {
    if (!S.pdEnabled || thisPrice == null || nextPrice == null) return '';
    const diff = nextPrice - thisPrice; // positive => current is cheaper
    if (diff <= 0) return '';
    const d = S.pdDollarMode ? tierClass(S.pdDollarThresholds, diff, 'tmh-diff') : '';
    const p = S.pdPercentMode ? tierClass(S.pdPercentThresholds, nextPrice > 0 ? (diff / nextPrice) * 100 : 0, 'tmh-diff') : '';
    if (S.pdDollarMode && S.pdPercentMode) return (d && p) ? d : '';
    return d || p || '';
  }

  const processed = new Set();

  function processGrid() {
    let count = 0;
    document.querySelectorAll('div[class*="itemTile"]').forEach(tile => {
      if (count >= S.maxPerPass) return;
      if (processed.has(tile)) return;
      if (S.visibleOnly && !inViewport(tile)) return;

      const priceEl = tile.querySelector('div[class*="priceAndTotal"]>span:first-child, [class*="price"]');
      const price = parsePrice(priceEl?.textContent);
      if (price == null) return;

      const id = getItemIdFromScope(tile);
      const mv = id ? S.mv[id] : null;

      if (S.master) {
        const cover = ensureScope(tile);

        // Grid: no under-price stack
        priceEl?.querySelector('.tms-underprice')?.remove();

        // MV highlight if we have MV
        const cls = mv != null ? applyMVHighlight(tile, price) : '';
        // Orange after-tax profit if MV exists and > 0
        tile.querySelector(':scope > .tms-corner-tax')?.remove();
        if (mv != null) {
          const netProfit = Math.round(mv * 0.95 - price);
          if (netProfit > 0) addCornerTaxProfit(tile, netProfit);
        }

        setCoverClass(cover, cls);
      }

      processed.add(tile);
      count++;
    });
  }

  function processList() {
    const rows = Array.from(document.querySelectorAll('[class*="rowWrapper"], [class*="sellerRow"], .seller-info'));
    if (!rows.length) return;

    const rowPrices = rows.map(r => parsePrice(r.querySelector('[class*="price"]')?.textContent));

    // Only one PD overlay: cheapest vs next higher price
    const valid = rowPrices.filter(p => p != null);
    const cheapestPrice = valid.length ? Math.min(...valid) : null;
    const nextHigherPrice = valid.filter(p => p > cheapestPrice).sort((a, b) => a - b)[0] ?? null;
    const cheapestIndex = rowPrices.findIndex(p => p === cheapestPrice);

    let count = 0;
    rows.forEach((row, idx) => {
      if (count >= S.maxPerPass) return;
      if (processed.has(row)) return;
      if (S.visibleOnly && !inViewport(row)) return;

      const priceEl = row.querySelector('[class*="price"]');
      const price = rowPrices[idx];
      if (price == null) return;

      const id = getItemIdFromScope(row);
      const mv = id ? S.mv[id] : null;

      if (S.master) {
        const cover = ensureScope(row);

        // Under-price stack: always show tax; show $/% only if MV exists
        priceEl?.querySelector('.tms-underprice')?.remove();
        priceEl.appendChild(buildUnderPrice(price, mv));

        // MV highlight if MV exists
        let cls = mv != null ? applyMVHighlight(row, price) : '';

        // Only cheapest row can receive PD highlight (vs next higher), MV not required
        if (idx === cheapestIndex) {
          const pd = applyPDDiscountHighlight(price, nextHigherPrice);
          if (!cls && pd) cls = pd;
        }

        setCoverClass(cover, cls);
      }

      processed.add(row);
      count++;
    });
  }

  function processBazaar() {
    let count = 0;
    document.querySelectorAll('#fullListingsView table tbody tr, #topCheapestView table tbody tr').forEach(row => {
      if (count >= S.maxPerPass) return;
      if (processed.has(row)) return;
      if (S.visibleOnly && !inViewport(row)) return;

      const priceCell = row.querySelector('td:first-child');
      const price = parsePrice(priceCell?.innerText);
      if (price == null) return;

      priceCell?.querySelector('.tms-underprice')?.remove();
      if (S.showTax) {
        const wrap = document.createElement('div');
        wrap.className = 'tms-underprice';
        const tax = document.createElement('div');
        tax.className = 'tms-mini';
        tax.innerHTML = `
          <span class="baz">($${Math.floor(price * 0.914).toLocaleString()})</span>
          <span class="tax">($${Math.floor(price * 0.95).toLocaleString()})</span>`;
        wrap.appendChild(tax);
        priceCell.appendChild(wrap);
      }

      processed.add(row);
      count++;
    });
  }

  let rerenderTimer;
  function handleChange(){
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(()=>{
      processed.clear();
      document.querySelectorAll('.tms-underprice, .tms-profit-tag, .tms-corner-pct, .tms-corner-tax, .tms-cover').forEach(n=>n.remove());

      const toggle = document.getElementById('tms-toggle');
      if (toggle) toggle.classList.remove('hidden');

      const isMarketList = !!document.querySelector('[class*="rowWrapper"], [class*="sellerRow"], .seller-info');
      const isMarketGrid = !!document.querySelector('div[class*="itemTile"]');
      const isBazaar = !!document.querySelector('#bazaarRoot');

      if (isMarketGrid) processGrid();
      if (isMarketList) processList();
      if (isBazaar) processBazaar();
    }, RENDER_DEBOUNCE);
  }

  loadState();
  buildUI();
  new MutationObserver(handleChange).observe(document.body, { childList:true, subtree:true });
  window.addEventListener('hashchange', handleChange);

  (function ensureToggleHook(){
    const rebind = () => {
      const toggle = document.getElementById('tms-toggle');
      const panel  = document.getElementById('tms-floating');
      if (!toggle || !panel) return;
      if (!toggle.dataset.bound) {
        toggle.dataset.bound = '1';
        toggle.addEventListener('click', () => panel.classList.toggle('open'));
      }
    };
    rebind();
    const id = setInterval(rebind, 1000);
    setTimeout(() => clearInterval(id), 15000);
  })();

  // ---- Auto-refresh MV every 5 minutes (silent) ----
  function autoRefreshMV() {
    if (!S.apiKey) return;
    refreshMV(false);
  }
  setInterval(autoRefreshMV, 5 * 60 * 1000);
  autoRefreshMV();

  handleChange();
})();
