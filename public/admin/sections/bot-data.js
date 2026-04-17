// admin section: bot-data (Prompts + Teams + AI logs + Bonus codes + Submissions)
(function() {
  const A = window.SlotenAdmin;
  const { state, api, el, $, $$, navigate, openModal, closeModal, confirmDialog, esc, fmtDate, fmtNum, humanizeError, toastErr, isStale, registerCleanup, downloadCsv, toolbar, updateBadge } = A;

  // --- Prompts (A/B) ---
  async function renderPrompts(root) {
    root.appendChild(el('h2', {}, 'プロンプト (A/B テスト)'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 16px;' },
      '有効なプロンプトから weight 加重ランダムで選択されます。各プロンプトの 👍/👎 率で比較判断してください。'));
    const tb = el('div', { class: 'slo-adm-sect-toolbar' },
      el('button', { class: 'slo-adm-btn', onclick: () => promptModal() }, '+ 新規'));
    root.appendChild(tb);
    const listDiv = el('div');
    root.appendChild(listDiv);
    try {
      const r = await api('GET', '/api/ai-prompts');
      state.data.prompts = r.prompts || [];
      renderPromptsTable(listDiv);
    } catch (e) { listDiv.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderPromptsTable(root) {
    root.innerHTML = '';
    const rows = state.data.prompts || [];
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, 'プロンプトがありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:25%' }, '名前'),
      el('th', {}, '説明 / 先頭'),
      el('th', { style: 'width:90px' }, 'weight'),
      el('th', { style: 'width:80px' }, '有効'),
      el('th', { style: 'width:140px' }, '👍 / 👎 / 呼出'),
      el('th', { style: 'width:140px' }, ''))));
    const tbody = el('tbody');
    for (const r of rows) {
      const upRatio = r.stats && (r.stats.up + r.stats.down) > 0 ? Math.round(100 * r.stats.up / (r.stats.up + r.stats.down)) : null;
      tbody.appendChild(el('tr', {},
        el('td', {}, r.name),
        el('td', {}, (r.description || r.system_prompt || '').slice(0, 100)),
        el('td', {}, String(r.weight)),
        el('td', {}, el('span', { class: 'slo-adm-badge', 'data-active': String(r.is_active ?? 0) }, r.is_active ? '有効' : '無効')),
        el('td', {}, r.stats ? `👍${r.stats.up} / 👎${r.stats.down} / ${r.stats.calls}${upRatio != null ? ` (${upRatio}%)` : ''}` : '—'),
        el('td', {}, el('div', { class: 'slo-adm-row-actions' },
          el('button', { onclick: () => promptModal(r) }, '編集'),
          el('button', { class: 'danger', onclick: () => deletePrompt(r.id) }, '削除')))
      ));
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }
  function promptModal(row) {
    openModal(row ? 'プロンプト編集' : 'プロンプト新規', (form, actions) => {
      form.appendChild(el('label', {}, '名前'));
      const n = el('input', { value: row?.name || '' }); form.appendChild(n);
      form.appendChild(el('label', {}, '説明 (任意)'));
      const d = el('input', { value: row?.description || '' }); form.appendChild(d);
      form.appendChild(el('label', {}, 'system_prompt'));
      const sp = el('textarea', { style: 'min-height:200px;font-family:ui-monospace,monospace;font-size:12px;' }, row?.system_prompt || ''); form.appendChild(sp);
      form.appendChild(el('label', {}, 'weight (0-100)'));
      const w = el('input', { type: 'number', value: String(row?.weight ?? 50), min: '0', max: '100' }); form.appendChild(w);
      form.appendChild(el('label', {}, '有効'));
      const act = el('select', {},
        el('option', { value: '1' }, '有効'),
        el('option', { value: '0' }, '無効'));
      act.value = (row?.is_active ?? 1) ? '1' : '0';
      form.appendChild(act);

      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: async () => {
        const body = {
          name: n.value.trim(), description: d.value || null, system_prompt: sp.value,
          weight: parseInt(w.value, 10), is_active: act.value === '1' ? 1 : 0,
        };
        try {
          if (row) await api('PATCH', `/api/ai-prompts/${row.id}`, body);
          else     await api('POST', '/api/ai-prompts', body);
          closeModal(); navigate('prompts');
        } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
      } }, '保存'));
    });
  }
  async function deletePrompt(id) {
    if (!(await confirmDialog('このプロンプトを削除しますか？'))) return;
    try { await api('DELETE', `/api/ai-prompts/${id}`); navigate('prompts'); } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
  }

  // --- Teams ---
  async function renderTeams(root) {
    root.appendChild(el('h2', {}, 'チーム'));
    const tb = el('div', { class: 'slo-adm-sect-toolbar' },
      el('button', { class: 'slo-adm-btn', onclick: () => teamModal() }, '+ 新規'));
    root.appendChild(tb);
    const listDiv = el('div');
    root.appendChild(listDiv);
    try {
      const [teams, staff] = await Promise.all([
        api('GET', '/api/teams'),
        api('GET', '/api/staff'),
      ]);
      state.data.teams = teams.teams || [];
      state.data.staffForTeams = staff.staff || [];
      renderTeamsTable(listDiv);
    } catch (e) { listDiv.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderTeamsTable(root) {
    root.innerHTML = '';
    const rows = state.data.teams || [];
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, 'チームがありません')); return; }
    for (const t of rows) {
      const card = el('div', { style: 'background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;' });
      const header = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' },
        el('div', {},
          el('div', { style: 'font-weight:600;font-size:15px;' }, t.name),
          el('div', { style: 'font-size:12px;color:#6b7280;' }, t.description || '—')),
        el('div', {},
          el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', style: 'margin-right:4px;', onclick: () => teamModal(t) }, '編集'),
          el('button', { class: 'slo-adm-btn slo-adm-btn-danger', onclick: () => deleteTeam(t.id) }, '削除'))
      );
      card.appendChild(header);

      card.appendChild(el('div', { style: 'font-size:11px;color:#6b7280;margin-top:12px;text-transform:uppercase;' }, `メンバー (${t.members.length})`));
      const memRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;' });
      for (const m of t.members) {
        memRow.appendChild(el('span', { style: 'display:inline-flex;align-items:center;gap:4px;background:#eff6ff;color:#1e40af;padding:3px 8px;border-radius:10px;font-size:12px;' },
          `${m.name || m.email} (${m.role})`,
          el('button', { style: 'border:none;background:transparent;color:#1e40af;cursor:pointer;padding:0;font-size:13px;', onclick: () => removeTeamMember(t.id, m.id) }, '×')
        ));
      }
      const select = el('select', { style: 'margin-left:6px;font-size:12px;padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;' },
        el('option', { value: '' }, '+ メンバー追加'));
      const currentIds = new Set(t.members.map((m) => m.id));
      for (const s of (state.data.staffForTeams || [])) {
        if (!currentIds.has(s.id)) select.appendChild(el('option', { value: String(s.id) }, `${s.name || s.email} (${s.role})`));
      }
      select.addEventListener('change', async () => {
        if (!select.value) return;
        try { await api('POST', `/api/teams/${t.id}/members`, { staff_id: parseInt(select.value, 10) }); navigate('teams'); }
        catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
      });
      memRow.appendChild(select);
      card.appendChild(memRow);
      root.appendChild(card);
    }
  }
  function teamModal(row) {
    openModal(row ? 'チーム編集' : 'チーム新規', (form, actions) => {
      form.appendChild(el('label', {}, '名前'));
      const n = el('input', { value: row?.name || '' }); form.appendChild(n);
      form.appendChild(el('label', {}, '説明'));
      const d = el('input', { value: row?.description || '' }); form.appendChild(d);
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: async () => {
        const body = { name: n.value.trim(), description: d.value || null };
        try {
          if (row) await api('PATCH', `/api/teams/${row.id}`, body);
          else     await api('POST', '/api/teams', body);
          closeModal(); navigate('teams');
        } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
      } }, '保存'));
    });
  }
  async function removeTeamMember(teamId, staffId) {
    if (!(await confirmDialog('このメンバーをチームから外しますか？'))) return;
    try { await api('DELETE', `/api/teams/${teamId}/members/${staffId}`); navigate('teams'); } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
  }
  async function deleteTeam(id) {
    if (!(await confirmDialog('このチームを削除しますか？'))) return;
    try { await api('DELETE', `/api/teams/${id}`); navigate('teams'); } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
  }

  // --- Helpers for new sections ---
  // --- AI logs ---
  async function renderAiLogs(root) {
    root.appendChild(el('h2', {}, 'AI ログ'));
    // Stats tiles
    const tileWrap = el('div', { class: 'slo-adm-tiles', id: 'slo-ai-stats' });
    root.appendChild(tileWrap);
    api('GET', '/api/ai-logs/stats').then((r) => {
      const s = r.stats;
      tileWrap.innerHTML = '';
      const tile = (label, val, sub) => el('div', { class: 'slo-adm-tile' },
        el('div', { class: 'slo-adm-tile-label' }, label),
        el('div', { class: 'slo-adm-tile-value' }, String(val)),
        sub ? el('div', { class: 'slo-adm-tile-sub' }, sub) : null);
      tileWrap.appendChild(tile('呼出数 (24h)', s.calls_24h, `7 日: ${s.calls_7d}`));
      tileWrap.appendChild(tile('エラー率 (24h)', s.calls_24h ? `${Math.round((s.errors_24h||0) / s.calls_24h * 100)}%` : '—', `エラー ${fmtNum(s.errors_24h)}`));
      tileWrap.appendChild(tile('平均レイテンシ (24h)', s.avg_latency_ms_24h != null ? `${s.avg_latency_ms_24h}ms` : '—'));
      tileWrap.appendChild(tile('フィードバック', `👍 ${s.thumbs_up} / 👎 ${s.thumbs_down}`));
    }).catch(() => { tileWrap.innerHTML = '<div class="slo-adm-empty">統計読込失敗</div>'; });

    // Filter toolbar
    const tb = el('div', { class: 'slo-adm-sect-toolbar', style: 'margin-top:16px;' });
    const statusSel = el('select', { onchange: () => reload() },
      el('option', { value: '' }, '全ステータス'),
      el('option', { value: 'ok' }, 'ok'),
      el('option', { value: 'error' }, 'error'),
      el('option', { value: 'empty' }, 'empty'));
    tb.appendChild(statusSel);
    tb.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: () => downloadCsv('ai_logs') }, '📥 CSV'));
    root.appendChild(tb);

    const listDiv = el('div');
    root.appendChild(listDiv);

    async function reload() {
      listDiv.innerHTML = '<div style="color:#9ca3af;">読み込み中…</div>';
      try {
        const qs = statusSel.value ? `?status=${statusSel.value}` : '';
        const r = await api('GET', '/api/ai-logs' + qs);
        renderAiLogsTable(listDiv, r.logs || []);
      } catch (e) { listDiv.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
    }
    reload();
  }
  function renderAiLogsTable(root, logs) {
    root.innerHTML = '';
    if (logs.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, 'AI ログはありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:140px' }, '日時'),
      el('th', { style: 'width:80px' }, 'ステータス'),
      el('th', { style: 'width:80px' }, 'ms'),
      el('th', {}, 'input'),
      el('th', { style: 'width:120px' }, 'feedback'),
      el('th', { style: 'width:100px' }, ''))));
    const tbody = el('tbody');
    for (const log of logs) {
      tbody.appendChild(el('tr', {},
        el('td', { style: 'font-size:11px;font-family:ui-monospace,monospace;' }, fmtDate(log.created_at)),
        el('td', {}, el('span', { class: 'slo-adm-badge', 'data-role': log.status === 'ok' ? 'agent' : 'admin' }, log.status)),
        el('td', {}, String(log.latency_ms || '—')),
        el('td', { style: 'max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, (log.input || '').slice(0, 80)),
        el('td', {}, `👍${log.feedback?.up || 0} / 👎${log.feedback?.down || 0}`),
        el('td', {}, el('div', { class: 'slo-adm-row-actions' },
          el('button', { onclick: () => aiLogModal(log.id) }, '詳細'),
          el('button', { class: 'danger', onclick: () => deleteAiLog(log.id) }, '削除')))
      ));
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }
  async function aiLogModal(id) {
    try {
      const r = await api('GET', `/api/ai-logs/${id}`);
      const log = r.log;
      openModal(`AI ログ #${id}`, (form, actions) => {
        form.appendChild(el('div', { style: 'font-size:11px;color:#6b7280;margin-bottom:8px;' },
          `${log.provider} / ${log.model} · ${log.status} · ${log.latency_ms}ms · ${log.created_at}`));
        form.appendChild(el('label', {}, 'ユーザー入力'));
        form.appendChild(el('textarea', { readonly: '', style: 'min-height:60px;' }, log.input || ''));
        form.appendChild(el('label', {}, 'システムプロンプト (先頭 2KB)'));
        form.appendChild(el('textarea', { readonly: '', style: 'min-height:100px;font-family:ui-monospace,monospace;font-size:11px;' }, log.system_prompt || ''));
        form.appendChild(el('label', {}, 'AI 応答'));
        form.appendChild(el('textarea', { readonly: '', style: 'min-height:100px;' }, log.output || ''));
        if (log.error_message) {
          form.appendChild(el('label', {}, 'エラー'));
          form.appendChild(el('div', { style: 'background:#fee2e2;padding:8px;border-radius:6px;color:#991b1b;' }, log.error_message));
        }
        form.appendChild(el('label', {}, 'フィードバック'));
        const note = el('textarea', { placeholder: '自由記述 (任意)' });
        form.appendChild(note);
        const ratingRow = el('div', { style: 'display:flex;gap:8px;margin-top:8px;' },
          el('button', { class: 'slo-adm-btn', onclick: async () => { await api('POST', `/api/ai-logs/${id}/feedback`, { rating: 1, note: note.value }); closeModal(); navigate('ai-logs'); } }, '👍 良い'),
          el('button', { class: 'slo-adm-btn slo-adm-btn-danger', onclick: async () => { await api('POST', `/api/ai-logs/${id}/feedback`, { rating: -1, note: note.value }); closeModal(); navigate('ai-logs'); } }, '👎 悪い'));
        form.appendChild(ratingRow);

        if ((r.feedback || []).length) {
          form.appendChild(el('label', {}, '既存フィードバック'));
          for (const fb of r.feedback) {
            form.appendChild(el('div', { style: 'background:#f9fafb;padding:8px;border-radius:6px;margin-top:4px;font-size:12px;' },
              `${fb.rating === 1 ? '👍' : '👎'} staff:${fb.staff_id || '—'} · ${fb.created_at}`,
              fb.note ? el('div', { style: 'color:#374151;margin-top:4px;' }, fb.note) : null));
          }
        }

        actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, '閉じる'));
      });
    } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
  }
  async function deleteAiLog(id) {
    if (!(await confirmDialog('この AI ログを削除しますか？'))) return;
    try { await api('DELETE', `/api/ai-logs/${id}`); navigate('ai-logs'); } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
  }

  // --- Bonus codes ---
  async function renderBonusCodes(root) {
    root.appendChild(el('h2', {}, 'ボーナスコード'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 16px;' },
      'AgentBot から移植した24種別 + カスタム種別を管理できます。ハードコード種別は削除不可 (無効化のみ可)。カスタム種別は新規追加できます。'));
    const head = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;' });
    head.appendChild(el('div'));
    const addBtn = el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: () => showBonusCodeEditor(null) }, '+ カスタム種別を新規作成');
    head.appendChild(addBtn);
    root.appendChild(head);

    const tableWrap = el('div', { id: 'slo-adm-bc-table' });
    root.appendChild(tableWrap);

    try {
      const r = await api('GET', '/api/bonus-codes');
      renderBonusCodesTable(tableWrap, r.codes || []);
    } catch (e) {
      tableWrap.appendChild(el('div', { style: 'color:#ef4444;' }, 'データ取得に失敗: ' + e.message));
    }
  }

  function renderBonusCodesTable(root, rows) {
    root.innerHTML = '';
    const t = el('table', { class: 'slo-adm-table' });
    const thead = el('thead', {}, el('tr', {},
      el('th', {}, '種別'),
      el('th', {}, 'コード'),
      el('th', {}, '照合'),
      el('th', {}, 'GAS'),
      el('th', {}, '出典'),
      el('th', {}, '有効'),
      el('th', {}, 'アクション'),
    ));
    const tbody = el('tbody');
    for (const row of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', {}, el('div', { style: 'font-weight:600;' }, row.display_name),
        el('div', { style: 'font-size:11px;color:#6b7280;' }, row.type_key)));
      tr.appendChild(el('td', { style: 'font-size:12px;' }, (row.codes || []).join(', ')));
      tr.appendChild(el('td', { style: 'font-size:12px;' }, row.match_mode === 'exact' ? '完全一致' : '大文字小文字を区別しない'));
      tr.appendChild(el('td', { style: 'font-size:12px;' }, row.gas_type || '-'));
      tr.appendChild(el('td', { style: 'font-size:12px;' }, row.source === 'hardcoded' ? 'AgentBot' : 'カスタム'));
      const toggle = el('input', { type: 'checkbox', onchange: async (ev) => {
        try { await api('PATCH', `/api/bonus-codes/${row.id}`, { enabled: ev.target.checked }); (window.Sloten?.toast||(()=>{}))('更新しました', { type: 'success' }); }
        catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); ev.target.checked = !ev.target.checked; }
      }});
      if (row.enabled) toggle.setAttribute('checked', 'checked');
      tr.appendChild(el('td', {}, toggle));
      const actions = el('div', { style: 'display:flex;gap:6px;' });
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: () => showBonusCodeEditor(row) }, '編集'));
      if (row.source !== 'hardcoded') {
        actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-danger', onclick: async () => {
          if (!(await confirmDialog(`${row.display_name} を削除しますか？ (関連する申請履歴は残りますが、行は孤立します)`))) return;
          try { await api('DELETE', `/api/bonus-codes/${row.id}`); navigate('bonus-codes'); }
          catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
        }}, '削除'));
      }
      tr.appendChild(el('td', {}, actions));
      tbody.appendChild(tr);
    }
    t.appendChild(thead); t.appendChild(tbody);
    root.appendChild(t);
  }

  function showBonusCodeEditor(row) {
    const isNew = !row;
    openModal(isNew ? 'カスタム種別の新規作成' : `編集: ${row.display_name}`, (form, actions) => {
      form.style.maxWidth = '100%';
      const addField = (label, id, value, opts = {}) => {
        form.appendChild(el('label', { for: id }, label));
        if (opts.textarea) {
          const ta = el('textarea', { id, style: 'min-height:' + ((opts.rows || 4) * 20) + 'px;' });
          ta.value = value || '';
          form.appendChild(ta);
        } else {
          const inp = el('input', { id, value: value || '' });
          if (opts.required) inp.required = true;
          form.appendChild(inp);
        }
        if (opts.hint) form.appendChild(el('div', { style: 'font-size:11px;color:#6b7280;margin:-6px 0 10px;' }, opts.hint));
      };
      if (isNew) addField('type_key (英小文字・数字・アンダースコア)', 'bc-key', '', { required: true, hint: '例: shingaku_special' });
      else form.appendChild(el('div', { style: 'margin-bottom:12px;font-size:13px;color:#6b7280;' },
        `type_key: ${row.type_key} (${row.source === 'hardcoded' ? 'AgentBot移植' : 'カスタム'})`));
      addField('表示名', 'bc-name', row?.display_name || '', { required: true });
      addField('受付コード (カンマ または 改行で複数)', 'bc-codes', (row?.codes || []).join('\n'), { textarea: true, rows: 3 });
      form.appendChild(el('label', { for: 'bc-mode' }, '照合方法'));
      const modeSel = el('select', { id: 'bc-mode' },
        el('option', { value: 'case_insensitive' }, '大文字小文字を区別しない'),
        el('option', { value: 'exact' }, '完全一致'));
      modeSel.value = row?.match_mode || 'case_insensitive';
      form.appendChild(modeSel);
      addField('成功メッセージ本文', 'bc-content', row?.success_content || '', { textarea: true, rows: 8, hint: '実際の改行で入力してください' });
      addField('成功メッセージ選択肢 (JSON array)', 'bc-items',
        (row?.success_items && row.success_items.length) ? JSON.stringify(row.success_items, null, 2) : '',
        { textarea: true, rows: 4, hint: '例: [{"title":"OK","value":"welcome_message"}] — 不要なら空欄' });
      addField('GAS type (optional)', 'bc-gas', row?.gas_type || '', { hint: 'BONUS_CODE_WEBHOOK_URL への転送識別子 (例: BC_入学)' });
      const tafter = el('input', { type: 'checkbox', id: 'bc-transfer' });
      if (row?.transfer_after) tafter.checked = true;
      const en = el('input', { type: 'checkbox', id: 'bc-enabled' });
      if (!row || row.enabled) en.checked = true;
      const cbWrap = el('div', { style: 'display:flex;gap:16px;margin:8px 0 12px;' });
      cbWrap.appendChild(el('label', { style: 'font-size:13px;' }, tafter, ' 受付後にオペレーター転送'));
      cbWrap.appendChild(el('label', { style: 'font-size:13px;' }, en, ' 有効'));
      form.appendChild(cbWrap);

      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: async () => {
        const get = (id) => document.getElementById(id).value;
        const payload = {
          display_name: get('bc-name'),
          codes: get('bc-codes').split(/\n|,/).map(s => s.trim()).filter(Boolean),
          match_mode: get('bc-mode'),
          success_content: get('bc-content'),
          gas_type: get('bc-gas') || null,
          transfer_after: document.getElementById('bc-transfer').checked,
          enabled: document.getElementById('bc-enabled').checked,
        };
        const itemsText = get('bc-items').trim();
        if (itemsText) {
          try {
            payload.success_items = JSON.parse(itemsText);
            if (!Array.isArray(payload.success_items)) throw new Error('items must be array');
          } catch (e) {
            (window.Sloten?.toast||alert)('items は JSON 配列で入力してください', { type: 'error' });
            return;
          }
        } else {
          payload.success_items = [];
        }
        if (isNew) payload.type_key = get('bc-key');
        try {
          if (isNew) await api('POST', '/api/bonus-codes', payload);
          else await api('PATCH', `/api/bonus-codes/${row.id}`, payload);
          closeModal();
          navigate('bonus-codes');
        } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
      }}, isNew ? '作成' : '保存'));
    });
  }

  // --- Bonus submission history ---
  async function renderBonusSubmissions(root) {
    root.appendChild(el('h2', {}, 'ボーナスコード申請履歴'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 16px;' }, '最新100件を表示します。'));
    try {
      const r = await api('GET', '/api/bonus-code-submissions?limit=100');
      const t = el('table', { class: 'slo-adm-table' });
      t.appendChild(el('thead', {}, el('tr', {},
        el('th', {}, '日時'),
        el('th', {}, 'コード'),
        el('th', {}, '種別'),
        el('th', {}, 'コンタクト'),
        el('th', {}, 'GAS転送'),
      )));
      const tbody = el('tbody');
      for (const s of (r.submissions || [])) {
        const tr = el('tr');
        tr.appendChild(el('td', { style: 'font-size:12px;' }, fmtDate(s.created_at)));
        tr.appendChild(el('td', {}, s.code_submitted));
        tr.appendChild(el('td', { style: 'font-size:12px;color:#6b7280;' }, s.type_key || '-'));
        tr.appendChild(el('td', {}, s.contact_name || s.contact_email || s.contact_id || '-'));
        tr.appendChild(el('td', { style: 'font-size:12px;' }, s.gas_forwarded ? '✓' : '-'));
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      root.appendChild(t);
    } catch (e) {
      root.appendChild(el('div', { style: 'color:#ef4444;' }, e.message));
    }
  }


  // --- Register sections ---
  A.section('prompts', renderPrompts);
  A.section('teams', renderTeams);
  A.section('ai-logs', renderAiLogs);
  A.section('bonus-codes', renderBonusCodes);
  A.section('bonus-submissions', renderBonusSubmissions);
})();
