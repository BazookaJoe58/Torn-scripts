// ==UserScript==
// @name         ChatGPT → GitHub Commit Bridge (no-fallback) v1.4.2
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      1.4.2
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

  // ---------- Styles ----------
  GM_addStyle(`
    .ghcb-wrap{position:relative}
    .ghcb-btn{
      position:absolute; top:8px; right:8px;
      font:600 12px/1.2 system-ui,Segoe UI,Arial;
      padding:6px 10px; border:1px solid #2f6; border-radius:7px;
      background:#102; color:#2f6; cursor:pointer; opacity:.95; z-index:2147483647;
    }
    .ghcb-btn:hover{opacity:1; filter:brightness(1.06)}
    .ghcb-toast{
      position:fixed; right:14px; bottom:14px; max-width:60ch;
      background:#111; color:#eee; border:1px solid #444; border-radius:10px;
      padding:10px 14px; box-shadow:0 6px 24px #0008; z-index:2147483647;
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

  // ---------- Settings ----------
  GM_registerMenuCommand('Set GitHub Token', () => {
    const cur = GM_getValue('gh_token','');
    const v = prompt('Paste a GitHub fine-grained token (repo:contents write):', cur || '');
    if (v !== null) {
      GM_setValue('gh_token', v.trim());
      toast('🔐 <b>Token saved</b>.');
    }
  });

  // ---------- Target auto-detect ----------
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

  // ---------- Code block detection & button wiring ----------
  const seen = new WeakSet();

  // Robust block finder: returns a DOM element we can attach to and its code text.
  function findBlocks(root=document) {
    const blocks = [];

    // 1) Standard: figure > div > pre > code OR pre > code
    root.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      if (code) blocks.push({host: pre, code});
    });

    // 2) Newer testid container: div[data-testid="code"] > pre > code
    root.querySelectorAll('div[data-testid="code"]').forEach(w => {
      const code = w.querySelector('pre code');
      if (code) blocks.push({host: w.querySelector('pre') || w, code});
    });

    // 3) Fallback: any code element that looks like a big block (long text)
    root.querySelectorAll('code').forEach(code => {
      if (code.textContent && code.textContent.length > 60) {
        const host = code.closest('pre,figure,div') || code;
        blocks.push({host, code});
      }
    });

    // Dedup by host
    const uniq = [];
    const seenHosts = new WeakSet();
    for (const b of blocks) {
      if (!b.host || seenHosts.has(b.host)) continue;
      seenHosts.add(b.host);
      uniq.push(b);
    }
    return uniq;
  }

  function addButton(host, codeEl) {
    if (!host || seen.has(host)) return;
    seen.add(host);
    host.classList.add('ghcb-wrap');

    const btn = document.createElement('button');
    btn.className = 'ghcb-btn';
    btn.textContent = 'Commit → GitHub';
    btn.title = 'Commit this code block to GitHub';

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = codeEl?.textContent ?? host.textContent ?? '';
      if (!code.trim()) { toast('No code detected in this block.'); return; }

      const target = detectTargetFromHeader(code);
      if (!target) {
        toast('❌ <b>No target detected.</b><br>Add <code>@updateURL</code>, <code>@downloadURL</code>, or <code>@commit-to owner/repo/branch/path</code> to the code header and try again.');
        return;
      }

      const message = prompt(`Commit message for ${target.owner}/${target.repo}\nbranch ${target.branch}\n${target.path}:`, `Update ${target.path}`);
      if (message === null) return;

      try {
        toast('⏳ Committing…');
        await commitToGitHub({...target, content: code, message: message || `Update ${target.path}`});
        toast(`✅ <b>Committed</b> to <b>${target.owner}/${target.repo}</b><br>branch <b>${target.branch}</b><br>path <b>${target.path}</b>`);
      } catch (err) {
        console.error(err);
        toast('❌ Commit failed. See console for details.');
      }
    });

    // Ensure host can anchor absolute positioning
    const style = getComputedStyle(host);
    if (style.position === 'static') host.style.position = 'relative';

    host.appendChild(btn);
  }

  function scan() {
    const blocks = findBlocks();
    blocks.forEach(({host, code}) => addButton(host, code));
  }

  // Appear only once code is fully present (and re-appear after re-render)
  scan();
  const mo = new MutationObserver(() => scan());
  mo.observe(document.body, {childList:true, subtree:true});

  // ---------- Hotkey fallback: Ctrl+Shift+G commits code under cursor ----------
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'g')) return;
    const el = document.elementFromPoint?.(window.innerWidth/2, window.innerHeight/2) || document.body;
    const host = el.closest?.('pre, figure, div[data-testid="code"]') || document.querySelector('pre, figure, div[data-testid="code"]');
    if (!host) { toast('No code block found for hotkey.'); return; }
    const codeEl = host.querySelector('code');
    if (!codeEl) { toast('No <code> element found inside this block.'); return; }
    const code = codeEl.textContent || '';
    const target = detectTargetFromHeader(code);
    if (!target) { toast('❌ No target detected in this code block.'); return; }
    const message = prompt(`Commit message for ${target.owner}/${target.repo}\nbranch ${target.branch}\n${target.path}:`, `Update ${target.path}`);
    if (message === null) return;
    (async () => {
      try {
        toast('⏳ Committing…');
        await commitToGitHub({...target, content: code, message: message || `Update ${target.path}`});
        toast(`✅ <b>Committed</b> to <b>${target.owner}/${target.repo}</b><br>branch <b>${target.branch}</b><br>path <b>${target.path}</b>`);
      } catch (err) {
        console.error(err);
        toast('❌ Commit failed. See console for details.');
      }
    })();
  });
