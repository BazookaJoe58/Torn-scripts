// ==UserScript==
// @name         ChatGPT → GitHub Commit Bridge (no-fallback) v1.4.5
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      1.4.5
// @description  One-click “Commit → GitHub” for ChatGPT code blocks. Shows per-block button immediately; turns green when code stops updating. Also adds a global toolbar button as a fallback. Strict: commits only if a target is auto-detected from @updateURL/@downloadURL/@commit-to in the header.
// @author       BazookaJoe
// @license      MIT
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @homepageURL  https://github.com/BazookaJoe58/Torn-scripts
// @supportURL   https://github.com/BazookaJoe58/Torn-scripts/issues
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/chat%20GPT%20commit%20bridge/chatgpt-github-commit-bridge-nofallback-v1.4.5.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/chat%20GPT%20commit%20bridge/chatgpt-github-commit-bridge-nofallback-v1.4.5.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---- Singleton guard ----
  if (window.__GHCB_SINGLETON__) return;
  window.__GHCB_SINGLETON__ = true;

  const QUIET_MS = 900; // time without code text changes before "Ready"
  const GLOBAL_BTN_ID = 'ghcb-global-btn';

  GM_addStyle(`
    .ghcb-wrap{position:relative}
    .ghcb-btn{
      position:absolute; top:8px; right:8px;
      font:600 12px/1.2 system-ui,Segoe UI,Arial;
      padding:6px 10px; border:1px solid #888; border-radius:7px;
      background:#444; color:#fff; cursor:not-allowed; opacity:.95; z-index:2147483647;
      transition:background .15s ease,border-color .15s ease,opacity .15s ease,transform .05s ease;
    }
    .ghcb-btn.ready{
      background:#28a745; border-color:#1f7a34; cursor:pointer;
    }
    .ghcb-btn:hover.ready{opacity:1; filter:brightness(1.05)}
    .ghcb-btn:active.ready{transform:scale(.98)}

    .ghcb-toast{
      position:fixed; right:14px; bottom:14px; max-width:60ch;
      background:#111; color:#eee; border:1px solid #444; border-radius:10px;
      padding:10px 14px; box-shadow:0 6px 24px #0008; z-index:2147483647;
      font: 13px/1.45 system-ui,Segoe UI,Arial;
    }
    .ghcb-toast b{color:#8ef}

    /* Global toolbar button (fallback) */
    #${GLOBAL_BTN_ID}{
      position:fixed; top:12px; right:12px;
      padding:6px 10px; border-radius:8px; border:1px solid #6aa1ff;
      background:#0b1a33; color:#cfe1ff; font:600 12px/1 system-ui,Segoe UI,Arial;
      cursor:pointer; z-index:2147483647; opacity:.95;
    }
    #${GLOBAL_BTN_ID}:hover{opacity:1; filter:brightness(1.05)}
  `);

  const toast = (html, ms=3600) => {
    const el = document.createElement('div');
    el.className = 'ghcb-toast';
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), ms);
  };

  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));

  GM_registerMenuCommand('Set GitHub Token', () => {
    const cur = GM_getValue('gh_token','');
    const v = prompt('Paste a GitHub fine-grained token (repo:contents write):', cur || '');
    if (v !== null) {
      GM_setValue('gh_token', v.trim());
      toast('🔐 <b>Token saved</b>.');
    }
  });

  // ---- Target auto-detect ----
  function detectTargetFromHeader(src) {
    const find = (re) => (src.match(re) || [])[1];
    const candidates = [
      find(/@updateURL\s+(\S+)/),
      find(/@downloadURL\s+(\S+)/),
      find(/@commit-to\s+([^\s]+)/),
    ].filter(Boolean);

    for (const u of candidates) {
      let m = u.match(/^https:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)$/i);
      if (m) return {owner:m[1], repo:m[2], branch:m[3], path:m[4]};
      m = u.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/raw\/refs\/heads\/([^\/]+)\/(.+)$/i);
      if (m) return {owner:m[1], repo:m[2], branch:m[3], path:m[4]};
      m = u.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/i);
      if (m) return {owner:m[1], repo:m[2], branch:m[3], path:m[4]};
      m = u.match(/^([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)$/);
      if (m) return {owner:m[1], repo:m[2], branch:m[3], path:m[4]};
    }
    return null;
  }

  // ---- GitHub API ----
  function ghGET(url, token) {
    return new Promise((res, rej) => {
      GM_xmlhttpRequest({
        url, method:'GET',
        headers: {'Accept':'application/vnd.github+json','Authorization':`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28'},
        onload: (r) => res({status:r.status, json: r.responseText ? JSON.parse(r.responseText) : null}),
        onerror: rej
      });
    });
  }

  function ghPUT(url, body, token) {
    return new Promise((res, rej) => {
      GM_xmlhttpRequest({
        url, method:'PUT',
        headers: {'Accept':'application/vnd.github+json','Authorization':`Bearer ${token}`,'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
        data: JSON.stringify(body),
        onload: (r) => res({status:r.status, json: r.responseText ? JSON.parse(r.responseText) : null}),
        onerror: rej
      });
    });
  }

  async function commitToGitHub({owner, repo, branch, path, content, message}) {
    const token = GM_getValue('gh_token','');
    if (!token) throw new Error('Missing GitHub token');

    const base = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`;

    let sha;
    const probe = await ghGET(`${base}?ref=${encodeURIComponent(branch)}`, token);
    if (probe.status === 200 && probe.json && probe.json.sha) sha = probe.json.sha;

    const body = { message, content: b64(content), branch, ...(sha ? {sha} : {}) };
    const res = await ghPUT(base, body, token);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GitHub error ${res.status}: ${JSON.stringify(res.json)}`);
    }
  }

  // ---- Block discovery ----
  function findBlocks() {
    const blocks = [];

    // Standard: <pre><code>
    document.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      if (code) blocks.push({host: pre, code});
    });

    // Newer testid wrapper
    document.querySelectorAll('div[data-testid="code"]').forEach(w => {
      const pre = w.querySelector('pre');
      const code = w.querySelector('pre code');
      if (pre && code) blocks.push({host: pre, code});
    });

    // Fallback: large <code> with no <pre>
    document.querySelectorAll('code').forEach(code => {
      if (code.closest('pre')) return;
      if ((code.textContent || '').length > 60) {
        const host = code.closest('figure,div') || code;
        blocks.push({host, code});
      }
    });

    // Dedup
    const uniq = [];
    const seen = new WeakSet();
    for (const b of blocks) {
      if (!b.host || seen.has(b.host)) continue;
      seen.add(b.host);
      uniq.push(b);
    }
    return uniq;
  }

  // ---- Per-block wiring (watch only the <code> node for stability) ----
  function wireBlock(host, codeEl) {
    if (!host || !codeEl) return;
    if (host.querySelector('.ghcb-btn')) return; // already has a button

    host.classList.add('ghcb-wrap');
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const btn = document.createElement('button');
    btn.className = 'ghcb-btn';
    btn.textContent = 'Commit → GitHub (Writing…)';
    host.appendChild(btn);

    let ready = false;
    let timer = null;
    const setReady = (v) => {
      ready = v;
      if (v) {
        btn.classList.add('ready');
        btn.textContent = 'Commit → GitHub (Ready)';
      } else {
        btn.classList.remove('ready');
        btn.textContent = 'Commit → GitHub (Writing…)';
      }
    };
    setReady(false);

    const mo = new MutationObserver(() => {
      setReady(false);
      clearTimeout(timer);
      timer = setTimeout(() => setReady(true), QUIET_MS);
    });
    mo.observe(codeEl, {childList:true, characterData:true, subtree:true});

    // If already stable, go ready shortly
    timer = setTimeout(() => setReady(true), QUIET_MS);

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = codeEl.textContent || '';
      if (!code.trim()) { toast('No code detected in this block.'); return; }
      if (!ready) { toast('⌛ Still updating. Wait until the button turns green.'); return; }
      const target = detectTargetFromHeader(code);
      if (!target) { toast('❌ <b>No target detected.</b> Add @updateURL/@downloadURL/@commit-to.'); return; }
      const msgDefault = `Update ${target.path}`;
      const message = prompt(`Commit message for ${target.owner}/${target.repo}\nbranch ${target.branch}\n${target.path}:`, msgDefault);
      if (message === null) return;
      try {
        setReady(false);
        btn.textContent = 'Committing…';
        await commitToGitHub({...target, content: code, message: message || msgDefault});
        btn.textContent = 'Committed ✅';
        toast(`✅ Committed to ${target.owner}/${target.repo}<br>${target.path}`);
        setTimeout(() => setReady(true), 1200);
      } catch (err) {
        console.error(err);
        toast('❌ Commit failed.');
        setReady(true);
      }
    });
  }

  function scan() {
    const blocks = findBlocks();
    blocks.forEach(({host, code}) => wireBlock(host, code));
  }

  // ---- Global toolbar button (fallback if per-block button fails) ----
  function ensureGlobalButton() {
    if (document.getElementById(GLOBAL_BTN_ID)) return;
    const b = document.createElement('button');
    b.id = GLOBAL_BTN_ID;
    b.textContent = 'Commit current code…';
    b.title = 'Commits the biggest visible code block on the page';
    b.addEventListener('click', async () => {
      const blocks = findBlocks();
      if (!blocks.length) { toast('No code blocks found on this page.'); return; }
      // Pick the largest code block (by text length)
      let best = blocks[0], max = (best.code.textContent || '').length;
      for (const bl of blocks) {
        const len = (bl.code.textContent || '').length;
        if (len > max) { best = bl; max = len; }
      }
      const code = best.code.textContent || '';
      const target = detectTargetFromHeader(code);
      if (!target) { toast('❌ No target detected in the largest block. Add @updateURL/@downloadURL/@commit-to.'); return; }
      const msgDefault = `Update ${target.path}`;
      const message = prompt(`Commit message for ${target.owner}/${target.repo}\nbranch ${target.branch}\n${target.path}:`, msgDefault);
      if (message === null) return;
      try {
        toast('⏳ Committing…');
        await commitToGitHub({...target, content: code, message: message || msgDefault});
        toast(`✅ Committed to ${target.owner}/${target.repo}<br>${target.path}`);
      } catch (err) {
        console.error(err);
        toast('❌ Commit failed.');
      }
    });
    document.body.appendChild(b);
  }

  // ---- Init ----
  function init() {
    ensureGlobalButton();
    scan();
    // Observe the whole page for new code blocks
    new MutationObserver(() => { ensureGlobalButton(); scan(); })
      .observe(document.body, {childList:true, subtree:true});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {once:true});
  } else {
    init();
  }
})();
