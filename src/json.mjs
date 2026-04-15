// Response helpers shared across handlers.

export function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const ok = (obj, corsHeaders) => json(obj, 200, corsHeaders);
export const created = (obj, corsHeaders) => json(obj, 201, corsHeaders);
export const err = (msg, status, corsHeaders) =>
  json({ success: false, error: msg }, status, corsHeaders);

export async function parseJson(request, corsHeaders) {
  try {
    return { body: await request.json() };
  } catch {
    return { response: err('Invalid JSON', 400, corsHeaders) };
  }
}
