(function(){'use strict';
  const tag=document.createElement('div');
  tag.textContent='Remote TMS ready';
  tag.style.cssText='position:fixed;bottom:8px;right:8px;padding:4px 8px;font:12px/1.2 system-ui;border:1px solid #999;border-radius:6px;background:#fff;opacity:.9;z-index:999999;';
  document.body.appendChild(tag);
  setTimeout(()=>tag.remove(),2200);
})();
