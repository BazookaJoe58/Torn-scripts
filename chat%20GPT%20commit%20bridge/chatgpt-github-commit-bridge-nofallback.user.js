// ==UserScript==
// @name         ChatGPT → GitHub Commit Bridge (no-fallback)
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      1.4.1
// @description  One-click “Commit → GitHub” for ChatGPT code blocks. STRICT: commits only when a target is auto-detected from @updateURL/@downloadURL/@commit-to in the code header. Otherwise it aborts.
// @author       BazookaJoe
// @license      MIT
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @homepageURL  https://github.com/BazookaJoe58/Torn-scripts
// @supportURL   https://github.com/BazookaJoe58/Torn-scripts/issues
// @downloadURL  https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/chat%20GPT%20commit%20bridge/chatgpt-github-commit-bridge-nofallback.user.js
// @updateURL    https://github.com/BazookaJoe58/Torn-scripts/raw/refs/heads/main/chat%20GPT%20commit%20bridge/chatgpt-github-commit-bridge-nofallback.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- UI ----------
  GM_addStyle(`
    .ghcb-wrap{position:relative}
    .ghcb-btn{
      position:absolute; top:8px; right:8px;
      font:600 12px/1.2 system-ui,Segoe UI,Arial;
      padding:6px 10px; border:1px solid #2f6; border-radius:7px;
      background:#102; color:#2f6; cursor:pointer; opacity:.9; z-index:5;
    }
    .ghcb-btn:hover{opacity:1; filter:brightness(1.1)}
    .ghcb-toast{
      position:fixed; right:14px; bottom:14px; max-width:55ch;
      background:#111; color:#eee; border:1px solid #444; border-radius:10px;
      padding:10px 14px; box-shadow:0 6px 24px #0008; z-index:999999;
      font: 13px/1.45 system-ui,Segoe UI,Arial;
    }
    .ghcb-toast b{color:#8ef}
  `);

  const toast = (html, ms=3600) => {
    const el = document.createElement('div');
    el.className = 'ghcb-toast';
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), ms);
  };

  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));

  // ---------- Settings: only token ----------
  GM_registerMenuCommand('Set GitHub Token', () => {
    const cur = GM_getValue('gh_token','');
    const v = prompt('Paste a GitHub fine-grained token (repo:contents write):', cur || '');
    if (v !== null) {
      GM_setValue('gh_token', v.trim());
      toast('🔐 <b>Token saved</b>.');
    }
  });

  // ---------- Target auto-detect ----------
  // Accepts:
  //  - raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>
  //  - github.com/<owner>/<repo>/raw/refs/heads/<branch>/<path>
  //  - github.com/<owner>/<repo>/blob/<branch>/<path>
  //  - @commit-to owner/repo/branch/path
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

      m = u.match(/^([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)$/); // owner/repo/branch/path
      if (m) return {owner:m[1], repo:m[2], branch:m[3], path:m[4]};
    }
    return null;
  }

  // ---------- GitHub API ----------
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

    // Check existing file to get sha (ok if 404)
    let sha;
    const probe = await ghGET(`${base}?ref=${encodeURIComponent(branch)}`, token);
    if (probe.status === 200 && probe.json && probe.json.sha) sha = probe.json.sha;

    const body = { message, content: b64(content), branch, ...(sha ? {sha} : {}) };
    const res = await ghPUT(base, body, token);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GitHub error ${res.status}: ${JSON.stringify(res.json)}`);
    }
  }

  // ---------- Inject buttons on code blocks ----------
  const seen = new WeakSet();
  const isCode = (pre) => pre && pre.querySelector('code');

  function wire(pre) {
    if (!pre || seen.has(pre)) return;
    if (!isCode(pre)) return;
    seen.add(pre);
    pre.classList.add('ghcb-wrap');

    const btn = document.createElement('button');
    btn.className = 'ghcb-btn';
    btn.textContent = 'Commit → GitHub';
    btn.title = 'Commit this code block to GitHub';

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
      if (!code.trim()) { toast('No code detected in this block.'); return; }

      const target = detectTargetFromHeader(code);
      if (!target) {
        toast('❌ <b>No target detected.</b><br>Add <code>@updateURL</code>, <code>@downloadURL</code>, or <code>@commit-to owner/repo/branch/path</code> to the code header and try again.');
        return;
      }

      const message = prompt(`Commit message for ${target.own
