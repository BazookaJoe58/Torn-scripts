// ==UserScript==
// @name         ChatGPT → GitHub Commit Bridge (no-fallback) v1.4.3
// @namespace    https://github.com/BazookaJoe58/Torn-scripts
// @version      1.4.3
// @description  One-click “Commit → GitHub” for ChatGPT code blocks. Shows immediately; turns green when the block stops updating. Strict: commits only if a target is auto-detected from @updateURL/@downloadURL/@commit-to in the header.
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

  const QUIET_MS = 900; // how long code must be unchanged to be "ready"

  // ---------- Styles ----------
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

    let sha;
    const probe = await ghGET(`${base}?ref=${encodeURIComponent(branch)}`, token);
    if (probe.status === 200 && probe.json && probe.json.sha) sha = probe.json.sha;

    const body = { message, content: b64(content), branch, ...(sha ? {sha} : {}) };
    const res = await ghPUT(base, body, token);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GitHub error ${res.status}: ${JSON.stringify(res.json)}`);
    }
  }

  // ---------- Code block detection ----------
  const wired = new WeakSet();

  function findBlocks(root=document) {
    const blocks = [];

    // Standard: pre > code (incl. figure wrappers)
    root.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      if (code) blocks.push({host: pre, code});
    });

    // Newer: div[data-testid="code"] > pre > code
    root.querySelectorAll('div[data-testid="code"]').forEach(w => {
      const code = w.querySelector('pre code');
      if (code) blocks.push({host: w.querySelector('pre') || w, code});
    });

    // Fallback: any big <code>
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

  function markReady(btn, ready) {
    if (ready) {
      btn.classList.add('ready');
      btn.textContent = 'Commit → GitHub (Ready)';
    } else {
      btn.classList.remove('ready');
      btn.textContent = 'Commit → GitHub (Writing…)';
    }
  }

  function wireBlock(host, codeEl) {
    if (!host || wired.has(host)) return;
    wired.add(host);
    host.classList.add('ghcb-wrap');

    // Ensure host can anchor absolute positioning
    const style = getComputedStyle(host);
    if (style.position === 'static') host.style.position = 'relative';

    const btn = document.createElement('button');
    btn.className = 'ghcb-btn';
    btn.textContent = 'Commit → GitHub (Writing…)';
    host.appendChild(btn);

    // Per-block stability watcher
    let lastChange = Date.now();
    let ready = false;
    const setReady = (v) => {
      ready = v;
      markReady(btn, ready);
    };

    // Initial state: show immediately but disabled (not ready)
    setReady(false);

    const mo = new MutationObserver(() => {
      lastChange = Date.now();
      if (ready) setReady(false);
    });
    // Watch inside the host for code changes
    mo.observe(host, {childList:true, subtree:true, characterData:true});

    // Poll for quiet window
    const tick = () => {
      if (!document.body.contains(host)) return; // block removed
      if (!ready && Date.now() - lastChange >= QUIET_MS) setReady(true);
      requestAnimationFrame(tick);
    };
    tick();

    // Click handler
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = codeEl?.textContent ?? host.textContent ?? '';
      if (!code.trim()) { toast('No code detected in this block.'); return; }

      if (!ready) {
        toast('⌛ Code is still updating. The button will turn <b>green</b> when ready.');
        return;
      }

      const target = detectTargetFromHeader(code);
      if (!target) {
        toast('❌ <b>No target detected.</b><br>Add <code>@updateURL</code>, <code>@downloadURL</code>, or <code>@commit-to owner/repo/branch/path</code> to the code header and try again.');
        return;
      }

      const msgDefault = `Update ${target.path}`;
      const message = prompt(`Commit message for ${target.owner}/${target.repo}\nbranch ${target.branch}\n${target.path}:`, msgDefault);
      if (message === null) return;

      try {
        markReady(btn, false);
        btn.textContent = 'Committing…';
        await commitToGitHub({...target, content: code, message: message || msgDefault});
        btn.textContent = 'Committed ✅';
        toast(`✅ <b>Committed</b> to <b>${target.owner}/${target.repo}</b><br>branch <b>${target.branch}</b><br>path <b>${target.path}</b>`);
        setTimeout(()=> markReady(btn, true), 1200);
      } catch (err) {
        console.error(err);
        toast('❌ Commit failed. See console for details.');
        markReady(btn, true);
      }
    });
  }

  function scan() {
    findBlocks().forEach(({host, code}) => wireBlock(host, code));
  }

  // Initial + live
  scan();
  const pageMO = new MutationObserver(scan);
  pageMO.observe(document.body, {childList:true, subtree:true});

  // Hotkey: commit block under cursor
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'g')) return;
    const el = document.elementFromPoint(window.innerWidth/2, window.innerHeight/2) || document.body;
    const host = el.closest?.('pre, figure, div[data-testid="code"]') || document.querySelector('pre, figure, div[data-testid="code"]');
    if (!host) { toast('No code block found for hotkey.'); return; }
    const codeEl = host.querySelector('code');
    if (!codeEl) { toast('No <code> element found inside this block.'); return; }
    const code = codeEl.textContent || '';
    if (!code.trim()) { toast('No code detected in this block.'); return; }
    const target = detectTargetFromHeader(code);
    if (!target) { toast('❌ No target detected in this code block.'); return; }

    const msgDefault = `Update ${target.path}`;
    const message = prompt(`Commit message for ${target.owner}/${target.repo}\nbranch ${target.branch}\n${target.path}:`, msgDefault);
    if (message === null) return;
    (async () => {
      try {
        toast('⏳ Committing…');
        await commitToGitHub({...target, content: code, message: message || msgDefault});
        toast(`✅ <b>Committed</b> to <b>${target.owner}/${target.repo}</b><br>branch <b>${target.branch}</b><br>path <b>${target.path}</b>`);
      } catch (err) {
        console.error(err);
        toast('❌ Commit failed. See console for details.');
      }
    })();
  });
})();
