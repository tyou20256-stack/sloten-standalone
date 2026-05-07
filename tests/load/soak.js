// k6 soak test for sloten-standalone-staging-bk
// Usage:
//   k6 run --vus 50 --duration 30m tests/load/soak.js
//   docker run -i grafana/k6 run - < tests/load/soak.js
//
// Dry run (5 VUs × 30s):
//   k6 run --vus 5 --duration 30s tests/load/soak.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// --- Config ---
const BASE_URL = __ENV.BASE_URL || 'https://sloten-standalone-staging-bk.rcc-aoki.workers.dev';

export const options = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS) : 50,
  duration: __ENV.DURATION || '30m',
  thresholds: {
    http_req_failed: ['rate<0.01'],          // < 1% errors
    http_req_duration: ['p(95)<3000', 'p(99)<8000'], // p95 < 3s, p99 < 8s
    'http_req_duration{type:message}': ['p(95)<8000'], // AI messages can be slower
  },
};

// --- Golden Set sample queries ---
const QUERIES = [
  'PayPay入金方法',
  '出金にはどれくらい時間がかかりますか',
  'KYCは必要？',
  'ライセンスはありますか？',
  'スマスロで継続率80%以上の機種を教えて',
  'バイオハザードヴィレッジについて教えて',
  '最新のお知らせを教えて',
  'オペレーターと話したい',
  'How do I deposit money?',
  'メニュー',
  '登録方法を教えて',
  '対応している決済方法は何ですか？',
  'サポートは24時間対応ですか？',
  '天井が800Gぐらいのスロットは？',
  'ボーナスコード',
];

// --- Custom metrics ---
const contactCreated = new Rate('contact_created');
const convCreated = new Rate('conversation_created');
const msgSent = new Rate('message_sent');
const botReplied = new Rate('bot_replied');
const aiLatency = new Trend('ai_response_latency', true);

// --- Helpers ---
function randomQuery() {
  return QUERIES[Math.floor(Math.random() * QUERIES.length)];
}

function randomSleep(min, max) {
  sleep(min + Math.random() * (max - min));
}

// --- Main VU scenario ---
export default function () {
  const headers = { 'Content-Type': 'application/json' };

  // 1. Create contact
  const contactRes = http.post(`${BASE_URL}/api/widget/contacts`, JSON.stringify({}), {
    headers,
    tags: { type: 'contact' },
  });
  const contactOk = check(contactRes, {
    'contact created': (r) => r.status === 200 || r.status === 201,
  });
  contactCreated.add(contactOk);
  if (!contactOk) { sleep(5); return; }

  const contactData = JSON.parse(contactRes.body);
  const contactToken = contactData.contact_token;
  const contactId = contactData.contact?.id;
  if (!contactToken || !contactId) { sleep(5); return; }

  const authHeaders = {
    'Content-Type': 'application/json',
    'X-Sloten-Contact-Token': contactToken,
  };

  // 2. Create conversation
  const convRes = http.post(`${BASE_URL}/api/widget/conversations`, JSON.stringify({
    contact_id: contactId,
    tenant_id: 'tenant_default',
  }), { headers: authHeaders, tags: { type: 'conversation' } });

  const convOk = check(convRes, {
    'conversation created': (r) => r.status === 200 || r.status === 201,
  });
  convCreated.add(convOk);
  if (!convOk) { sleep(5); return; }

  const convData = JSON.parse(convRes.body);
  const conversationId = convData.conversation?.id;
  if (!conversationId) { sleep(5); return; }

  // 3. Send 5-10 messages with random intervals
  const numMessages = 5 + Math.floor(Math.random() * 6); // 5-10
  for (let i = 0; i < numMessages; i++) {
    const query = randomQuery();
    const start = Date.now();

    const msgRes = http.post(
      `${BASE_URL}/api/widget/conversations/${conversationId}/messages`,
      JSON.stringify({ sender_type: 'customer', content: query }),
      { headers: authHeaders, tags: { type: 'message' } },
    );

    const elapsed = Date.now() - start;

    const msgOk = check(msgRes, {
      'message sent': (r) => r.status === 200 || r.status === 201,
    });
    msgSent.add(msgOk);

    if (msgOk) {
      const msgData = JSON.parse(msgRes.body);
      const hasReply = !!(msgData.bot_replies && msgData.bot_replies.length > 0) ||
                       !!(msgData.bot_reply && msgData.bot_reply.content);
      botReplied.add(hasReply ? 1 : 0);
      if (hasReply) {
        aiLatency.add(elapsed);
      }
    }

    // Random interval between messages (5-30s for soak, 2-5s for dry run)
    const isDryRun = options.duration === '30s' || (__ENV.DURATION && __ENV.DURATION.includes('s'));
    randomSleep(isDryRun ? 2 : 5, isDryRun ? 5 : 30);
  }
}

// --- Summary handler ---
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    base_url: BASE_URL,
    vus: options.vus,
    duration: options.duration,
    metrics: {
      http_req_failed: data.metrics.http_req_failed?.values?.rate || 0,
      http_req_duration_p95: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
      http_req_duration_p99: data.metrics.http_req_duration?.values?.['p(99)'] || 0,
      contact_created: data.metrics.contact_created?.values?.rate || 0,
      conversation_created: data.metrics.conversation_created?.values?.rate || 0,
      message_sent: data.metrics.message_sent?.values?.rate || 0,
      bot_replied: data.metrics.bot_replied?.values?.rate || 0,
      ai_response_latency_p50: data.metrics.ai_response_latency?.values?.['p(50)'] || 0,
      ai_response_latency_p95: data.metrics.ai_response_latency?.values?.['p(95)'] || 0,
    },
    thresholds_passed: Object.values(data.root_group?.checks || {}).every(c => c.passes > 0),
  };

  return {
    stdout: JSON.stringify(summary, null, 2) + '\n',
    'results.json': JSON.stringify(data, null, 2),
  };
}
