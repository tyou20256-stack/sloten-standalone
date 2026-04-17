// admin section: content
(function() {
  const A = window.SlotenAdmin;
  const { state, api, el, $, $$, navigate, openModal, closeModal, confirmDialog, esc, fmtDate, fmtNum, humanizeError, toastErr, isStale, registerCleanup, downloadCsv, toolbar, updateBadge } = A;

  async function renderFaq(root) {
    root.appendChild(el('h2', {}, 'FAQ'));
    // Toolbar (search + new button) — mirrors reference admin
    const toolbarRow = el('div', { class: 'slo-adm-sect-toolbar' });
    toolbarRow.appendChild(el('input', { type: 'search', placeholder: 'FAQを検索...', oninput: (ev) => { state.searchFilter.faq = ev.target.value; renderFaqTable(listBody); }}));
    toolbarRow.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: () => faqModal() }, '+ 新規FAQ'));
    toolbarRow.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: () => downloadCsv('faq') }, '📥 CSV'));
    root.appendChild(toolbarRow);
    // Card container
    const card = el('div', { class: 'slo-adm-card' });
    const cardHeader = el('div', { class: 'slo-adm-card-header' });
    cardHeader.appendChild(el('div', { class: 'slo-adm-card-title' }, 'よくある質問', el('span', { id: 'faqCount', style: 'font-size:13px;color:#6b7280;font-weight:400;margin-left:8px;' })));
    cardHeader.appendChild(el('span', { style: 'font-size:12px;color:#6b7280;' }, '優先度の高い順'));
    card.appendChild(cardHeader);
    const listBody = el('div', { class: 'slo-adm-card-body slo-adm-card-body--tight' });
    card.appendChild(listBody);
    root.appendChild(card);
    try {
      const r = await api('GET', '/api/faq');
      state.data.faq = r.faqs || r.faq || [];
      state.data.faq.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      renderFaqTable(listBody);
    } catch (e) { listBody.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderFaqTable(root) {
    root.innerHTML = '';
    const q = (state.searchFilter.faq || '').toLowerCase();
    const rows = (state.data.faq || []).filter((r) => !q
      || (r.question || '').toLowerCase().includes(q)
      || (r.answer || '').toLowerCase().includes(q)
      || (r.category || '').toLowerCase().includes(q));
    const counter = document.getElementById('faqCount');
    if (counter) counter.textContent = `(${rows.length} 件)`;
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, '該当する FAQ はありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:40%' }, '質問'),
      el('th', { style: 'width:140px' }, 'カテゴリ'),
      el('th', { style: 'width:80px' }, '優先度'),
      el('th', { style: 'width:90px;text-align:right;' }, '使用数'),
      el('th', { style: 'width:80px' }, '状態'),
      el('th', { style: 'width:140px' }, '操作'))));
    const tbody = el('tbody');
    for (const r of rows) {
      tbody.appendChild(el('tr', {},
        el('td', {}, el('div', { style: 'font-weight:500;' }, (r.question || '').slice(0, 100)),
                       el('div', { style: 'font-size:11px;color:#6b7280;margin-top:2px;' }, (r.answer || '').replace(/\s+/g, ' ').slice(0, 80))),
        el('td', {}, el('span', { class: 'slo-adm-badge slo-adm-badge-info' }, r.category || '一般')),
        el('td', {}, String(r.priority ?? 0)),
        el('td', { style: 'text-align:right;' }, String(r.usage_count || 0)),
        el('td', {}, el('span', { class: 'slo-adm-status-pill ' + (r.is_active ? 'active' : 'inactive') }, r.is_active ? '有効' : '無効')),
        el('td', {}, el('div', { style: 'display:flex;gap:6px;' },
          el('button', { class: 'slo-adm-btn slo-adm-btn-sm', onclick: () => faqModal(r) }, '編集'),
          el('button', { class: 'slo-adm-btn slo-adm-btn-sm slo-adm-btn-danger', onclick: () => deleteFaq(r.id) }, '削除')))
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
        } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
      } }, '保存'));
    });
  }
  async function deleteFaq(id) {
    if (!(await confirmDialog('この FAQ を削除しますか？'))) return;
    try { await api('DELETE', `/api/faq/${id}`); navigate('faq'); } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
  }

  // --- Templates ---
  async function renderTemplates(root) {
    root.appendChild(el('h2', {}, 'テンプレート'));
    const toolbarRow = el('div', { class: 'slo-adm-sect-toolbar' });
    toolbarRow.appendChild(el('input', { type: 'search', placeholder: 'テンプレートを検索…', oninput: (ev) => { state.searchFilter.tpl = ev.target.value; renderTplTable(listBody); }}));
    const catSel = el('select', { onchange: (ev) => { state.tplCatFilter = ev.target.value; renderTplTable(listBody); }},
      el('option', { value: '' }, '全カテゴリ'));
    toolbarRow.appendChild(catSel);
    const langSel = el('select', { onchange: (ev) => { state.tplLangFilter = ev.target.value; renderTplTable(listBody); }},
      el('option', { value: '' }, '全言語'),
      el('option', { value: 'ja' }, '日本語'),
      el('option', { value: 'en' }, 'English'));
    toolbarRow.appendChild(langSel);
    toolbarRow.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: () => tplModal() }, '+ 新規テンプレート'));
    toolbarRow.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: () => downloadCsv('templates') }, '📥 CSV'));
    root.appendChild(toolbarRow);

    const card = el('div', { class: 'slo-adm-card' });
    const cardHeader = el('div', { class: 'slo-adm-card-header' });
    cardHeader.appendChild(el('div', { class: 'slo-adm-card-title' }, '返信テンプレート ',
      el('span', { id: 'tplCount', style: 'font-size:13px;color:#6b7280;font-weight:400;margin-left:8px;' })));
    cardHeader.appendChild(el('span', { style: 'font-size:12px;color:#6b7280;' }, '使用数が多い順に表示'));
    card.appendChild(cardHeader);
    const listBody = el('div', { class: 'slo-adm-card-body slo-adm-card-body--tight' });
    card.appendChild(listBody);
    root.appendChild(card);

    try {
      const r = await api('GET', '/api/templates?tenant_id=tenant_default');
      state.data.templates = (r.templates || []).slice().sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
      // Populate category filter from data
      const cats = [...new Set(state.data.templates.map(t => t.category).filter(Boolean))].sort();
      for (const c of cats) catSel.appendChild(el('option', { value: c }, c));
      renderTplTable(listBody);
    } catch (e) { listBody.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderTplTable(root) {
    root.innerHTML = '';
    const q = (state.searchFilter.tpl || '').toLowerCase();
    const cat = state.tplCatFilter || '';
    const lang = state.tplLangFilter || '';
    const rows = (state.data.templates || []).filter((r) => {
      if (q && !((r.name || '').toLowerCase().includes(q)
              || (r.content || '').toLowerCase().includes(q)
              || (r.category || '').toLowerCase().includes(q)
              || (r.shortcut || '').toLowerCase().includes(q))) return false;
      if (cat && (r.category || '') !== cat) return false;
      if (lang && (r.language || 'ja') !== lang) return false;
      return true;
    });
    const counter = document.getElementById('tplCount');
    if (counter) counter.textContent = `(${rows.length} 件)`;
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, '該当するテンプレートはありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, '名前'),
      el('th', { style: 'width:140px' }, 'カテゴリ'),
      el('th', { style: 'width:70px' }, '言語'),
      el('th', { style: 'width:120px' }, 'ショートカット'),
      el('th', { style: 'width:90px;text-align:right;' }, '使用数'),
      el('th', { style: 'width:140px' }, '操作'))));
    const tbody = el('tbody');
    for (const r of rows) {
      tbody.appendChild(el('tr', {},
        el('td', {}, el('div', { style: 'font-weight:500;' }, r.name || ''),
                       el('div', { style: 'font-size:11px;color:#6b7280;margin-top:2px;' }, (r.content || '').replace(/\s+/g, ' ').slice(0, 100))),
        el('td', {}, r.category ? el('span', { class: 'slo-adm-badge slo-adm-badge-info' }, r.category) : el('span', { class: 'slo-adm-muted' }, '—')),
        el('td', {}, el('span', { class: 'slo-adm-badge slo-adm-badge-gray' }, r.language || 'ja')),
        el('td', {}, r.shortcut ? el('code', { style: 'background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:12px;' }, r.shortcut) : '—'),
        el('td', { style: 'text-align:right;font-variant-numeric:tabular-nums;' }, String(r.usage_count ?? r.use_count ?? 0)),
        el('td', {}, el('div', { style: 'display:flex;gap:6px;' },
          el('button', { class: 'slo-adm-btn slo-adm-btn-sm', onclick: () => tplModal(r) }, '編集'),
          el('button', { class: 'slo-adm-btn slo-adm-btn-sm slo-adm-btn-danger', onclick: () => deleteTpl(r.id) }, '削除')))
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
        } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
      } }, '保存'));
    });
  }
  async function deleteTpl(id) {
    if (!(await confirmDialog('このテンプレートを削除しますか？'))) return;
    try { await api('DELETE', `/api/templates/${id}`); navigate('templates'); } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
  }

  // --- Knowledge sources (mirrors reference: 3 tabs URL/Text/Recommended + table) ---
  async function renderKnowledge(root) {
    root.appendChild(el('h2', {}, 'ナレッジベース'));

    // Tab bar
    const tabBar = el('div', { class: 'slo-adm-tabs' });
    const tabUrl = el('button', { 'data-active': '1', onclick: () => switchTab('url') }, '🌐 URL登録');
    const tabText = el('button', { onclick: () => switchTab('text') }, '📝 テキスト登録');
    const tabReco = el('button', { onclick: () => switchTab('recommend') }, '⭐ 推奨URL');
    tabBar.appendChild(tabUrl); tabBar.appendChild(tabText); tabBar.appendChild(tabReco);
    tabBar.appendChild(el('div', { style: 'flex:1;' }));
    tabBar.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: () => navigate('knowledge') }, '🔄 一覧更新'));
    tabBar.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: () => downloadCsv('knowledge') }, '📥 CSV'));
    root.appendChild(tabBar);

    // ----- URL登録 panel -----
    const urlPanel = el('div', { class: 'slo-adm-card', style: 'margin-bottom:20px;' });
    urlPanel.appendChild(el('div', { class: 'slo-adm-card-header' },
      el('div', { class: 'slo-adm-card-title' }, '🌐 URL からナレッジを追加')));
    const urlBody = el('div', { class: 'slo-adm-card-body' });
    const urlRow = el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:end;' });
    const urlField = (label, child, flex) => el('div', { style: `flex:${flex};min-width:120px;` },
      el('label', { style: 'font-size:12px;color:#6b7280;display:block;margin-bottom:4px;' }, label), child);
    const urlInp = el('input', { type: 'url', placeholder: 'https://example.com/page' });
    const urlPriSel = el('select', {},
      el('option', { value: '5' }, '5 - 最重要'), el('option', { value: '4' }, '4 - 重要'),
      el('option', { value: '3', selected: '' }, '3 - 通常'), el('option', { value: '2' }, '2 - 低'),
      el('option', { value: '1' }, '1 - 最低'));
    const urlCatSel = el('select', {},
      el('option', { value: 'general' }, '一般'),
      el('option', { value: 'legal' }, '法務・規約'),
      el('option', { value: 'campaign' }, 'キャンペーン'),
      el('option', { value: 'faq' }, 'FAQ'),
      el('option', { value: 'manual' }, 'マニュアル'));
    const urlAuto = el('input', { type: 'checkbox' });
    urlRow.appendChild(urlField('URL', urlInp, '2'));
    urlRow.appendChild(urlField('優先度', urlPriSel, '0.5'));
    urlRow.appendChild(urlField('カテゴリ', urlCatSel, '0.5'));
    urlRow.appendChild(el('div', { style: 'display:flex;align-items:center;gap:6px;padding-bottom:10px;' }, urlAuto, el('label', { style: 'font-size:12px;color:#6b7280;' }, '自動更新')));
    urlRow.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: async () => {
      const u = urlInp.value.trim();
      if (!u) return (window.Sloten?.toast || alert)('URL を入力してください', { type: 'warning' });
      try {
        await api('POST', '/api/knowledge-sources', {
          source_type: 'url', url: u,
          priority: parseInt(urlPriSel.value, 10),
          category: urlCatSel.value,
          auto_refresh: urlAuto.checked ? 1 : 0,
        });
        (window.Sloten?.toast||(()=>{}))('追加しました', { type: 'success' });
        navigate('knowledge');
      } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
    }}, '+ URL追加'));
    urlBody.appendChild(urlRow);
    urlPanel.appendChild(urlBody);
    root.appendChild(urlPanel);

    // ----- Text panel -----
    const textPanel = el('div', { class: 'slo-adm-card', style: 'margin-bottom:20px;display:none;' });
    textPanel.appendChild(el('div', { class: 'slo-adm-card-header' },
      el('div', { class: 'slo-adm-card-title' }, '📝 テキストナレッジを直接登録')));
    const textBody = el('div', { class: 'slo-adm-card-body' });
    const txtTopRow = el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin-bottom:12px;' });
    const txtTitle = el('input', { type: 'text', placeholder: '例: 春のキャンペーン情報' });
    const txtPri = el('select', {},
      el('option', { value: '5' }, '5 - 最重要'), el('option', { value: '4' }, '4 - 重要'),
      el('option', { value: '3', selected: '' }, '3 - 通常'), el('option', { value: '2' }, '2 - 低'),
      el('option', { value: '1' }, '1 - 最低'));
    const txtCat = el('select', {},
      el('option', { value: 'general' }, '一般'),
      el('option', { value: 'campaign' }, 'キャンペーン'),
      el('option', { value: 'manual' }, 'マニュアル'),
      el('option', { value: 'faq' }, 'FAQ'),
      el('option', { value: 'legal' }, '法務・規約'));
    txtTopRow.appendChild(urlField('タイトル', txtTitle, '2'));
    txtTopRow.appendChild(urlField('優先度', txtPri, '0.5'));
    txtTopRow.appendChild(urlField('カテゴリ', txtCat, '0.5'));
    textBody.appendChild(txtTopRow);
    textBody.appendChild(el('label', { style: 'font-size:12px;color:#6b7280;display:block;margin:6px 0;' }, '本文'));
    const txtContent = el('textarea', { rows: '8', placeholder: 'AIに学習させたいテキストを入力してください...' });
    textBody.appendChild(txtContent);
    textBody.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-primary', style: 'margin-top:12px;', onclick: async () => {
      const t = txtTitle.value.trim();
      const c = txtContent.value.trim();
      if (!t || !c) return (window.Sloten?.toast || alert)('タイトルと本文を入力してください', { type: 'warning' });
      try {
        await api('POST', '/api/knowledge-sources', {
          source_type: 'text', title: t, content: c,
          priority: parseInt(txtPri.value, 10),
          category: txtCat.value,
        });
        (window.Sloten?.toast||(()=>{}))('追加しました', { type: 'success' });
        navigate('knowledge');
      } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
    }}, '📝 テキスト追加'));
    textPanel.appendChild(textBody);
    root.appendChild(textPanel);

    // ----- Recommend panel -----
    const recoPanel = el('div', { class: 'slo-adm-card', style: 'margin-bottom:20px;display:none;' });
    recoPanel.appendChild(el('div', { class: 'slo-adm-card-header' },
      el('div', { class: 'slo-adm-card-title' }, '⭐ Sloten 推奨URL（未取込は一括追加可能）')));
    recoPanel.appendChild(el('div', { class: 'slo-adm-card-body' },
      el('div', { class: 'slo-adm-empty' }, 'ここに表示する推奨URLはまだありません。 URL/テキスト登録タブから個別にナレッジを追加してください。')));
    root.appendChild(recoPanel);

    function switchTab(t) {
      [tabUrl, tabText, tabReco].forEach(b => b.removeAttribute('data-active'));
      urlPanel.style.display = textPanel.style.display = recoPanel.style.display = 'none';
      if (t === 'url')       { tabUrl.setAttribute('data-active', '1'); urlPanel.style.display = ''; }
      else if (t === 'text') { tabText.setAttribute('data-active', '1'); textPanel.style.display = ''; }
      else                   { tabReco.setAttribute('data-active', '1'); recoPanel.style.display = ''; }
    }

    // ----- List card -----
    const card = el('div', { class: 'slo-adm-card' });
    const cardHeader = el('div', { class: 'slo-adm-card-header' });
    cardHeader.appendChild(el('div', { class: 'slo-adm-card-title' }, '登録済みナレッジ ',
      el('span', { id: 'kbCount', style: 'font-size:13px;color:#6b7280;font-weight:400;margin-left:8px;' })));
    const searchInp = el('input', { type: 'search', placeholder: 'タイトル・内容で絞り込み…',
      style: 'width:240px;font-size:13px;padding:6px 12px;',
      oninput: (ev) => { state.searchFilter.kb = ev.target.value; renderKbTable(listBody); }});
    cardHeader.appendChild(searchInp);
    card.appendChild(cardHeader);
    const listBody = el('div', { class: 'slo-adm-card-body slo-adm-card-body--tight' });
    card.appendChild(listBody);
    root.appendChild(card);

    try {
      const r = await api('GET', '/api/knowledge-sources');
      state.data.kb = r.sources || r.data || r.knowledge_sources || r.results || [];
      renderKbTable(listBody);
    } catch (e) { listBody.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderKbTable(root) {
    root.innerHTML = '';
    const q = (state.searchFilter.kb || '').toLowerCase();
    const rows = (state.data.kb || []).filter((r) => !q
      || (r.title || '').toLowerCase().includes(q)
      || (r.content || '').toLowerCase().includes(q)
      || (r.category || '').toLowerCase().includes(q)
      || (r.url || '').toLowerCase().includes(q));
    const counter = document.getElementById('kbCount');
    if (counter) counter.textContent = `(${rows.length} 件)`;
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, 'ナレッジはありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:60px;' }, '種別'),
      el('th', {}, 'タイトル'),
      el('th', { style: 'width:240px;' }, 'URL/ソース'),
      el('th', { style: 'width:80px;text-align:center;' }, '優先度'),
      el('th', { style: 'width:120px;' }, 'カテゴリ'),
      el('th', { style: 'width:80px;text-align:center;' }, '自動更新'),
      el('th', { style: 'width:140px;' }, '最終更新'),
      el('th', { style: 'width:80px;' }, 'ステータス'),
      el('th', { style: 'width:140px;' }, '操作'))));
    const tbody = el('tbody');
    for (const r of rows) {
      const typeBadge = r.source_type === 'url'
        ? el('span', { class: 'slo-adm-badge slo-adm-badge-info' }, '🌐 URL')
        : el('span', { class: 'slo-adm-badge slo-adm-badge-gray' }, '📝 TEXT');
      tbody.appendChild(el('tr', {},
        el('td', {}, typeBadge),
        el('td', {}, el('div', { style: 'font-weight:500;' }, r.title || '—'),
                       el('div', { style: 'font-size:11px;color:#6b7280;margin-top:2px;' }, (r.content || '').replace(/\s+/g, ' ').slice(0, 80))),
        el('td', { style: 'font-size:11px;font-family:monospace;color:#6b7280;overflow:hidden;text-overflow:ellipsis;max-width:240px;white-space:nowrap;' }, r.url || '(direct text)'),
        el('td', { style: 'text-align:center;font-weight:600;' }, String(r.priority ?? 3)),
        el('td', {}, el('span', { class: 'slo-adm-badge slo-adm-badge-info' }, r.category || 'general')),
        el('td', { style: 'text-align:center;' }, r.auto_refresh ? '✓' : '—'),
        el('td', { style: 'font-size:11px;color:#6b7280;' }, fmtDate(r.last_refreshed_at || r.updated_at || r.created_at)),
        el('td', {}, el('span', { class: 'slo-adm-status-pill ' + (r.is_active ? 'active' : 'inactive') }, r.is_active ? '有効' : '無効')),
        el('td', {}, el('div', { style: 'display:flex;gap:6px;' },
          el('button', { class: 'slo-adm-btn slo-adm-btn-sm', onclick: () => kbModal(r) }, '編集'),
          el('button', { class: 'slo-adm-btn slo-adm-btn-sm slo-adm-btn-danger', onclick: () => deleteKb(r.id) }, '削除')))
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
        } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
      } }, '保存'));
    });
  }
  async function deleteKb(id) {
    if (!(await confirmDialog('このナレッジを削除しますか？'))) return;
    try { await api('DELETE', `/api/knowledge-sources/${id}`); navigate('knowledge'); } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
  }

  // --- Labels (タグ) ---
  async function renderLabels(root) {
    root.appendChild(el('h2', {}, 'タグ'));
    const card = el('div', { class: 'slo-adm-card' });
    const cardHeader = el('div', { class: 'slo-adm-card-header' });
    cardHeader.appendChild(el('div', { class: 'slo-adm-card-title' }, 'タグ管理 ',
      el('span', { id: 'lbCount', style: 'font-size:13px;color:#6b7280;font-weight:400;margin-left:8px;' })));
    const right = el('div', { style: 'display:flex;gap:8px;align-items:center;' });
    right.appendChild(el('input', { type: 'search', placeholder: '名前で絞り込み…',
      style: 'width:200px;font-size:13px;padding:6px 12px;',
      oninput: (ev) => { state.searchFilter.lb = ev.target.value; renderLabelsTable(listBody); }}));
    right.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-primary', onclick: () => labelModal() }, '+ 新規タグ'));
    cardHeader.appendChild(right);
    card.appendChild(cardHeader);
    const listBody = el('div', { class: 'slo-adm-card-body slo-adm-card-body--tight' });
    card.appendChild(listBody);
    root.appendChild(card);
    try {
      const r = await api('GET', '/api/labels');
      state.data.labels = r.labels || [];
      renderLabelsTable(listBody);
    } catch (e) { listBody.innerHTML = '<div class="slo-adm-empty">エラー: ' + esc(e.message) + '</div>'; }
  }
  function renderLabelsTable(root) {
    root.innerHTML = '';
    const q = (state.searchFilter.lb || '').toLowerCase();
    const rows = (state.data.labels || []).filter((r) => !q || (r.name || '').toLowerCase().includes(q));
    const counter = document.getElementById('lbCount');
    if (counter) counter.textContent = `(${rows.length} 件)`;
    if (rows.length === 0) { root.appendChild(el('div', { class: 'slo-adm-empty' }, 'タグはありません')); return; }
    const table = el('table', { class: 'slo-adm-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: 'width:60px;' }, '色'),
      el('th', {}, '名前'),
      el('th', {}, '説明'),
      el('th', { style: 'width:90px;text-align:right;' }, '使用数'),
      el('th', { style: 'width:140px;' }, '操作'))));
    const tbody = el('tbody');
    for (const r of rows) {
      tbody.appendChild(el('tr', {},
        el('td', {}, el('span', { class: 'slo-adm-color-dot', style: `background:${r.color || '#6b7280'};` })),
        el('td', { style: 'font-weight:500;' }, r.name || ''),
        el('td', { style: 'color:#6b7280;' }, r.description || '—'),
        el('td', { style: 'text-align:right;font-variant-numeric:tabular-nums;' }, String(r.usage_count || 0)),
        el('td', {}, el('div', { style: 'display:flex;gap:6px;' },
          el('button', { class: 'slo-adm-btn slo-adm-btn-sm', onclick: () => labelModal(r) }, '編集'),
          el('button', { class: 'slo-adm-btn slo-adm-btn-sm slo-adm-btn-danger', onclick: () => deleteLabel(r.id) }, '削除')))
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
        } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
      } }, '保存'));
    });
  }
  async function deleteLabel(id) {
    if (!(await confirmDialog('このラベルを削除しますか？ 会話のラベル参照も削除されます。'))) return;
    try { await api('DELETE', `/api/labels/${id}`); navigate('labels'); } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
  }

  // --- Staff ---
  async function renderStaff(root) {
    root.appendChild(el('h2', {}, 'スタッフ'));
    const tb = toolbar('メール・名前で絞り込み…', (q) => { state.searchFilter.st = q; renderStaffTable(listDiv); }, () => staffModal());
    tb.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: bulkImportStaff }, 'Chatwoot 担当者を一括インポート'));
    tb.appendChild(el('button', { class: 'slo-adm-btn slo-adm-btn-secondary', onclick: () => downloadCsv('staff') }, '📥 CSV'));
    root.appendChild(tb);
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
        } catch (e) { (window.Sloten?.toast || alert)(e.message, { type: 'error' }); }
      } }, row ? '保存' : '追加'));
    });
  }
  async function resetPassword(row) {
    if (!(await confirmDialog(`${row.email} のパスワードを再発行しますか？`))) return;
    try {
      const r = await api('POST', `/api/staff/${row.id}/reset_password`);
      showGeneratedPassword(r.email, r.password);
    } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
  }
  async function deleteStaff(row) {
    if (row.id === state.staff?.id) { (window.Sloten?.toast||alert)('自分自身は削除できません', { type: 'warning' }); return; }
    if (!(await confirmDialog(`${row.email} を削除しますか？担当していた会話は未割当になります。`))) return;
    try { await api('DELETE', `/api/staff/${row.id}`); navigate('staff'); } catch (e) { (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
  }
  async function bulkImportStaff() {
    if (!(await confirmDialog('Chatwoot の担当者 email から未登録スタッフを一括作成し、会話の assignee_id を復元します。続行しますか？'))) return;
    // Small loading overlay while waiting for the backend.
    const loading = el('div', {
      style: 'position:fixed;inset:0;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;z-index:3000;color:#fff;font-size:14px;',
    }, 'インポート中…');
    document.body.appendChild(loading);
    try {
      const r = await api('POST', '/api/staff/import_from_chatwoot?show_passwords=1');
      loading.remove();
      openModal('一括インポート結果', (form, actions) => {
        form.appendChild(el('p', {}, `対象 email: ${r.total_emails} / 新規作成: ${r.created_count} / 既存スキップ: ${r.skipped_count} / 会話 backfill: ${r.backfilled_conversations}`));
        if (r.created.length) {
          form.appendChild(el('p', { style: 'color:#b91c1c;font-weight:600;' }, '⚠️ パスワードは 1 回のみ表示されます。必ずコピーしてください。'));
          const table = el('table', { class: 'slo-adm-table', style: 'margin-top:8px;' });
          table.appendChild(el('thead', {}, el('tr', {}, el('th', {}, 'Email'), el('th', {}, 'Password'))));
          const tb = el('tbody');
          for (const c of r.created) {
            tb.appendChild(el('tr', {},
              el('td', { style: 'font-family:ui-monospace,monospace;font-size:12px;' }, c.email),
              el('td', { style: 'font-family:ui-monospace,monospace;font-size:12px;' }, c.password)));
          }
          table.appendChild(tb);
          form.appendChild(table);
        }
        actions.appendChild(el('button', { class: 'slo-adm-btn', onclick: () => { closeModal(); navigate('staff'); } }, '閉じる'));
        if (r.created.length) {
          actions.insertBefore(el('button', {
            class: 'slo-adm-btn slo-adm-btn-secondary',
            onclick: () => {
              const csv = '\uFEFFemail,password\n' + r.created.map((c) => `"${c.email}","${c.password}"`).join('\n');
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const u = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = u; a.download = `staff-passwords-${new Date().toISOString().slice(0,10)}.csv`;
              a.click(); URL.revokeObjectURL(u);
            },
          }, '📥 CSV ダウンロード'), actions.firstChild);
        }
      });
    } catch (e) { loading.remove(); (window.Sloten?.toast||alert)(e.message, { type: 'error' }); }
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


  // --- Register sections ---
  A.section('faq', renderFaq);
  A.section('templates', renderTemplates);
  A.section('knowledge', renderKnowledge);
  A.section('labels', renderLabels);
  A.section('staff', renderStaff);
})();
