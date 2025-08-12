// ==UserScript==
// @name         ChatGPT → GitHub Commit Bridge (no-fallback) v1.5.0
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      1.5.0
// @description  Per-block commit button (turns green when stable) + global fallback button. If direct commit is blocked (e.g., protected branch), auto-creates a branch, commits there, and gives you a PR link. Strict: target must be auto-detected from @updateURL/@downloadURL/@commit-to.
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
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/chat%20GPT%20commit%20bridge/chatgpt-github-commit-bridge-nofallback-v1.5.0.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/chat%20GPT%20commit%20bridge/chatgpt-github-commit-bridge-nofallback-v1.5.0.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.__GHCB_SINGLETON__) return;
  window.__GHCB_SINGLETON__ = true;

  const QUIET_MS = 900;
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
      white-space: normal;
    }
    .ghcb-toast b{color:#8ef}

    #${GLOBAL_BTN_ID}{
      position:fixed; top:12px; right:12px;
      padding:6px 10px; border-radius:8px; border:1px solid #6aa1ff;
      background:#0b1a33; color:#cfe1ff; font:600 12px/1 system-ui,Segoe UI,Arial;
      cursor:pointer; z-index:2147483647; opacity:.95;
    }
    #${GLOBAL_BTN_ID}:hover{opacity:1; filter:brightness(1.05)}
  `);

  const toast = (html, ms=4000) => {
    const el = document.createElement('div');
    el.className = 'ghcb-toast';
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), ms);
  };

  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));

  GM_registerMenuCommand('Set GitHub Token', () => {
    const cur = GM_getValue('gh_token','');
    const v = prompt('Paste a GitHub fine-grained token (repo:contents:write):', cur || '');
    if (v !== null) {
      GM_setValue('gh_token', v.trim());
      toast('🔐 <b>Token saved</b>.');
    }
  });

  // ---- GitHub helpers ----
  function req(method, url, token, data) {
    return new Promise((res, rej) => {
      GM_xmlhttpRequest({
        url, method,
        headers: {
          'Accept':'application/vnd.github+json',
          'Authorization':`Bearer ${token}`,
          'X-GitHub-Api-Version':'2022-11-28',
          ...(data ? {'Content-Type':'application/json'} : {})
        },
        data: data ? JSON.stringify(data) : undefined,
        onload: (r) => {
          let json = null;
          try { json = r.responseText ? JSON.parse(r.responseText) : null; } catch {}
          res({ status: r.status, json });
        },
        onerror: rej
      });
    });
  }

  const ghGET = (url, token) => req('GET', url, token);
  const ghPUT = (url, body, token) => req('PUT', url, token, body);
  const ghPOST = (url, body, token) => req('POST', url, token, body);

  async function getRepoDefaultBranch(owner, repo, token) {
    const r = await ghGET(`https://api.github.com/repos/${owner}/${repo}`, token);
    if (r.status === 200 && r.json?.default_branch) return r.json.default_branch;
    return 'main';
    // fallback if API restricted
  }

  async function commitToGitHub({owner, repo, branch, path, content, message}) {
    const token = GM_getValue('gh_token','');
    if (!token) throw new Error('Missing GitHub token');

    const pathEncoded = encodeURIComponent(path).replace(/%2F/g,'/');
    const contentsURL = `https://api.github.com/repos/${owner}/${repo}/contents/${pathEncoded}`;

    // Try direct commit
    let probe = await ghGET(`${contentsURL}?ref=${encodeURIComponent(branch)}`, token);
    let sha = (probe.status === 200 && probe.json?.sha) ? probe.json.sha : undefined;

    let res = await ghPUT(contentsURL, { message, content: b64(content), branch, ...(sha ? {sha} : {}) }, token);
    if (res.status >= 200 && res.status < 300) {
      return { mode: 'direct', branch, res };
    }

    // If blocked (403/409), try branch fallback (protected branch or required PR)
    if (res.status === 403 || res.status === 409) {
      const defaultBranch = await getRepoDefaultBranch(owner, repo, token);
      // Get default branch SHA
      const refInfo = await ghGET(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(defaultBranch)}`, token);
      const baseSha = refInfo.json?.object?.sha;
      if (!baseSha) throw new Error(`Cannot read base ref: ${defaultBranch}. (${refInfo.status})`);

      // Create a unique branch
      const newBranch = `cb/${Date.now()}`;
      const createRef = await ghPOST(`https://api.github.com/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${newBranch}`, sha: baseSha }, token);
      if (!(createRef.status >= 200 && createRef.status < 300)) {
        throw new Error(`Create branch failed (${createRef.status}): ${JSON.stringify(createRef.json)}`);
      }

      // Commit to the new branch
      probe = await ghGET(`${contentsURL}?ref=${encodeURIComponent(newBranch)}`, token);
      sha = (probe.status === 200 && probe.json?.sha) ? probe.json.sha : undefined;
      const commitRes = await ghPUT(contentsURL, { message: `${message} [via Commit Bridge]`, content: b64(content), branch: newBranch, ...(sha ? {sha} : {}) }, token);
      if (commitRes.status >= 200 && commitRes.status < 300) {
        const prURL = `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(newBranch)}?expand=1`;
        return { mode: 'branch', branch: newBranch, defaultBranch, prURL, res: commitRes };
      }

      throw new Error(`Commit to new branch failed (${commitRes.status}): ${JSON.stringify(commitRes.json)}`);
    }

    // Otherwise surface the exact error
    throw new Error(`GitHub error ${res.status}: ${JSON.stringify(res.json)}`);
  }

  // ---- Target detection ----
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

  // ---- Code discovery & UI (unchanged from last good build) ----
  function findBlocks() {
    const blocks = [];
    document.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      if (code) blocks.push({host: pre, code});
    });
    document.querySelectorAll('div[data-testid="code"]').forEach(w => {
      const pre = w.querySelector('pre');
      const code = w.querySelector('pre code');
      if (pre && code) blocks.push({host: pre, code});
    });
    document.querySelectorAll('code').forEach(code => {
      if (code.closest('pre')) return;
      if ((code.textContent || '').length > 60) {
        const host = code.closest('figure,div') || code;
        blocks.push({host, code});
      }
    });
    const uniq = [], seen = new WeakSet();
    for (const b of blocks) {
      if (!b.host || seen.has(b.host)) continue;
      seen.add(b.host); uniq.push(b);
    }
    return uniq;
  }

  function wireBlock(host, codeEl) {
    if (!host || !codeEl) return;
    if (host.querySelector('.ghcb-btn')) return;

    host.classList.add('ghcb-wrap');
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const btn = document.createElement('button');
    btn.className = 'ghcb-btn';
    btn.textContent = 'Commit → GitHub (Writing…)';
    host.appendChild(btn);

    let ready = false, timer = null;
    const setReady = (v) => {
      ready = v;
      btn.classList.toggle('ready', v);
      btn.textContent = v ? 'Commit → GitHub (Ready)' : 'Commit → GitHub (Writing…)';
    };
    setReady(false);

    const mo = new MutationObserver(() => {
      setReady(false);
      clearTimeout(timer);
      timer = setTimeout(() => setReady(true), QUIET_MS);
    });
    mo.observe(codeEl, {childList:true, characterData:true, subtree:true});
    timer = setTimeout(() => setReady(true), QUIET_MS);

    btn.addEventListener('click', async () => {
      const code = codeEl.textContent || '';
      if (!code.trim()) { toast('No code detected in this block.'); return; }
      if (!ready) { toast('⌛ Still updating. Wait until green.'); return; }
      const target = detectTargetFromHeader(code);
      if (!target) { toast('❌ No target detected. Add @updateURL/@downloadURL/@commit-to.'); return; }

      const msgDefault = `Update ${target.path}`;
      const message = prompt(`Commit message for ${target.owner}/${target.repo}\nbranch ${target.branch}\n${target.path}:`, msgDefault);
      if (message === null) return;

      try {
        setReady(false); btn.textContent = 'Committing…';
        const result = await commitToGitHub({...target, content: code, message: message || msgDefault});
        if (result.mode === 'direct') {
          btn.textContent = 'Committed ✅';
          toast(`✅ Committed directly to <b>${target.owner}/${target.repo}</b><br>branch <b>${result.branch}</b><br><small>${target.path}</small>`);
        } else if (result.mode === 'branch') {
          btn.textContent = 'Committed (PR ready) ✅';
          toast(`✅ Committed to new branch <b>${result.branch}</b>.<br><a href="${result.prURL}" target="_blank" rel="noreferrer">Open Pull Request</a>`, 8000);
          // Try to open PR in a new tab silently
          try { window.open(result.prURL, '_blank'); } catch {}
        }
        setTimeout(() => setReady(true), 1200);
      } catch (err) {
        console.error(err);
        toast(`❌ Commit failed.<br><small>${(err && err.message) ? err.message : 'Unknown error'}</small>`, 7000);
        setReady(true);
      }
    });
  }

  function scan() { findBlocks().forEach(({host, code}) => wireBlock(host, code)); }

  function ensureGlobalButton() {
    if (document.getElementById(GLOBAL_BTN_ID)) return;
    const b = document.createElement('button');
    b.id = GLOBAL_BTN_ID;
    b.textContent = 'Commit current code…';
    b.title = 'Commits the biggest visible code block';
    b.addEventListener('click', async () => {
      const blocks = findBlocks();
      if (!blocks.length) { toast('No code blocks found on this page.'); return; }
      let best = blocks[0], max = (best.code.textContent || '').length;
      for (const bl of blocks) {
        const len = (bl.code.textContent || '').length;
        if (len > max) { best = bl; max = len; }
      }
      const code = best.code.textContent || '';
      const target = detectTargetFromHeader(code);
      if (!target) { toast('❌ No target detected in the largest block.'); return; }
      const msgDefault = `Update ${target.path}`;
      const message = prompt(`Commit message for ${target.owner}/${target.repo}\nbranch ${target.branch}\n${target.path}:`, msgDefault);
      if (message === null) return;
      try {
        toast('⏳ Committing…');
        const result = await commitToGitHub({...target, content: code, message: message || msgDefault});
        if (result.mode === 'direct') {
          toast(`✅ Committed directly to <b>${target.owner}/${target.repo}</b><br>branch <b>${result.branch}</b><br><small>${target.path}</small>`);
        } else {
          toast(`✅ Committed to new branch <b>${result.branch}</b>.<br><a href="${result.prURL}" target="_blank" rel="noreferrer">Open Pull Request</a>`, 8000);
          try { window.open(result.prURL, '_blank'); } catch {}
        }
      } catch (err) {
        console.error(err);
        toast(`❌ Commit failed.<br><small>${(err && err.message) ? err.message : 'Unknown error'}</small>`, 7000);
      }
    });
    document.body.appendChild(b);
  }

  function init() {
    ensureGlobalButton();
    scan();
    new MutationObserver(() => { ensureGlobalButton(); scan(); })
      .observe(document.body, {childList:true, subtree:true});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {once:true});
  } else {
    init();
  }
})();
