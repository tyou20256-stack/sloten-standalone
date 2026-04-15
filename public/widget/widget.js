/*
 * Sloten Chat Widget — embeddable standalone script.
 *
 * Usage (host site):
 *   <script src="https://<worker>/widget/widget.js"
 *           data-api="https://<worker>"
 *           data-tenant-id="tenant_default"
 *           data-title="スロット天国サポート"
 *           async></script>
 *
 * Config precedence: script[data-*] > window.SlotenChatConfig > defaults.
 * All state persisted in localStorage under "sloten_chat:v1".
 */
(function () {
  'use strict';
  if (window.__SlotenChatLoaded) return;
  window.__SlotenChatLoaded = true;

  const script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  const ds = (script && script.dataset) || {};
  const userCfg = window.SlotenChatConfig || {};
  const defaults = {
    tenantId: 'tenant_default',
    title: 'スロット天国',
    subtitle: '対応中',
    brandInitials: 'ST',
    welcomeTitle: 'こんばんは、スロット天国サポートです',
    welcomeBody: 'ご用件をお選びいただくか、自由にご質問ください。',
    menuButtonLabel: 'メニュー',
    dreampotUrl: 'https://sloten.io/lottery',
    inputPlaceholder: 'ご質問を入力…',
    autoOpen: false,
  };

  const apiBase = (ds.api || userCfg.api || (script ? new URL(script.src).origin : window.location.origin)).replace(/\/$/, '');

  // Host-provided user info (optional). Populated from:
  //   data-user-name / data-user-email / data-user-phone / data-user-external-id
  //   window.SlotenChatConfig.user = { name, email, phone, external_id, metadata }
  const hostUser = Object.assign({}, (userCfg.user || {}));
  if (ds.userName)       hostUser.name = ds.userName;
  if (ds.userEmail)      hostUser.email = ds.userEmail;
  if (ds.userPhone)      hostUser.phone = ds.userPhone;
  if (ds.userExternalId) hostUser.external_id = ds.userExternalId;

  const cfg = {
    apiBase,
    wsBase: apiBase.replace(/^http/, 'ws'),
    tenantId: ds.tenantId || userCfg.tenantId || defaults.tenantId,
    title: ds.title || userCfg.title || defaults.title,
    subtitle: ds.subtitle || userCfg.subtitle || defaults.subtitle,
    brandInitials: ds.brandInitials || userCfg.brandInitials || defaults.brandInitials,
    welcomeTitle: ds.welcomeTitle || userCfg.welcomeTitle || defaults.welcomeTitle,
    welcomeBody: ds.welcomeBody || userCfg.welcomeBody || defaults.welcomeBody,
    menuButtonLabel: ds.menuButtonLabel || userCfg.menuButtonLabel || defaults.menuButtonLabel,
    dreampotUrl: ds.dreampotUrl || userCfg.dreampotUrl || defaults.dreampotUrl,
    inputPlaceholder: ds.inputPlaceholder || userCfg.inputPlaceholder || defaults.inputPlaceholder,
    autoOpen: (ds.autoOpen || userCfg.autoOpen || '').toString() === '1' || userCfg.autoOpen === true,
    cssUrl: ds.cssUrl || userCfg.cssUrl || (script ? new URL('./widget.css', script.src).toString() : null),
    user: hostUser,
  };

  const STORAGE_KEY = 'sloten_chat:v1';
  const state = Object.assign(
    { contactId: null, conversationId: null, contactToken: null, status: null, history: [] },
    loadState()
  );

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
    catch { return {}; }
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        contactId: state.contactId,
        conversationId: state.conversationId,
        contactToken: state.contactToken,
      }));
    } catch (_) {}
  }

  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.contactToken) headers['X-Sloten-Contact-Token'] = state.contactToken;
    const r = await fetch(cfg.apiBase + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) {
      // 401/403 on existing state means token or conversation is invalid —
      // clear and force fresh bootstrap on next send.
      if ((r.status === 401 || r.status === 403) && state.contactToken) {
        state.contactId = null;
        state.conversationId = null;
        state.contactToken = null;
        saveState();
      }
      throw new Error(data.error || `HTTP ${r.status}`);
    }
    return data;
  }

  function injectStyles() {
    if (cfg.cssUrl && !document.querySelector('link[data-sloten-chat="1"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cfg.cssUrl;
      link.setAttribute('data-sloten-chat', '1');
      document.head.appendChild(link);
    }
  }

  // --- DOM construction ---
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    for (const c of children) {
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };

  const ICON_CHAT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 5.94 2 10.8c0 2.52 1.26 4.79 3.3 6.41L4 22l5.22-2.61c.9.14 1.83.21 2.78.21 5.52 0 10-3.94 10-8.8C22 5.94 17.52 2 12 2z"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

  const dom = {};
  function buildUI() {
    dom.root = el('div', { class: 'sloten-chat-root', 'data-open': cfg.autoOpen ? '1' : '0' });
    dom.launcher = el('button', {
      class: 'sloten-chat-launcher',
      'aria-label': 'チャットを開く',
      onclick: open,
      html: ICON_CHAT,
    });
    dom.panel = el('div', { class: 'sloten-chat-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'サポートチャット' });

    // Header: ST avatar + title + "対応中" + close
    const brandInitials = (cfg.brandInitials || 'ST').slice(0, 2);
    const header = el('div', { class: 'sloten-chat-header' },
      el('div', { class: 'sloten-chat-header-avatar', 'aria-hidden': 'true' }, brandInitials),
      el('div', { class: 'sloten-chat-header-text' },
        el('div', { class: 'sloten-chat-title' }, cfg.title),
        el('div', { class: 'sloten-chat-subtitle' }, cfg.subtitle),
      ),
      el('button', { class: 'sloten-chat-close', type: 'button', 'aria-label': 'チャットウィジェットを閉じる', onclick: close }, '\u00d7'),
    );

    // Pinned welcome + dreampot (always above the message stream)
    dom.pinned = el('div', { class: 'sloten-chat-pinned' });
    dom.welcome = el('div', { class: 'sloten-chat-welcome' },
      el('div', { class: 'sloten-chat-welcome-text' },
        el('div', { class: 'sloten-chat-welcome-title' }, cfg.welcomeTitle),
        el('div', { class: 'sloten-chat-welcome-body' }, cfg.welcomeBody),
      ),
      el('button', {
        class: 'sloten-chat-menu-btn', type: 'button',
        'aria-label': 'メニューを表示',
        onclick: onMenuClick,
      }, cfg.menuButtonLabel),
    );
    dom.dreampot = el('div', {
      class: 'sloten-chat-dreampot',
      role: 'button', tabindex: '0',
      onclick: () => window.open(cfg.dreampotUrl, '_blank', 'noopener'),
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') window.open(cfg.dreampotUrl, '_blank', 'noopener'); },
    },
      el('div', { class: 'sloten-chat-dreampot-badge' }, 'JP'),
      el('div', { class: 'sloten-chat-dreampot-text' },
        el('div', { class: 'sloten-chat-dreampot-title', id: 'slc-dreampot-title' }, 'ドリームポット 読み込み中…'),
        el('div', { class: 'sloten-chat-dreampot-more' }, '詳しくはこちら'),
      ),
    );
    dom.pinned.appendChild(dom.welcome);
    dom.pinned.appendChild(dom.dreampot);

    dom.banner = el('div', { class: 'sloten-chat-banner' });
    dom.messages = el('div', { class: 'sloten-chat-messages' });
    dom.typing = el('div', { class: 'sloten-chat-typing' }, '入力中…');
    dom.input = el('textarea', {
      class: 'sloten-chat-input',
      rows: '1',
      placeholder: cfg.inputPlaceholder,
      onkeydown: onKeyDown,
      oninput: () => autoResize(dom.input),
    });
    dom.send = el('button', { class: 'sloten-chat-send', type: 'button', 'aria-label': 'メッセージを送信', onclick: onSend, html: ICON_SEND });
    dom.attach = el('button', { class: 'sloten-chat-attach', type: 'button', 'aria-label': 'ファイルを添付', title: 'ファイル添付 (画像/PDF, 最大10MB)', onclick: () => dom.file.click() }, '📎');
    dom.file = el('input', { type: 'file', accept: 'image/*,application/pdf', style: 'display:none', onchange: onFilePicked });
    dom.pending = el('div', { class: 'sloten-chat-pending', style: 'display:none' });
    const inputWrap = el('div', { class: 'sloten-chat-input-wrap' }, dom.attach, dom.input, dom.send);
    dom.status = el('div', { class: 'sloten-chat-status' }, '接続準備中');

    dom.panel.appendChild(header);
    dom.panel.appendChild(dom.pinned);
    dom.panel.appendChild(dom.banner);
    dom.panel.appendChild(dom.messages);
    dom.messages.appendChild(dom.typing);
    dom.panel.appendChild(dom.pending);
    dom.panel.appendChild(inputWrap);
    dom.panel.appendChild(dom.file);
    dom.panel.appendChild(dom.status);
    dom.root.appendChild(dom.launcher);
    dom.root.appendChild(dom.panel);
    (document.body || document.documentElement).appendChild(dom.root);
  }

  // --- Attachments ---
  let pendingAttachment = null; // { id, filename, content_type, size_bytes }

  function showPending(att) {
    pendingAttachment = att;
    if (!att) { dom.pending.style.display = 'none'; dom.pending.innerHTML = ''; return; }
    dom.pending.style.display = 'flex';
    dom.pending.innerHTML = '';
    dom.pending.appendChild(document.createTextNode(`📎 ${att.filename} (${Math.round(att.size_bytes/1024)} KB)`));
    const x = el('button', { type: 'button', 'aria-label': '添付キャンセル', onclick: () => showPending(null) }, '×');
    dom.pending.appendChild(x);
  }

  async function onFilePicked(ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      renderMessage({ id: 'err-' + Date.now(), sender_type: 'system', content: 'ファイルが大きすぎます (最大10MB)', created_at: new Date().toISOString() });
      return;
    }
    try {
      await ensureConversation();
      const form = new FormData();
      form.append('file', f);
      const headers = state.contactToken ? { 'X-Sloten-Contact-Token': state.contactToken } : {};
      const r = await fetch(`${cfg.apiBase}/api/widget/conversations/${state.conversationId}/attachments`, { method: 'POST', headers, body: form });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = {}; }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      showPending(data.attachment);
    } catch (e) {
      renderMessage({ id: 'err-' + Date.now(), sender_type: 'system', content: 'アップロード失敗: ' + e.message, created_at: new Date().toISOString() });
    }
  }

  function autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
  }

  function onKeyDown(ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      onSend();
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  }

  function setStatus(text) { dom.status.textContent = text; }
  function setBanner(text) {
    if (!text) { dom.banner.removeAttribute('data-visible'); dom.banner.textContent = ''; }
    else { dom.banner.setAttribute('data-visible', '1'); dom.banner.textContent = text; }
  }
  function setTyping(on) { dom.typing.setAttribute('data-visible', on ? '1' : '0'); }

  function formatTime(iso) {
    try {
      const d = new Date((iso && !iso.endsWith('Z') ? iso.replace(' ', 'T') + 'Z' : iso));
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  function renderMessage(msg) {
    if (!msg || !msg.id) return;
    if (dom.messages.querySelector(`[data-msg-id="${msg.id}"]`)) return; // dedupe
    const bubble = el('div', { class: 'sloten-chat-msg', 'data-sender': msg.sender_type || 'bot', 'data-msg-id': msg.id });
    const contentDiv = el('div', {}, msg.content || '');
    bubble.appendChild(contentDiv);

    // Attachment preview
    if (msg.attachment) {
      const a = msg.attachment;
      const url = `${cfg.apiBase}/api/widget/attachments/${a.id}`;
      const isImg = (a.content_type || '').startsWith('image/');
      const box = el('div', { class: 'sloten-chat-attachment' });
      if (isImg) {
        const img = el('img', { alt: a.filename, 'data-att-id': a.id });
        // Fetch with header auth, blob-convert to object URL so <img> can show it.
        fetch(url, { headers: { 'X-Sloten-Contact-Token': state.contactToken || '' } })
          .then((r) => r.ok ? r.blob() : Promise.reject(new Error('download failed')))
          .then((b) => { img.src = URL.createObjectURL(b); })
          .catch(() => { img.alt = '画像の読み込みに失敗'; });
        img.addEventListener('click', () => window.open(img.src, '_blank', 'noopener'));
        box.appendChild(img);
      } else {
        const link = el('a', {
          class: 'sloten-chat-attachment-file',
          href: '#', onclick: async (ev) => {
            ev.preventDefault();
            try {
              const r = await fetch(url, { headers: { 'X-Sloten-Contact-Token': state.contactToken || '' } });
              if (!r.ok) throw new Error('download failed');
              const b = await r.blob();
              const u = URL.createObjectURL(b);
              window.open(u, '_blank', 'noopener');
            } catch (e) { console.warn(e); }
          },
        }, '📎 ' + (a.filename || 'file'),
           el('span', { class: 'sloten-chat-attachment-meta' }, Math.round((a.size_bytes || 0) / 1024) + ' KB'));
        box.appendChild(link);
      }
      bubble.appendChild(box);
    }

    if (msg.content_type === 'input_select' && msg.content_attributes) {
      try {
        const attrs = typeof msg.content_attributes === 'string' ? JSON.parse(msg.content_attributes) : msg.content_attributes;
        const items = (attrs && attrs.items) || [];
        if (items.length) {
          const group = el('div', { class: 'sloten-chat-selects' });
          for (const it of items) {
            // Display the human-readable title, but send the machine-friendly
            // value (if provided) so keyword regex rules can match predictably.
            const displayText = it.title || it.value || '';
            const sendValue = it.value || it.title || '';
            const btn = el('button', {
              class: 'sloten-chat-select-btn',
              type: 'button',
              onclick: () => sendText(sendValue),
            }, displayText);
            group.appendChild(btn);
          }
          bubble.appendChild(group);
        }
      } catch (_) {}
    }

    bubble.appendChild(el('div', { class: 'sloten-chat-meta' }, formatTime(msg.created_at)));
    dom.messages.insertBefore(bubble, dom.typing);
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { dom.messages.scrollTop = dom.messages.scrollHeight; });
  }

  // --- Bootstrap conversation ---
  async function ensureContact() {
    if (state.contactId) return state.contactId;
    // Collect host-provided user info. external_id goes into metadata,
    // additional metadata (if any) is merged.
    const payload = { tenant_id: cfg.tenantId };
    const u = cfg.user || {};
    if (u.name)  payload.name  = u.name;
    if (u.email) payload.email = u.email;
    if (u.phone) payload.phone = u.phone;
    const meta = Object.assign({}, u.metadata || {});
    if (u.external_id) meta.external_id = u.external_id;
    if (Object.keys(meta).length) payload.metadata = meta;

    const r = await api('POST', '/api/widget/contacts', payload);
    state.contactId = r.contact.id;
    if (r.contact_token) state.contactToken = r.contact_token;
    saveState();
    return state.contactId;
  }

  async function ensureConversation() {
    if (state.conversationId) return state.conversationId;
    await ensureContact();
    const r = await api('POST', '/api/widget/conversations', {
      tenant_id: cfg.tenantId,
      contact_id: state.contactId,
    });
    state.conversationId = r.conversation.id;
    state.status = r.conversation.status;
    saveState();
    // First-time conversation: open WS immediately so operator replies appear in real time.
    connectWS();
    return state.conversationId;
  }

  async function loadHistory() {
    if (!state.conversationId) return;
    try {
      const r = await api('GET', `/api/widget/conversations/${state.conversationId}/messages`);
      for (const m of (r.messages || [])) renderMessage(m);
    } catch (e) {
      console.warn('[sloten-chat] loadHistory failed:', e.message);
      state.conversationId = null;
      saveState();
    }
  }

  async function refreshConversation() {
    if (!state.conversationId) return;
    try {
      const r = await api('GET', `/api/widget/conversations/${state.conversationId}`);
      state.status = r.conversation.status;
      if (r.conversation.status === 'open' && r.conversation.assignee_id) {
        setBanner('担当者におつなぎしました。少々お待ちください。');
      } else if (r.conversation.status === 'closed') {
        setBanner('この会話は終了しています。新しい質問は送信ボタンから。');
      } else {
        setBanner('');
      }
    } catch (_) { /* ignore */ }
  }

  // --- Menu button ---
  async function onMenuClick() {
    if (sending) return;
    const btn = document.querySelector('.sloten-chat-menu-btn');
    if (btn) btn.disabled = true;
    sending = true;
    setTyping(true);
    try {
      await ensureConversation();
      // reset_flow:true clears any active flow_state server-side so the main
      // menu is displayed again even mid-flow.
      await api('POST', `/api/widget/conversations/${state.conversationId}/messages`, {
        sender_type: 'customer',
        content: cfg.menuButtonLabel,
        reset_flow: true,
      });
    } catch (e) {
      renderMessage({
        id: 'err-' + Date.now(), sender_type: 'system',
        content: 'メニュー表示に失敗しました: ' + e.message,
        created_at: new Date().toISOString(),
      });
    } finally {
      sending = false;
      setTyping(false);
      if (btn) btn.disabled = false;
    }
  }

  // --- Sending ---
  let sending = false;
  async function onSend() {
    const text = (dom.input.value || '').trim();
    if (!text || sending) return;
    dom.input.value = '';
    autoResize(dom.input);
    await sendText(text);
  }

  async function sendText(text) {
    // Allow empty text if an attachment is pending — send just the file.
    if (!text && !pendingAttachment) return;
    sending = true;
    dom.send.disabled = true;
    setTyping(true);
    try {
      await ensureConversation();
      const body = {
        sender_type: 'customer',
        content: text || (pendingAttachment ? pendingAttachment.filename : ''),
      };
      if (pendingAttachment) {
        body.content_attributes = { attachment_id: pendingAttachment.id };
      }
      await api('POST', `/api/widget/conversations/${state.conversationId}/messages`, body);
      if (pendingAttachment) showPending(null);
      // Broadcast will render it via WS; also render optimistically if WS absent.
      if (!wsActive()) {
        renderMessage({
          id: 'local-' + Date.now(),
          sender_type: 'customer',
          content: text,
          created_at: new Date().toISOString(),
        });
        setTimeout(pollMessages, 800);
      }
    } catch (e) {
      renderMessage({
        id: 'err-' + Date.now(),
        sender_type: 'system',
        content: '送信に失敗しました: ' + e.message,
        created_at: new Date().toISOString(),
      });
    } finally {
      sending = false;
      dom.send.disabled = false;
      setTyping(false);
    }
  }

  // --- WebSocket ---
  let ws = null;
  let wsReconnectTimer = null;
  let wsAttempt = 0;
  let pollTimer = null;

  function wsActive() { return ws && ws.readyState === WebSocket.OPEN; }

  function connectWS() {
    if (!state.conversationId || !state.contactToken) return;
    if (ws && ws.readyState !== WebSocket.CLOSED) return; // already connected/connecting
    try {
      const u = `${cfg.wsBase}/ws/widget/conversations/${state.conversationId}?contact_token=${encodeURIComponent(state.contactToken)}`;
      ws = new WebSocket(u);
    } catch (e) {
      console.warn('[sloten-chat] ws construct failed:', e.message);
      startPolling();
      return;
    }
    ws.addEventListener('open', () => {
      setStatus('接続中');
      wsAttempt = 0;
      stopPolling();
    });
    ws.addEventListener('message', (ev) => {
      let f; try { f = JSON.parse(ev.data); } catch { return; }
      if (f.type === 'message.created' && f.message) {
        // Skip private notes — operator-only.
        if (f.message.is_private) return;
        renderMessage(f.message);
      } else if (f.type === 'conversation.updated' && f.conversation) {
        state.status = f.conversation.status;
        refreshConversation();
      }
    });
    ws.addEventListener('close', () => {
      setStatus('再接続待機中');
      startPolling();
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      try { ws.close(); } catch (_) {}
    });
  }

  function scheduleReconnect() {
    if (wsReconnectTimer) return;
    // Exponential backoff with cap: 3s -> 6s -> 12s -> ... up to 60s.
    // After 10 consecutive failures, stop trying; polling fallback continues.
    if (wsAttempt >= 10) return;
    const delay = Math.min(60000, 3000 * Math.pow(2, wsAttempt));
    wsAttempt++;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      connectWS();
    }, delay);
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollMessages, 5000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function pollMessages() {
    if (!state.conversationId) return;
    try {
      const r = await api('GET', `/api/widget/conversations/${state.conversationId}/messages`);
      for (const m of (r.messages || [])) renderMessage(m);
      refreshConversation();
    } catch (_) { /* ignore */ }
  }

  // --- Lifecycle ---
  async function open() {
    dom.root.setAttribute('data-open', '1');
    dom.input.focus();
    if (!state.conversationId) {
      // Greet message only on fresh open. WS is deferred until first send
      // creates the conversation (ensureConversation calls connectWS).
      renderMessage({
        id: 'greet-' + Date.now(),
        sender_type: 'bot',
        content: 'こんにちは！ご質問やお困りごとをお書きください。',
        created_at: new Date().toISOString(),
      });
    } else {
      await loadHistory();
      await refreshConversation();
      connectWS();
    }
  }
  function close() {
    dom.root.setAttribute('data-open', '0');
    stopPolling();
  }

  // --- Dreampot live amount ---
  let dreampotTimer = null;
  async function refreshDreampot() {
    try {
      const r = await fetch(cfg.apiBase + '/api/public/jackpot', { credentials: 'omit' });
      const j = await r.json();
      if (j && j.success && Number.isFinite(j.amount)) {
        const t = document.getElementById('slc-dreampot-title');
        if (t) t.textContent = 'ドリームポット ¥' + j.amount.toLocaleString('en-US');
      }
    } catch (_) { /* ignore transient errors */ }
  }

  async function init() {
    injectStyles();
    buildUI();
    refreshDreampot();
    if (dreampotTimer) clearInterval(dreampotTimer);
    dreampotTimer = setInterval(refreshDreampot, 60 * 1000);
    if (cfg.autoOpen) await open();
    if (state.conversationId) {
      // Resume on fresh page load: connect WS eagerly so operator replies
      // arrive even if the user hasn't opened the panel yet.
      connectWS();
    }
    setStatus('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Expose minimal API for host pages.
  window.SlotenChat = {
    open,
    close,
    reset() {
      state.contactId = null;
      state.conversationId = null;
      localStorage.removeItem(STORAGE_KEY);
      dom.messages.querySelectorAll('.sloten-chat-msg').forEach((n) => n.remove());
    },
    getState() { return Object.assign({}, state); },
  };
})();
