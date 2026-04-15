/**
 * cors-helper.mjs
 * Critical修正 C4: CORS Origin制限
 *
 * 既存の corsHeaders 生成箇所（router/index.mjs 等）で以下の buildCorsHeaders を使用し、
 * 各ハンドラに渡してください。不明な Origin はヘッダーを付与せず、ブラウザ側で拒否されます。
 *
 * 追加の許可 Origin は env.ALLOWED_ORIGINS（カンマ区切り）で指定可能。
 * 後方互換のため env.EXTRA_CORS_ORIGINS も引き続きサポート。
 */

const ALLOWED_ORIGINS = [
  'https://sloten.io',
  'https://www.sloten.io',
  'https://sloten-ai-test.pages.dev',
  'https://sloten-admin-secure.pages.dev',
];

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.sloten\.io$/,
  /^https:\/\/[a-z0-9-]+\.sloten-admin-secure\.pages\.dev$/,
];

/**
 * env から追加許可 Origin を取り出し、デフォルトと結合したリストを返す
 */
function getAllowedOrigins(env) {
  const extra = (env?.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return [...ALLOWED_ORIGINS, ...extra];
}

/**
 * Origin ヘッダーが許可リストに含まれるか判定
 * @param {string|null} origin
 * @param {object} [env]
 * @returns {boolean}
 */
export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const list = getAllowedOrigins(env);
  if (list.includes(origin)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

/**
 * リクエストに応じた CORS ヘッダーを生成
 * Origin が allowlist にあれば Access-Control-Allow-Origin を echo、
 * なければ空オブジェクト（ブラウザで拒否される）
 *
 * @param {Request} request
 * @param {object} [env]
 * @returns {object} corsHeaders
 */
export function buildCorsHeaders(request, env) {
  const origin = request.headers.get('Origin');

  // 後方互換: EXTRA_CORS_ORIGINS（旧名）もサポート
  const legacyExtra = (env?.EXTRA_CORS_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  if (!origin) {
    // ブラウザ以外（サーバー間呼び出し）はCORS不要
    return {};
  }

  const allowed = isAllowedOrigin(origin, env) || legacyExtra.includes(origin);
  if (!allowed) {
    // 拒否: Allow-Origin を返さない → ブラウザが CORS エラー化
    return {
      'Vary': 'Origin',
    };
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/**
 * OPTIONS preflight ハンドラ
 */
export function handleCorsPreflight(request, env) {
  const headers = buildCorsHeaders(request, env);
  // allowlist 外は 403
  if (!headers['Access-Control-Allow-Origin']) {
    return new Response(null, { status: 403, headers });
  }
  return new Response(null, { status: 204, headers });
}
