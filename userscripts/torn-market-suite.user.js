// ==UserScript==
// @name         Torn Market Suite (MV/PD + Corner % + List stack $ then %) - Toggleable Panel
// @namespace    http://tampermonkey.net/
// @version      5.3.2
// @description  Three-tab UI (Main/MV/PD). Full-tile/row overlay (T5/T6 semi-transparent). Grid: corner $ + corner % + orange after-tax profit (>0 only); List: tax lines then $ delta then % delta under price. PD overlay only on the single cheapest listing vs the next higher price. Panel opens/closes via MS toggle, close (×), Esc. Fonts +1px. MS tab always visible. Author: BazookaJoe. Auto-refreshes MV every 5 min.
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

  const DEF_DOLLAR  = { tier6: 60000, tier5: 50000, tier4: 40000, tier3: 30000, tier2: 20000, tier1: 10000 };
  const DEF_PERCENT = { tier6:    14, tier5:    13, tier4:    12, tier3:    11, tier2:    10, tier1:     9 };

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

  const inViewport = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
  };
  const parsePrice = (txt) => {
    const m = txt?.match(/\$([0-9,]+)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  };

  async function fetchMarketValues() {
    if (!S.apiKey) return;
    try {
      const res = await new Promise((resolve, reject) => {
        GM.xmlHttpRequest({
          method: 'GET',
          url: `https://api.torn.com/market/?selections=bazaar,itemmarket&key=${S.apiKey}`,
          onload: r => resolve(JSON.parse(r.responseText)),
          onerror: reject
        });
      });
      if (res && res.items) {
        S.mv = res.items;
        save(K.MV_CACHE, S.mv);
      }
    } catch (e) {
      console.error('TMS: MV fetch failed', e);
    }
  }

  // Auto refresh market values every 5 minutes
  setInterval(fetchMarketValues, 300000);

  // Initial load
  loadState();
  fetchMarketValues();

})();
