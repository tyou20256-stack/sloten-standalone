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
    detailsById: {},       // cached full conversation rows (survives list filter changes)
    historyByContact: {},  // contact_id -> conversations[]
    labels: [],            // global labels catalog
    templates: [],         // canned responses
    filter: 'open',
    ws: null,
    wsConvId: null,
    listTimer: null,
    privateMode: false,    // composer is in "internal note" mode
    tplOpen: false,
    searchDebounce: null,
    notifyGranted: false,
  };

  const PRIORITIES = [
    { key: 'low',    label: '低' },
    { key: 'normal', label: '通常' },
    { key: 'high',   label: '高' },
    { key: 'urgent', label: '緊急' },
  ];

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

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
      let qs = '';
      if (state.filter === 'snoozed') qs = '?snoozed=1';
      else if (state.filter !== 'all') qs = `?status=${state.filter}&snoozed=0`;
      else qs = '?snoozed=0';
      const r = await api('GET', '/api/conversations' + qs);
      state.conversations = r.conversations || [];
      renderList();
    } catch (e) {
      if (e.status === 401) return logout();
      console.warn('loadConversations', e.message);
    }
  }

  async function loadLabels() {
    try { const r = await api('GET', '/api/labels'); state.labels = r.labels || []; }
    catch (e) { console.warn('loadLabels', e.message); }
  }
  async function loadTemplates() {
    try {
      const r = await api('GET', '/api/templates?tenant_id=tenant_default');
      state.templates = r.templates || [];
    } catch (e) { console.warn('loadTemplates', e.message); }
  }
  async function loadTeams() {
    try { const r = await api('GET', '/api/teams'); state.teams = r.teams || []; }
    catch (e) { state.teams = []; }
  }

  async function selectConversation(id) {
    if (state.selectedId === id) return;
    state.selectedId = id;
    renderList();
    renderDetail();
    renderInfo();
    await loadMessages(id);
    openWS(id);
    // Contact history is fetched once per contact; lazy.
    const contactId = state.detailsById[id]?.contact_id;
    if (contactId && !state.historyByContact[contactId]) await loadContactHistory(contactId);
    renderInfo();
  }

  async function loadContactHistory(contactId) {
    try {
      const r = await api('GET', `/api/contacts/${contactId}/conversations`);
      state.historyByContact[contactId] = r.conversations || [];
    } catch (e) { console.warn('loadContactHistory', e.message); }
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
        is_private: state.privateMode,
      });
    } catch (e) { alert('送信失敗: ' + e.message); }
  }

  async function markRead(convId) {
    try { await api('POST', `/api/conversations/${convId}/mark_read`); }
    catch (e) { /* ignore */ }
  }

  async function setPriority(p) {
    if (!state.selectedId) return;
    await api('PATCH', `/api/conversations/${state.selectedId}`, { priority: p });
    await refreshSelectedDetail();
    await loadConversations();
  }
  async function addLabel(name) {
    if (!state.selectedId) return;
    const conv = state.detailsById[state.selectedId];
    const current = (conv?.labels || '').split(',').filter(Boolean);
    if (current.includes(name)) return;
    current.push(name);
    await api('PATCH', `/api/conversations/${state.selectedId}`, { labels: current });
    await refreshSelectedDetail();
    await loadConversations();
  }
  async function removeLabel(name) {
    if (!state.selectedId) return;
    const conv = state.detailsById[state.selectedId];
    const current = (conv?.labels || '').split(',').filter(Boolean).filter((x) => x !== name);
    await api('PATCH', `/api/conversations/${state.selectedId}`, { labels: current });
    await refreshSelectedDetail();
    await loadConversations();
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
  async function snoozeConv(iso) { await patchConv({ snoozed_until: iso }); }
  async function unsnoozeConv()  { await patchConv({ snoozed_until: null }); }
  async function setTeam(teamId) { await patchConv({ team_id: teamId || null }); }

  // --- WebSocket ---
  function closeWS() {
    if (state.ws) { try { state.ws.close(); } catch (_) {} }
    state.ws = null;
    state.wsConvId = null;
  }
  function openWS(convId) {
    closeWS();
    if (state.wsReconnectTimer) { clearTimeout(state.wsReconnectTimer); state.wsReconnectTimer = null; }
    try {
      state.ws = new WebSocket(`${WS_BASE}/ws/operator/conversations/${convId}`);
      state.wsConvId = convId;
    } catch (e) { return; }
    state.ws.addEventListener('open', () => { state.wsAttempt = 0; });
    state.ws.addEventListener('message', (ev) => {
      let f; try { f = JSON.parse(ev.data); } catch { return; }
      if (f.type === 'message.created' && f.message) {
        const arr = state.messagesByConv[convId] || [];
        if (!arr.some((m) => m.id === f.message.id)) arr.push(f.message);
        state.messagesByConv[convId] = arr;
        renderDetail();
        renderInfo();
        // Bump list entry + unread
        const conv = state.conversations.find((c) => c.id === convId);
        if (conv) {
          if (!f.message.is_private) {
            conv.last_message_preview = (f.message.content || '').slice(0, 200);
            conv.last_message_at = f.message.created_at;
            if ((f.message.sender_type === 'customer' || f.message.sender_type === 'bot')
                && state.selectedId !== convId) {
              conv.unread_count_staff = (conv.unread_count_staff || 0) + 1;
              notifyNewMessage(conv, f.message);
            }
          }
          renderList();
        }
        // If selected and visible, auto-mark-read after 2s
        if (state.selectedId === convId && !document.hidden) {
          setTimeout(() => { markRead(convId); }, 2000);
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
        renderInfo();
      }
    });
    state.ws.addEventListener('close', () => {
      if (state.wsConvId !== convId || state.selectedId !== convId) return;
      if ((state.wsAttempt || 0) >= 10) return;
      const delay = Math.min(60000, 3000 * Math.pow(2, state.wsAttempt || 0));
      state.wsAttempt = (state.wsAttempt || 0) + 1;
      state.wsReconnectTimer = setTimeout(() => {
        state.wsReconnectTimer = null;
        if (state.selectedId === convId) openWS(convId);
      }, delay);
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
      const priorityEl = c.priority && c.priority !== 'normal'
        ? el('span', { class: 'slo-op-priority', 'data-p': c.priority }, (PRIORITIES.find((p) => p.key === c.priority) || {}).label || c.priority)
        : null;
      const titleLine = el('div', { class: 'slo-op-conv-title' });
      if (priorityEl) titleLine.appendChild(priorityEl);
      titleLine.appendChild(document.createTextNode(title));
      if (c.unread_count_staff > 0) {
        titleLine.appendChild(el('span', { class: 'slo-op-unread' }, String(c.unread_count_staff)));
      }
      const item = el('div', {
        class: 'slo-op-conv',
        'data-selected': c.id === state.selectedId ? '1' : '0',
        onclick: () => selectConversation(c.id),
      },
        titleLine,
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
    // Snooze button — schedules a future wake via datetime-local picker.
    const snoozeBtn = el('button', { onclick: () => openSnoozeDialog(conv) },
      conv.snoozed_until ? `⏰ ${formatTime(conv.snoozed_until)}` : '⏰ スヌーズ');
    actions.appendChild(snoozeBtn);
    if (conv.snoozed_until) actions.appendChild(el('button', { onclick: unsnoozeConv }, '解除'));
    // Priority selector
    const prioritySelect = el('select', {
      onchange: (ev) => setPriority(ev.target.value),
    });
    for (const p of PRIORITIES) {
      const opt = el('option', { value: p.key }, p.label);
      if ((conv.priority || 'normal') === p.key) opt.setAttribute('selected', '');
      prioritySelect.appendChild(opt);
    }
    actions.insertBefore(prioritySelect, actions.firstChild);

    detail.appendChild(el('div', { class: 'slo-op-detail-header' },
      el('div', {},
        el('div', { class: 'slo-op-detail-title' }, title),
        el('div', { class: 'slo-op-detail-sub' },
          `status: ${conv.status}` +
          (conv.assignee_id ? ` / assignee: ${conv.assignee_id}` : '') +
          ` / priority: ${conv.priority || 'normal'}` +
          ` / ${conv.id.slice(0, 8)}`
        )
      ),
      actions
    ));

    // Messages
    const msgsEl = el('div', { class: 'slo-op-msgs', id: 'slo-msgs' });
    const msgs = state.messagesByConv[conv.id] || [];
    for (const m of msgs) {
      const body = el('div', {});
      if (m.is_private) body.appendChild(el('span', { class: 'slo-op-msg-private-tag' }, '内部'));
      body.appendChild(document.createTextNode(m.content || ''));
      const b = el('div', { class: 'slo-op-msg', 'data-sender': m.sender_type, 'data-private': m.is_private ? '1' : '0', 'data-msg-id': m.id },
        body,
        el('div', { class: 'slo-op-msg-meta' }, `${m.sender_type} · ${formatTime(m.created_at)}`)
      );
      msgsEl.appendChild(b);
    }
    detail.appendChild(msgsEl);

    // Composer (toggle bar + input)
    const toggleBar = el('div', { class: 'slo-op-compose-toggle' },
      el('label', {},
        el('input', {
          type: 'checkbox',
          onchange: (ev) => { state.privateMode = ev.target.checked; renderDetail(); },
        }),
        '内部メモ (顧客に送信しない)'
      ),
      el('button', {
        onclick: (ev) => { ev.stopPropagation(); state.tplOpen = !state.tplOpen; renderDetail(); },
      }, '📝 定型返信')
    );
    // Persist checkbox state after re-render
    const cbox = toggleBar.querySelector('input');
    cbox.checked = state.privateMode;

    const input = el('textarea', {
      rows: '2',
      placeholder: state.privateMode
        ? '内部メモ (他のオペレーターのみに見える) …'
        : 'メッセージを入力… (Enter で送信、Shift+Enter で改行)',
    });
    const btn = el('button', {
      onclick: () => { const v = input.value; input.value = ''; sendMessage(v); },
    }, state.privateMode ? 'メモ保存' : '送信');
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
    const composeWrap = el('div', {
      class: 'slo-op-compose' + (state.privateMode ? ' slo-op-compose-private' : ''),
    }, input, btn);

    // Templates dropdown
    const tplPanel = el('div', { class: 'slo-op-tpl-panel', 'data-open': state.tplOpen ? '1' : '0' });
    if (state.templates.length === 0) {
      tplPanel.appendChild(el('div', { style: 'padding:12px;color:#9ca3af;font-size:12px;' }, '定型返信はまだありません'));
    } else {
      for (const t of state.templates.slice(0, 30)) {
        tplPanel.appendChild(el('div', {
          class: 'slo-op-tpl-item',
          onclick: () => {
            input.value = (input.value ? input.value + '\n' : '') + (t.content || '');
            state.tplOpen = false;
            renderDetail();
            setTimeout(() => { const ta = $('#slo-detail textarea'); if (ta) ta.focus(); }, 0);
          },
        },
          el('div', { class: 'slo-op-tpl-item-name' }, t.name || ''),
          el('div', { class: 'slo-op-tpl-item-preview' }, (t.content || '').slice(0, 200))
        ));
      }
    }

    detail.appendChild(toggleBar);
    detail.appendChild(composeWrap);
    detail.appendChild(tplPanel);

    // Scroll to bottom + mark read
    requestAnimationFrame(() => { const m = $('#slo-msgs'); if (m) m.scrollTop = m.scrollHeight; });
    if ((conv.unread_count_staff || 0) > 0) {
      markRead(conv.id);
      conv.unread_count_staff = 0;
    }
  }

  function renderTop() {
    $('#slo-top-user').textContent = state.staff ? `${state.staff.name || state.staff.email}` : '';
  }

  function parseMetadata(meta) {
    if (!meta) return null;
    if (typeof meta === 'object') return meta;
    try { return JSON.parse(meta); } catch { return null; }
  }
  function initials(name, fallback) {
    const s = (name || fallback || '?').trim();
    if (!s) return '?';
    // Use first two alpha chars or fallback to first char
    const ch = s.match(/[\p{L}\p{N}]/u);
    return (ch ? ch[0] : s[0]).toUpperCase();
  }
  function formatDate(iso) {
    if (!iso) return '—';
    try {
      const s = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
      return new Date(s).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  }

  function renderInfo() {
    const info = $('#slo-info');
    info.innerHTML = '';
    if (!state.selectedId) {
      info.appendChild(el('div', { class: 'slo-op-info-empty' }, '会話を選択するとユーザー情報が表示されます'));
      return;
    }
    const conv = state.detailsById[state.selectedId];
    const contact = state.contactsByConv[state.selectedId];
    if (!conv || !contact) {
      info.appendChild(el('div', { class: 'slo-op-info-empty' }, '読み込み中…'));
      return;
    }

    // Header (avatar + name + id)
    const displayName = contact.name || contact.email || contact.phone || 'ゲスト';
    info.appendChild(el('div', { class: 'slo-op-info-header' },
      el('div', { class: 'slo-op-info-avatar' }, initials(contact.name, contact.email || contact.phone || 'G')),
      el('div', { class: 'slo-op-info-name' }, displayName),
      el('div', { class: 'slo-op-info-id' }, contact.id)
    ));

    // Contact fields
    const fields = el('div', { class: 'slo-op-info-section' });
    fields.appendChild(el('h4', {}, 'ユーザー情報'));
    const addRow = (label, value) => {
      if (value == null || value === '') return;
      fields.appendChild(el('div', { class: 'slo-op-info-row' },
        el('span', {}, label),
        el('span', {}, String(value))
      ));
    };
    addRow('名前', contact.name);
    addRow('メール', contact.email);
    addRow('電話', contact.phone);
    addRow('識別済', contact.is_identified ? 'はい' : 'いいえ');
    addRow('登録日時', formatDate(contact.created_at));
    addRow('最終更新', formatDate(contact.updated_at));
    info.appendChild(fields);

    // Labels section
    const labelsSec = el('div', { class: 'slo-op-info-section' });
    labelsSec.appendChild(el('h4', {}, 'ラベル'));
    const labelsGroup = el('div', { class: 'slo-op-labels-group' });
    const activeLabels = (conv.labels || '').split(',').filter(Boolean);
    for (const name of activeLabels) {
      const def = state.labels.find((l) => l.name === name);
      const color = def?.color || '#6b7280';
      labelsGroup.appendChild(el('span', { class: 'slo-op-label', style: `background:${color}` },
        name,
        el('button', { title: '削除', onclick: () => removeLabel(name) }, '×')
      ));
    }
    labelsSec.appendChild(labelsGroup);
    const available = state.labels.filter((l) => !activeLabels.includes(l.name));
    const picker = el('div', { class: 'slo-op-label-picker' });
    for (const l of available) {
      picker.appendChild(el('button', {
        class: 'slo-op-label-add',
        style: `border-color:${l.color};color:${l.color}`,
        onclick: () => addLabel(l.name),
      }, '+ ' + l.name));
    }
    picker.appendChild(el('button', {
      class: 'slo-op-label-add',
      onclick: async () => {
        const name = prompt('新しいラベル名');
        if (!name) return;
        const color = prompt('色コード (例: #2563eb)', '#2563eb') || '#2563eb';
        try {
          await api('POST', '/api/labels', { name: name.trim(), color });
          await loadLabels();
          await addLabel(name.trim());
        } catch (e) { alert('作成失敗: ' + e.message); }
      },
    }, '+ 新規'));
    labelsSec.appendChild(picker);
    info.appendChild(labelsSec);

    // Metadata (including external_id, custom attrs)
    const meta = parseMetadata(contact.metadata);
    if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
      const metaSec = el('div', { class: 'slo-op-info-section' });
      metaSec.appendChild(el('h4', {}, 'カスタム属性'));
      for (const k of Object.keys(meta)) {
        let v = meta[k];
        if (typeof v === 'object') v = JSON.stringify(v);
        metaSec.appendChild(el('div', { class: 'slo-op-info-row' },
          el('span', {}, k),
          el('span', {}, String(v))
        ));
      }
      info.appendChild(metaSec);
    }

    // Past conversations
    const history = state.historyByContact[contact.id] || [];
    const histSec = el('div', { class: 'slo-op-info-section', style: 'padding:12px 0;' });
    histSec.appendChild(el('h4', { style: 'padding:0 16px;' }, `過去の会話 (${history.length})`));
    if (history.length === 0) {
      histSec.appendChild(el('div', { style: 'padding:0 16px;font-size:12px;color:#9ca3af;' }, 'なし'));
    } else {
      for (const h of history) {
        histSec.appendChild(el('div', {
          class: 'slo-op-info-history-item',
          'data-current': h.id === state.selectedId ? '1' : '0',
          onclick: () => { if (h.id !== state.selectedId) selectConversation(h.id); },
        },
          el('div', { class: 'slo-op-info-history-preview' }, h.last_message_preview || '(メッセージなし)'),
          el('div', { class: 'slo-op-info-history-meta' },
            el('span', {},
              el('span', { class: 'slo-op-conv-status', 'data-s': h.status }, h.status)
            ),
            el('span', {}, formatTime(h.last_message_at || h.created_at))
          )
        ));
      }
    }
    info.appendChild(histSec);
  }

  // --- Boot ---
  // --- Search ---
  function openSnoozeDialog(conv) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 60);
    const pad = (n) => String(n).padStart(2, '0');
    const defaultVal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // Build an inline overlay modal — reliable across browsers and pop-up
    // blockers, no cross-window postMessage, no leaked listeners.
    const backdrop = el('div', {
      style: 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:2000;display:flex;align-items:center;justify-content:center;',
      onclick: (ev) => { if (ev.target === backdrop) close(); },
    });
    const card = el('div', { style: 'background:#fff;border-radius:10px;padding:20px;width:320px;box-shadow:0 10px 30px rgba(0,0,0,0.2);' },
      el('h3', { style: 'margin:0 0 12px;font-size:16px;' }, 'スヌーズ終了日時'),
      el('div', { style: 'font-size:12px;color:#6b7280;margin-bottom:8px;' }, 'この時刻まで会話を「スヌーズ中」フィルタに隠します')
    );
    const input = el('input', { type: 'datetime-local', value: defaultVal, style: 'width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;' });
    card.appendChild(input);
    const actions = el('div', { style: 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px;' },
      el('button', { style: 'padding:6px 12px;border:1px solid #d1d5db;background:#fff;border-radius:4px;cursor:pointer;', onclick: () => close() }, 'キャンセル'),
      el('button', {
        style: 'padding:6px 12px;border:none;background:#2563eb;color:#fff;border-radius:4px;cursor:pointer;',
        onclick: () => { const v = input.value; if (v) snoozeConv(new Date(v).toISOString()); close(); },
      }, '設定')
    );
    card.appendChild(actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    input.focus();

    function onKey(ev) { if (ev.key === 'Escape') close(); }
    function close() {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    }
    document.addEventListener('keydown', onKey);
  }

  async function runSearch(q) {
    const results = $('#slo-search-results');
    results.innerHTML = '';
    if (!q || q.length < 1) { results.removeAttribute('data-open'); return; }
    try {
      const r = await api('GET', '/api/search?q=' + encodeURIComponent(q) + '&limit=20');
      results.setAttribute('data-open', '1');
      const convSec = el('div', { class: 'slo-op-search-section' });
      convSec.appendChild(el('h5', {}, `会話 (${r.conversations.length})`));
      for (const c of r.conversations.slice(0, 8)) {
        convSec.appendChild(el('div', {
          class: 'slo-op-search-item',
          onclick: () => {
            $('#slo-search').value = '';
            results.removeAttribute('data-open');
            selectConversation(c.id);
          },
          html: `<b>${escapeHtml(c.contact_name || c.contact_email || c.contact_id.slice(0,8))}</b> — ${escapeHtml((c.last_message_preview || '').slice(0, 120))} <span style="color:#9ca3af;font-size:10px;">${formatTime(c.last_message_at || c.created_at)}</span>`,
        }));
      }
      results.appendChild(convSec);

      const msgSec = el('div', { class: 'slo-op-search-section' });
      msgSec.appendChild(el('h5', {}, `メッセージ (${r.messages.length})`));
      for (const m of r.messages.slice(0, 8)) {
        msgSec.appendChild(el('div', {
          class: 'slo-op-search-item',
          onclick: () => {
            $('#slo-search').value = '';
            results.removeAttribute('data-open');
            selectConversation(m.conversation_id);
          },
          html: `<span style="color:#6b7280;">[${m.sender_type}]</span> ${escapeHtml((m.content || '').slice(0, 180))} <span style="color:#9ca3af;font-size:10px;">${formatTime(m.created_at)}</span>`,
        }));
      }
      results.appendChild(msgSec);

      const ctSec = el('div', { class: 'slo-op-search-section' });
      ctSec.appendChild(el('h5', {}, `ユーザー (${r.contacts.length})`));
      for (const ct of r.contacts.slice(0, 5)) {
        ctSec.appendChild(el('div', {
          class: 'slo-op-search-item',
          html: `<b>${escapeHtml(ct.name || ct.email || ct.phone || ct.id.slice(0,8))}</b> ${ct.email ? '· ' + escapeHtml(ct.email) : ''} ${ct.phone ? '· ' + escapeHtml(ct.phone) : ''}`,
        }));
      }
      results.appendChild(ctSec);

      if (r.conversations.length + r.messages.length + r.contacts.length === 0) {
        results.innerHTML = '<div style="padding:20px;color:#9ca3af;font-size:12px;text-align:center;">該当なし</div>';
      }
    } catch (e) { console.warn('search', e.message); }
  }

  // --- Browser notifications ---
  function notifyNewMessage(conv, msg) {
    if (!state.notifyGranted) return;
    if (document.hasFocus() && state.selectedId === conv.id) return;
    try {
      const contact = state.contactsByConv[conv.id];
      const title = (contact?.name || contact?.email || conv.contact_id.slice(0, 8)) + ' から新着';
      const n = new Notification(title, { body: (msg.content || '').slice(0, 140), tag: conv.id });
      n.onclick = () => { window.focus(); selectConversation(conv.id); n.close(); };
    } catch (_) { /* ignore */ }
  }

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

    // Search wiring
    const searchInput = $('#slo-search');
    searchInput.addEventListener('input', (ev) => {
      clearTimeout(state.searchDebounce);
      const q = ev.target.value;
      state.searchDebounce = setTimeout(() => runSearch(q), 250);
    });
    searchInput.addEventListener('focus', () => {
      if (searchInput.value) runSearch(searchInput.value);
    });
    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('.slo-op-top-search')) {
        $('#slo-search-results').removeAttribute('data-open');
      }
      if (!ev.target.closest('.slo-op-tpl-panel') && !ev.target.closest('.slo-op-compose-toggle button')) {
        if (state.tplOpen) { state.tplOpen = false; if (state.selectedId) renderDetail(); }
      }
    });

    // Browser notifications permission
    if ('Notification' in window) {
      if (Notification.permission === 'granted') state.notifyGranted = true;
      else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((p) => { state.notifyGranted = p === 'granted'; });
      }
    }

    if (await checkAuth()) onAuthenticated();
    else document.body.setAttribute('data-view', 'login');
  }

  async function onAuthenticated() {
    document.body.setAttribute('data-view', 'app');
    renderTop();
    await Promise.all([loadConversations(), loadLabels(), loadTemplates(), loadTeams()]);
    if (state.listTimer) clearInterval(state.listTimer);
    state.listTimer = setInterval(loadConversations, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
