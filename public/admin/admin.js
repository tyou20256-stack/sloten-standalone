// Sloten Admin Console — SPA vanilla JS.

(function () {
  'use strict';
  const API = window.location.origin;
  const state = {
    staff: null,
    section: 'dashboard',
    data: {},       // per-section cached data
    labels: [],     // shared
    searchFilter: {},// section -> string
  };

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    for (const c of children) {
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    try { const r = await api('GET', '/api/staff/me'); state.staff = r.staff; return r.staff; }
    catch { return null; }
  }
  async function login(email, password) {
    const r = await api('POST', '/api/staff/login', { email, password });
    state.staff = r.staff;
  }
  async function logout() {
    try { await api('POST', '/api/staff/logout'); } catch (_) {}
    state.staff = null;
    document.body.setAttribute('data-view', 'login');
    $('#slo-adm-login-email').value = '';
    $('#slo-adm-login-password').value = '';
  }
  window.SlotenAdmin = { logout };

  // --- Modal ---
  function openModal(title, contentFn, opts = {}) {
    const body = $('#slo-adm-modal-body');
    body.innerHTML = '';
    body.appendChild(el('h3', {}, title));
    const form = el('form', { onsubmit: (ev) => ev.preventDefault() });
    body.appendChild(form);
    const actions = el('div', { class: 'slo-adm-modal-actions' });
    contentFn(form, actions);
    body.appendChild(actions);
    $('#slo-adm-modal').setAttribute('data-open', '1');
  }
  function closeModal() { $('#slo-adm-modal').removeAttribute('data-open'); }
  $('#slo-adm-modal').addEventListener('click', (ev) => { if (ev.target.id === 'slo-adm-modal') closeModal(); });

  function confirmDialog(msg) { return new Promise((res) => {
    openModal('確認', (form, actions) => {
      form.appendChild(el('p', { style: 'margin:0;color:#374151;' }, msg));
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: () => { closeModal(); res(false); } }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-danger', onclick: () => { closeModal(); res(true); } }, '削除'));
    });
  });}

  // --- Render root ---
  function navigate(section) {
    state.section = section;
    for (const n of $$('.slo-adm-nav-item')) n.toggleAttribute('data-active', n.dataset.section === section);
    render();
  }

  async function render() {
    const content = $('#slo-adm-content');
    content.innerHTML = '';
    if (state.section === 'dashboard') return renderDashboard(content);
    if (state.section === 'faq') return renderFaq(content);
    if (state.section === 'templates') return renderTemplates(content);
    if (state.section === 'knowledge') return renderKnowledge(content);
    if (state.section === 'labels') return renderLabels(content);
    if (state.section === 'staff') return renderStaff(content);
  }

  // --- Dashboard ---
  async function renderDashboard(root) {
    root.appendChild(el('h2', {}, 'ダッシュボード'));
    const loading = el('div', { style: 'color:#9ca3af;' }, '読み込み中…');
    root.appendChild(loading);
    try {
      const r = await api('GET', '/api/dashboard/stats');
      const s = r.stats;
      loading.remove();
      const tiles = el('div', { class: 'slo-adm-tiles' });
      const tile = (label, val, sub) => el('div', { class: 'slo-adm-tile' },
        el('div', { class: 'slo-adm-tile-label' }, label),
        el('div', { class: 'slo-adm-tile-value' }, String(val)),
        sub ? el('div', { class: 'slo-adm-tile-sub' }, sub) : null);
      tiles.appendChild(tile('会話 (合計)', s.conversations.total, `ボット ${s.conversations.bot} / 対応中 ${s.conversations.open} / 解決済 ${s.conversations.closed}`));
      tiles.appendChild(tile('メッセージ (24h)', s.messages_24h, `7 日累計 ${s.messages_7d}`));
      tiles.appendChild(tile('コンタクト', s.contact_count));
      tiles.appendChild(tile('FAQ', s.faq_count));
      tiles.appendChild(tile('テンプレート', s.template_count));
      tiles.appendChild(tile('ナレッジ', s.knowledge_count));
      tiles.appendChild(tile('ラベル', s.label_count));
      tiles.appendChild(tile('スタッフ (有効)', s.staff_count));
      root.appendChild(tiles);
    } catch (e) {
      loading.textContent = 'エラー: ' + e.message;
    }
  }

  // --- Generic table helpers ---
  function toolbar(placeholder, onSearch, onNew) {
    const tb = el('div', { class: 'slo-adm-sect-toolbar' });
    const input = el('input', { type: 'search', placeholder, oninput: (ev) => onSearch(ev.target.value) });
    tb.appendChild(input);
    if (onNew) tb.appendChild(el('button', { class: 'slo-adm-btn', onclick: onNew }, '+ 新規'));
    return tb;
  }

  // --- FAQ ---
  async function renderFaq(root) {
    root.appendChild(el('h2', {}, 'FAQ'));
    root.appendChild(toolbar('質問・回答・カテゴリで絞り込み…', (q) => { state.searchFilter.faq = q; renderFaqTable(listDiv); }, () => faqModal()));
    const listDiv = el('div');
    root.appendChild(listDiv);
    try {
      const r = await api('GET', '/api/faq');
      state.data.faq = r.faqs || r.faq || [];
      renderFaqTable(listDiv);
    } catch (e) { listDiv.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderFaqTable(root) {
    root.innerHTML = '';
    const q = (state.searchFilter.faq || '').toLowerCase();
    const rows = (state.data.faq || []).filter((r) => !q
      || (r.question || '').toLowerCase().includes(q)
      || (r.answer || '').toLowerCase().includes(q)
      || (r.category || '').toLowerCase().includes(q));
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, '該当する FAQ はありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    const head = el('tr', {},
      el('th', { style: 'width:40%' }, '質問'),
      el('th', {}, 'カテゴリ'),
      el('th', { style: 'width:80px' }, '優先度'),
      el('th', { style: 'width:80px' }, '有効'),
      el('th', { style: 'width:140px' }, ''));
    table.appendChild(el('thead', {}, head));
    const tbody = el('tbody');
    for (const r of rows) {
      tbody.appendChild(el('tr', {},
        el('td', {}, (r.question || '').slice(0, 120)),
        el('td', {}, r.category || '—'),
        el('td', {}, String(r.priority ?? 0)),
        el('td', {}, el('span', { class: 'slo-adm-badge', 'data-active': String(r.is_active ?? 1) }, r.is_active ? '有効' : '無効')),
        el('td', {}, el('div', { class: 'slo-adm-row-actions' },
          el('button', { onclick: () => faqModal(r) }, '編集'),
          el('button', { class: 'danger', onclick: () => deleteFaq(r.id) }, '削除')))
      ));
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }
  function faqModal(row) {
    openModal(row ? 'FAQ 編集' : 'FAQ 新規', (form, actions) => {
      form.appendChild(el('label', {}, '質問'));
      const q = el('input', { value: row?.question || '', required: '' }); form.appendChild(q);
      form.appendChild(el('label', {}, '回答'));
      const a = el('textarea', {}, row?.answer || ''); form.appendChild(a);
      form.appendChild(el('label', {}, 'カテゴリ'));
      const cat = el('input', { value: row?.category || '' }); form.appendChild(cat);
      form.appendChild(el('label', {}, '優先度 (数値)'));
      const pri = el('input', { type: 'number', value: String(row?.priority ?? 0) }); form.appendChild(pri);
      form.appendChild(el('label', {}, '有効'));
      const act = el('select', {},
        el('option', { value: '1' }, '有効'),
        el('option', { value: '0' }, '無効'));
      act.value = (row?.is_active ?? 1) ? '1' : '0';
      form.appendChild(act);

      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: async () => {
        const body = { question: q.value, answer: a.value, category: cat.value || null, priority: parseInt(pri.value || '0', 10), is_active: act.value === '1' ? 1 : 0 };
        try {
          if (row) await api('PUT', `/api/faq/${row.id}`, body);
          else     await api('POST', '/api/faq', Object.assign({ tenant_id: 'tenant_default' }, body));
          closeModal(); navigate('faq');
        } catch (e) { alert(e.message); }
      } }, '保存'));
    });
  }
  async function deleteFaq(id) {
    if (!(await confirmDialog('この FAQ を削除しますか？'))) return;
    try { await api('DELETE', `/api/faq/${id}`); navigate('faq'); } catch (e) { alert(e.message); }
  }

  // --- Templates ---
  async function renderTemplates(root) {
    root.appendChild(el('h2', {}, 'テンプレート'));
    root.appendChild(toolbar('名前・本文・カテゴリで絞り込み…', (q) => { state.searchFilter.tpl = q; renderTplTable(listDiv); }, () => tplModal()));
    const listDiv = el('div');
    root.appendChild(listDiv);
    try {
      const r = await api('GET', '/api/templates?tenant_id=tenant_default');
      state.data.templates = r.templates || [];
      renderTplTable(listDiv);
    } catch (e) { listDiv.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderTplTable(root) {
    root.innerHTML = '';
    const q = (state.searchFilter.tpl || '').toLowerCase();
    const rows = (state.data.templates || []).filter((r) => !q
      || (r.name || '').toLowerCase().includes(q)
      || (r.content || '').toLowerCase().includes(q)
      || (r.category || '').toLowerCase().includes(q));
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, '該当するテンプレートはありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:25%' }, '名前'),
      el('th', {}, '本文'),
      el('th', { style: 'width:100px' }, '使用数'),
      el('th', { style: 'width:140px' }, ''))));
    const tbody = el('tbody');
    for (const r of rows) {
      tbody.appendChild(el('tr', {},
        el('td', {}, r.name || ''),
        el('td', {}, (r.content || '').slice(0, 140)),
        el('td', {}, String(r.usage_count ?? r.use_count ?? 0)),
        el('td', {}, el('div', { class: 'slo-adm-row-actions' },
          el('button', { onclick: () => tplModal(r) }, '編集'),
          el('button', { class: 'danger', onclick: () => deleteTpl(r.id) }, '削除')))
      ));
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }
  function tplModal(row) {
    openModal(row ? 'テンプレート編集' : 'テンプレート新規', (form, actions) => {
      form.appendChild(el('label', {}, '名前'));
      const n = el('input', { value: row?.name || '', required: '' }); form.appendChild(n);
      form.appendChild(el('label', {}, 'カテゴリ'));
      const cat = el('input', { value: row?.category || '' }); form.appendChild(cat);
      form.appendChild(el('label', {}, 'ショートカット (例: /hello)'));
      const sc = el('input', { value: row?.shortcut || '' }); form.appendChild(sc);
      form.appendChild(el('label', {}, '本文'));
      const c = el('textarea', { style: 'min-height:160px;' }, row?.content || ''); form.appendChild(c);
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: async () => {
        const body = { name: n.value, category: cat.value || null, shortcut: sc.value || null, content: c.value, tenant_id: 'tenant_default' };
        try {
          if (row) await api('PUT', `/api/templates/${row.id}`, body);
          else     await api('POST', '/api/templates', body);
          closeModal(); navigate('templates');
        } catch (e) { alert(e.message); }
      } }, '保存'));
    });
  }
  async function deleteTpl(id) {
    if (!(await confirmDialog('このテンプレートを削除しますか？'))) return;
    try { await api('DELETE', `/api/templates/${id}`); navigate('templates'); } catch (e) { alert(e.message); }
  }

  // --- Knowledge sources ---
  async function renderKnowledge(root) {
    root.appendChild(el('h2', {}, 'ナレッジベース'));
    root.appendChild(toolbar('タイトル・内容で絞り込み…', (q) => { state.searchFilter.kb = q; renderKbTable(listDiv); }, () => kbModal()));
    const listDiv = el('div');
    root.appendChild(listDiv);
    try {
      const r = await api('GET', '/api/knowledge-sources');
      state.data.kb = r.sources || r.knowledge_sources || r.results || [];
      renderKbTable(listDiv);
    } catch (e) { listDiv.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderKbTable(root) {
    root.innerHTML = '';
    const q = (state.searchFilter.kb || '').toLowerCase();
    const rows = (state.data.kb || []).filter((r) => !q
      || (r.title || '').toLowerCase().includes(q)
      || (r.content || '').toLowerCase().includes(q)
      || (r.category || '').toLowerCase().includes(q));
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, 'ナレッジはありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:30%' }, 'タイトル'),
      el('th', {}, '内容 (先頭)'),
      el('th', { style: 'width:100px' }, 'カテゴリ'),
      el('th', { style: 'width:80px' }, '有効'),
      el('th', { style: 'width:140px' }, ''))));
    const tbody = el('tbody');
    for (const r of rows) {
      tbody.appendChild(el('tr', {},
        el('td', {}, r.title || '—'),
        el('td', {}, (r.content || '').replace(/\s+/g, ' ').slice(0, 140)),
        el('td', {}, r.category || '—'),
        el('td', {}, el('span', { class: 'slo-adm-badge', 'data-active': String(r.is_active ?? 1) }, r.is_active ? '有効' : '無効')),
        el('td', {}, el('div', { class: 'slo-adm-row-actions' },
          el('button', { onclick: () => kbModal(r) }, '編集'),
          el('button', { class: 'danger', onclick: () => deleteKb(r.id) }, '削除')))
      ));
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }
  function kbModal(row) {
    openModal(row ? 'ナレッジ編集' : 'ナレッジ新規', (form, actions) => {
      form.appendChild(el('label', {}, 'タイトル'));
      const t = el('input', { value: row?.title || '' }); form.appendChild(t);
      form.appendChild(el('label', {}, 'URL (任意)'));
      const u = el('input', { value: row?.url || '' }); form.appendChild(u);
      form.appendChild(el('label', {}, 'カテゴリ'));
      const cat = el('input', { value: row?.category || 'general' }); form.appendChild(cat);
      form.appendChild(el('label', {}, '本文 (Markdown / プレーン)'));
      const c = el('textarea', { style: 'min-height:240px;' }, row?.content || ''); form.appendChild(c);
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: async () => {
        const body = { title: t.value, url: u.value || null, category: cat.value || 'general', content: c.value, source_type: row?.source_type || 'manual' };
        try {
          if (row) await api('PUT', `/api/knowledge-sources/${row.id}`, body);
          else     await api('POST', '/api/knowledge-sources', body);
          closeModal(); navigate('knowledge');
        } catch (e) { alert(e.message); }
      } }, '保存'));
    });
  }
  async function deleteKb(id) {
    if (!(await confirmDialog('このナレッジを削除しますか？'))) return;
    try { await api('DELETE', `/api/knowledge-sources/${id}`); navigate('knowledge'); } catch (e) { alert(e.message); }
  }

  // --- Labels ---
  async function renderLabels(root) {
    root.appendChild(el('h2', {}, 'ラベル'));
    root.appendChild(toolbar('名前で絞り込み…', (q) => { state.searchFilter.lb = q; renderLabelsTable(listDiv); }, () => labelModal()));
    const listDiv = el('div');
    root.appendChild(listDiv);
    try {
      const r = await api('GET', '/api/labels');
      state.data.labels = r.labels || [];
      renderLabelsTable(listDiv);
    } catch (e) { listDiv.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderLabelsTable(root) {
    root.innerHTML = '';
    const q = (state.searchFilter.lb || '').toLowerCase();
    const rows = (state.data.labels || []).filter((r) => !q || (r.name || '').toLowerCase().includes(q));
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, 'ラベルはありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:25%' }, '名前'),
      el('th', { style: 'width:100px' }, '色'),
      el('th', {}, '説明'),
      el('th', { style: 'width:140px' }, ''))));
    const tbody = el('tbody');
    for (const r of rows) {
      tbody.appendChild(el('tr', {},
        el('td', {}, el('span', { class: 'slo-adm-color', style: `background:${r.color}` }), r.name),
        el('td', {}, r.color || ''),
        el('td', {}, r.description || '—'),
        el('td', {}, el('div', { class: 'slo-adm-row-actions' },
          el('button', { onclick: () => labelModal(r) }, '編集'),
          el('button', { class: 'danger', onclick: () => deleteLabel(r.id) }, '削除')))
      ));
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }
  function labelModal(row) {
    openModal(row ? 'ラベル編集' : 'ラベル新規', (form, actions) => {
      form.appendChild(el('label', {}, '名前'));
      const n = el('input', { value: row?.name || '' }); form.appendChild(n);
      form.appendChild(el('label', {}, '色 (#RRGGBB)'));
      const c = el('input', { value: row?.color || '#2563eb', type: 'color' }); form.appendChild(c);
      form.appendChild(el('label', {}, '説明 (任意)'));
      const d = el('input', { value: row?.description || '' }); form.appendChild(d);
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: async () => {
        const body = { name: n.value.trim(), color: c.value, description: d.value || null };
        try {
          if (row) await api('PUT', `/api/labels/${row.id}`, body);
          else     await api('POST', '/api/labels', body);
          closeModal(); navigate('labels');
        } catch (e) { alert(e.message); }
      } }, '保存'));
    });
  }
  async function deleteLabel(id) {
    if (!(await confirmDialog('このラベルを削除しますか？ 会話のラベル参照も削除されます。'))) return;
    try { await api('DELETE', `/api/labels/${id}`); navigate('labels'); } catch (e) { alert(e.message); }
  }

  // --- Staff ---
  async function renderStaff(root) {
    root.appendChild(el('h2', {}, 'スタッフ'));
    root.appendChild(toolbar('メール・名前で絞り込み…', (q) => { state.searchFilter.st = q; renderStaffTable(listDiv); }, () => staffModal()));
    const listDiv = el('div');
    root.appendChild(listDiv);
    try {
      const r = await api('GET', '/api/staff');
      state.data.staff = r.staff || [];
      renderStaffTable(listDiv);
    } catch (e) { listDiv.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderStaffTable(root) {
    root.innerHTML = '';
    const q = (state.searchFilter.st || '').toLowerCase();
    const rows = (state.data.staff || []).filter((r) => !q
      || (r.email || '').toLowerCase().includes(q)
      || (r.name || '').toLowerCase().includes(q));
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, 'スタッフがいません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:30%' }, 'メール'),
      el('th', {}, '名前'),
      el('th', { style: 'width:90px' }, 'ロール'),
      el('th', { style: 'width:80px' }, '有効'),
      el('th', { style: 'width:140px' }, '最終ログイン'),
      el('th', { style: 'width:220px' }, ''))));
    const tbody = el('tbody');
    for (const r of rows) {
      tbody.appendChild(el('tr', {},
        el('td', {}, r.email),
        el('td', {}, r.name || '—'),
        el('td', {}, el('span', { class: 'slo-adm-badge', 'data-role': r.role }, r.role)),
        el('td', {}, el('span', { class: 'slo-adm-badge', 'data-active': String(r.is_active ?? 0) }, r.is_active ? '有効' : '無効')),
        el('td', {}, r.last_login_at || '—'),
        el('td', {}, el('div', { class: 'slo-adm-row-actions' },
          el('button', { onclick: () => staffModal(r) }, '編集'),
          el('button', { onclick: () => resetPassword(r) }, 'PW再発行'),
          el('button', {
            class: 'danger',
            onclick: () => deleteStaff(r),
            disabled: r.id === state.staff?.id ? '' : null,
          }, '削除')))
      ));
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }
  function staffModal(row) {
    openModal(row ? 'スタッフ編集' : 'スタッフ追加', (form, actions) => {
      form.appendChild(el('label', {}, 'メール' + (row ? ' (変更不可)' : '')));
      const em = el('input', { type: 'email', value: row?.email || '' });
      if (row) em.setAttribute('disabled', '');
      form.appendChild(em);
      form.appendChild(el('label', {}, '名前'));
      const nm = el('input', { value: row?.name || '' }); form.appendChild(nm);
      form.appendChild(el('label', {}, 'ロール'));
      const role = el('select', {},
        el('option', { value: 'admin' }, 'admin'),
        el('option', { value: 'agent' }, 'agent'),
        el('option', { value: 'viewer' }, 'viewer'));
      role.value = row?.role || 'agent';
      form.appendChild(role);
      form.appendChild(el('label', {}, '有効'));
      const act = el('select', {},
        el('option', { value: '1' }, '有効'),
        el('option', { value: '0' }, '無効'));
      act.value = (row?.is_active ?? 1) ? '1' : '0';
      form.appendChild(act);

      if (!row) {
        form.appendChild(el('div', { style: 'margin-top:12px;font-size:12px;color:#6b7280;' },
          '追加するとパスワードが自動発行されます。モーダル上で一度だけ表示するので、必ず保存してください。'));
      }

      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: async () => {
        try {
          if (row) {
            await api('PATCH', `/api/staff/${row.id}`, { name: nm.value, role: role.value, is_active: act.value === '1' ? 1 : 0 });
            closeModal(); navigate('staff');
          } else {
            const r = await api('POST', '/api/staff', { email: em.value.trim(), name: nm.value.trim(), role: role.value });
            showGeneratedPassword(r.staff.email, r.password, () => { closeModal(); navigate('staff'); });
          }
        } catch (e) { alert(e.message); }
      } }, row ? '保存' : '追加'));
    });
  }
  async function resetPassword(row) {
    if (!(await confirmDialog(`${row.email} のパスワードを再発行しますか？`))) return;
    try {
      const r = await api('POST', `/api/staff/${row.id}/reset_password`);
      showGeneratedPassword(r.email, r.password);
    } catch (e) { alert(e.message); }
  }
  async function deleteStaff(row) {
    if (row.id === state.staff?.id) { alert('自分自身は削除できません。'); return; }
    if (!(await confirmDialog(`${row.email} を削除しますか？担当していた会話は未割当になります。`))) return;
    try { await api('DELETE', `/api/staff/${row.id}`); navigate('staff'); } catch (e) { alert(e.message); }
  }
  function showGeneratedPassword(email, password, onClose) {
    openModal('パスワード発行', (form, actions) => {
      form.appendChild(el('p', { style: 'margin:0 0 8px;color:#374151;' }, `${email} の新しいパスワード:`));
      form.appendChild(el('div', { class: 'slo-adm-password-box' },
        el('strong', {}, 'コピーしてスタッフに安全に渡してください'),
        password));
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: () => { closeModal(); if (onClose) onClose(); } }, '閉じる'));
    });
  }

  // --- Boot ---
  async function boot() {
    $('#slo-adm-login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = $('#slo-adm-login-email').value.trim();
      const password = $('#slo-adm-login-password').value;
      const errEl = $('#slo-adm-login-err');
      errEl.removeAttribute('data-visible');
      try {
        await login(email, password);
        await onAuthenticated();
      } catch (e) {
        errEl.textContent = e.message || 'ログインに失敗しました';
        errEl.setAttribute('data-visible', '1');
      }
    });
    $('#slo-adm-logout').addEventListener('click', logout);
    for (const n of $$('.slo-adm-nav-item')) n.addEventListener('click', () => navigate(n.dataset.section));

    const s = await checkAuth();
    if (s) await onAuthenticated();
    else document.body.setAttribute('data-view', 'login');
  }
  async function onAuthenticated() {
    if (state.staff?.role !== 'admin') {
      document.body.setAttribute('data-view', 'forbidden');
      return;
    }
    document.body.setAttribute('data-view', 'app');
    $('#slo-adm-top-user').textContent = `${state.staff.name || state.staff.email}`;
    navigate('dashboard');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
