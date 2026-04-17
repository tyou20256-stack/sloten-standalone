// admin section: bot-flows (FAQ candidates + Bot flows + Bot menus)
(function() {
  const A = window.SlotenAdmin;
  const { state, api, el, $, $$, navigate, openModal, closeModal, confirmDialog, esc, fmtDate, fmtNum, humanizeError, toastErr, isStale, registerCleanup, downloadCsv, toolbar, updateBadge } = A;

  // --- FAQ candidates ---
  async function renderFaqCandidates(root) {
    root.appendChild(el('h2', {}, 'FAQ 候補'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 16px;' },
      '過去会話から週次 Cron で抽出される候補。内容を確認し、良質なものは承認で FAQ に追加、不要なものは却下してください。入金関連は自動で除外されます。'));

    const tb = el('div', { class: 'slo-adm-sect-toolbar' });
    const statusSel = el('select', { onchange: () => reload() },
      el('option', { value: 'pending' }, '未レビュー'),
      el('option', { value: 'approved' }, '承認済'),
      el('option', { value: 'rejected' }, '却下済'));
    tb.appendChild(statusSel);
    tb.appendChild(el('button', { class: 'slo-adm-btn', onclick: runNow }, '今すぐ抽出実行'));
    tb.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: () => bulkApply('approve') }, '✅ 表示中全て承認'));
    tb.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-danger', onclick: () => bulkApply('reject') }, '✗ 表示中全て却下'));
    root.appendChild(tb);
    const countsEl = el('div', { style: 'font-size:12px;color:#6b7280;margin-bottom:8px;' });
    root.appendChild(countsEl);
    const listDiv = el('div');
    root.appendChild(listDiv);

    async function reload() {
      listDiv.innerHTML = '<div style="color:#9ca3af;">読み込み中…</div>';
      try {
        const r = await api('GET', '/api/faq-candidates?status=' + statusSel.value + '&limit=200');
        state.data.faqCandidates = r.candidates || [];
        countsEl.textContent = `件数  未レビュー: ${r.counts.pending} / 承認済: ${r.counts.approved} / 却下済: ${r.counts.rejected}`;
        renderTable(listDiv, r.candidates || [], statusSel.value);
        updateBadge(r.counts.pending);
      } catch (e) { listDiv.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
    }
    async function runNow() {
      try {
        const r = await api('POST', '/api/faq-candidates/run?days=7');
        (window.Sloten?.toast || alert)(
          `抽出完了: 新規 ${r.stats.inserted} / 更新 ${r.stats.updated} / 入金除外 ${r.stats.deposit_filtered}`,
          { type: 'success' });
        reload();
      } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
    }
    async function bulkApply(action) {
      const ids = (state.data.faqCandidates || []).map((c) => c.id);
      if (ids.length === 0) return;
      if (!(await confirmDialog(`表示中の ${ids.length} 件を ${action === 'approve' ? '承認' : '却下'} しますか？`))) return;
      try {
        const r = await api('POST', '/api/faq-candidates/bulk', { action, ids });
        (window.Sloten?.toast || alert)(`処理件数: ${r.processed}`, { type: 'success' });
        reload();
      } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
    }

    reload();
  }

  function renderTable(root, rows, status) {
    root.innerHTML = '';
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, '該当する候補はありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:30%' }, '質問'),
      el('th', {}, '回答 (先頭)'),
      el('th', { style: 'width:90px' }, 'カテゴリ'),
      el('th', { style: 'width:70px' }, '出現数'),
      el('th', { style: 'width:110px' }, '最終検出'),
      el('th', { style: 'width:180px' }, ''))));
    const tbody = el('tbody');
    for (const r of rows) {
      const actions = el('div', { class: 'slo-adm-row-actions' });
      if (status === 'pending') {
        actions.appendChild(el('button', { onclick: () => editModal(r) }, '編集'));
        actions.appendChild(el('button', { onclick: () => approveOne(r) }, '✅ 承認'));
        actions.appendChild(el('button', { class: 'danger', onclick: () => rejectOne(r) }, '✗ 却下'));
      } else if (status === 'approved') {
        actions.appendChild(el('span', { style: 'color:#059669;font-size:11px;' }, 'FAQ #' + (r.approved_faq_id || '?')));
      }
      tbody.appendChild(el('tr', {},
        el('td', {}, (r.question || '').slice(0, 90)),
        el('td', {}, (r.answer || '').slice(0, 120)),
        el('td', {}, r.category || '—'),
        el('td', {}, String(r.source_count)),
        el('td', { style: 'font-size:11px;' }, (r.last_seen_at || '').slice(0, 16)),
        el('td', {}, actions)
      ));
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }

  async function approveOne(r) {
    try { await api('POST', `/api/faq-candidates/${r.id}/approve`); (window.Sloten?.toast || alert)('承認して FAQ に追加しました', { type: 'success' }); navigate('faq-candidates'); }
    catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
  }
  async function rejectOne(r) {
    try { await api('POST', `/api/faq-candidates/${r.id}/reject`); navigate('faq-candidates'); }
    catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
  }
  function editModal(r) {
    openModal('候補を編集して承認', (form, actions) => {
      form.appendChild(el('label', {}, '質問'));
      const q = el('textarea', { style: 'min-height:60px;' }, r.question || ''); form.appendChild(q);
      form.appendChild(el('label', {}, '回答'));
      const a = el('textarea', { style: 'min-height:120px;' }, r.answer || ''); form.appendChild(a);
      form.appendChild(el('label', {}, 'カテゴリ'));
      const cat = el('input', { value: r.category || '' }); form.appendChild(cat);
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-danger', onclick: async () => {
        try { await api('POST', `/api/faq-candidates/${r.id}/reject`); closeModal(); navigate('faq-candidates'); }
        catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
      } }, '却下'));
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: async () => {
        try {
          await api('POST', `/api/faq-candidates/${r.id}/approve`, { question: q.value, answer: a.value, category: cat.value });
          closeModal(); navigate('faq-candidates');
          (window.Sloten?.toast || alert)('編集して承認しました', { type: 'success' });
        } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
      } }, '編集して承認'));
    });
  }

  // --- Bot flows ---
  async function renderBotFlows(root) {
    root.appendChild(el('h2', {}, 'ボットフロー'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 16px;' },
      '多段階対話ワークフロー。顧客メッセージが trigger_value (正規表現) にマッチしたときに開始され、各 step を順に実行します。webhook ステップで GAS 等へ POST して外部連携できます。'));
    root.appendChild(el('div', { class: 'slo-adm-sect-toolbar' },
      el('button', { class: 'slo-adm-btn', onclick: () => flowModal() }, '+ 新規')));
    const listDiv = el('div');
    root.appendChild(listDiv);
    try {
      const r = await api('GET', '/api/bot-flows');
      state.data.flows = r.flows || [];
      renderFlowsTable(listDiv);
    } catch (e) { listDiv.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderFlowsTable(root) {
    root.innerHTML = '';
    const rows = state.data.flows || [];
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, 'フローはありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:22%' }, '名前'),
      el('th', {}, '説明 / trigger'),
      el('th', { style: 'width:80px' }, '開始'),
      el('th', { style: 'width:80px' }, 'steps'),
      el('th', { style: 'width:70px' }, '優先度'),
      el('th', { style: 'width:70px' }, '有効'),
      el('th', { style: 'width:140px' }, ''))));
    const tbody = el('tbody');
    for (const r of rows) {
      tbody.appendChild(el('tr', {},
        el('td', {}, r.name),
        el('td', {},
          el('div', {}, r.description || '—'),
          el('div', { style: 'font-family:ui-monospace,monospace;font-size:11px;color:#6b7280;margin-top:2px;' }, r.trigger_value || '(manual)')),
        el('td', {}, r.start_step_id),
        el('td', {}, String((r.steps || []).length)),
        el('td', {}, String(r.priority)),
        el('td', {}, el('span', { class: 'slo-adm-badge', 'data-active': String(r.is_active ?? 0) }, r.is_active ? '有効' : '無効')),
        el('td', {}, el('div', { class: 'slo-adm-row-actions' },
          el('button', { onclick: () => flowModal(r) }, '編集'),
          el('button', { class: 'danger', onclick: () => deleteFlow(r.id) }, '削除')))
      ));
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }
  // --- Flow visual editor ---
  function flowModal(row) {
    // Local mutable model that the UI edits; on save it's serialized.
    const model = {
      name: row?.name || '',
      description: row?.description || '',
      trigger_value: row?.trigger_value || '',
      start_step_id: row?.start_step_id || '',
      priority: row?.priority ?? 0,
      is_active: row?.is_active ?? 1,
      steps: JSON.parse(JSON.stringify(row?.steps || [])),
      jsonMode: false,
      openStepIds: new Set([row?.start_step_id].filter(Boolean)),
    };

    openModal(row ? 'フロー編集' : 'フロー新規', (form, actions) => {
      form.style.maxWidth = '100%';
      const body = form.parentElement;
      if (body) body.style.maxWidth = '780px';

      // --- Header fields ---
      const headWrap = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;' });
      const mk = (label, input) => el('div', {}, el('label', {}, label), input);
      const nameI = el('input', { value: model.name, placeholder: 'deposit-paypay' });
      const triggerI = el('input', { value: model.trigger_value, placeholder: '^(入金|deposit)' });
      const descI = el('input', { value: model.description, placeholder: '説明 (任意)' });
      const priI = el('input', { type: 'number', value: String(model.priority) });
      const actS = el('select', {},
        el('option', { value: '1' }, '有効'),
        el('option', { value: '0' }, '無効'));
      actS.value = String(model.is_active);
      const startS = el('select', {});  // populated in re-render
      headWrap.appendChild(mk('名前', nameI));
      headWrap.appendChild(mk('trigger (正規表現)', triggerI));
      headWrap.appendChild(mk('説明', descI));
      headWrap.appendChild(mk('開始 step', startS));
      headWrap.appendChild(mk('優先度', priI));
      headWrap.appendChild(mk('有効', actS));
      form.appendChild(headWrap);

      const validation = el('div', { class: 'slo-flow-validation' });
      form.appendChild(validation);

      // --- Step toolbar ---
      const tb = el('div', { class: 'slo-flow-toolbar' });
      const addSel = el('select', {},
        el('option', { value: 'input' }, 'input (顧客入力待ち)'),
        el('option', { value: 'select' }, 'select (ボタン選択)'),
        el('option', { value: 'message' }, 'message (bot がテキスト送信)'),
        el('option', { value: 'webhook' }, 'webhook (外部 POST)'),
        el('option', { value: 'handoff' }, 'handoff (人間へ引継ぎ)'));
      const addBtn = el('button', { type: 'button', class: 'slo-adm-btn', onclick: () => { addStep(addSel.value); } }, '+ ステップ追加');
      const toggleMode = el('button', { type: 'button', class: 'slo-flow-mode-toggle', onclick: () => { model.jsonMode = !model.jsonMode; renderSteps(); } }, 'JSON モード');
      tb.appendChild(addSel); tb.appendChild(addBtn); tb.appendChild(toggleMode);
      form.appendChild(tb);

      const stepsHost = el('div');
      form.appendChild(stepsHost);

      // --- Helpers ---
      function genStepId(type) {
        const base = type + '_' + (model.steps.filter((s) => s.type === type).length + 1);
        let id = base; let n = 1;
        while (model.steps.some((s) => s.id === id)) { id = base + '_' + (++n); }
        return id;
      }
      function addStep(type) {
        const id = genStepId(type);
        const step = { id, type };
        if (type === 'message') Object.assign(step, { content: '', next: null });
        if (type === 'input')   Object.assign(step, { prompt: '', var: '', validate: '', validate_error: '', next: null });
        if (type === 'select')  Object.assign(step, { prompt: 'ご選択ください', var: '', options: [{ title: '', value: '', next: null }] });
        if (type === 'webhook') Object.assign(step, { url: '', method: 'POST', body: {}, timeout_ms: 8000, next: null, on_error: null, error_message: 'システム連携でエラーが発生しました' });
        if (type === 'handoff') Object.assign(step, { note: '担当者にお繋ぎします' });
        model.steps.push(step);
        model.openStepIds.add(id);
        if (!model.start_step_id) model.start_step_id = id;
        renderSteps();
      }
      function moveStep(idx, delta) {
        const j = idx + delta;
        if (j < 0 || j >= model.steps.length) return;
        const [s] = model.steps.splice(idx, 1);
        model.steps.splice(j, 0, s);
        renderSteps();
      }
      function removeStep(idx) {
        const [removed] = model.steps.splice(idx, 1);
        // Null out any references to this step's id
        const stale = removed.id;
        for (const s of model.steps) {
          if (s.next === stale) s.next = null;
          if (s.on_error === stale) s.on_error = null;
          if (s.options) for (const o of s.options) if (o.next === stale) o.next = null;
        }
        if (model.start_step_id === stale) model.start_step_id = model.steps[0]?.id || '';
        model.openStepIds.delete(stale);
        renderSteps();
      }

      // --- Per-step renderer ---
      function stepCard(step, idx) {
        const openFlag = model.openStepIds.has(step.id);
        const card = el('div', { class: 'slo-flow-step', 'data-open': openFlag ? '1' : '0' });
        const preview = (() => {
          if (step.type === 'message') return step.content || '(empty)';
          if (step.type === 'input')   return step.prompt || '(prompt)';
          if (step.type === 'select')  return step.prompt + ' → ' + (step.options || []).map((o) => o.title).join(' / ');
          if (step.type === 'webhook') return (step.method || 'POST') + ' ' + (step.url || '');
          if (step.type === 'handoff') return step.note || '引継ぎ';
          return '';
        })();
        const head = el('div', { class: 'slo-flow-step-head', onclick: (ev) => {
          if (ev.target.closest('.slo-flow-step-actions')) return;
          if (model.openStepIds.has(step.id)) model.openStepIds.delete(step.id);
          else model.openStepIds.add(step.id);
          renderSteps();
        } },
          el('span', { class: 'slo-flow-step-type', 'data-t': step.type }, step.type),
          el('span', { class: 'slo-flow-step-id' }, step.id),
          el('span', { class: 'slo-flow-step-preview' }, preview),
          el('div', { class: 'slo-flow-step-actions' },
            el('button', { type: 'button', title: '上へ', disabled: idx === 0 ? '' : null, onclick: (ev) => { ev.stopPropagation(); moveStep(idx, -1); } }, '↑'),
            el('button', { type: 'button', title: '下へ', disabled: idx === model.steps.length - 1 ? '' : null, onclick: (ev) => { ev.stopPropagation(); moveStep(idx, 1); } }, '↓'),
            el('button', { type: 'button', class: 'danger', title: '削除', onclick: (ev) => { ev.stopPropagation(); removeStep(idx); } }, '×'))
        );
        card.appendChild(head);

        const bodyDiv = el('div', { class: 'slo-flow-step-body' });
        const stepIdsOptions = () => {
          const opts = [el('option', { value: '' }, '(終了)')];
          for (const s of model.steps) if (s.id !== step.id) opts.push(el('option', { value: s.id }, s.id));
          return opts;
        };
        const nextSelect = (key) => {
          const s = el('select', { onchange: () => { step[key] = s.value || null; refreshHeadPreview(head, step, card); } }, ...stepIdsOptions());
          s.value = step[key] || '';
          return s;
        };

        // Common: step id
        bodyDiv.appendChild(el('label', {}, 'id'));
        const idI = el('input', { value: step.id, onchange: () => {
          const newId = idI.value.trim();
          if (!newId || newId === step.id) { idI.value = step.id; return; }
          if (model.steps.some((s) => s.id === newId)) { (window.Sloten?.toast || alert)('id が重複しています', { type: 'error' }); idI.value = step.id; return; }
          const oldId = step.id;
          for (const s of model.steps) {
            if (s.next === oldId) s.next = newId;
            if (s.on_error === oldId) s.on_error = newId;
            if (s.options) for (const o of s.options) if (o.next === oldId) o.next = newId;
          }
          step.id = newId;
          if (model.start_step_id === oldId) model.start_step_id = newId;
          model.openStepIds.delete(oldId); model.openStepIds.add(newId);
          renderSteps();
        } });
        bodyDiv.appendChild(idI);

        if (step.type === 'message') {
          bodyDiv.appendChild(el('label', {}, '本文 (テンプレ OK: {{vars.x}})'));
          const c = el('textarea', { oninput: () => { step.content = c.value; } }, step.content || '');
          bodyDiv.appendChild(c);
          bodyDiv.appendChild(el('label', {}, '次のステップ')); bodyDiv.appendChild(nextSelect('next'));
        }
        if (step.type === 'input') {
          bodyDiv.appendChild(el('label', {}, 'prompt (bot が表示)'));
          const p = el('textarea', { oninput: () => { step.prompt = p.value; } }, step.prompt || '');
          bodyDiv.appendChild(p);
          bodyDiv.appendChild(el('label', {}, '保存先変数名 (vars.X)'));
          const v = el('input', { value: step.var || '', oninput: () => { step.var = v.value; } }); bodyDiv.appendChild(v);
          bodyDiv.appendChild(el('label', {}, 'validate (正規表現、空=検証なし)'));
          const val = el('input', { value: step.validate || '', oninput: () => { step.validate = val.value || ''; } }); bodyDiv.appendChild(val);
          bodyDiv.appendChild(el('label', {}, 'validate 失敗時メッセージ'));
          const ve = el('input', { value: step.validate_error || '', oninput: () => { step.validate_error = ve.value || ''; } }); bodyDiv.appendChild(ve);
          bodyDiv.appendChild(el('label', {}, '次のステップ')); bodyDiv.appendChild(nextSelect('next'));
        }
        if (step.type === 'select') {
          bodyDiv.appendChild(el('label', {}, 'prompt (ボタン上の文)'));
          const p = el('input', { value: step.prompt || '', oninput: () => { step.prompt = p.value; } }); bodyDiv.appendChild(p);
          bodyDiv.appendChild(el('label', {}, '選択肢'));
          const tbl = el('table', { class: 'slo-flow-options-table' });
          tbl.appendChild(el('thead', {}, el('tr', {},
            el('th', { style: 'width:28%' }, 'title (表示)'),
            el('th', { style: 'width:28%' }, 'value (送信値)'),
            el('th', {}, 'next'),
            el('th', { style: 'width:30px' }, ''))));
          const tbody = el('tbody');
          const renderOptions = () => {
            tbody.innerHTML = '';
            (step.options || []).forEach((opt, oi) => {
              const tInp = el('input', { value: opt.title || '', oninput: () => { opt.title = tInp.value; } });
              const vInp = el('input', { value: opt.value || '', oninput: () => { opt.value = vInp.value; } });
              const nextS = el('select', { onchange: () => { opt.next = nextS.value || null; } }, ...stepIdsOptions());
              nextS.value = opt.next || '';
              const del = el('button', { type: 'button', onclick: () => { step.options.splice(oi, 1); renderOptions(); } }, '×');
              tbody.appendChild(el('tr', {}, el('td', {}, tInp), el('td', {}, vInp), el('td', {}, nextS), el('td', {}, del)));
            });
          };
          tbl.appendChild(tbody); bodyDiv.appendChild(tbl);
          bodyDiv.appendChild(el('button', { type: 'button', class: 'slo-adm-btn slo-adm-btn-secondary', style: 'margin-top:6px;', onclick: () => { (step.options ||= []).push({ title: '', value: '', next: null }); renderOptions(); } }, '+ 選択肢追加'));
          bodyDiv.appendChild(el('label', {}, '保存先変数名 (vars.X、選択された value を保存)'));
          const v = el('input', { value: step.var || '', oninput: () => { step.var = v.value; } }); bodyDiv.appendChild(v);
          renderOptions();
        }
        if (step.type === 'webhook') {
          bodyDiv.appendChild(el('label', {}, 'URL (テンプレ OK)'));
          const u = el('input', { value: step.url || '', oninput: () => { step.url = u.value; } }); bodyDiv.appendChild(u);
          bodyDiv.appendChild(el('label', {}, 'method'));
          const m = el('select', { onchange: () => { step.method = m.value; } },
            el('option', { value: 'POST' }, 'POST'),
            el('option', { value: 'GET' }, 'GET'));
          m.value = step.method || 'POST'; bodyDiv.appendChild(m);
          bodyDiv.appendChild(el('label', {}, 'body (JSON、テンプレ OK)'));
          const b = el('textarea', {
            oninput: () => { try { step.body = JSON.parse(b.value); b.style.borderColor = ''; } catch { b.style.borderColor = '#dc2626'; } },
          }, JSON.stringify(step.body || {}, null, 2));
          bodyDiv.appendChild(b);
          bodyDiv.appendChild(el('label', {}, 'timeout (ms)'));
          const to = el('input', { type: 'number', value: String(step.timeout_ms ?? 8000), oninput: () => { step.timeout_ms = parseInt(to.value, 10) || 8000; } }); bodyDiv.appendChild(to);
          bodyDiv.appendChild(el('label', {}, '成功時の next')); bodyDiv.appendChild(nextSelect('next'));
          bodyDiv.appendChild(el('label', {}, 'エラー時の step (on_error)')); bodyDiv.appendChild(nextSelect('on_error'));
          bodyDiv.appendChild(el('label', {}, 'エラー時メッセージ'));
          const em = el('input', { value: step.error_message || '', oninput: () => { step.error_message = em.value || ''; } }); bodyDiv.appendChild(em);
        }
        if (step.type === 'handoff') {
          bodyDiv.appendChild(el('label', {}, '引継ぎ時メッセージ (任意)'));
          const t = el('textarea', { oninput: () => { step.note = t.value; } }, step.note || '');
          bodyDiv.appendChild(t);
        }
        card.appendChild(bodyDiv);
        return card;
      }
      function refreshHeadPreview() { renderSteps(); }

      function refreshStartStepOptions() {
        startS.innerHTML = '';
        for (const s of model.steps) {
          const opt = el('option', { value: s.id }, `${s.id} (${s.type})`);
          startS.appendChild(opt);
        }
        startS.value = model.start_step_id || (model.steps[0]?.id || '');
        model.start_step_id = startS.value;
      }
      startS.addEventListener('change', () => { model.start_step_id = startS.value; });

      function validateAll() {
        const errs = [];
        const ids = new Set(model.steps.map((s) => s.id));
        if (!model.name.trim()) errs.push('名前必須');
        if (!model.start_step_id) errs.push('開始 step 必須');
        else if (!ids.has(model.start_step_id)) errs.push('開始 step が存在しません');
        if (model.trigger_value) { try { new RegExp(model.trigger_value); } catch { errs.push('trigger 正規表現が不正'); } }
        for (const s of model.steps) {
          if (s.next && !ids.has(s.next)) errs.push(`${s.id}.next=${s.next} が存在しません`);
          if (s.on_error && !ids.has(s.on_error)) errs.push(`${s.id}.on_error=${s.on_error} が存在しません`);
          if (s.type === 'input' && !s.var) errs.push(`${s.id}: var 必須`);
          if (s.type === 'webhook' && !s.url) errs.push(`${s.id}: url 必須`);
          if (s.type === 'select') {
            for (const o of (s.options || [])) if (o.next && !ids.has(o.next)) errs.push(`${s.id}.options[${o.title}].next=${o.next} が存在しません`);
          }
          if (s.type === 'input' && s.validate) {
            try { new RegExp(s.validate || ''); } catch { errs.push(`${s.id}: validate 正規表現が不正`); }
          }
        }
        validation.textContent = errs.join(' / ');
        validation.setAttribute('data-visible', errs.length ? '1' : '0');
        return errs.length === 0;
      }

      function renderSteps() {
        stepsHost.innerHTML = '';
        if (model.jsonMode) {
          const ta = el('textarea', {
            style: 'min-height:360px;font-family:ui-monospace,monospace;font-size:12px;width:100%;',
            oninput: () => {
              try { model.steps = JSON.parse(ta.value); ta.style.borderColor = ''; } catch { ta.style.borderColor = '#dc2626'; }
            },
          }, JSON.stringify(model.steps, null, 2));
          stepsHost.appendChild(ta);
          toggleMode.textContent = 'ビジュアルモード';
        } else {
          const list = el('div', { class: 'slo-flow-steps' });
          if (model.steps.length === 0) list.appendChild(el('div', { style: 'padding:20px;text-align:center;color:#9ca3af;font-size:13px;' }, 'ステップを追加してください'));
          else model.steps.forEach((s, i) => list.appendChild(stepCard(s, i)));
          stepsHost.appendChild(list);
          toggleMode.textContent = 'JSON モード';
        }
        refreshStartStepOptions();
        validateAll();
      }

      // --- Sync header inputs into model ---
      nameI.addEventListener('input', () => { model.name = nameI.value; });
      descI.addEventListener('input', () => { model.description = descI.value; });
      triggerI.addEventListener('input', () => { model.trigger_value = triggerI.value; validateAll(); });
      priI.addEventListener('input', () => { model.priority = parseInt(priI.value, 10) || 0; });
      actS.addEventListener('change', () => { model.is_active = parseInt(actS.value, 10); });

      // Actions
      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: async () => {
        if (!validateAll()) { (window.Sloten?.toast || alert)('フロー定義に不備があります', { type: 'error' }); return; }
        const body = {
          name: model.name.trim(), description: model.description || null,
          trigger_type: 'entry', trigger_value: model.trigger_value || null,
          start_step_id: model.start_step_id,
          steps: model.steps,
          priority: model.priority,
          is_active: model.is_active,
        };
        try {
          if (row) await api('PATCH', `/api/bot-flows/${row.id}`, body);
          else     await api('POST', '/api/bot-flows', body);
          closeModal(); navigate('bot-flows');
        } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
      } }, '保存'));

      // Initial render
      renderSteps();
    });
  }
  async function deleteFlow(id) {
    if (!(await confirmDialog('このフローを削除しますか？'))) return;
    try { await api('DELETE', `/api/bot-flows/${id}`); navigate('bot-flows'); }
    catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
  }

  // --- Bot menus ---
  async function renderBotMenus(root) {
    root.appendChild(el('h2', {}, 'ボットメニュー'));
    root.appendChild(el('p', { style: 'color:#6b7280;margin:0 0 16px;' },
      '顧客チャットに表示するボタン付きメニュー。default=会話開始時に自動表示 / keyword=顧客メッセージの正規表現マッチ / fallback=AI が応答できない時。'));
    const tb = el('div', { class: 'slo-adm-sect-toolbar' },
      el('button', { class: 'slo-adm-btn', onclick: () => botMenuModal() }, '+ 新規'));
    root.appendChild(tb);
    const listDiv = el('div');
    root.appendChild(listDiv);
    try {
      const r = await api('GET', '/api/bot-menus');
      state.data.botMenus = r.menus || [];
      renderBotMenusTable(listDiv);
    } catch (e) { listDiv.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderBotMenusTable(root) {
    root.innerHTML = '';
    const rows = state.data.botMenus || [];
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, 'メニューはありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:20%' }, '名前'),
      el('th', { style: 'width:90px' }, '種別'),
      el('th', { style: 'width:30%' }, 'トリガー (regex)'),
      el('th', {}, '項目数 / プロンプト'),
      el('th', { style: 'width:70px' }, 'priority'),
      el('th', { style: 'width:70px' }, '有効'),
      el('th', { style: 'width:140px' }, ''))));
    const tbody = el('tbody');
    for (const r of rows) {
      tbody.appendChild(el('tr', {},
        el('td', {}, r.name),
        el('td', {}, el('span', { class: 'slo-adm-badge', 'data-role': r.trigger_type === 'default' ? 'admin' : r.trigger_type === 'keyword' ? 'agent' : 'viewer' }, r.trigger_type)),
        el('td', { style: 'font-family:ui-monospace,monospace;font-size:11px;' }, r.trigger_value || '—'),
        el('td', {}, `${r.items?.length || 0} 項目 · ${(r.prompt || '').slice(0, 40)}`),
        el('td', {}, String(r.priority)),
        el('td', {}, el('span', { class: 'slo-adm-badge', 'data-active': String(r.is_active ?? 0) }, r.is_active ? '有効' : '無効')),
        el('td', {}, el('div', { class: 'slo-adm-row-actions' },
          el('button', { onclick: () => botMenuModal(r) }, '編集'),
          el('button', { class: 'danger', onclick: () => deleteBotMenu(r.id) }, '削除')))
      ));
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }
  function botMenuModal(row) {
    openModal(row ? 'ボットメニュー編集' : 'ボットメニュー新規', (form, actions) => {
      form.appendChild(el('label', {}, '名前'));
      const n = el('input', { value: row?.name || '' }); form.appendChild(n);
      form.appendChild(el('label', {}, '種別'));
      const t = el('select', {},
        el('option', { value: 'default' }, 'default (会話開始時に自動表示)'),
        el('option', { value: 'keyword' }, 'keyword (顧客メッセージにマッチ)'),
        el('option', { value: 'fallback' }, 'fallback (AI 応答不能時)'));
      t.value = row?.trigger_type || 'keyword';
      form.appendChild(t);
      const trigWrap = el('div', {});
      trigWrap.appendChild(el('label', {}, 'トリガー正規表現 (keyword 時のみ)'));
      const tv = el('input', { value: row?.trigger_value || '', placeholder: '例: ^入金$|^deposit$' });
      trigWrap.appendChild(tv);
      form.appendChild(trigWrap);
      function refreshTriggerVisibility() { trigWrap.style.display = t.value === 'keyword' ? '' : 'none'; }
      t.addEventListener('change', refreshTriggerVisibility);
      refreshTriggerVisibility();

      form.appendChild(el('label', {}, 'プロンプト (ボタンの上に表示するテキスト)'));
      const p = el('input', { value: row?.prompt || 'ご用件をお選びください。' }); form.appendChild(p);

      form.appendChild(el('label', {}, '項目 (title と value)'));
      const itemsWrap = el('div', { style: 'display:flex;flex-direction:column;gap:4px;' });
      const rowsDiv = el('div', { style: 'display:flex;flex-direction:column;gap:4px;' });
      function makeRow(title, value) {
        const tInp = el('input', { placeholder: 'title (表示名)', value: title || '', style: 'flex:2' });
        const vInp = el('input', { placeholder: 'value (送信値)', value: value || '', style: 'flex:2' });
        const del = el('button', { type: 'button', style: 'width:30px;border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:4px;', onclick: () => line.remove() }, '×');
        const line = el('div', { style: 'display:flex;gap:4px;' }, tInp, vInp, del);
        line.__get = () => ({ title: tInp.value, value: vInp.value || tInp.value });
        return line;
      }
      const seedItems = row?.items?.length ? row.items : [{ title: '', value: '' }];
      for (const it of seedItems) rowsDiv.appendChild(makeRow(it.title, it.value));
      itemsWrap.appendChild(rowsDiv);
      itemsWrap.appendChild(el('button', { type: 'button', class: 'slo-adm-btn slo-adm-btn-secondary', style: 'align-self:flex-start;margin-top:4px;', onclick: () => rowsDiv.appendChild(makeRow()) }, '+ 項目追加'));
      form.appendChild(itemsWrap);

      form.appendChild(el('label', {}, '優先度 (大きい順にチェック)'));
      const pri = el('input', { type: 'number', value: String(row?.priority ?? 0) }); form.appendChild(pri);
      form.appendChild(el('label', {}, '有効'));
      const act = el('select', {},
        el('option', { value: '1' }, '有効'),
        el('option', { value: '0' }, '無効'));
      act.value = (row?.is_active ?? 1) ? '1' : '0';
      form.appendChild(act);

      actions.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: closeModal }, 'キャンセル'));
      actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: async () => {
        const items = [...rowsDiv.querySelectorAll(':scope > div')].map((d) => d.__get()).filter((it) => it.title.trim());
        const body = {
          name: n.value.trim(), trigger_type: t.value,
          trigger_value: t.value === 'keyword' ? tv.value : null,
          prompt: p.value, items,
          priority: parseInt(pri.value, 10) || 0, is_active: act.value === '1' ? 1 : 0,
        };
        try {
          if (row) await api('PATCH', `/api/bot-menus/${row.id}`, body);
          else     await api('POST', '/api/bot-menus', body);
          closeModal(); navigate('bot-menus');
        } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
      } }, '保存'));
    });
  }
  async function deleteBotMenu(id) {
    if (!(await confirmDialog('このメニューを削除しますか？'))) return;
    try { await api('DELETE', `/api/bot-menus/${id}`); navigate('bot-menus'); }
    catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
  }


  // --- Register sections ---
  A.section('faq-candidates', renderFaqCandidates);
  A.section('bot-flows', renderBotFlows);
  A.section('bot-menus', renderBotMenus);
})();
