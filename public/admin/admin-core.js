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
    renderToken: 0, // bumped on navigate() so stale fetches can bail out
    cleanup: [],    // [() => void] to run on section switch
  };

  // Section handler registry — populated by section files.
  const sectionHandlers = {};

  // --- Formatting helpers (centralised so tables stay consistent) ---
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return String(iso); }
  }
  function fmtNum(n) {
    if (n == null || isNaN(Number(n))) return '0';
    return Number(n).toLocaleString('ja-JP');
  }
  // Map raw HTTP error text / status code to a human-friendly Japanese line.
  function humanizeError(err) {
    const msg = (err && err.message) ? err.message : String(err || 'error');
    const status = err?.status;
    if (status === 401) return '認証エラー: 再ログインが必要です';
    if (status === 403) return 'アクセス権限がありません';
    if (status === 404) return '対象が見つかりませんでした';
    if (status === 409) return '重複または競合が発生しました';
    if (status === 429) return 'レート制限: 少し待ってから再試行してください';
    if (status >= 500)  return 'サーバーエラー: エラーログをご確認ください';
    // Keep the raw message for 4xx validation issues so field hints propagate.
    return msg;
  }
  function toastErr(err) { (window.Sloten?.toast || alert)(humanizeError(err), { type: 'error' }); }

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
  // Global Escape closes open modal (accessibility).
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && $('#slo-adm-modal').getAttribute('data-open') === '1') closeModal();
  });

  function confirmDialog(msg) { return new Promise((res) => {
    openModal('確認', (form, actions) => {
      form.appendChild(el('p', { style: 'margin:0;color:#374151;' }, msg));
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: () => { closeModal(); res(false); } }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-danger', onclick: () => { closeModal(); res(true); } }, '削除'));
    });
  });}

  // --- Render root ---
  function navigate(section) {
    // Run registered cleanup callbacks (event listeners, timers) before
    // tearing down the old section. Prevents memory leaks + listener
    // accumulation on rapid nav switches.
    for (const fn of state.cleanup.splice(0)) { try { fn(); } catch (_) {} }
    state.renderToken++;
    state.section = section;
    for (const n of $$('.slo-adm-nav-item')) n.toggleAttribute('data-active', n.dataset.section === section);
    render();
  }
  // Renderers call this to check if they are still the active view before
  // mutating `root`. Returns true if stale (caller should bail).
  function isStale(token) { return token !== state.renderToken; }
  function registerCleanup(fn) { state.cleanup.push(fn); }

  async function render() {
    const content = $('#slo-adm-content');
    content.innerHTML = '';
    const handler = sectionHandlers[state.section];
    if (handler) return handler(content);
    content.innerHTML = '<div class="slo-adm-empty">セクション "' + state.section + '" は未実装です</div>';
  }


  // --- Shared helpers (used by section files) ---
  function updateBadge(n) {
    const b = document.getElementById('slo-adm-fq-badge');
    if (!b) return;
    if (n > 0) { b.textContent = n; b.style.display = 'inline-block'; }
    else { b.style.display = 'none'; }
  }

  function downloadCsv(resource) {
    const a = document.createElement('a');
    a.href = API + `/api/export/${resource}.csv`;
    a.rel = 'noopener';
    a.download = `${resource}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function toolbar(placeholder, onSearch, onNew) {
    const tb = el('div', { class: 'slo-adm-sect-toolbar' });
    const input = el('input', { type: 'search', placeholder, oninput: (ev) => onSearch(ev.target.value) });
    tb.appendChild(input);
    if (onNew) tb.appendChild(el('button', { class: 'slo-adm-btn', onclick: onNew }, '+ 新規'));
    return tb;
  }

  // --- FAQ ---

  // --- Expose namespace for section files ---
  const A = window.SlotenAdmin = {
    state, api, el, $, $$, navigate, openModal, closeModal, confirmDialog,
    esc, fmtDate, fmtNum, humanizeError, toastErr, isStale, registerCleanup,
    sectionHandlers, updateBadge, downloadCsv, toolbar,
    section(name, fn) { sectionHandlers[name] = fn; },
  };

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
    // Event delegation — avoids accumulating listeners on repeated renders.
    const nav = document.querySelector('.slo-adm-nav');
    if (nav) nav.addEventListener('click', (ev) => {
      const item = ev.target.closest('.slo-adm-nav-item');
      if (item && item.dataset.section) navigate(item.dataset.section);
    });

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
    $('#slo-adm-top-user').textContent = state.staff.name || state.staff.email;
    const navUser = document.getElementById('slo-adm-nav-user');
    if (navUser) navUser.textContent = state.staff.name || state.staff.email;
    // Prime the pending-count badge
    api('GET', '/api/faq-candidates?status=pending&limit=1').then((r) => updateBadge(r.counts?.pending || 0)).catch(() => {});
    navigate('dashboard');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
