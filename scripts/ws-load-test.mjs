#!/usr/bin/env node
// WebSocket load test for ConversationRoom Durable Object.
// Spawns N parallel WS connections (each on a fresh conversation), each sending
// M messages via REST POST, and measures the round-trip latency from REST POST
// to receiving the matching broadcast frame on the WS.
//
// Usage:
//   node scripts/ws-load-test.mjs [BASE_URL] [parallel=50] [per_conn=20]
// Example:
//   node scripts/ws-load-test.mjs https://sloten-standalone-staging-bk.rcc-aoki.workers.dev 50 20

const WS = globalThis.WebSocket || (await import('undici')).WebSocket;

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const N = parseInt(process.argv[3] || '50', 10);
const M = parseInt(process.argv[4] || '20', 10);
const WS_BASE = BASE.replace(/^http/, 'ws');

async function j(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

async function runClient(clientIdx) {
  const c = await j('POST', '/api/widget/contacts', { name: `Load ${clientIdx}` });
  const contactId = c.contact.id;
  const cv = await j('POST', '/api/widget/conversations', { contact_id: contactId });
  const convId = cv.conversation.id;

  const ws = new WS(`${WS_BASE}/ws/widget/conversations/${convId}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
    setTimeout(() => reject(new Error('ws open timeout')), 10000);
  });

  // Map id->start time. When WS frame arrives with matching content, we compute rtt.
  const pending = new Map();
  const latencies = [];
  let botCount = 0;
  ws.addEventListener('message', (ev) => {
    let f; try { f = JSON.parse(ev.data); } catch { return; }
    if (f.type !== 'message.created' || !f.message) return;
    if (f.message.sender_type === 'bot') { botCount++; return; }
    const key = f.message.content;
    const start = pending.get(key);
    if (start) {
      latencies.push(Date.now() - start);
      pending.delete(key);
    }
  });

  for (let i = 0; i < M; i++) {
    const content = `lt-${clientIdx}-${i}-${Math.random().toString(36).slice(2, 8)}`;
    pending.set(content, Date.now());
    try {
      await j('POST', `/api/widget/conversations/${convId}/messages`, {
        sender_type: 'customer',
        content,
      });
    } catch (e) {
      pending.delete(content);
      console.warn(`client ${clientIdx} msg ${i} POST failed:`, e.message);
    }
    // Small pacing so we don't all slam in the same ms.
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
  }
  // Drain remaining frames for 5s.
  await new Promise((r) => setTimeout(r, 5000));
  ws.close();
  return { latencies, sent: M, received: latencies.length, botCount };
}

async function main() {
  console.log(`WS load test: ${BASE}`);
  console.log(`  parallel clients: ${N}`);
  console.log(`  messages/client:  ${M}`);
  console.log(`  total messages:   ${N * M}`);
  const started = Date.now();

  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => runClient(i).catch((e) => ({ error: e.message, latencies: [], sent: 0, received: 0, botCount: 0 })))
  );

  const totalElapsed = Date.now() - started;
  const allLat = [].concat(...results.map((r) => r.latencies));
  const totalSent = results.reduce((s, r) => s + r.sent, 0);
  const totalRecv = results.reduce((s, r) => s + r.received, 0);
  const totalBot = results.reduce((s, r) => s + r.botCount, 0);
  const errors = results.filter((r) => r.error).length;

  const p = (q) => percentile(allLat, q);
  console.log('');
  console.log('=== Results ===');
  console.log(`| metric          | value |`);
  console.log(`|-----------------|-------|`);
  console.log(`| clients         | ${N} (${errors} errored)`);
  console.log(`| sent            | ${totalSent}`);
  console.log(`| received        | ${totalRecv} (${totalSent ? Math.round(100 * totalRecv / totalSent) : 0}%)`);
  console.log(`| bot broadcasts  | ${totalBot}`);
  console.log(`| wall clock      | ${(totalElapsed / 1000).toFixed(1)}s`);
  console.log(`| throughput      | ${((totalSent / totalElapsed) * 1000).toFixed(1)} msg/s`);
  console.log(`| rtt p50         | ${p(0.5)}ms`);
  console.log(`| rtt p95         | ${p(0.95)}ms`);
  console.log(`| rtt p99         | ${p(0.99)}ms`);
  console.log(`| rtt max         | ${allLat.length ? Math.max(...allLat) : 0}ms`);
}

main().catch((e) => { console.error(e); process.exit(1); });
