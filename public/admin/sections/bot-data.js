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
  // One-click feedback helper (Phase 1 — no modal, no confirmation, 3秒で完了)
  async function quickFeedback(logId, rating, cellNode) {
    try {
      await api('POST', `/api/ai-logs/${logId}/feedback`, { rating, note: null });
      // Visual confirmation without reload
      if (cellNode) cellNode.innerHTML = rating === 1 ? '✅ 👍' : (rating === -1 ? '✅ 👎' : '✅ ⚠️');
    } catch (e) { (window.Sloten?.toast||alert)('feedback 失敗: ' + e.message, { type: 'error' }); }
  }

  function renderAiLogsTable(root, logs) {
    root.innerHTML = '';
    if (logs.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, 'AI ログはありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:130px' }, '日時'),
      el('th', { style: 'width:80px' }, 'ステータス'),
      el('th', { style: 'width:70px' }, 'ms'),
      el('th', { style: 'width:70px' }, 'tokens'),
      el('th', {}, 'input'),
      el('th', { style: 'width:80px' }, 'retrieval'),
      el('th', { style: 'width:110px' }, 'feedback'),
      el('th', { style: 'width:200px' }, ''))));
    const tbody = el('tbody');
    for (const log of logs) {
      const tokenStr = (log.tokens_in != null || log.tokens_out != null)
        ? `${log.tokens_in || '-'}/${log.tokens_out || '-'}`
        : '—';
      const trace = log.retrieval_trace ? (() => { try { return JSON.parse(log.retrieval_trace); } catch { return null; } })() : null;
      const strategy = trace?.strategy || (log.escalation_reason ? `esc:${log.escalation_reason}` : '—');
      // Pre-create feedback cell so quickFeedback can mutate its content on click.
      const fbCell = el('td', { style: 'font-size:12px;' }, `👍${log.feedback?.up || 0} / 👎${log.feedback?.down || 0}`);
      tbody.appendChild(el('tr', {},
        el('td', { style: 'font-size:11px;font-family:ui-monospace,monospace;' }, fmtDate(log.created_at)),
        el('td', {}, el('span', { class: 'slo-adm-badge', 'data-role': log.status === 'ok' ? 'agent' : 'admin' }, log.status)),
        el('td', {}, String(log.latency_ms || '—')),
        el('td', { style: 'font-size:11px;font-family:ui-monospace,monospace;' }, tokenStr),
        el('td', { style: 'max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, (log.input || '').slice(0, 80)),
        el('td', { style: 'font-size:11px;color:#6b7280;' }, strategy),
        fbCell,
        el('td', {}, el('div', { class: 'slo-adm-row-actions', style: 'gap:4px;' },
          el('button', { title: '良い', style: 'padding:2px 6px;', onclick: () => quickFeedback(log.id, 1, fbCell) }, '👍'),
          el('button', { title: '悪い', style: 'padding:2px 6px;', onclick: () => quickFeedback(log.id, -1, fbCell) }, '👎'),
          el('button', { title: '重大問題', style: 'padding:2px 6px;background:#fef3c7;', onclick: () => quickFeedback(log.id, -2, fbCell) }, '⚠️'),
          el('button', { onclick: () => aiLogModal(log.id) }, '詳細'),
          el('button', { class: 'danger', onclick: () => deleteAiLog(log.id) }, '×')))
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

      // --- 成功メッセージ選択肢: 動的フォーム (+/- ボタン) ---
      form.appendChild(el('label', {}, '成功メッセージ選択肢'));
      const itemsWrap = el('div', { id: 'bc-items-wrap', style: 'border:1px solid #e5e7eb;border-radius:6px;padding:8px;margin-bottom:4px;' });
      const PRESET_VALUES = [
        'welcome_message',
        'transfer_to_agent',
      ];
      const dl = el('datalist', { id: 'bc-items-valueoptions' });
      PRESET_VALUES.forEach((v) => dl.appendChild(el('option', { value: v })));
      form.appendChild(dl);
      const addItemRow = (title = '', value = '') => {
        const rowWrap = el('div', { class: 'bc-item-row', style: 'display:flex;gap:6px;margin-bottom:6px;align-items:center;' });
        const t = el('input', { type: 'text', placeholder: 'タイトル (例: ↩️ メインメニューに戻る)', value: title, style: 'flex:2;' });
        const v = el('input', { type: 'text', placeholder: '値 (例: welcome_message)', value: value, list: 'bc-items-valueoptions', style: 'flex:1;' });
        t.classList.add('bc-item-title');
        v.classList.add('bc-item-value');
        const del = el('button', { type: 'button', class: 'slo-adm-btn slo-adm-btn-secondary', style: 'padding:4px 10px;', onclick: () => rowWrap.remove() }, '−');
        rowWrap.appendChild(t);
        rowWrap.appendChild(v);
        rowWrap.appendChild(del);
        itemsWrap.appendChild(rowWrap);
      };
      (row?.success_items || []).forEach((it) => addItemRow(it?.title || '', it?.value || ''));
      form.appendChild(itemsWrap);
      form.appendChild(el('button', { type: 'button', class: 'slo-adm-btn slo-adm-btn-secondary',
        style: 'margin-bottom:10px;',
        onclick: () => addItemRow('', '') }, '+ 選択肢を追加'));
      form.appendChild(el('div', { style: 'font-size:11px;color:#6b7280;margin:-6px 0 10px;' },
        '各選択肢の「値」は遷移先のステップ ID です (例: welcome_message / transfer_to_agent)。空欄のまま保存すると選択肢なしになります。'));

      // --- GAS type: BC_ 固定プレフィックス + suffix 入力 ---
      const existingGas = row?.gas_type || '';
      const existingSuffix = existingGas.startsWith('BC_') ? existingGas.slice(3) : existingGas;
      form.appendChild(el('label', { for: 'bc-gas-suffix' }, 'GAS type (BONUS_CODE_WEBHOOK_URL 転送識別子)'));
      const gasWrap = el('div', { style: 'display:flex;align-items:center;gap:4px;margin-bottom:4px;' });
      gasWrap.appendChild(el('span', {
        style: 'font-family:monospace;font-weight:600;background:#f3f4f6;padding:8px 10px;border:1px solid #e5e7eb;border-radius:6px;color:#374151;'
      }, 'BC_'));
      const gasSuffix = el('input', { id: 'bc-gas-suffix', value: existingSuffix, placeholder: '例: 入学 / ギルド / だっちゃん', style: 'flex:1;' });
      gasWrap.appendChild(gasSuffix);
      form.appendChild(gasWrap);
      form.appendChild(el('div', { style: 'font-size:11px;color:#6b7280;margin:-2px 0 10px;' },
        'GAS へ転送する場合、BC_ の後ろに識別子を入力 (保存時に BC_XXX として登録)。GAS 転送しない場合は空欄のまま。'));
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
        const gasSuffixVal = (get('bc-gas-suffix') || '').trim();
        const payload = {
          display_name: get('bc-name'),
          codes: get('bc-codes').split(/\n|,/).map(s => s.trim()).filter(Boolean),
          match_mode: get('bc-mode'),
          success_content: get('bc-content'),
          gas_type: gasSuffixVal ? 'BC_' + gasSuffixVal : null,
          transfer_after: document.getElementById('bc-transfer').checked,
          enabled: document.getElementById('bc-enabled').checked,
        };
        // 動的フォームから items を組み立てる: 両方空の行は無視、片方だけ入力の行はエラー
        const itemRows = Array.from(itemsWrap.querySelectorAll('.bc-item-row'));
        const builtItems = [];
        for (const r of itemRows) {
          const title = r.querySelector('.bc-item-title').value.trim();
          const value = r.querySelector('.bc-item-value').value.trim();
          if (!title && !value) continue;
          if (!title || !value) {
            (window.Sloten?.toast||alert)('選択肢はタイトルと値の両方を入力してください (不要な行は削除)', { type: 'error' });
            return;
          }
          builtItems.push({ title, value });
        }
        payload.success_items = builtItems;
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


  // --- Phase 1: AI silent-failure viewer ---
  // Surfaces failures the feedback system missed: 即エスカ / 再質問 / 怒り語
  async function renderAiSilentFailures(root) {
    root.appendChild(el('h2', {}, 'AI サイレント失敗 (Phase 1)'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 12px;' },
      '👍👎 がついていなくても、ユーザー行動から AI 回答の失敗を検出します。migration 018 のビュー 3 種。'));
    const tabs = el('div', { style: 'display:flex;gap:8px;margin-bottom:12px;' });
    const listDiv = el('div');
    const tabs_spec = [
      { key: 'escalation', label: '即エスカレーション (< 120s)' },
      { key: 'repeat',     label: '同じ質問 (10分以内)' },
      { key: 'anger',      label: '怒り・不満ワード後続' },
    ];
    let current = 'escalation';
    async function loadTab(view) {
      listDiv.innerHTML = '読み込み中...';
      current = view;
      for (const b of tabs.querySelectorAll('button')) {
        b.style.background = b.dataset.view === view ? '#2563eb' : '#fff';
        b.style.color = b.dataset.view === view ? '#fff' : '#111';
      }
      try {
        const r = await api('GET', `/api/ai-logs/silent-failures?view=${view}&limit=50`);
        const rows = r.rows || [];
        listDiv.innerHTML = '';
        if (rows.length === 0) { listDiv.appendChild(el('div', { class: 'slo-adm-empty' }, '該当なし — 良い兆候です')); return; }
        const t = el('table', { class: 'slo-adm-table' });
        t.appendChild(el('thead', {}, el('tr', {},
          el('th', { style: 'width:140px' }, 'AI 応答時刻'),
          el('th', { style: 'width:80px' }, 'log_id'),
          el('th', {}, view === 'escalation' ? 'AI 応答 (抜粋)' : 'ユーザー発話'),
          el('th', { style: 'width:80px' }, ''))));
        const tbody = el('tbody');
        for (const row of rows) {
          const preview = (view === 'escalation' ? row.ai_response : row.followup_message) || '';
          tbody.appendChild(el('tr', {},
            el('td', { style: 'font-size:11px;font-family:ui-monospace,monospace;' }, fmtDate(row.ai_created_at)),
            el('td', {}, String(row.ai_log_id)),
            el('td', { style: 'max-width:500px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, preview.slice(0, 120)),
            el('td', {}, el('button', { onclick: () => aiLogModal(row.ai_log_id) }, '詳細'))
          ));
        }
        t.appendChild(tbody);
        listDiv.appendChild(t);
      } catch (e) {
        listDiv.innerHTML = '';
        listDiv.appendChild(el('div', { class: 'slo-adm-empty' }, 'エラー: ' + e.message));
      }
    }
    for (const t of tabs_spec) {
      tabs.appendChild(el('button', {
        class: 'slo-adm-btn',
        'data-view': t.key,
        style: 'padding:6px 12px;',
        onclick: () => loadTab(t.key),
      }, t.label));
    }
    root.appendChild(tabs);
    root.appendChild(listDiv);
    loadTab(current);
  }

  // --- Phase 2: Golden Set editor + eval results + shadow settings ---
  async function renderGoldenSet(root) {
    root.appendChild(el('h2', {}, 'Golden Set (評価コーパス)'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 12px;' },
      'プロンプト評価に使う Q&A 標準セット。nightly で `scripts/eval-golden-set.mjs` が全 active プロンプトを評価します。'));
    const toolbar = el('div', { style: 'display:flex;gap:8px;margin-bottom:12px;' },
      el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: () => goldenEditor(null) }, '+ 新規追加'),
      el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: () => renderGoldenSet(root) }, '🔄 再読み込み'));
    root.appendChild(toolbar);

    try {
      const [rowsResp, evalResp] = await Promise.all([
        api('GET', '/api/golden-set'),
        api('GET', '/api/golden-eval').catch(() => ({ prompts: [] })),
      ]);
      // Eval summary first
      if (evalResp.prompts?.length) {
        root.appendChild(el('h3', {}, '直近 30 日評価サマリ'));
        const t = el('table', { class: 'slo-adm-table', style: 'margin-bottom:20px;' });
        t.appendChild(el('thead', {}, el('tr', {},
          el('th', {}, 'Prompt'), el('th', {}, 'n'), el('th', {}, 'avg keyword'),
          el('th', {}, 'violations'), el('th', {}, 'esc match'), el('th', {}, 'avg judge'),
          el('th', {}, 'avg ms'), el('th', {}, 'latest'))));
        const tb = el('tbody');
        for (const p of evalResp.prompts) {
          tb.appendChild(el('tr', {},
            el('td', {}, p.prompt_name),
            el('td', {}, String(p.n)),
            el('td', {}, ((p.avg_keyword_score || 0) * 100).toFixed(1) + '%'),
            el('td', {}, String(p.total_violations || 0)),
            el('td', {}, `${p.esc_match || 0}/${p.n}`),
            el('td', {}, p.avg_judge != null ? Number(p.avg_judge).toFixed(2) : '—'),
            el('td', {}, String(Math.round(p.avg_latency || 0))),
            el('td', { style: 'font-size:11px;color:#6b7280;' }, fmtDate(p.latest_run))));
        }
        t.appendChild(tb);
        root.appendChild(t);
      }

      root.appendChild(el('h3', {}, 'Golden Set 行 (' + (rowsResp.rows?.length || 0) + ')'));
      const rows = rowsResp.rows || [];
      if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, '行がありません')); return; }
      // Group by category
      const byCat = {};
      for (const r of rows) { (byCat[r.category] ||= []).push(r); }
      for (const cat of Object.keys(byCat).sort()) {
        root.appendChild(el('h4', { style: 'margin:12px 0 4px;' }, `${cat} (${byCat[cat].length})`));
        const t = el('table', { class: 'slo-adm-table' });
        t.appendChild(el('thead', {}, el('tr', {},
          el('th', { style: 'width:40px' }, 'id'),
          el('th', {}, '質問'),
          el('th', { style: 'width:80px' }, 'エスカ'),
          el('th', { style: 'width:100px' }, ''))));
        const tb = el('tbody');
        for (const r of byCat[cat]) {
          tb.appendChild(el('tr', {},
            el('td', {}, String(r.id)),
            el('td', {}, r.question),
            el('td', {}, r.expected_escalation ? '✓ 人間' : 'AI'),
            el('td', {}, el('div', { class: 'slo-adm-row-actions' },
              el('button', { onclick: () => goldenEditor(r) }, '編集'),
              el('button', { class: 'danger', onclick: async () => {
                if (!await confirmDialog('削除しますか？')) return;
                await api('DELETE', `/api/golden-set/${r.id}`);
                renderGoldenSet(root);
              } }, '×')))));
        }
        t.appendChild(tb);
        root.appendChild(t);
      }
    } catch (e) {
      root.appendChild(el('div', { style: 'color:#ef4444;' }, 'エラー: ' + e.message));
    }
  }
  function goldenEditor(row) {
    const isNew = !row;
    openModal(isNew ? 'Golden Set 新規' : `編集 #${row.id}`, (form, actions) => {
      const add = (label, id, value, opts = {}) => {
        form.appendChild(el('label', { for: id }, label));
        const node = opts.textarea
          ? el('textarea', { id, style: 'min-height:' + ((opts.rows || 3) * 20) + 'px;' })
          : el('input', { id, value: value || '' });
        if (opts.textarea) node.value = value || '';
        form.appendChild(node);
        if (opts.hint) form.appendChild(el('div', { style: 'font-size:11px;color:#6b7280;margin:-6px 0 10px;' }, opts.hint));
      };
      add('カテゴリ', 'g-cat', row?.category || '入出金');
      add('質問', 'g-q', row?.question || '', { textarea: true, rows: 2, required: true });
      add('模範回答 (任意)', 'g-ref', row?.reference_answer || '', { textarea: true, rows: 4, hint: '運用者が記入。eval-golden-set.mjs の LLM-as-Judge が使用' });
      add('必須含有キーワード (JSON array)', 'g-mc',
        row?.must_contain ? (typeof row.must_contain === 'string' ? row.must_contain : JSON.stringify(row.must_contain)) : '[]',
        { hint: '例: ["PayPay","入金"]' });
      add('禁止ワード (JSON array)', 'g-mnc',
        row?.must_not_contain ? (typeof row.must_not_contain === 'string' ? row.must_not_contain : JSON.stringify(row.must_not_contain)) : '[]',
        { hint: '例: ["必ず","絶対","100%"]' });
      const escCheckbox = el('input', { type: 'checkbox', id: 'g-esc' });
      if (row?.expected_escalation) escCheckbox.checked = true;
      form.appendChild(el('label', { style: 'display:flex;gap:6px;margin:8px 0 10px;' }, escCheckbox, ' 期待される挙動: 人間エスカレ'));
      add('メモ', 'g-notes', row?.notes || '', { textarea: true, rows: 2 });

      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: async () => {
        const get = (id) => document.getElementById(id).value;
        const parseJsonSafe = (s) => { try { return JSON.parse(s || '[]'); } catch { return null; } };
        const mc = parseJsonSafe(get('g-mc'));
        const mnc = parseJsonSafe(get('g-mnc'));
        if (mc === null || mnc === null) { alert('必須含有 / 禁止ワードは JSON array で'); return; }
        const payload = {
          category: get('g-cat'),
          question: get('g-q'),
          reference_answer: get('g-ref') || null,
          must_contain: mc,
          must_not_contain: mnc,
          expected_escalation: escCheckbox.checked,
          notes: get('g-notes') || null,
        };
        try {
          if (isNew) await api('POST', '/api/golden-set', payload);
          else await api('PATCH', `/api/golden-set/${row.id}`, payload);
          closeModal();
          navigate('golden-set');
        } catch (e) { alert(e.message); }
      } }, isNew ? '作成' : '保存'));
    });
  }

  // --- Phase 2: Shadow mode settings ---
  async function renderShadowSettings(root) {
    root.appendChild(el('h2', {}, 'Shadow Mode 設定 (Phase 2)'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 12px;' },
      'ユーザーに見えない形で候補プロンプトを並列実行し、後で比較評価します。LLM コストが 2-3 倍化するため、off がデフォルト。'));
    try {
      const [cfg, prompts] = await Promise.all([
        api('GET', '/api/admin/shadow-config'),
        api('GET', '/api/ai-prompts'),
      ]);
      const enabled = cfg.config?.['ai.shadow_mode.enabled'] === '1';
      const ids = cfg.config?.['ai.shadow_mode.prompt_ids'] || '';
      const enabledInput = el('input', { type: 'checkbox', id: 'shadow-enabled' });
      if (enabled) enabledInput.checked = true;
      const idsInput = el('input', { id: 'shadow-ids', value: ids, placeholder: '例: 3,4', style: 'width:240px;' });

      root.appendChild(el('div', { style: 'display:flex;gap:16px;align-items:center;margin-bottom:8px;' },
        enabledInput, el('label', { for: 'shadow-enabled' }, 'Shadow mode 有効 (ai.shadow_mode.enabled)')));
      root.appendChild(el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:12px;' },
        el('label', { for: 'shadow-ids' }, 'Shadow prompt IDs (カンマ区切り、最大 2 本):'), idsInput));
      root.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: async () => {
        try {
          await api('POST', '/api/admin/shadow-config', {
            'ai.shadow_mode.enabled': enabledInput.checked ? '1' : '0',
            'ai.shadow_mode.prompt_ids': idsInput.value.trim(),
          });
          alert('保存しました');
        } catch (e) { alert(e.message); }
      } }, '💾 保存'));

      root.appendChild(el('h3', { style: 'margin-top:24px;' }, '利用可能なプロンプト'));
      const t = el('table', { class: 'slo-adm-table' });
      t.appendChild(el('thead', {}, el('tr', {},
        el('th', {}, 'id'), el('th', {}, '名前'), el('th', {}, 'active'), el('th', {}, 'weight'))));
      const tb = el('tbody');
      for (const p of (prompts.prompts || [])) {
        tb.appendChild(el('tr', {},
          el('td', {}, String(p.id)), el('td', {}, p.name),
          el('td', {}, p.is_active ? '✓' : '—'),
          el('td', {}, String(p.weight))));
      }
      t.appendChild(tb);
      root.appendChild(t);
    } catch (e) {
      root.appendChild(el('div', { style: 'color:#ef4444;' }, e.message));
    }
  }

  // --- Phase 2b: Vectorize / Hybrid RAG settings ---
  async function renderVectorize(root) {
    root.appendChild(el('h2', {}, 'Vectorize (Phase 2b)'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 12px;' },
      'Workers AI (bge-m3, 1024dim) + Vectorize で密ベクトル検索。BM25 と RRF 融合で言い換え対応が強化されます。'));
    const stateDiv = el('div');
    const actionsDiv = el('div', { style: 'display:flex;gap:8px;margin:12px 0;flex-wrap:wrap;' });
    root.appendChild(stateDiv);
    root.appendChild(actionsDiv);
    const logDiv = el('div', { style: 'background:#f9fafb;padding:10px;border-radius:6px;font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;margin-top:12px;max-height:400px;overflow:auto;' });
    root.appendChild(logDiv);
    const log = (msg) => { logDiv.textContent += (logDiv.textContent ? '\n' : '') + msg; };

    async function refreshState() {
      stateDiv.innerHTML = '読み込み中...';
      try {
        const r = await api('GET', '/api/admin/vectorize/state');
        stateDiv.innerHTML = '';
        stateDiv.appendChild(el('div', { style: 'display:grid;grid-template-columns:auto auto;gap:4px 16px;font-size:13px;' },
          el('div', { style: 'color:#6b7280;' }, 'AI binding:'),
          el('div', {}, r.ai_binding ? '✅ 有効' : '❌ 未設定'),
          el('div', { style: 'color:#6b7280;' }, 'Vectorize binding:'),
          el('div', {}, r.vectorize_binding ? '✅ 有効' : '❌ 未設定'),
          el('div', { style: 'color:#6b7280;' }, 'use_vectorize flag:'),
          el('div', {}, r.flags?.['retrieval.use_vectorize'] === '1' ? '🟢 ON (hybrid RRF)' : '⚪ OFF (BM25 only)'),
          el('div', { style: 'color:#6b7280;' }, 'use_chunks flag:'),
          el('div', {}, r.flags?.['retrieval.use_chunks'] === '1' ? '🟢 ON' : '⚪ OFF')));
        if (r.state?.length) {
          const t = el('table', { class: 'slo-adm-table', style: 'margin-top:10px;' });
          t.appendChild(el('thead', {}, el('tr', {},
            el('th', {}, 'kind'), el('th', {}, 'items'), el('th', {}, 'model'),
            el('th', {}, 'dim'), el('th', {}, 'last reindex'), el('th', {}, 'notes'))));
          const tb = el('tbody');
          for (const s of r.state) {
            tb.appendChild(el('tr', {},
              el('td', {}, s.kind), el('td', {}, String(s.item_count)),
              el('td', {}, s.embedding_model || '—'), el('td', {}, String(s.embedding_dim || '—')),
              el('td', { style: 'font-size:11px;' }, s.last_reindex_at || '—'),
              el('td', { style: 'font-size:11px;color:#6b7280;' }, s.notes || '—')));
          }
          t.appendChild(tb);
          stateDiv.appendChild(t);
        }
      } catch (e) { stateDiv.innerHTML = '<div style="color:#ef4444;">' + e.message + '</div>'; }
    }
    await refreshState();

    actionsDiv.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: async () => {
      if (!await confirmDialog('knowledge_chunks 全件を再 embed して Vectorize にアップロードします (数分+Workers AI 課金発生)。続行？')) return;
      log('[reindex:kb_chunks] 開始...');
      try {
        const r = await api('POST', '/api/admin/vectorize/reindex', { kind: 'kb_chunks' });
        log('[reindex:kb_chunks] ' + JSON.stringify(r, null, 2));
        await refreshState();
      } catch (e) { log('ERROR: ' + e.message); }
    } }, '📤 KB chunks を reindex'));

    actionsDiv.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: async () => {
      const q = prompt('テスト クエリを入力', '入金方法について');
      if (!q) return;
      log('[query] "' + q + '"');
      try {
        const r = await api('POST', '/api/admin/vectorize/query', { text: q, top_k: 5 });
        log(JSON.stringify(r, null, 2));
      } catch (e) { log('ERROR: ' + e.message); }
    } }, '🔍 Query テスト'));

    actionsDiv.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: async () => {
      try {
        await api('POST', '/api/admin/vectorize/flags', { 'retrieval.use_vectorize': '1' });
        alert('Hybrid RRF retrieval を有効化しました');
        await refreshState();
      } catch (e) { alert(e.message); }
    } }, '🟢 Hybrid ON'));
    actionsDiv.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: async () => {
      try {
        await api('POST', '/api/admin/vectorize/flags', { 'retrieval.use_vectorize': '0' });
        alert('Hybrid RRF retrieval を無効化しました (BM25 only)');
        await refreshState();
      } catch (e) { alert(e.message); }
    } }, '⚪ Hybrid OFF'));
  }

  // --- Phase 2b: FAQ Candidates Silver 層 (embedding cluster) ---
  async function renderFaqClusters(root) {
    root.appendChild(el('h2', {}, 'FAQ 候補クラスタ (Silver 層)'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 12px;' },
      '606 候補 → 意味的 cluster へ圧縮。頻度 ≥ 3 の cluster のみ "promoted" 状態に。'));

    const toolbar = el('div', { style: 'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;' });
    const listDiv = el('div');
    root.appendChild(toolbar);
    root.appendChild(listDiv);

    async function loadClusters(onlyPromoted) {
      listDiv.innerHTML = '読み込み中...';
      try {
        const r = await api('GET', '/api/admin/faq-candidates/clusters?limit=100' + (onlyPromoted ? '&promoted=1' : ''));
        const cs = r.clusters || [];
        listDiv.innerHTML = '';
        if (cs.length === 0) {
          listDiv.appendChild(el('div', { class: 'slo-adm-empty' },
            'クラスタがありません。まず Workers AI が有効なアカウントで「🔄 再クラスタリング」を実行してください。'));
          return;
        }
        const t = el('table', { class: 'slo-adm-table' });
        t.appendChild(el('thead', {}, el('tr', {},
          el('th', { style: 'width:50px' }, 'id'),
          el('th', {}, '代表質問'),
          el('th', { style: 'width:60px' }, 'size'),
          el('th', { style: 'width:80px' }, '類似度'),
          el('th', { style: 'width:80px' }, '状態'),
          el('th', { style: 'width:80px' }, ''))));
        const tb = el('tbody');
        for (const c of cs) {
          tb.appendChild(el('tr', {},
            el('td', {}, String(c.id)),
            el('td', {}, c.rep_question || '(no question)'),
            el('td', {}, String(c.size)),
            el('td', {}, (c.avg_similarity || 0).toFixed(3)),
            el('td', {}, c.promoted ? '🟢 promoted' : '⚪ small'),
            el('td', {}, el('button', { onclick: async () => {
              try {
                const mr = await api('GET', `/api/admin/faq-candidates/clusters/${c.id}/members`);
                alert((mr.members || []).map(m => '#' + m.id + ' [rank ' + m.cluster_rank + '] ' + m.question).join('\n\n'));
              } catch (e) { alert(e.message); }
            } }, 'メンバー'))
          ));
        }
        t.appendChild(tb);
        listDiv.appendChild(t);
      } catch (e) {
        listDiv.innerHTML = '<div style="color:#ef4444;">' + e.message + '</div>';
      }
    }

    toolbar.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: async () => {
      if (!await confirmDialog('全 pending FAQ 候補を再 embed + クラスタリング (Workers AI 課金)。続行？')) return;
      try {
        const r = await api('POST', '/api/admin/faq-candidates/cluster', { dry_run: false });
        alert(`候補 ${r.candidates} → ${r.clusters} clusters (promoted ${r.promoted})`);
        loadClusters(false);
      } catch (e) { alert(e.message); }
    } }, '🔄 再クラスタリング'));
    toolbar.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: async () => {
      try {
        const r = await api('POST', '/api/admin/faq-candidates/cluster', { dry_run: true });
        const top = (r.top_clusters || []).slice(0, 10).map(c =>
          `size=${c.size} sim=${c.avg_sim} ${c.promoted ? '🟢' : '⚪'} "${c.rep}"`).join('\n');
        alert(`候補 ${r.candidates} → ${r.clusters} clusters (promoted ${r.promoted})\n\nTop 10:\n${top}`);
      } catch (e) { alert(e.message); }
    } }, '👁️ Dry-run プレビュー'));
    toolbar.appendChild(el('button', { class: 'slo-adm-btn', onclick: () => loadClusters(false) }, 'すべて'));
    toolbar.appendChild(el('button', { class: 'slo-adm-btn', onclick: () => loadClusters(true) }, 'promoted のみ'));

    loadClusters(false);
  }

  // --- Register sections ---
  A.section('prompts', renderPrompts);
  A.section('teams', renderTeams);
  A.section('ai-logs', renderAiLogs);
  A.section('ai-silent-failures', renderAiSilentFailures);
  A.section('golden-set', renderGoldenSet);
  A.section('shadow-settings', renderShadowSettings);
  A.section('vectorize', renderVectorize);
  A.section('faq-clusters', renderFaqClusters);
  A.section('bonus-codes', renderBonusCodes);
  A.section('bonus-submissions', renderBonusSubmissions);
})();
