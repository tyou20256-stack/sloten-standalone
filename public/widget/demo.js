// Demo-page glue for /widget/index.html.
//
// Why this file exists: the /widget/* Content-Security-Policy is
// `script-src 'self'` with NO 'unsafe-inline'. That (correctly) blocks the
// inline onclick="" handler and the inline <script> the demo page used to
// rely on — which is exactly why "localStorage の会話状態をリセット" did
// nothing when clicked (the handler never ran; the browser console showed a
// CSP violation). An external same-origin script is allowed, so the wiring
// lives here instead of inline.

(function () {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    // 1. API base label (was an inline <script>, CSP-blocked).
    var apiEl = document.getElementById('api-base');
    if (apiEl) apiEl.textContent = window.location.origin;

    // 2. Reset button (was inline onclick, CSP-blocked).
    var btn = document.getElementById('demo-reset-btn');
    if (!btn) return;

    btn.addEventListener('click', function () {
      // widget.js loads async — guard until SlotenChat is available.
      if (!window.SlotenChat || typeof window.SlotenChat.reset !== 'function') {
        alert('ウィジェットの読み込みがまだ完了していません。数秒後にもう一度お試しください。');
        return;
      }
      if (!confirm('会話状態をリセットします。現在の会話履歴とトークンが破棄され、次回送信時に新しい会話が開始されます。よろしいですか？')) {
        return;
      }
      var prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'リセット中…';
      try {
        window.SlotenChat.reset();
        btn.textContent = '✓ リセット完了';
      } catch (e) {
        console.error('[sloten-demo] reset failed:', e);
        btn.textContent = '✗ リセット失敗（コンソール参照）';
      }
      setTimeout(function () {
        btn.disabled = false;
        btn.textContent = prev;
      }, 2500);
    });
  });
})();
