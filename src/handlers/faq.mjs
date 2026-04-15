// 弊社側暫定実装 — tking510 納品版で置き換え予定
import { detectInputThreat } from '../responseFilter.mjs';

const json = (obj, status, corsHeaders) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
const ok = (obj, corsHeaders) => json(obj, 200, corsHeaders);
const err = (msg, status, corsHeaders) => json({ success: false, error: msg }, status, corsHeaders);

async function parseJson(request, corsHeaders) {
  try {
    return { body: await request.json() };
  } catch {
    return { response: err('Invalid JSON', 400, corsHeaders) };
  }
}

const FAQ_COLS = ['tenant_id', 'question', 'answer', 'category', 'language', 'usage_count', 'is_active', 'priority', 'keywords'];

// Decorate FAQ row with HTML-expected aliases (title/content) and optional fields.
function decorateFaq(row) {
  if (!row) return row;
  return {
    ...row,
    title: row.question ?? null,
    content: row.answer ?? null,
    keywords: row.keywords ?? null,
    view_count: row.view_count ?? null,
    helpful_count: row.helpful_count ?? null,
  };
}

export async function handleFaqGet(request, env, corsHeaders) {
  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenant_id') || 'tenant_default';
    const language = url.searchParams.get('language');
    const isActive = url.searchParams.get('is_active');
    let q = 'SELECT * FROM faq WHERE tenant_id = ?';
    const vals = [tenantId];
    if (language) { q += ' AND language = ?'; vals.push(language); }
    if (isActive !== null && isActive !== undefined && isActive !== '') {
      q += ' AND is_active = ?'; vals.push(isActive === '1' || isActive === 'true' ? 1 : 0);
    }
    q += ' ORDER BY priority DESC, id DESC';
    const { results } = await env.DB.prepare(q).bind(...vals).all();
    const rows = (results || []).map(decorateFaq);
    return ok({ success: true, faqs: rows, faq: rows }, corsHeaders);
  } catch (e) {
    console.error('handleFaqGet:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function handleFaqGetOne(request, env, corsHeaders, id) {
  try {
    const row = await env.DB.prepare('SELECT * FROM faq WHERE id = ?').bind(id).first();
    if (!row) return err('FAQ not found', 404, corsHeaders);
    return ok({ success: true, faq: decorateFaq(row) }, corsHeaders);
  } catch (e) {
    console.error('handleFaqGetOne:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function handleFaqPost(request, env, corsHeaders) {
  const parsed = await parseJson(request, corsHeaders);
  if (parsed.response) return parsed.response;
  const b = parsed.body;
  const tenant_id = b.tenant_id || 'tenant_default';
  // Accept both {title, content} (HTML) and {question, answer} (legacy).
  const question = b.question || b.title;
  const answer = b.answer || b.content;
  const category = b.category ?? null;
  const language = b.language || 'ja';
  const priority = b.priority ?? 1;
  const is_active = b.is_active ?? 1;
  let keywords = b.keywords ?? null;
  if (Array.isArray(keywords)) keywords = JSON.stringify(keywords);
  if (!question || !answer) return err('question/title and answer/content are required', 400, corsHeaders);
  // Prompt-injection defense on admin write (FAQ content is rendered into LLM system prompt)
  {
    const contentToCheck = `${question} ${answer}`;
    const threat = detectInputThreat(contentToCheck);
    if (threat?.suspicious) {
      console.warn('[faq] Injection attempt in FAQ content:', threat.category);
      return err('FAQ content rejected: potential prompt injection detected', 400, corsHeaders);
    }
  }
  try {
    const result = await env.DB.prepare(
      `INSERT INTO faq (tenant_id, question, answer, category, language, priority, is_active, keywords, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(tenant_id, question, answer, category, language, priority, is_active ? 1 : 0, keywords).run();
    const id = result.meta?.last_row_id;
    const faq = await env.DB.prepare('SELECT * FROM faq WHERE id = ?').bind(id).first();
    return json({ success: true, faq: decorateFaq(faq) }, 201, corsHeaders);
  } catch (e) {
    console.error('handleFaqPost:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function handleFaqPut(request, env, corsHeaders, id) {
  const parsed = await parseJson(request, corsHeaders);
  if (parsed.response) return parsed.response;
  try {
    const existing = await env.DB.prepare('SELECT * FROM faq WHERE id = ?').bind(id).first();
    if (!existing) return err('FAQ not found', 404, corsHeaders);
    // Coalesce title/content into question/answer on input.
    const body = { ...parsed.body };
    if (body.title !== undefined && body.question === undefined) body.question = body.title;
    if (body.content !== undefined && body.answer === undefined) body.answer = body.content;
    if (Array.isArray(body.keywords)) body.keywords = JSON.stringify(body.keywords);
    // Prompt-injection defense on admin update
    {
      const contentToCheck = `${body.question ?? existing.question ?? ''} ${body.answer ?? existing.answer ?? ''}`;
      const threat = detectInputThreat(contentToCheck);
      if (threat?.suspicious) {
        console.warn('[faq] Injection attempt in FAQ update:', threat.category);
        return err('FAQ content rejected: potential prompt injection detected', 400, corsHeaders);
      }
    }
    const sets = [];
    const vals = [];
    for (const col of FAQ_COLS) {
      if (col in body) {
        sets.push(`${col} = ?`);
        vals.push(col === 'is_active' ? (body[col] ? 1 : 0) : body[col]);
      }
    }
    if (sets.length === 0) return ok({ success: true, faq: decorateFaq(existing) }, corsHeaders);
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    await env.DB.prepare(`UPDATE faq SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
    const faq = await env.DB.prepare('SELECT * FROM faq WHERE id = ?').bind(id).first();
    return ok({ success: true, faq: decorateFaq(faq) }, corsHeaders);
  } catch (e) {
    console.error('handleFaqPut:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function handleFaqDelete(request, env, corsHeaders, id) {
  try {
    const existing = await env.DB.prepare('SELECT id FROM faq WHERE id = ?').bind(id).first();
    if (!existing) return err('FAQ not found', 404, corsHeaders);
    await env.DB.prepare('DELETE FROM faq WHERE id = ?').bind(id).run();
    return ok({ success: true, deleted: Number(id) }, corsHeaders);
  } catch (e) {
    console.error('handleFaqDelete:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function handleFaqSearch(request, env, corsHeaders) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';
    const tenantId = url.searchParams.get('tenant_id') || 'tenant_default';
    if (!q.trim()) return ok({ success: true, results: [], faq: [] }, corsHeaders);
    const like = `%${q}%`;
    const { results } = await env.DB.prepare(
      `SELECT * FROM faq WHERE tenant_id = ? AND is_active = 1
         AND (question LIKE ? OR answer LIKE ? OR category LIKE ?)
       ORDER BY priority DESC, usage_count DESC LIMIT 50`
    ).bind(tenantId, like, like, like).all();
    const rows = (results || []).map(decorateFaq);
    return ok({ success: true, results: rows, faq: rows }, corsHeaders);
  } catch (e) {
    console.error('handleFaqSearch:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}
