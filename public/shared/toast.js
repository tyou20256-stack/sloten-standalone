/* Minimal toast utility — non-blocking replacement for alert().
 * Usage:  Sloten.toast('メッセージ', { type: 'error' });
 * Types: info (default) | success | error | warning
 * Styles scoped under .sloten-toast-*
 */
(function () {
  'use strict';
  if (window.Sloten && window.Sloten.toast) return;

  const STYLE = `
    .sloten-toast-stack{position:fixed;top:20px;right:20px;z-index:2147483600;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:calc(100vw - 40px);}
    .sloten-toast{pointer-events:auto;min-width:220px;max-width:360px;padding:10px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.15);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;background:#2563eb;display:flex;gap:8px;align-items:flex-start;animation:slo-toast-in .18s ease-out;}
    .sloten-toast[data-type="success"]{background:#059669;}
    .sloten-toast[data-type="error"]{background:#dc2626;}
    .sloten-toast[data-type="warning"]{background:#d97706;}
    .sloten-toast[data-type="info"]{background:#2563eb;}
    .sloten-toast[data-leaving="1"]{animation:slo-toast-out .18s ease-in forwards;}
    .sloten-toast button{margin-left:auto;background:transparent;border:none;color:inherit;cursor:pointer;font-size:16px;line-height:1;padding:0;opacity:.8;}
    .sloten-toast button:hover{opacity:1;}
    @keyframes slo-toast-in{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}
    @keyframes slo-toast-out{from{transform:translateX(0);opacity:1}to{transform:translateX(20px);opacity:0}}
  `;
  function ensureStack() {
    let stack = document.querySelector('.sloten-toast-stack');
    if (!stack) {
      if (!document.querySelector('style[data-sloten-toast]')) {
        const st = document.createElement('style');
        st.setAttribute('data-sloten-toast', '1');
        st.textContent = STYLE;
        document.head.appendChild(st);
      }
      stack = document.createElement('div');
      stack.className = 'sloten-toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, opts = {}) {
    const stack = ensureStack();
    const t = document.createElement('div');
    t.className = 'sloten-toast';
    t.setAttribute('data-type', opts.type || 'info');
    t.setAttribute('role', 'alert');
    const text = document.createElement('span');
    text.textContent = String(message == null ? '' : message);
    const close = document.createElement('button');
    close.setAttribute('aria-label', '閉じる');
    close.textContent = '×';
    close.onclick = dismiss;
    t.appendChild(text);
    t.appendChild(close);
    stack.appendChild(t);
    const timer = setTimeout(dismiss, opts.duration || 4000);
    function dismiss() {
      clearTimeout(timer);
      t.setAttribute('data-leaving', '1');
      setTimeout(() => t.remove(), 180);
    }
    return dismiss;
  }

  window.Sloten = window.Sloten || {};
  window.Sloten.toast = toast;
})();
