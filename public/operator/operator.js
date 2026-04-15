// Operator Console — vanilla JS SPA.

(function () {
  'use strict';

  const API = window.location.origin;
  const WS_BASE = API.replace(/^http/, 'ws');

  const state = {
    staff: null,
    conversations: [],
    selectedId: null,
    messagesByConv: {},
    contactsByConv: {},
    detailsById: {}, // cached full conversation rows (survives list filter changes)
    filter: 'open',
    ws: null,
    wsConvId: null,
    listTimer: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    for (const c of children) {
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };

  async function api(method, path, body) {
    const r = await fetch(API + path, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
    return data;
  }

  // --- Auth ---
  async function checkAuth() {
    try {
      const r = await api('GET', '/api/staff/me');
      state.staff = r.staff;
      return true;
    } catch { return false; }
  }

  async function login(email, password) {
    const r = await api('POST', '/api/staff/login', { email, password });
    state.staff = r.staff;
  }

  async function logout() {
    try { await api('POST', '/api/staff/logout'); } catch (_) {}
    state.staff = null;
    state.selectedId = null;
    closeWS();
    if (state.listTimer) { clearInterval(state.listTimer); state.listTimer = null; }
    document.body.setAttribute('data-view', 'login');
    $('#slo-login-email').value = '';
    $('#slo-login-password').value = '';
  }

  // --- Conversations ---
  async function loadConversations() {
    try {
      const qs = state.filter === 'all' ? '' : `?status=${state.filter}`;
      const r = await api('GET', '/api/conversations' + qs);
      state.conversations = r.conversations || [];
      renderList();
    } catch (e) {
      if (e.status === 401) return logout();
      console.warn('loadConversations', e.message);
    }
  }

  async function selectConversation(id) {
    if (state.selectedId === id) return;
    state.selectedId = id;
    renderList();
    renderDetail();
    await loadMessages(id);
    openWS(id);
  }

  async function loadMessages(id) {
    try {
      const r = await api('GET', `/api/conversations/${id}`);
      state.contactsByConv[id] = r.contact;
      state.detailsById[id] = r.conversation;
      const m = await api('GET', `/api/conversations/${id}/messages?include_private=1`);
      state.messagesByConv[id] = m.messages || [];
      renderDetail();
    } catch (e) { console.warn('loadMessages', e.message); }
  }

  async function refreshSelectedDetail() {
    if (!state.selectedId) return;
    try {
      const r = await api('GET', `/api/conversations/${state.selectedId}`);
      state.detailsById[state.selectedId] = r.conversation;
      state.contactsByConv[state.selectedId] = r.contact;
      renderDetail();
    } catch (e) { console.warn('refreshSelectedDetail', e.message); }
  }

  async function sendMessage(text) {
    if (!state.selectedId || !text.trim()) return;
    try {
      await api('POST', `/api/conversations/${state.selectedId}/messages`, {
        sender_type: 'staff',
        sender_id: String(state.staff.id),
        content: text.trim(),
      });
      // WS will broadcast — render will happen on frame arrival.
    } catch (e) { alert('送信失敗: ' + e.message); }
  }

  async function patchConv(patch) {
    if (!state.selectedId) return;
    await api('PATCH', `/api/conversations/${state.selectedId}`, patch);
    // Refresh detail first so the selected conv stays visible even if it's
    // filtered out of the list after the status change (Chatwoot-style).
    await refreshSelectedDetail();
    await loadConversations();
  }
  const takeOver    = () => patchConv({ status: 'open', assignee_id: state.staff.id });
  const resolveConv = () => patchConv({ status: 'closed' });
  const reopenConv  = () => patchConv({ status: 'open' });
  const returnToBot = () => patchConv({ status: 'bot', assignee_id: null });

  // --- WebSocket ---
  function closeWS() {
    if (state.ws) { try { state.ws.close(); } catch (_) {} }
    state.ws = null;
    state.wsConvId = null;
  }
  function openWS(convId) {
    closeWS();
    try {
      state.ws = new WebSocket(`${WS_BASE}/ws/operator/conversations/${convId}`);
      state.wsConvId = convId;
    } catch (e) { return; }
    state.ws.addEventListener('message', (ev) => {
      let f; try { f = JSON.parse(ev.data); } catch { return; }
      if (f.type === 'message.created' && f.message) {
        const arr = state.messagesByConv[convId] || [];
        if (!arr.some((m) => m.id === f.message.id)) arr.push(f.message);
        state.messagesByConv[convId] = arr;
        renderDetail();
        // Bump list entry
        const conv = state.conversations.find((c) => c.id === convId);
        if (conv) {
          conv.last_message_preview = (f.message.content || '').slice(0, 200);
          conv.last_message_at = f.message.created_at;
          renderList();
        }
        // Keep detail cache fresh too
        if (state.detailsById[convId]) {
          state.detailsById[convId].last_message_preview = (f.message.content || '').slice(0, 200);
          state.detailsById[convId].last_message_at = f.message.created_at;
        }
      } else if (f.type === 'conversation.updated' && f.conversation) {
        const i = state.conversations.findIndex((c) => c.id === f.conversation.id);
        if (i >= 0) state.conversations[i] = f.conversation;
        state.detailsById[f.conversation.id] = f.conversation;
        renderList();
        renderDetail();
      }
    });
    state.ws.addEventListener('close', () => {
      if (state.wsConvId === convId) setTimeout(() => openWS(convId), 3000);
    });
  }

  // --- Rendering ---
  function formatTime(iso) {
    if (!iso) return '';
    try {
      const s = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
      const d = new Date(s);
      const today = new Date();
      if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
    } catch { return ''; }
  }

  function renderList() {
    const root = $('#slo-convs');
    root.innerHTML = '';
    for (const c of state.conversations) {
      const contact = state.contactsByConv[c.id];
      const title = contact?.name || contact?.email || c.contact_id.slice(0, 8);
      const item = el('div', {
        class: 'slo-op-conv',
        'data-selected': c.id === state.selectedId ? '1' : '0',
        onclick: () => selectConversation(c.id),
      },
        el('div', { class: 'slo-op-conv-title' }, title),
        el('div', { class: 'slo-op-conv-preview' }, c.last_message_preview || '—'),
        el('div', { class: 'slo-op-conv-meta' },
          el('span', {},
            el('span', { class: 'slo-op-conv-status', 'data-s': c.status }, c.status)
          ),
          el('span', {}, formatTime(c.last_message_at || c.created_at))
        ),
      );
      root.appendChild(item);
    }
    if (state.conversations.length === 0) {
      root.appendChild(el('div', { style: 'padding:20px;color:#9ca3af;font-size:12px;' }, '該当する会話はありません'));
    }
  }

  function renderDetail() {
    const detail = $('#slo-detail');
    detail.innerHTML = '';
    if (!state.selectedId) {
      detail.appendChild(el('div', { class: 'slo-op-detail-empty' }, '左の一覧から会話を選択してください'));
      return;
    }
    // Prefer cached detail (survives list-filter changes); fall back to list entry.
    const conv = state.detailsById[state.selectedId]
      || state.conversations.find((c) => c.id === state.selectedId);
    if (!conv) {
      detail.appendChild(el('div', { class: 'slo-op-detail-empty' }, '会話を読み込み中…'));
      return;
    }
    const contact = state.contactsByConv[conv.id];
    const title = contact?.name || contact?.email || conv.contact_id.slice(0, 8);

    // Header
    const actions = el('div', { class: 'slo-op-detail-actions' });
    const isMine = conv.assignee_id && state.staff && conv.assignee_id === state.staff.id;
    if (conv.status === 'bot' || (!isMine && conv.status === 'open')) {
      actions.appendChild(el('button', { class: 'primary', onclick: takeOver }, '自分が担当する'));
    }
    if (conv.status === 'open') {
      actions.appendChild(el('button', { onclick: returnToBot }, 'ボットに戻す'));
      actions.appendChild(el('button', { class: 'danger', onclick: resolveConv }, '解決'));
    }
    if (conv.status === 'closed') {
      actions.appendChild(el('button', { class: 'primary', onclick: reopenConv }, '再オープン'));
    }
    detail.appendChild(el('div', { class: 'slo-op-detail-header' },
      el('div', {},
        el('div', { class: 'slo-op-detail-title' }, title),
        el('div', { class: 'slo-op-detail-sub' },
          `status: ${conv.status}` +
          (conv.assignee_id ? ` / assignee: ${conv.assignee_id}` : '') +
          ` / ${conv.id.slice(0, 8)}`
        )
      ),
      actions
    ));

    // Messages
    const msgsEl = el('div', { class: 'slo-op-msgs', id: 'slo-msgs' });
    const msgs = state.messagesByConv[conv.id] || [];
    for (const m of msgs) {
      const b = el('div', { class: 'slo-op-msg', 'data-sender': m.sender_type, 'data-msg-id': m.id },
        el('div', {}, m.content || ''),
        el('div', { class: 'slo-op-msg-meta' }, `${m.sender_type} · ${formatTime(m.created_at)}`)
      );
      msgsEl.appendChild(b);
    }
    detail.appendChild(msgsEl);

    // Composer
    const input = el('textarea', { rows: '2', placeholder: 'メッセージを入力… (Enter で送信、Shift+Enter で改行)' });
    const btn = el('button', { onclick: () => { const v = input.value; input.value = ''; sendMessage(v); } }, '送信');
    if (conv.status === 'closed') {
      input.setAttribute('disabled', '');
      btn.setAttribute('disabled', '');
    }
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        const v = input.value; input.value = '';
        sendMessage(v);
      }
    });
    detail.appendChild(el('div', { class: 'slo-op-compose' }, input, btn));

    // Scroll to bottom
    requestAnimationFrame(() => { const m = $('#slo-msgs'); if (m) m.scrollTop = m.scrollHeight; });
  }

  function renderTop() {
    $('#slo-top-user').textContent = state.staff ? `${state.staff.name || state.staff.email}` : '';
  }

  // --- Boot ---
  async function boot() {
    $('#slo-login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = $('#slo-login-email').value.trim();
      const password = $('#slo-login-password').value;
      const errEl = $('#slo-login-err');
      errEl.removeAttribute('data-visible');
      try {
        await login(email, password);
        onAuthenticated();
      } catch (e) {
        errEl.textContent = e.message || 'ログインに失敗しました';
        errEl.setAttribute('data-visible', '1');
      }
    });
    $('#slo-logout').addEventListener('click', logout);
    for (const b of document.querySelectorAll('.slo-op-filter button')) {
      b.addEventListener('click', () => {
        for (const x of document.querySelectorAll('.slo-op-filter button')) x.removeAttribute('data-active');
        b.setAttribute('data-active', '1');
        state.filter = b.dataset.status;
        loadConversations();
      });
    }

    if (await checkAuth()) onAuthenticated();
    else document.body.setAttribute('data-view', 'login');
  }

  async function onAuthenticated() {
    document.body.setAttribute('data-view', 'app');
    renderTop();
    await loadConversations();
    if (state.listTimer) clearInterval(state.listTimer);
    state.listTimer = setInterval(loadConversations, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
