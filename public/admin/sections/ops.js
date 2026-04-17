// admin section: ops
(function() {
  const A = window.SlotenAdmin;
  const { state, api, el, $, $$, navigate, openModal, closeModal, confirmDialog, esc, fmtDate, fmtNum, humanizeError, toastErr, isStale, registerCleanup, downloadCsv, toolbar, updateBadge } = A;

  // --- Conversations (embeds the operator console) ---
  // The admin and the operator share the staff_token cookie, so the iframe
  // boots straight into the conversations view. Every reply admin makes is
  // tagged with their staff id (role=admin), and the operator UI now shows
  // a gold "👑 管理者" badge on those messages.
  function renderConversations(root) {
    root.style.padding = '0';
    root.innerHTML = '';
    const banner = el('div', { style: 'background:#fffbeb;border-bottom:1px solid #fde68a;padding:8px 16px;font-size:12px;color:#92400e;display:flex;justify-content:space-between;align-items:center;' });
    banner.appendChild(el('span', {}, '👑 管理者として返信します — 送信したメッセージは「管理者」バッジ付きで会話に表示されます。'));
    banner.appendChild(el('a', { href: '/operator/', target: '_blank', style: 'color:#92400e;text-decoration:underline;font-weight:600;' }, '別タブで開く ↗'));
    root.appendChild(banner);
    const frame = el('iframe', {
      src: '/operator/',
      style: 'width:100%;border:0;display:block;',
      title: 'オペレーター画面 (管理者として返信)',
    });
    // Fill remaining height. The .slo-adm-content default padding was zeroed
    // above; fall back if running outside the standard shell.
    function size() {
      const top = frame.getBoundingClientRect().top;
      const h = Math.max(400, window.innerHeight - top);
      frame.style.height = h + 'px';
    }
    root.appendChild(frame);
    size();
    window.addEventListener('resize', size);
    // Clean up when the section changes (navigate() runs state.cleanup first).
    registerCleanup(() => {
      window.removeEventListener('resize', size);
      root.style.padding = '';
    });
  }

  // --- Menu tree viewer (mirrors production chatwoot-bot admin "メニュー・メッセージ" tab) ---
  async function renderMenuTree(root) {
    // Inject production-style CSS once.
    if (!document.getElementById('mt-styles')) {
      const css = `
        .mt-search { width:100%; padding:8px 12px; margin-bottom:16px; border:1px solid #d1d5db; border-radius:6px; font-size:14px; }
        .mt-section { margin-bottom:24px; }
        .mt-section-header { font-weight:600; font-size:14px; color:#111827; padding:8px 0; cursor:pointer; display:flex; align-items:center; gap:8px; border-bottom:2px solid #e5e7eb; margin-bottom:8px; user-select:none; background:none; border-top:none; border-left:none; border-right:none; width:100%; text-align:left; font-family:inherit; }
        .mt-section-header:hover { color:#1e40af; }
        .mt-section-header .mt-count { font-size:11px; color:#6b7280; font-weight:400; }
        .mt-section-body { display:none; padding-left:4px; }
        .mt-section-body.open { display:block; }
        .mt-node { position:relative; }
        .mt-children { margin-left:16px; padding-left:12px; border-left:2px solid #e5e7eb; }
        .mt-node-row { display:flex; align-items:center; gap:4px; padding:4px 6px; border-radius:4px; font-size:13px; }
        .mt-node-row:hover { background:#eff6ff; }
        .mt-toggle { width:18px; text-align:center; font-size:10px; color:#6b7280; flex-shrink:0; cursor:pointer; line-height:1; padding:4px 0; user-select:none; background:none; border:none; }
        .mt-toggle:hover { color:#1e40af; }
        .mt-label { flex:1; min-width:0; display:flex; align-items:baseline; gap:6px; overflow:hidden; cursor:pointer; background:none; border:none; padding:0; text-align:left; font-family:inherit; font-size:inherit; color:inherit; }
        .mt-title { font-weight:500; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .mt-key { color:#6b7280; font-size:11px; font-family:monospace; white-space:nowrap; }
        .mt-badge { font-size:10px; padding:1px 5px; border-radius:3px; white-space:nowrap; font-weight:700; margin-left:2px; }
        .mt-badge-gas { background:#fef3c7; color:#854d0e; }
        .mt-badge-bank { background:#dcfce7; color:#14532d; }
        .mt-badge-ec { background:#dbeafe; color:#1e3a8a; }
        .mt-badge-agent { background:#fce7f3; color:#831843; }
        .mt-badge-bonus { background:#fef9c3; color:#713f12; }
        .mt-badge-fwd { background:#ede9fe; color:#4c1d95; }
        .mt-detail { margin:2px 0 6px 28px; padding:12px; background:#f9fafb; border-radius:6px; border-left:3px solid #1e40af; font-size:11px; display:none; }
        .mt-detail.open { display:block; }
        .mt-detail pre { background:#fff; padding:8px; border-radius:4px; border:1px solid #e5e7eb; white-space:pre-wrap; word-wrap:break-word; font-size:11px; margin:4px 0; }
        .mt-ref .mt-node-row { opacity:0.6; }
        .mt-detail table { width:100%; border-collapse:collapse; font-size:11px; margin-top:6px; }
        .mt-detail th, .mt-detail td { padding:3px 6px; border:1px solid #e5e7eb; text-align:left; vertical-align:top; }
        .mt-detail th { background:#f3f4f6; }
        .mt-content-preview { color:#6b7280; font-size:11px; padding-left:24px; margin:-1px 0 2px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; max-width:95%; line-height:1.3; }
        .mt-content-preview:hover { color:#111827; }
        .mt-link { color:#1e40af; cursor:pointer; text-decoration:none; font-family:monospace; font-size:11px; background:none; border:none; padding:0; }
        .mt-link:hover { text-decoration:underline; }
        .mt-nav-type { font-size:11px; color:#6b7280; white-space:nowrap; }
        .mt-node.highlight > .mt-node-row { background:rgba(15,118,110,0.15) !important; transition:background 0.5s; }
        .mt-node.highlight > .mt-content-preview { color:#0f766e; font-weight:600; }
      `;
      const styleEl = document.createElement('style');
      styleEl.id = 'mt-styles';
      styleEl.textContent = css;
      document.head.appendChild(styleEl);
    }

    root.appendChild(el('h2', {}, 'メニュー・メッセージ'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 12px;' },
      'Bot のメニュー階層・ボーナスコード応答・ユーティリティを参照します。読み取り専用 (各種設定の編集は専用画面から)。'));

    const search = el('input', { type: 'search', class: 'mt-search', placeholder: 'キーワードでフィルター...',
      oninput: (ev) => filterTree(ev.target.value.trim().toLowerCase()) });
    root.appendChild(search);

    const container = el('div', {}, el('div', { style: 'color:#9ca3af;' }, '読み込み中…'));
    root.appendChild(container);

    let result;
    try {
      result = await api('GET', '/api/admin/menu-tree');
    } catch (e) {
      container.innerHTML = '';
      container.appendChild(el('div', { style: 'color:#ef4444;' }, 'エラー: ' + e.message));
      return;
    }
    const data = result.data || {};
    container.innerHTML = '';

    // Section: メインメニューフロー
    container.appendChild(makeSection(
      'main', 'メインメニューフロー', true,
      data.mainMenu ? [data.mainMenu] : [],
    ));
    // Section: ボーナスコード応答フロー
    container.appendChild(makeSection(
      'bonus', 'ボーナスコード応答フロー', true,
      data.bonusFlows || [],
    ));
    // Section: テンプレート・その他
    if (data.other && data.other.length) {
      container.appendChild(makeSection(
        'other', 'テンプレート・その他 (ユーティリティ・終端など)', false,
        data.other,
      ));
    }

    function makeSection(id, label, openByDefault, nodes) {
      const sec = el('div', { class: 'mt-section' });
      const chev = el('span', { class: 'mt-chev', style: openByDefault ? 'transform:rotate(90deg);display:inline-block;' : 'display:inline-block;' }, '▶');
      const body = el('div', { class: 'mt-section-body' + (openByDefault ? ' open' : '') });
      const head = el('button', { class: 'mt-section-header', onclick: () => {
        const open = body.classList.toggle('open');
        chev.style.transform = open ? 'rotate(90deg)' : 'none';
      }});
      head.appendChild(chev);
      head.appendChild(document.createTextNode(' ' + label + ' '));
      head.appendChild(el('span', { class: 'mt-count' }, '(' + nodes.length + ')'));
      sec.appendChild(head);
      for (const n of nodes) {
        const ne = nodeEl(n, true);
        if (ne) body.appendChild(ne);
      }
      sec.appendChild(body);
      return sec;
    }

    function badgeFor(flags) {
      const out = [];
      if (!flags) return out;
      if (flags.handoff_to_gasbot)  out.push(el('span', { class: 'mt-badge mt-badge-gas' }, 'GAS'));
      if (flags.handoff_to_bank_bot) out.push(el('span', { class: 'mt-badge mt-badge-bank' }, '銀行'));
      if (flags.handoff_to_ec_bot)   out.push(el('span', { class: 'mt-badge mt-badge-ec' }, 'EC'));
      if (flags.transfer_to_agent)   out.push(el('span', { class: 'mt-badge mt-badge-agent' }, '転送'));
      if (flags.bonus_code)          out.push(el('span', { class: 'mt-badge mt-badge-bonus' }, '🎟️ ボーナス'));
      if (flags.gas_forward)         out.push(el('span', { class: 'mt-badge mt-badge-fwd' }, '→ ' + (flags.gas_type || 'GAS')));
      return out;
    }

    function nodeEl(node, expandedDefault) {
      if (!node) return null;
      const wrap = el('div', { class: 'mt-node' + (node.isRef ? ' mt-ref' : '') });
      wrap.dataset.key = node.key || '';
      const hasChildren = node.children && node.children.length > 0;
      const detail = el('div', { class: 'mt-detail' });
      const childrenWrap = el('div', { class: 'mt-children', style: hasChildren && expandedDefault ? '' : 'display:none;' });

      const row = el('div', { class: 'mt-node-row' });
      const toggle = el('button', { class: 'mt-toggle', onclick: () => {
        if (hasChildren) {
          const showing = childrenWrap.style.display !== 'none';
          childrenWrap.style.display = showing ? 'none' : '';
          toggle.textContent = showing ? '▶' : '▼';
        } else {
          detail.classList.toggle('open');
        }
      }}, hasChildren ? (expandedDefault ? '▼' : '▶') : '📄');
      row.appendChild(toggle);

      const labelBtn = el('button', { class: 'mt-label', onclick: () => detail.classList.toggle('open') });
      labelBtn.appendChild(el('span', { class: 'mt-title' }, node.label || node.key));
      labelBtn.appendChild(el('span', { class: 'mt-key' }, node.key));
      row.appendChild(labelBtn);
      if (node.isRef) row.appendChild(el('span', { class: 'mt-badge', style: 'background:#f3f4f6;color:#6b7280;' }, '参照'));
      else for (const b of badgeFor(node.flags)) row.appendChild(b);
      wrap.appendChild(row);

      if (!node.isRef) {
        const previewLine = (node.content || '').split('\n').filter((l) => l.trim())[0] || '';
        const truncated = previewLine.length > 80 ? previewLine.slice(0, 80) + '…' : previewLine;
        if (truncated) {
          wrap.appendChild(el('div', { class: 'mt-content-preview', onclick: () => detail.classList.toggle('open') }, truncated));
        }

        // Detail panel
        if (node.content) detail.appendChild(el('pre', {}, node.content));
        if (node.flags && node.flags.codes && node.flags.codes.length) {
          detail.appendChild(el('div', { style: 'margin-top:6px;font-size:11px;' },
            el('strong', {}, '受付コード: '),
            node.flags.codes.join(' / '),
            ' ',
            el('span', { style: 'color:#6b7280;' }, '(' + node.flags.match_mode + ')'),
          ));
        }
        if (node.items && node.items.length) {
          const tbl = el('table');
          const thead = el('thead');
          const trh = el('tr');
          trh.appendChild(el('th', {}, 'ボタン'));
          trh.appendChild(el('th', {}, '遷移先'));
          trh.appendChild(el('th', { style: 'width:60px;' }, '種別'));
          thead.appendChild(trh); tbl.appendChild(thead);
          const tbody = el('tbody');
          for (const btn of node.items) {
            const tr = el('tr');
            tr.appendChild(el('td', {}, btn.title || ''));
            const isBack = /[↩⇔↔]/.test(btn.title || '') || btn.value === 'welcome_message';
            const isAgent = btn.value === 'transfer_to_agent';
            const link = el('button', { class: 'mt-link', onclick: () => navigateToKey(btn.value) }, btn.value || '');
            const tdLink = el('td', {});
            tdLink.appendChild(link);
            tr.appendChild(tdLink);
            const typeLabel = isAgent ? '🙋 転送' : isBack ? '🔙 戻る' : '➡️ 遷移';
            tr.appendChild(el('td', { class: 'mt-nav-type' }, typeLabel));
            tbody.appendChild(tr);
          }
          tbl.appendChild(tbody);
          detail.appendChild(tbl);
        }
        wrap.appendChild(detail);
      }

      if (hasChildren) {
        for (const c of node.children) {
          // Children only auto-expand at depth 0; subsequent levels collapsed.
          const child = nodeEl(c, false);
          if (child) childrenWrap.appendChild(child);
        }
      }
      wrap.appendChild(childrenWrap);

      // Search index
      wrap.dataset.searchText = (
        (node.label || '') + ' ' +
        (node.key || '') + ' ' +
        (node.content || '') + ' ' +
        (node.items || []).map((i) => (i.title||'') + ' ' + (i.value||'')).join(' ')
      ).toLowerCase();
      return wrap;
    }

    function navigateToKey(key) {
      // Find any node with data-key=KEY, scroll into view, briefly highlight,
      // and ensure all ancestor children-wraps + section bodies are open.
      const targets = container.querySelectorAll(`[data-key="${CSS.escape(key)}"]`);
      if (!targets.length) {
        (window.Sloten?.toast || alert)('未定義の遷移先: ' + key + ' (テンプレート・その他に存在する可能性)', { type: 'warning' });
        return;
      }
      const target = targets[0];
      // Open ancestors.
      let p = target.parentElement;
      while (p) {
        if (p.classList?.contains('mt-children')) p.style.display = '';
        if (p.classList?.contains('mt-section-body')) p.classList.add('open');
        p = p.parentElement;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('highlight');
      setTimeout(() => target.classList.remove('highlight'), 2000);
    }

    function filterTree(q) {
      if (!q) {
        container.querySelectorAll('.mt-node').forEach((n) => n.style.display = '');
        return;
      }
      container.querySelectorAll('.mt-node').forEach((n) => {
        const txt = n.dataset.searchText || '';
        n.style.display = txt.includes(q) ? '' : 'none';
      });
    }
  }

  // --- Webhook test ---
  async function renderWebhookTest(root) {
    root.appendChild(el('h2', {}, 'Bot テスト'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 16px;' },
      '任意の文字列を送ってボットの応答を確認できます。実会話には残りません。'));
    const presets = ['メニュー', 'スペシャルステップ', 'SAKURA2026', '入金 銀行振込', 'transfer_to_agent'];
    const presetWrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;' });
    const inp = el('input', { id: 'wt-input', class: 'slo-adm-input', placeholder: 'メッセージを入力 (例: メニュー)', style: 'width:100%;padding:8px 12px;font-size:14px;' });
    for (const p of presets) {
      presetWrap.appendChild(el('button', { class: 'slo-adm-btn', onclick: () => { inp.value = p; } }, p));
    }
    root.appendChild(presetWrap);
    root.appendChild(inp);
    const sendBtn = el('button', { class: 'slo-adm-btn slo-adm-btn-primary', style: 'margin-top:12px;', onclick: async () => {
      const message = inp.value.trim();
      if (!message) return;
      out.innerHTML = '<div style="color:#6b7280;">送信中…</div>';
      try {
        const r = await api('POST', '/api/admin/test-bot', { message });
        out.innerHTML = '';
        out.appendChild(el('div', { style: 'background:#1e40af;color:#fff;padding:10px 14px;border-radius:8px;margin-bottom:8px;' }, '👤 ' + message));
        if (!r.bot_replies || !r.bot_replies.length) {
          out.appendChild(el('div', { style: 'color:#6b7280;font-style:italic;' }, '(応答なし — フローやボーナスコードにマッチせず、AI もキーワードを返さなかった可能性)'));
        }
        for (const m of (r.bot_replies || [])) {
          const bubble = el('div', { style: 'background:#fff;border:1px solid #e5e7eb;padding:10px 14px;border-radius:8px;margin-bottom:8px;white-space:pre-wrap;' }, m.content || '');
          if (m.content_attributes) {
            try {
              const attrs = typeof m.content_attributes === 'string' ? JSON.parse(m.content_attributes) : m.content_attributes;
              if (attrs?.items?.length) {
                const opts = el('div', { style: 'margin-top:8px;font-size:12px;color:#6b7280;' }, 'options: ' + attrs.items.map(it => it.title).join(' | '));
                bubble.appendChild(opts);
              }
            } catch (_) {}
          }
          out.appendChild(bubble);
        }
      } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
    }}, '送信');
    root.appendChild(sendBtn);
    const out = el('div', { style: 'margin-top:16px;' });
    root.appendChild(out);
  }

  // --- GAS URLs ---
  async function renderGasUrls(root) {
    root.appendChild(el('h2', {}, 'GAS Webhook URL 設定'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 16px;' },
      'D1 上書き優先 → 静的 secret フォールバック。空にすると上書きを削除し静的 secret に戻ります。'));
    try {
      const r = await api('GET', '/api/admin/gas-urls');
      const t = el('table', { class: 'slo-adm-table' });
      t.appendChild(el('thead', {}, el('tr', {},
        el('th', {}, 'KEY'),
        el('th', {}, '現在の値 (effective)'),
        el('th', {}, 'override'),
        el('th', {}, 'static secret'),
        el('th', {}, '更新者 / 日時'),
        el('th', {}, 'アクション'),
      )));
      const tbody = el('tbody');
      for (const row of (r.urls || [])) {
        const tr = el('tr');
        tr.appendChild(el('td', { style: 'font-family:monospace;font-size:11px;' }, row.key));
        const inp = el('input', { class: 'slo-adm-input', value: row.effective_value || '', style: 'width:100%;font-size:11px;' });
        tr.appendChild(el('td', {}, inp));
        tr.appendChild(el('td', { style: 'font-size:11px;' }, row.has_override ? '✓' : '-'));
        tr.appendChild(el('td', { style: 'font-size:11px;' }, row.has_static_secret ? '✓' : '-'));
        tr.appendChild(el('td', { style: 'font-size:11px;color:#6b7280;' }, row.override_updated_by ? `${row.override_updated_by} / ${fmtDate(row.override_updated_at)}` : '—'));
        const actions = el('div', { style: 'display:flex;gap:6px;' });
        actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: async () => {
          try { await api('POST', '/api/admin/gas-urls', { key: row.key, value: inp.value }); (window.Sloten?.toast||(()=>{}))('保存しました', { type: 'success' }); navigate('gas-urls'); }
          catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
        }}, '保存'));
        actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: async () => {
          try {
            const pingR = await api('POST', '/api/admin/gas-ping', { key: row.key });
            const r2 = pingR.result || {};
            const label = r2.ok ? '疎通成功'
                        : r2.status >= 500 ? 'サーバーエラー'
                        : r2.status === 404 ? '未設定または見つかりません'
                        : r2.status === 401 || r2.status === 403 ? '認証エラー'
                        : r2.error ? '接続エラー'
                        : `HTTP ${r2.status ?? '?'}`;
            const body = (r2.body_snippet || r2.error || '').toString().slice(0, 100);
            (window.Sloten?.toast||alert)(`${label}${body ? ' — ' + body : ''}`, { type: r2.ok ? 'success' : 'error', duration: 6000 });
          } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
        }}, '疎通テスト'));
        if (row.has_override) {
          actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-danger', onclick: async () => {
            if (!(await confirmDialog('override を削除して静的 secret に戻しますか？'))) return;
            try { await api('POST', '/api/admin/gas-urls', { key: row.key, value: '' }); navigate('gas-urls'); }
            catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
          }}, 'override削除'));
        }
        tr.appendChild(el('td', {}, actions));
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      root.appendChild(t);
    } catch (e) {
      root.appendChild(el('div', { style: 'color:#ef4444;' }, e.message));
    }
  }

  // --- Audit log ---
  async function renderAuditLog(root) {
    root.appendChild(el('h2', {}, '監査ログ'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 16px;' }, '管理画面からの操作履歴 (最新200件)'));
    try {
      const r = await api('GET', '/api/admin/audit-log?limit=200');
      const t = el('table', { class: 'slo-adm-table' });
      t.appendChild(el('thead', {}, el('tr', {},
        el('th', {}, '日時'),
        el('th', {}, 'スタッフ'),
        el('th', {}, 'アクション'),
        el('th', {}, 'リソース'),
        el('th', {}, 'IP'),
        el('th', {}, 'payload'),
      )));
      const tbody = el('tbody');
      for (const e of (r.entries || [])) {
        const tr = el('tr');
        tr.appendChild(el('td', { style: 'font-size:11px;' }, fmtDate(e.created_at)));
        tr.appendChild(el('td', { style: 'font-size:12px;' }, e.staff_email || '-'));
        tr.appendChild(el('td', { style: 'font-family:monospace;font-size:11px;' }, e.action));
        tr.appendChild(el('td', { style: 'font-size:11px;' }, [e.resource_type, e.resource_id].filter(Boolean).join(':')));
        tr.appendChild(el('td', { style: 'font-size:11px;color:#6b7280;' }, e.ip || '-'));
        tr.appendChild(el('td', { style: 'font-size:10px;color:#6b7280;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, e.payload || ''));
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      root.appendChild(t);
    } catch (e) { root.appendChild(el('div', { style: 'color:#ef4444;' }, e.message)); }
  }

  // --- Error log ---
  async function renderErrorLog(root) {
    root.appendChild(el('h2', {}, 'エラーログ'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 16px;' }, 'Worker内部エラー (最新100件)'));
    try {
      const r = await api('GET', '/api/admin/error-log?limit=100');
      const t = el('table', { class: 'slo-adm-table' });
      t.appendChild(el('thead', {}, el('tr', {},
        el('th', {}, '日時'),
        el('th', {}, 'source'),
        el('th', {}, 'message'),
        el('th', {}, 'conv'),
      )));
      const tbody = el('tbody');
      for (const e of (r.entries || [])) {
        const tr = el('tr');
        tr.appendChild(el('td', { style: 'font-size:11px;' }, fmtDate(e.created_at)));
        tr.appendChild(el('td', { style: 'font-family:monospace;font-size:11px;' }, e.source));
        tr.appendChild(el('td', { style: 'font-size:11px;' }, e.message));
        tr.appendChild(el('td', { style: 'font-size:10px;color:#6b7280;' }, (e.conversation_id||'').slice(0,8)));
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      root.appendChild(t);
    } catch (e) { root.appendChild(el('div', { style: 'color:#ef4444;' }, e.message)); }
  }

  // --- Backup / Restore ---
  function renderBackup(root) {
    root.appendChild(el('h2', {}, 'バックアップ / リストア'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 16px;' },
      'bot_flows / bonus_codes / faq / templates 等の設定を JSON で出力・復元します。'));
    const backupBtn = el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: async () => {
      try {
        const r = await fetch(API + '/api/admin/backup', { credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `sloten-backup-${Date.now()}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        (window.Sloten?.toast||(()=>{}))('ダウンロードを開始しました', { type: 'success' });
      } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
    }}, '⬇ 全設定をダウンロード');
    root.appendChild(backupBtn);

    root.appendChild(el('h3', { style: 'margin-top:32px;' }, 'リストア'));
    const warn = el('p', { style: 'color:#6b7280;font-size:12px;' },
      '⚠️ 選択したテーブルの ',
      el('strong', { style: 'color:#dc2626;' }, '全行を削除して'),
      ' JSON の内容で置き換えます。事前にバックアップを取ってください。');
    root.appendChild(warn);
    const fileInp = el('input', { type: 'file', accept: '.json' });
    root.appendChild(fileInp);
    const tableSel = el('select', { id: 'restore-table', class: 'slo-adm-input', style: 'margin-left:12px;' });
    for (const t of ['bot_flows','bot_menus','bonus_codes','faq','templates','knowledge_sources','labels','teams','env_overrides','ai_prompts']) {
      tableSel.appendChild(el('option', { value: t }, t));
    }
    root.appendChild(tableSel);
    const restoreBtn = el('button', { class: 'slo-adm-btn slo-adm-btn-danger', style: 'margin-left:12px;', onclick: async () => {
      const f = fileInp.files?.[0];
      if (!f) return (window.Sloten?.toast||alert)('JSONファイルを選択してください', { type: 'warning' });
      const table = tableSel.value;
      if (!(await confirmDialog(`⚠️ ${table} テーブルの全行を削除して、選択した JSON の内容で置き換えます。この操作は取り消せません。続行しますか？`))) return;
      try {
        const text = await f.text();
        const data = JSON.parse(text);
        const rows = (data.tables && data.tables[table]) || data.rows || (Array.isArray(data) ? data : null);
        if (!Array.isArray(rows)) throw new Error('対象テーブルの rows が見つかりません');
        const r = await api('POST', '/api/admin/restore', { table, rows });
        (window.Sloten?.toast||(()=>{}))(`${r.inserted}件 復元しました`, { type: 'success' });
      } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
    }}, 'リストア実行');
    root.appendChild(restoreBtn);
  }

  // --- Export section ---
  function renderExport(root) {
    root.appendChild(el('h2', {}, 'エクスポート'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin-bottom:16px;' },
      'UTF-8 (BOM 付き) CSV で出力します。Excel で直接開けます。'));
    const tiles = el('div', { class: 'slo-adm-tiles' });
    const entries = [
      ['conversations', '会話'],
      ['messages', 'メッセージ'],
      ['contacts', 'コンタクト'],
      ['faq', 'FAQ'],
      ['templates', 'テンプレート'],
      ['knowledge', 'ナレッジ'],
      ['staff', 'スタッフ'],
      ['ai_logs', 'AI ログ'],
    ];
    for (const [res, label] of entries) {
      const tile = el('div', { class: 'slo-adm-tile', style: 'cursor:pointer;', onclick: () => downloadCsv(res) },
        el('div', { class: 'slo-adm-tile-label' }, label),
        el('div', { class: 'slo-adm-tile-value', style: 'font-size:14px;color:#2563eb;' }, '📥 ダウンロード'));
      tiles.appendChild(tile);
    }
    root.appendChild(tiles);
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
    // Bot ステータス stats (parity with production chatwoot-bot admin).
    try {
      root.appendChild(el('h3', { style: 'margin-top:24px;' }, 'Bot ステータス'));
      const btr = await api('GET', '/api/admin/menu-tree');
      const bs = btr.stats || {};
      const tiles2 = el('div', { class: 'slo-adm-tiles' });
      const tile = (label, val, sub) => el('div', { class: 'slo-adm-tile' },
        el('div', { class: 'slo-adm-tile-label' }, label),
        el('div', { class: 'slo-adm-tile-value' }, String(val)),
        sub ? el('div', { class: 'slo-adm-tile-sub' }, sub) : null);
      tiles2.appendChild(tile('メニュー ステップ', bs.menu_steps, `アクティブ flow ${bs.flows_active}`));
      tiles2.appendChild(tile('ボーナスコード 種別', bs.bonus_codes_enabled, `全 ${bs.bonus_codes} 種 (無効含む)`));
      tiles2.appendChild(tile('GAS 連携', bs.gas_urls_configured, `有効な URL 数`));
      root.appendChild(tiles2);
    } catch (_) { /* non-fatal */ }
  }

  // --- Generic table helpers ---
  // --- FAQ ---

  // --- Register sections ---
  A.section('conversations', renderConversations);
  A.section('menu-tree', renderMenuTree);
  A.section('webhook-test', renderWebhookTest);
  A.section('gas-urls', renderGasUrls);
  A.section('audit-log', renderAuditLog);
  A.section('error-log', renderErrorLog);
  A.section('backup', renderBackup);
  A.section('export', renderExport);
  A.section('dashboard', renderDashboard);
})();
