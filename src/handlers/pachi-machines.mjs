// pachi-slot-crawler API proxy + RAG context provider
// 統合先: pachi-slot-crawler (https://github.com/tyou20256-stack/pachi-slot-crawler)
//
// 提供機能:
// 1. プロキシエンドポイント (admin から直接呼出可)
//    - GET  /api/pachi/search?q=...
//    - GET  /api/pachi/machines/{id}
//    - GET  /api/pachi/similar?name=...
//    - POST /api/pachi/chat       (構造化フィルタ + 自然言語)
// 2. RAG context provider (ai-chat-handler.mjs から内部使用)
//    - fetchPachiContext(query, env)  — 機種クエリ検出時に LLM プロンプト用 context を返す
//
// 環境変数:
// - PACHI_API_URL : 例 "https://pachi-api.example.com" (Cloudflare Tunnel 経由)
// - PACHI_API_KEY : Bearer token (wrangler secret put)
//
// キャッシュ: KV (60s TTL) でコスト削減
// レート制御: 上位ミドルウェアで token-bucket 適用

// Sanitize untrusted external API string before LLM injection.
// Strips control chars, unicode tag block, zero-width, leading markdown headers.
function sanitizeUntrusted(s, max = 100) {
  if (!s) return '';
  let out = String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u{E0000}-\u{E007F}]/gu, '')
    .replace(/[​-‏﻿]/g, '')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  if (out.length > max) out = out.slice(0, max) + '…';
  return out;
}

// Probe lengths for compound machine name matching. Tuned to typical pachi
// DB word lengths:
// - SUFFIX_PROBE_LENGTHS: rightmost word lengths (ヴィレッジ=5, ガーデン=4,
//   キングダム=5). 5 is sweet spot, 4/6 widen coverage.
// - PREFIX_PROBE_LENGTHS: leading brand/series word (バイオハザード=7,
//   モンスターハンター=9). 8 catches most, 5/6 are graceful fallbacks.
// Used by both fetchPachiContext (search ladder) and isKnownMachine (exists
// check). Keep in sync — they're the same DB structure assumption.
const SUFFIX_PROBE_LENGTHS = [5, 6, 4];
const PREFIX_PROBE_LENGTHS = [8, 6, 5];

const json = (obj, status, corsHeaders) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });

const err = (msg, status, corsHeaders) =>
  json({ success: false, error: msg }, status, corsHeaders);

// ============================================================
// 内部ヘルパ: 認証付きで pachi-slot-crawler API を呼ぶ
// ============================================================
async function callPachiAPI(env, path, options = {}) {
  const baseUrl = env.PACHI_API_URL;
  const apiKey = env.PACHI_API_KEY;
  if (!baseUrl) {
    return { error: 'PACHI_API_URL not configured', status: 503 };
  }

  const url = new URL(path, baseUrl).toString();
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'sloten-ai-gateway/1.0',
    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
    ...(options.headers || {}),
  };

  const init = {
    method: options.method || 'GET',
    headers,
    cf: { cacheTtl: 60, cacheEverything: false }, // CF edge cache 60s
  };
  if (options.body) {
    init.body = options.body;
    headers['Content-Type'] = 'application/json';
  }

  try {
    const resp = await fetch(url, init);
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, data };
  } catch (e) {
    return { error: `Fetch failed: ${e.message}`, status: 502 };
  }
}

// ============================================================
// KV キャッシュラッパー (60s TTL)
// ============================================================
async function cachedFetch(env, cacheKey, fetcher) {
  const kv = env.STATE_KV || env.KV_CACHE;
  if (!kv) return await fetcher();

  const cached = await kv.get(cacheKey, 'json').catch(() => null);
  if (cached) return cached;

  const result = await fetcher();
  if (result.ok && result.data) {
    await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 60 }).catch(() => {});
  }
  return result;
}

// ============================================================
// プロキシエンドポイント
// ============================================================
export async function handlePachiSearch(request, env, corsHeaders) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const limit = url.searchParams.get('limit') || '20';
  if (!q) return err('q is required', 400, corsHeaders);

  const cacheKey = `pachi:search:${q}:${limit}`;
  const result = await cachedFetch(env, cacheKey, () =>
    callPachiAPI(env, `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  );

  if (result.error) return err(result.error, result.status || 502, corsHeaders);
  return json(result.data, result.status, corsHeaders);
}

export async function handlePachiMachineGet(request, env, corsHeaders, machineId) {
  if (!machineId) return err('machine_id required', 400, corsHeaders);
  const cacheKey = `pachi:machine:${machineId}`;
  const result = await cachedFetch(env, cacheKey, () =>
    callPachiAPI(env, `/api/machines/${encodeURIComponent(machineId)}`),
  );
  if (result.error) return err(result.error, result.status || 502, corsHeaders);
  if (result.status === 404) return err('Machine not found', 404, corsHeaders);
  return json(result.data, result.status, corsHeaders);
}

export async function handlePachiSimilar(request, env, corsHeaders) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  const limit = url.searchParams.get('limit') || '10';
  const threshold = url.searchParams.get('threshold') || '0.5';
  if (!name) return err('name is required', 400, corsHeaders);

  const cacheKey = `pachi:similar:${name}:${limit}:${threshold}`;
  const result = await cachedFetch(env, cacheKey, () =>
    callPachiAPI(env, `/api/similar-machines?name=${encodeURIComponent(name)}&limit=${limit}&threshold=${threshold}`),
  );
  if (result.error) return err(result.error, result.status || 502, corsHeaders);
  return json(result.data, result.status, corsHeaders);
}

export async function handlePachiChat(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON', 400, corsHeaders);
  }
  if (!body.query || typeof body.query !== 'string') {
    return err('query is required', 400, corsHeaders);
  }

  const cacheKey = `pachi:chat:${body.query}:${body.limit || 10}`;
  const result = await cachedFetch(env, cacheKey, () =>
    callPachiAPI(env, '/api/chat', {
      method: 'POST',
      body: JSON.stringify({ query: body.query, limit: body.limit || 10 }),
    }),
  );
  if (result.error) return err(result.error, result.status || 502, corsHeaders);
  return json(result.data, result.status, corsHeaders);
}

// ============================================================
// RAG context provider (ai-chat-handler.mjs から呼ばれる)
// ============================================================

/**
 * ユーザーメッセージが「機種関連」かどうか検出するキーワード
 * カジノ運営の問い合わせは Sloten の対象外なので、機種スペック特化の語で識別
 */
const MACHINE_QUERY_PATTERNS = [
  // Allow particles (が/は/の/で) and other connectors between the keyword
  // and the digit: "天井が800G" / "天井は1300G" / "天井で800ゲーム" should all
  // match. Use [^\d]{0,5} to skip up to 5 non-digit chars before the number.
  /天井[^\d]{0,5}\d/,                 // 天井 / 天井が / 天井は + 数字
  /継続率[^\d]{0,5}\d/,                // 継続率 / 継続率が + 数字
  /設定\s*[1-6]/,                     // 設定 6
  /機械割/,
  /ボーダー[^\d]{0,5}\d/,
  /大当り\s*確率|大当たり\s*確率/,
  /スマスロ|スマパチ|6\.5号機|6号機|5号機/,
  /甘デジ|ライトミドル|ミドル|MAX|羽根物/,
  /([A-Za-zＡ-Ｚａ-ｚ぀-ヿ一-鿿]+)\s*の\s*(スペック|期待値|天井|ゾーン)/,
  /(おすすめ|オススメ|推薦)\s*の\s*(機種|台|スロット|パチンコ|スマスロ)/,
  /似[たて]\s*(機種|台|スロット|パチンコ)/,
  // Specific machine name + question phrase: "バイオハザードヴィレッジについて"、
  // "コードギアスとは"、"ヨルムンガンドのスペックは" 等。
  // ≥4 連続カタカナ (機種名は基本カタカナ) を要求 — 漢字は含めない (「出金方法を教えて」
  // 等の一般質問が誤マッチするのを防ぐ)。
  // NOTE: Non-machine katakana words (ライセンス, ボーナス etc.) are excluded via
  // NON_MACHINE_KATAKANA_BLACKLIST in detectMachineQuery() — not in this regex.
  /[゠-ヿー]{4,}.{0,8}(?:について|教えて|とは|どんな|の(?:特徴|演出|出玉)|ってどう)/,
  /パチスロ|パチンコ|スロット/,  // 弱シグナル、他と組合せで判定
];

// Non-machine katakana words that are ≥4 chars and commonly appear in CS
// questions. When the ONLY strong match is the katakana+question regex AND the
// matched katakana fragment is one of these, we suppress the machine query
// detection so the message falls through to FAQ / announcements RAG instead.
const NON_MACHINE_KATAKANA_BLACKLIST = /^(?:ライセンス|ボーナス|サポート|メンテナンス|キャンペーン|プロモーション|カスタマー|オペレーター|アカウント|パスワード|セキュリティ|ゴールデンウィーク|ドリームポット|カテゴリ)$/;

/**
 * Lightweight check: does the pachi DB have a machine matching this name?
 * KV cached (1h TTL) to avoid hammering the pachi API on repeated queries.
 * Returns false on error (fail-safe: if pachi is down, don't block FAQ).
 */
export async function isKnownMachine(name, env) {
  if (!name || !env.PACHI_API_URL) return false;
  const kv = env.RATE_LIMITER || env.STATE_KV;
  const cacheKey = `pachi:exists:${name.slice(0, 30)}`;

  // KV cache check
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached === '1') return true;
      if (cached === '0') return false;
    } catch (_) {}
  }

  // API call — fail-open: if pachi API is down or endpoint not deployed,
  // return true (allow pachi route) rather than blocking legitimate queries.
  // Probe ladder: full → suffix → prefix. The pachi DB stores compound names
  // like "スマスロ バイオハザード ヴィレッジ" with spaces, so user input
  // "バイオハザードヴィレッジ" (no space) won't match a single substring query.
  // We try sub-tokens until one matches, then cache the verdict for the full
  // input. This keeps the cache key stable while widening the matching net.
  try {
    // Use the same SUFFIX/PREFIX_PROBE_LENGTHS as fetchPachiContext for DRY
    // and ensures both code paths agree on what counts as "known".
    const probes = [name];
    for (const len of SUFFIX_PROBE_LENGTHS) {
      if (name.length > len) probes.push(name.slice(-len));
    }
    for (const len of PREFIX_PROBE_LENGTHS) {
      if (name.length > len) probes.push(name.slice(0, len));
    }
    let exists = false;
    let apiOk = true;
    for (const probe of probes) {
      const r = await callPachiAPI(env, `/api/exists?name=${encodeURIComponent(probe)}`);
      if (!r.ok) { apiOk = false; break; }
      if (r.data?.exists === true) { exists = true; break; }
    }
    if (!apiOk) {
      console.warn(`[pachi-rag] isKnownMachine: API error for "${name.slice(0, 30)}" — fail-open`);
      return true;
    }
    if (kv) {
      try { await kv.put(cacheKey, exists ? '1' : '0', { expirationTtl: 3600 }); } catch (_) {}
    }
    return exists;
  } catch (e) {
    console.warn(`[pachi-rag] isKnownMachine: exception for "${name.slice(0, 30)}" — fail-open: ${e.message}`);
    return true; // fail-open
  }
}

/**
 * メッセージが機種関連クエリかどうかを判定
 * @returns {Object} { isMachineQuery, confidence, matched_patterns }
 */
export function detectMachineQuery(message) {
  if (!message || typeof message !== 'string') {
    return { isMachineQuery: false, confidence: 0, matched_patterns: [] };
  }

  const matched = [];
  let strongMatches = 0;
  let weakMatches = 0;

  // Index of the katakana+question regex in the patterns array (second to last)
  const katakanaPatternIdx = MACHINE_QUERY_PATTERNS.length - 2;

  for (let i = 0; i < MACHINE_QUERY_PATTERNS.length; i++) {
    const p = MACHINE_QUERY_PATTERNS[i];
    if (p.test(message)) {
      matched.push(p.source);
      // 最後の一つは弱シグナル
      if (i === MACHINE_QUERY_PATTERNS.length - 1) {
        weakMatches++;
      } else {
        strongMatches++;
      }
    }
  }

  // Blacklist check: if the only strong match is the katakana+question pattern,
  // verify the katakana fragment isn't a known non-machine CS term.
  if (strongMatches === 1 && matched.length >= 1) {
    const katakanaPattern = MACHINE_QUERY_PATTERNS[katakanaPatternIdx];
    const isOnlyKatakana = katakanaPattern.test(message) &&
      matched.filter((_, idx) => idx < matched.length - weakMatches).length === 1;
    if (isOnlyKatakana) {
      const katFragments = message.match(/[゠-ヿー]{4,}/g) || [];
      const allBlacklisted = katFragments.length > 0 &&
        katFragments.every(frag => NON_MACHINE_KATAKANA_BLACKLIST.test(frag));
      if (allBlacklisted) {
        return { isMachineQuery: false, confidence: 0, matched_patterns: [], blacklisted: true };
      }
    }
  }

  // 強パターン 1 つ以上で確定、弱パターンのみは保留
  const isMachineQuery = strongMatches > 0 || weakMatches >= 2;
  const confidence = Math.min(0.5 + strongMatches * 0.2 + weakMatches * 0.1, 1.0);

  return { isMachineQuery, confidence, matched_patterns: matched };
}

/**
 * 機種関連クエリに対する RAG コンテキストを生成
 * ai-chat-handler.mjs 内で呼ばれて、Gemini プロンプトに注入される
 *
 * @param {string} query ユーザーの自然言語クエリ
 * @param {Object} env CF Worker env
 * @returns {Promise<{context: string, citations: Array, error?: string}>}
 */
export async function fetchPachiContext(query, env) {
  if (!env.PACHI_API_URL) {
    return { context: '', citations: [], error: 'pachi_api_disabled' };
  }

  // pachi-slot-crawler の /api/chat は構造化フィルタ抽出 + 結果返却
  const result = await callPachiAPI(env, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ query, limit: 5 }),
  });

  if (result.error || !result.ok || !result.data) {
    return {
      context: '',
      citations: [],
      error: result.error || `status_${result.status}`,
    };
  }

  const machines = result.data.results || [];
  if (machines.length === 0) {
    return {
      context: '機種データベースに該当する機種が見つかりませんでした。',
      citations: [],
      filters: result.data.extracted_filters,
    };
  }

  // Detect "filter extraction failed" case: pachi-api returned 5 latest
  // machines but couldn't structure-extract anything from the user query
  // (e.g. "天井800G" — the upstream NLP doesn't recognize ceiling values yet).
  // Returning these as if they answered the spec-specific question causes the
  // LLM to mix unrelated FAQ context (e.g. FAQ 259 about BUY feature) with
  // unrelated machines, producing nonsense replies.
  // Mark this state explicitly so the system prompt can refuse politely.
  const f = result.data.extracted_filters || {};
  const hasNameKeywords = Array.isArray(f.name_keywords) && f.name_keywords.length > 0;
  const hasStructuredFilter = !!(
    f.continuation_min || f.continuation_max ||
    f.tags || f.spec_class ||
    f.manufacturer || f.release_date_after || f.release_date_before ||
    f.machine_id
  );
  const filterFailed = !hasNameKeywords && !hasStructuredFilter;

  if (filterFailed) {
    // Last-ditch fallback: when the query has a long Katakana phrase, try
    // /api/search as substring match. The /api/chat endpoint's structured
    // extractor sometimes misses machine names with embedded spaces (e.g.
    // pachi DB stores "スマスロ バイオハザード ヴィレッジ" but user types
    // "バイオハザードヴィレッジ" without space). Try multiple probe lengths:
    // full sequence first, then progressively shorter prefix sub-sequences
    // until a substring match returns results.
    const katakanaSeq = /[゠-ヿー]{4,}/g;
    const katMatches = (query.match(katakanaSeq) || []).sort((a, b) => b.length - a.length);
    let machines = [];
    let usedProbe = null;
    if (katMatches.length > 0) {
      // Build probe candidates from the longest katakana fragment. DB stores
      // multi-word names with spaces ("スマスロ バイオハザード ヴィレッジ"),
      // so user input "バイオハザードヴィレッジ" needs to be split. Probes:
      //  1. Full continuous fragment (try first — best precision when present)
      //  2. Suffix sub-strings (catch the last "word" e.g. ヴィレッジ)
      //  3. Prefix sub-strings (catch the first "word" e.g. バイオハザード)
      // Use limit=10 so multi-machine prefix matches are not truncated below
      // the relevant entry.
      const longest = katMatches[0];
      const probes = [longest];
      // Probe lengths defined at module top — see SUFFIX_PROBE_LENGTHS /
      // PREFIX_PROBE_LENGTHS for tuning rationale.
      for (const len of SUFFIX_PROBE_LENGTHS) {
        if (longest.length > len) probes.push(longest.slice(-len));
      }
      for (const len of PREFIX_PROBE_LENGTHS) {
        if (longest.length > len) probes.push(longest.slice(0, len));
      }
      // Try each probe in order, stop at first non-empty result set
      for (const probe of probes) {
        const sr = await callPachiAPI(env, `/api/search?q=${encodeURIComponent(probe)}&limit=10`);
        if (sr.ok && sr.data && Array.isArray(sr.data.results) && sr.data.results.length > 0) {
          machines = sr.data.results.slice(0, 5); // trim to 5 for prompt size
          usedProbe = probe;
          break;
        }
      }
    }
    if (machines.length > 0) {
        const lines = [
          `【機種データベース検索結果】(${machines.length}件、${usedProbe} の名称サブストリング検索、出典: pachi-slot-crawler)`,
          '',
        ];
        for (const m of machines) {
          const tags = Array.isArray(m.tags) ? sanitizeUntrusted(m.tags.join('/'), 200) : '';
          const parts = [
            `■ ${sanitizeUntrusted(m.name)}`,
            `  メーカー: ${sanitizeUntrusted(m.manufacturer) || '不明'}`,
            `  リリース: ${sanitizeUntrusted(m.release_date, 30) || '不明'}`,
            m.spec_class ? `  分類: ${sanitizeUntrusted(m.spec_class, 50)}` : '',
            tags ? `  タグ: ${tags}` : '',
            m.probability ? `  確率: ${sanitizeUntrusted(m.probability, 50)}` : '',
            m.max_payout ? `  最大出玉: ${sanitizeUntrusted(m.max_payout, 50)}` : '',
            m.continuation ? `  継続率: ${sanitizeUntrusted(m.continuation, 50)}` : '',
            m.setting6_payout_rate ? `  設定6機械割: ${sanitizeUntrusted(m.setting6_payout_rate, 50)}` : '',
          ].filter(Boolean);
          lines.push(parts.join('\n'));
          lines.push('');
        }
        lines.push('※ 上記数値は公開仕様情報に基づく統計上の推定値です。実戦における収支を保証するものではありません。');
        return {
          context: lines.join('\n'),
          citations: machines.map((m) => ({ machine_id: m.machine_id, name: m.name, source: 'pachi-slot-crawler' })),
          filters: f,
          name_substring_match: usedProbe,
        };
      }
    // The query had specific intent (e.g. "ceiling around 800G") but pachi-api
    // could not translate it. Return a clear refusal rather than 5 unrelated
    // recent machines.
    return {
      context: [
        '【機種データベース検索結果】絞り込み失敗',
        'ユーザーの質問内容から機種データベースの検索条件を抽出できませんでした。',
        `(クエリ: "${query}" / 抽出フィルタ: 空)`,
        '',
        '対応指示:',
        '- このユーザーの質問に **FAQ やナレッジから機種スペック情報を引用して回答するのは禁止** です。',
        '  (FAQ や KB は機種スペックの正規ソースではありません。混合すると誤情報になります)',
        '- 「ご質問の条件で機種データベースから絞り込めませんでした。具体的な機種名（例: バイオハザードヴィレッジ）でお問い合わせいただければ、その機種の仕様をご案内できます。」と素直に回答してください。',
        '- 必要に応じて「現在対応している機種カテゴリ: スマスロ / 6.5号機 / スマパチ / ライトミドル等」と補足可。',
      ].join('\n'),
      citations: [],
      filters: f,
      filter_failed: true,
    };
  }

  // LLM プロンプト用に整形 (Security: H6 修正 — fallback 経路と同じく
  // sanitizeUntrusted を全フィールドに適用。pachi DB は外部サイトクロール
  // データを含むため、機種名・メーカー名・タグ等にプロンプトインジェクション
  // ペイロードが混入する可能性が常にある。)
  const safeFilters = sanitizeUntrusted(JSON.stringify(result.data.extracted_filters || {}), 300);
  const lines = [
    `【機種データベース検索結果】(${machines.length}件、出典: pachi-slot-crawler)`,
    `抽出条件: ${safeFilters}`,
    '',
  ];
  for (const m of machines) {
    const tags = Array.isArray(m.tags) ? sanitizeUntrusted(m.tags.join('/'), 200) : '';
    const parts = [
      `■ ${sanitizeUntrusted(m.name)}`,
      `  メーカー: ${sanitizeUntrusted(m.manufacturer) || '不明'}`,
      `  リリース: ${sanitizeUntrusted(m.release_date, 30) || '不明'}`,
      m.spec_class ? `  分類: ${sanitizeUntrusted(m.spec_class, 50)}` : '',
      tags ? `  タグ: ${tags}` : '',
      m.probability ? `  確率: ${sanitizeUntrusted(m.probability, 50)}` : '',
      m.max_payout ? `  最大出玉: ${sanitizeUntrusted(m.max_payout, 50)}` : '',
      m.continuation ? `  継続率: ${sanitizeUntrusted(m.continuation, 50)}` : '',
      m.setting6_payout_rate ? `  設定6機械割: ${sanitizeUntrusted(m.setting6_payout_rate, 50)}` : '',
    ].filter(Boolean);
    lines.push(parts.join('\n'));
    lines.push('');
  }
  lines.push('※ 上記数値は公開仕様情報に基づく統計上の推定値であり、個別の実戦における収支を保証するものではありません。');

  return {
    context: lines.join('\n'),
    citations: machines.map((m) => ({
      machine_id: m.machine_id,
      name: m.name,
      source: 'pachi-slot-crawler',
    })),
    filters: result.data.extracted_filters,
  };
}
