// ==UserScript==
// @name         Torn Market Suite (MV/PD + Corner % + $→% + Orange Net) — PDA Port (Desktop-Style UI)
// @namespace
// @version      5.2.4
// @description  PDA-ready port matching your TM suite (same storage keys) with desktop-style controls. Tabs (Main/MV/PD), 6 tiers for MV & PD (dollar+percent), corner $ + corner %, orange after-tax net in grid, list shows tax then $ + %, PD overlay only on the cheapest vs next, T5/T6 semi-transparent, debounced/visible-only passes. Compact (~50%) and auto-fit to phone viewport. Author: BazookaJoe.
// @author       BazookaJoe
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/imarket.php*
// @match        https://www.torn.com/bazaar.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM.xmlHttpRequest
//
// Auto-update (raw links for PDA):
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/PDA-torm-market-suite.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/userscripts/PDA-torm-market-suite.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- constants & storage keys (kept identical to your TM scheme) ---
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

  // Default tiers
  const DEF_DOLLAR  = { tier6: 60000, tier5: 50000, tier4: 40000, tier3: 30000, tier2: 20000, tier1: 10000 };
  const DEF_PERCENT = { tier6:    14, tier5:    13, tier4:    12, tier3:    11, tier2:    10, tier1:     9 };

  const TAX_RATE = 0.05;

  // --- state (loaded from storage) ---
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
    try { S.mvDollarThresholds  = JSON.parse(load(K.MV_D_THR, JSON.stringify(DEF_DOLLAR))); } catch {}
    try { S.mvPercentThresholds = JSON.parse(load(K.MV_P_THR, JSON.stringify(DEF_PERCENT))); } catch {}

    S.pdEnabled = JSON.parse(load(K.PD_ENABLED, true));
    S.pdDollarMode = JSON.parse(load(K.PD_DOLLAR, true));
    S.pdPercentMode = JSON.parse(load(K.PD_PERCENT, true));
    try { S.pdDollarThresholds  = JSON.parse(load(K.PD_D_THR, JSON.stringify(DEF_DOLLAR))); } catch {}
    try { S.pdPercentThresholds = JSON.parse(load(K.PD_P_THR, JSON.stringify(DEF_PERCENT))); } catch {}

    S.showTax = JSON.parse(load(K.SHOW_TAX, true));
    S.showPct = JSON.parse(load(K.SHOW_PCT, true));
    S.showDol = JSON.parse(load(K.SHOW_DOL, true));

    S.visibleOnly = JSON.parse(load(K.PERF_VISIBLE, true));
    S.maxPerPass = parseInt(load(K.PERF_MAXPASS, 60), 10);
  }
  loadState();

  // --- compact styles + auto-fit base ---
  GM_addStyle(`
    [data-tms-scope]{position:relative!important}

    /* Smaller on‑page decorations (~50%) */
    .tms-overlay{position:absolute;inset:0;border-radius:8px;pointer-events:none;z-index:1;opacity:.18}
    .tms-t5{background:#2e9e4f}
    .tms-t6{background:#0b7a27}

    .tms-corner{position:absolute;top:3px;right:3px;z-index:3;display:flex;flex-direction:column;gap:1px}
    .tms-chip{padding:0 4px;border-radius:3px;font-size:9px;font-weight:700;color:#fff;text-align:right;line-height:1.3}
    .tms-chip.dol{background:#006700}
    .tms-chip.pct{background:#990000}
    .tms-chip.tax{background:#ff7a00}

    .tms-under{display:flex;flex-direction:column;gap:1px;margin-top:1px}
    .tms-badge{display:inline-flex;gap:3px;align-items:center;padding:1px 3px;border-radius:3px;font-size:9px;color:#fff;font-weight:700;width:max-content;line-height:1.2}
    .tms-badge.mv{background:#3a3a9a}
    .tms-badge.pd{background:#7a3a9a}
    .tms-badge.tax{background:#ff7a00}

    /* Panel — responsive & scaled via CSS var */
    #tms-toggle{position:fixed;top:96px;right:0;width:28px;height:40px;background:#333;color:#fff;border:1px solid #555;border-right:none;border-top-left-radius:8px;border-bottom-left-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:700;z-index:100000;font-size:12px}
    #tms-floating{
      --tms-scale:.5; /* base target ~50% */
      position:fixed;top:96px;right:-380px;width:360px;
      background:#2b2b2b;color:#eee;border:1px solid #555;border-right:none;border-top-left-radius:10px;border-bottom-left-radius:10px;
      box-shadow:-2px 2px 12px rgba(0,0,0,.5);padding:10px;transition:right .25s;z-index:100001;
      transform:scale(var(--tms-scale));transform-origin:top right;will-change:transform;
      max-height:80vh;overflow:auto;
    }
    #tms-floating.open{right:0}
    #tms-floating h3{margin:0 0 6px;text-align:center;border-bottom:1px solid #555;padding-bottom:6px;font-size:.95em;position:relative}
    #tms-close{position:absolute;right:6px;top:50%;transform:translateY(-50%);background:#444;color:#fff;border:none;border-radius:6px;width:22px;height:22px;font-weight:700;cursor:pointer;font-size:12px}

    .tms-tabs{display:flex;gap:4px;margin-bottom:8px}
    .tms-tab{flex:1;text-align:center;padding:6px 8px;background:#444;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px}
    .tms-tab.active{background:#2e9e4f}
    .tms-card{border:1px solid #444;border-radius:8px;padding:8px;margin-bottom:8px;background:#222}
    .tms-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0}
    .tms-switch{position:relative;width:42px;height:22px}
    .tms-switch input{opacity:0;width:0;height:0}
    .tms-slider{position:absolute;inset:0;background:#777;border-radius:22px;transition:.2s}
    .tms-slider:before{content:"";position:absolute;width:16px;height:16px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s}
    input:checked + .tms-slider{background:#2e9e4f}
    input:checked + .tms-slider:before{transform:translateX(20px)}
    .tms-grid{display:grid;grid-template-columns:auto 1fr;gap:6px;align-items:center}
    .tms-input{width:100%;padding:6px 8px;border-radius:6px;border:1px solid #555;background:#1f1f1f;color:#eee;font-size:12px}
    .tms-btn{width:100%;margin-top:6px;padding:8px 10px;border:none;border-radius:6px;background:#2e9e4f;color:#fff;font-weight:700;cursor:pointer;font-size:12px}
    .tms-btn.ghost{background:#444}

    /* Desktop-style accents */
    .tms-btn.primary{background:#1e66ff}
    .tms-btn.success{background:#2e9e4f}
    .tms-btn.destructive{background:#555}
    .tms-btn:disabled{opacity:.6;cursor:not-allowed}
    .tms-subhead{font-weight:700;margin:6px 0 4px;opacity:.9}
    .tms-th-cols{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .tms-th-box{border:1px solid #444;border-radius:8px;padding:8px;background:#1d1d1d}
    .tms-th-title{font-size:12px;margin-bottom:6px;opacity:.8}
    .tms-th-grid{display:grid;grid-template-columns:auto 1fr;gap:6px;align-items:center}
  `);

  // --- utils ---
  const inViewport = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
  };
  const parsePrice = (txt) => {
    const m = txt?.match(/\$([0-9,]+)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  };
  const getItemIdFromScope = (scope) => {
    const img = scope.querySelector('img.torn-item, img[src*="/images/items/"]');
    const m = img?.src.match(/\/images\/items\/(\d+)\//);
    return m ? m[1] : null;
  };

  function pctTierClass(pct, thr) {
    const ap = Math.abs(pct);
    if (ap < 0.5) return 'eq';
    const L = [thr.tier6, thr.tier5, thr.tier4, thr.tier3, thr.tier2, thr.tier1];
    if (pct > 0) {
      if (pct >= L[0]) return 't6';
      if (pct >= L[1]) return 't5';
      if (pct >= L[2]) return 't4';
      if (pct >= L[3]) return 't3';
      if (pct >= L[4]) return 't2';
      return 't1';
    } else {
      if (ap >= L[0]) return 'n6';
      if (ap >= L[1]) return 'n5';
      if (ap >= L[2]) return 'n4';
      if (ap >= L[3]) return 'n3';
      if (ap >= L[4]) return 'n2';
      return 'n1';
    }
  }
  function dolTierStrong(delta, thr){ // 0..6 (only 5/6 trigger overlays)
    const ap = Math.abs(delta);
    if (ap >= thr.tier6) return 6;
    if (ap >= thr.tier5) return 5;
    return 0;
  }

  // --- Torn API (MV) ---
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
      for (const id in data.items) out[id] = data.items[id].market_value || 0;
      S.mv = out; save(K.MV_CACHE, out);
      if (click) alert('Market values refreshed.');
      scheduleRender();
    } catch (e) { if (click) alert(`API error: ${e.message}`); }
  }

  // --- UI helpers ---
  function switchRow(label, id, checked) {
    return `
      <div class="tms-row">
        <div>${label}</div>
        <label class="tms-switch">
          <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
          <span class="tms-slider"></span>
        </label>
      </div>
    `;
  }
  function bindSwitch(id, cb) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => cb(el.checked));
  }
  function read6(prefix) {
    return {
      tier6: toNum(document.getElementById(prefix + 't6')?.value),
      tier5: toNum(document.getElementById(prefix + 't5')?.value),
      tier4: toNum(document.getElementById(prefix + 't4')?.value),
      tier3: toNum(document.getElementById(prefix + 't3')?.value),
      tier2: toNum(document.getElementById(prefix + 't2')?.value),
      tier1: toNum(document.getElementById(prefix + 't1')?.value),
    };
  }
  const toNum = (v) => (Number.isFinite(+v) ? +v : 0);

  function tmsApplyAutoScale() {
    const floating = document.getElementById('tms-floating');
    if (!floating) return;

    // Base design size before scaling
    const baseW = 360;   // px
    const baseH = 520;   // approx content height

    const vw = Math.max(320, window.innerWidth || document.documentElement.clientWidth);
    const vh = Math.max(320, window.innerHeight || document.documentElement.clientHeight);

    // Fit within 92% width and 82% height
    const fitW = 0.92 * vw / baseW;
    const fitH = 0.82 * vh / baseH;

    // Final scale: min(target 0.5, fit limits, and never above 1)
    const scale = Math.min(0.5, fitW, fitH, 1);
    floating.style.setProperty('--tms-scale', scale.toFixed(3));
  }

  // --- UI panel (Main / MV / PD) ---
  function buildUI() {
    if (document.getElementById('tms-floating')) return;

    const toggle = document.createElement('div');
    toggle.id = 'tms-toggle';
    toggle.textContent = 'MS';
    document.body.appendChild(toggle);

    const floating = document.createElement('div');
    floating.id = 'tms-floating';
    floating.innerHTML = `
      <h3>Torn Market Suite <button id="tms-close" title="Close">×</button></h3>

      <div class="tms-tabs">
        <div class="tms-tab active" data-tab="main">Main</div>
        <div class="tms-tab" data-tab="mv">MV Highlight</div>
        <div class="tms-tab" data-tab="pd">Price Diff</div>
      </div>

      <!-- MAIN -->
      <div class="tms-card tms-pane" data-pane="main">
        ${switchRow('Enabled', 'tms-master', S.master)}
        ${switchRow('Show % / $ (list/grid)', 'tms-showPct', S.showPct)}
        ${switchRow('Show after-tax', 'tms-showTax', S.showTax)}
        ${switchRow('Visible only', 'tms-visibleOnly', S.visibleOnly)}
        <div class="tms-grid" style="margin-top:6px">
          <label>Max per pass</label>
          <input class="tms-input" id="tms-maxpass" type="number" min="10" step="10" value="${S.maxPerPass}">
        </div>

        <div class="tms-subhead" style="margin-top:10px">Torn API key</div>
        <input class="tms-input" id="tms-apikey" placeholder="XXXX..." value="${S.apiKey}">
        <button class="tms-btn primary" id="tms-savekey" style="margin-top:8px">Save key</button>
        <button class="tms-btn success" id="tms-refresh-mv" style="margin-top:8px">Refresh Market Values</button>

        <button class="tms-btn ghost" id="tms-reprocess" style="margin-top:10px">Reprocess</button>
      </div>

      <!-- MV -->
      <div class="tms-card tms-pane tms-hidden" data-pane="mv">
        ${switchRow('Enabled', 'tms-mvEnabled', S.mvEnabled)}
        ${switchRow('$ mode', 'tms-mvDollar', S.mvDollarMode)}
        ${switchRow('% mode', 'tms-mvPercent', S.mvPercentMode)}

        <div class="tms-th-cols" style="margin-top:8px">
          <div class="tms-th-box">
            <div class="tms-th-title">$ Thresholds</div>
            <div class="tms-th-grid">
              <label>Tier 6 ≥</label><input class="tms-input" id="mv_d_t6" type="number" value="${S.mvDollarThresholds.tier6}">
              <label>Tier 5 ≥</label><input class="tms-input" id="mv_d_t5" type="number" value="${S.mvDollarThresholds.tier5}">
              <label>Tier 4 ≥</label><input class="tms-input" id="mv_d_t4" type="number" value="${S.mvDollarThresholds.tier4}">
              <label>Tier 3 ≥</label><input class="tms-input" id="mv_d_t3" type="number" value="${S.mvDollarThresholds.tier3}">
              <label>Tier 2 ≥</label><input class="tms-input" id="mv_d_t2" type="number" value="${S.mvDollarThresholds.tier2}">
              <label>Tier 1 ≥</label><input class="tms-input" id="mv_d_t1" type="number" value="${S.mvDollarThresholds.tier1}">
            </div>
            <button class="tms-btn success" id="mv-save" style="margin-top:8px">Save $</button>
          </div>

          <div class="tms-th-box">
            <div class="tms-th-title">% Thresholds</div>
            <div class="tms-th-grid">
              <label>Tier 6 ≥</label><input class="tms-input" id="mv_p_t6" type="number" value="${S.mvPercentThresholds.tier6}">
              <label>Tier 5 ≥</label><input class="tms-input" id="mv_p_t5" type="number" value="${S.mvPercentThresholds.tier5}">
              <label>Tier 4 ≥</label><input class="tms-input" id="mv_p_t4" type="number" value="${S.mvPercentThresholds.tier4}">
              <label>Tier 3 ≥</label><input class="tms-input" id="mv_p_t3" type="number" value="${S.mvPercentThresholds.tier3}">
              <label>Tier 2 ≥</label><input class="tms-input" id="mv_p_t2" type="number" value="${S.mvPercentThresholds.tier2}">
              <label>Tier 1 ≥</label><input class="tms-input" id="mv_p_t1" type="number" value="${S.mvPercentThresholds.tier1}">
            </div>
            <button class="tms-btn success" id="mv-save-pct" style="margin-top:8px">Save %</button>
          </div>
        </div>

        <button class="tms-btn destructive" id="mv-reset-defaults" style="margin-top:8px">Reset MV defaults</button>
      </div>

      <!-- PD -->
      <div class="tms-card tms-pane tms-hidden" data-pane="pd">
        ${switchRow('Enabled', 'tms-pdEnabled', S.pdEnabled)}
        ${switchRow('$ mode', 'tms-pdDollar', S.pdDollarMode)}
        ${switchRow('% mode', 'tms-pdPercent', S.pdPercentMode)}

        <div class="tms-th-cols" style="margin-top:8px">
          <div class="tms-th-box">
            <div class="tms-th-title">$ Thresholds</div>
            <div class="tms-th-grid">
              <label>Tier 6 ≥</label><input class="tms-input" id="pd_d_t6" type="number" value="${S.pdDollarThresholds.tier6}">
              <label>Tier 5 ≥</label><input class="tms-input" id="pd_d_t5" type="number" value="${S.pdDollarThresholds.tier5}">
              <label>Tier 4 ≥</label><input class="tms-input" id="pd_d_t4" type="number" value="${S.pdDollarThresholds.tier4}">
              <label>Tier 3 ≥</label><input class="tms-input" id="pd_d_t3" type="number" value="${S.pdDollarThresholds.tier3}">
              <label>Tier 2 ≥</label><input class="tms-input" id="pd_d_t2" type="number" value="${S.pdDollarThresholds.tier2}">
              <label>Tier 1 ≥</label><input class="tms-input" id="pd_d_t1" type="number" value="${S.pdDollarThresholds.tier1}">
            </div>
            <button class="tms-btn success" id="pd-save" style="margin-top:8px">Save $</button>
          </div>

          <div class="tms-th-box">
            <div class="tms-th-title">% Thresholds</div>
            <div class="tms-th-grid">
              <label>Tier 6 ≥</label><input class="tms-input" id="pd_p_t6" type="number" value="${S.pdPercentThresholds.tier6}">
              <label>Tier 5 ≥</label><input class="tms-input" id="pd_p_t5" type="number" value="${S.pdPercentThresholds.tier5}">
              <label>Tier 4 ≥</label><input class="tms-input" id="pd_p_t4" type="number" value="${S.pdPercentThresholds.tier4}">
              <label>Tier 3 ≥</label><input class="tms-input" id="pd_p_t3" type="number" value="${S.pdPercentThresholds.tier3}">
              <label>Tier 2 ≥</label><input class="tms-input" id="pd_p_t2" type="number" value="${S.pdPercentThresholds.tier2}">
              <label>Tier 1 ≥</label><input class="tms-input" id="pd_p_t1" type="number" value="${S.pdPercentThresholds.tier1}">
            </div>
            <button class="tms-btn success" id="pd-save-pct" style="margin-top:8px">Save %</button>
          </div>
        </div>

        <button class="tms-btn destructive" id="pd-reset-defaults" style="margin-top:8px">Reset PD defaults</button>
      </div>
    `;
    document.body.appendChild(floating);

    // open/close & autoscale — keep PDA behavior
    toggle.addEventListener('click', () => {
      floating.classList.toggle('open');
      tmsApplyAutoScale();
    });
    floating.querySelector('#tms-close').onclick = () => floating.classList.remove('open');
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') floating.classList.remove('open'); });

    // tabs
    floating.querySelectorAll('.tms-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        floating.querySelectorAll('.tms-tab').forEach(t => t.classList.remove('active'));
        floating.querySelectorAll('.tms-pane').forEach(p => p.classList.add('tms-hidden'));
        tab.classList.add('active');
        floating.querySelector(`.tms-pane[data-pane="${tab.dataset.tab}"]`).classList.remove('tms-hidden');
      });
    });

    // switches (unchanged wiring)
    bindSwitch('tms-master', v => { S.master = v; save(K.MASTER, v); scheduleRender(); });
    bindSwitch('tms-mvEnabled', v => { S.mvEnabled = v; save(K.MV_ENABLED, v); scheduleRender(); });
    bindSwitch('tms-mvDollar', v => { S.mvDollarMode = v; save(K.MV_DOLLAR, v); scheduleRender(); });
    bindSwitch('tms-mvPercent', v => { S.mvPercentMode = v; save(K.MV_PERCENT, v); scheduleRender(); });
    bindSwitch('tms-pdEnabled', v => { S.pdEnabled = v; save(K.PD_ENABLED, v); scheduleRender(); });
    bindSwitch('tms-pdDollar', v => { S.pdDollarMode = v; save(K.PD_DOLLAR, v); scheduleRender(); });
    bindSwitch('tms-pdPercent', v => { S.pdPercentMode = v; save(K.PD_PERCENT, v); scheduleRender(); });
    bindSwitch('tms-showPct', v => { S.showPct = v; save(K.SHOW_PCT, v); scheduleRender(); });
    bindSwitch('tms-showTax', v => { S.showTax = v; save(K.SHOW_TAX, v); scheduleRender(); });
    bindSwitch('tms-visibleOnly', v => { S.visibleOnly = v; save(K.PERF_VISIBLE, v); });

    // keep the $ chip toggle available in storage (not shown here); if you want the separate UI switch again, re-enable below:
    // bindSwitch('tms-showDol', v => { S.showDol = v; save(K.SHOW_DOL, v); scheduleRender(); });

    // max per pass
    floating.querySelector('#tms-maxpass').addEventListener('change', e => {
      const v = Math.max(10, parseInt(e.target.value || '60', 10));
      S.maxPerPass = v; save(K.PERF_MAXPASS, v);
    });

    // API key + actions
    const apikeyInput = floating.querySelector('#tms-apikey');
    floating.querySelector('#tms-savekey').onclick = () => {
      S.apiKey = (apikeyInput.value || '').trim(); save(K.API_KEY, S.apiKey);
      alert('API key saved.');
    };
    apikeyInput.addEventListener('change', e => {
      S.apiKey = e.target.value.trim(); save(K.API_KEY, S.apiKey);
    });
    floating.querySelector('#tms-refresh-mv').onclick = () => refreshMV(true);

    // MV / PD save + reset
    floating.querySelector('#mv-save').onclick = () => {
      S.mvDollarThresholds = read6('mv_d_'); save(K.MV_D_THR, S.mvDollarThresholds);
      alert('MV $ tiers saved.'); scheduleRender();
    };
    floating.querySelector('#mv-save-pct').onclick = () => {
      S.mvPercentThresholds = read6('mv_p_'); save(K.MV_P_THR, S.mvPercentThresholds);
      alert('MV % tiers saved.'); scheduleRender();
    };
    floating.querySelector('#pd-save').onclick = () => {
      S.pdDollarThresholds = read6('pd_d_'); save(K.PD_D_THR, S.pdDollarThresholds);
      alert('PD $ tiers saved.'); scheduleRender();
    };
    floating.querySelector('#pd-save-pct').onclick = () => {
      S.pdPercentThresholds = read6('pd_p_'); save(K.PD_P_THR, S.pdPercentThresholds);
      alert('PD % tiers saved.'); scheduleRender();
    };
    floating.querySelector('#mv-reset-defaults').onclick = () => {
      S.mvDollarThresholds = { ...DEF_DOLLAR }; save(K.MV_D_THR, S.mvDollarThresholds);
      S.mvPercentThresholds = { ...DEF_PERCENT }; save(K.MV_P_THR, S.mvPercentThresholds);
      alert('MV thresholds reset.'); scheduleRender();
    };
    floating.querySelector('#pd-reset-defaults').onclick = () => {
      S.pdDollarThresholds = { ...DEF_DOLLAR }; save(K.PD_D_THR, S.pdDollarThresholds);
      S.pdPercentThresholds = { ...DEF_PERCENT }; save(K.PD_P_THR, S.pdPercentThresholds);
      alert('PD thresholds reset.'); scheduleRender();
    };

    // initial autoscale + resize listener
    tmsApplyAutoScale();
    window.addEventListener('resize', tmsApplyAutoScale);
  }

  // --- scanning & rendering ---
  let renderTimer = 0;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPass, RENDER_DEBOUNCE);
  }

  function listAllScopes() {
    // grid tiles
    const tiles = document.querySelectorAll('div[class*="itemTile"], li[class*="items-list"]');
    // seller rows (desktop & mobile variants), bazaars too
    const rows  = document.querySelectorAll('.sellerRow___AI0m6, .sellerRow___Ca2pK, #fullListingsView tr, #topCheapestView tr, .seller-info, .bazaar___, [class*="bazaar"]');
    const all = [...tiles, ...rows];
    return all.filter(n => n && n.nodeType === 1);
  }

  function clearDecor(scope) {
    scope.querySelectorAll('.tms-overlay, .tms-corner, .tms-under').forEach(n => n.remove());
  }

  function decorateScope(scope, itemId, price, pricesForItem) {
    scope.setAttribute('data-tms-scope', '1');
    clearDecor(scope);
    if (!S.master) return;

    const priceEl =
      scope.querySelector('.priceAndTotal___eEVS7') ||
      scope.querySelector('.price___Uwiv2') ||
      scope.querySelector('[class*="price_"]') || scope;

    const corner = document.createElement('div');
    corner.className = 'tms-corner';

    // MV deltas (vs market_value)
    let mvDollar = null, mvPct = null;
    if (S.mvEnabled && S.mv[itemId]) {
      const mv = S.mv[itemId];
      mvDollar = mv - price;
      mvPct = mv ? ((mv - price) / mv) * 100 : 0;
    }

    // PD deltas (cheapest vs next)
    let pdDollar = null, pdPct = null, pdStrong = 0;
    if (S.pdEnabled && Array.isArray(pricesForItem) && pricesForItem.length >= 2) {
      const cheapest = pricesForItem[0];
      const next = pricesForItem[1];
      if (price === cheapest) {
        pdDollar = next - cheapest;
        pdPct = next ? ((next - cheapest) / next) * 100 : 0;
        if (S.pdDollarMode) pdStrong = dolTierStrong(pdDollar, S.pdDollarThresholds);
        if (S.pdPercentMode) {
          const cls = pctTierClass(pdPct || 0, S.pdPercentThresholds);
          if (cls === 't6') pdStrong = 6;
          else if (cls === 't5') pdStrong = Math.max(pdStrong, 5);
        }
      }
    }

    const isGrid = !!scope.closest('div[class*="itemTile"]') || scope.matches('div[class*="itemTile"]');

    // GRID: corner $ / % / net
    if (isGrid) {
      if (S.showDol && mvDollar !== null && S.mvDollarMode) {
        const dol = document.createElement('div');
        dol.className = 'tms-chip dol';
        dol.textContent = (mvDollar >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(mvDollar)).toLocaleString();
        corner.appendChild(dol);
      }
      if (S.showPct && mvPct !== null && S.mvPercentMode) {
        const pct = document.createElement('div');
        pct.className = 'tms-chip pct';
        pct.textContent = (mvPct >= 0 ? '-' : '+') + Math.abs(Math.round(mvPct)) + '%';
        corner.appendChild(pct);
      }
      if (S.showTax && mvDollar !== null && S.mv[itemId]) {
        const net = Math.floor((mvDollar) - (S.mv[itemId] * TAX_RATE));
        if (net > 0) {
          const tax = document.createElement('div');
          tax.className = 'tms-chip tax';
          tax.textContent = '+$' + net.toLocaleString() + ' net';
          corner.appendChild(tax);
        }
      }
      if (corner.children.length) scope.appendChild(corner);
    } else {
      // LIST: tax, then $ and %
      const under = document.createElement('div');
      under.className = 'tms-under';

      if (S.showTax && mvDollar !== null && S.mv[itemId]) {
        const t = document.createElement('div');
        t.className = 'tms-badge tax';
        const taxAmt = Math.floor(S.mv[itemId] * TAX_RATE);
        const net = Math.floor((mvDollar) - taxAmt);
        t.textContent = 'Tax 5%: -$' + taxAmt.toLocaleString() + (net > 0 ? `  •  Net +$${net.toLocaleString()}` : '');
        under.appendChild(t);
      }
      if (S.mvEnabled && mvDollar !== null && S.mvDollarMode) {
        const b = document.createElement('div');
        b.className = 'tms-badge mv';
        b.textContent = (mvDollar >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(mvDollar)).toLocaleString();
        under.appendChild(b);
      }
      if (S.mvEnabled && mvPct !== null && S.mvPercentMode) {
        const b = document.createElement('div');
        b.className = 'tms-badge mv';
        b.textContent = (mvPct >= 0 ? '-' : '+') + Math.abs(Math.round(mvPct)) + '%';
        under.appendChild(b);
      }

      if (under.children.length) priceEl.after(under);
    }

    // PD overlay (only on the single cheapest listing vs next)
    if (S.pdEnabled && pdDollar !== null && price === (pricesForItem[0] || null)) {
      if (pdStrong >= 5) {
        const over = document.createElement('div');
        over.className = 'tms-overlay ' + (pdStrong === 6 ? 'tms-t6' : 'tms-t5');
        scope.appendChild(over);
      }
    }
  }

  function collectPricesPerItem(scopes) {
    const map = new Map();
    for (const scope of scopes) {
      const id = getItemIdFromScope(scope);
      if (!id) continue;
      const priceEl =
        scope.querySelector('.priceAndTotal___eEVS7') ||
        scope.querySelector('.price___Uwiv2') ||
        scope.querySelector('[class*="price_"]') || scope;
      const price = parsePrice(priceEl?.textContent || '');
      if (!price) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(price);
    }
    for (const [id, arr] of map) arr.sort((a, b) => a - b);
    return map;
  }

  function renderPass() {
    const all = listAllScopes();
    const scopes = S.visibleOnly ? all.filter(inViewport) : all;

    const perItem = collectPricesPerItem(scopes);

    let processed = 0;
    for (const scope of scopes) {
      if (processed >= S.maxPerPass) break;

      const id = getItemIdFromScope(scope);
      if (!id) continue;

      const priceEl =
        scope.querySelector('.priceAndTotal___eEVS7') ||
        scope.querySelector('.price##_Uwiv2') ||
        scope.querySelector('[class*="price_"]') || scope;
      const price = parsePrice(priceEl?.textContent || '');
      if (!price) continue;

      decorateScope(scope, id, price, perItem.get(id) || []);
      processed++;
    }
  }

  // --- observer & bootstrap ---
  const mo = new MutationObserver(() => scheduleRender());
  function startObserve() {
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }

  function init() {
    buildUI();
    startObserve();
    scheduleRender();
    tmsApplyAutoScale();
  }

  init();

})();
