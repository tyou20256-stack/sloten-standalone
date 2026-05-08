// Property-based test for escalation regex over-detection (FP).
//
// Generates a corpus of plausible *benign* user queries — questions that
// should NOT escalate. If the escalation classifier flags any of them, that's
// a false positive worth investigating before it hits production.
//
// Run: node tests/property/escalation-fp.test.mjs

import { decideEscalation } from '../../src/escalation.mjs';

// Benign-question vocabulary — domain-relevant but should NOT trip
// escalation patterns (no anger, no money urgency, no RG signal, no legal).
const SUBJECTS = [
  'PayPay入金', '銀行振込', 'コンビニ入金', 'ATM入金', '出金時間', 'ボーナス',
  '入金不要ボーナス', 'ボーナスコード', '賭け条件', '本人確認', 'KYC',
  'ログイン', 'パスワード変更', 'メールアドレス変更', 'ライセンス', 'キャンペーン',
  '営業時間', '対応時間', 'ゲーム種類', 'スマスロ', '機種',
];
const QUESTION_FORMS = [
  '%sについて教えて',
  '%sのやり方は？',
  '%sはどうすればいい',
  '%sの方法を知りたい',
  '%sがわからない',
  '%sを教えてください',
  '%sについて聞きたい',
  '%sを確認したい',
  '%sを変更するには',
  '%sは何時から',
];
const POLITE_PARTICLES = ['', 'よろしくお願いします', 'すみません', '初心者です'];

function generate() {
  const out = [];
  for (const s of SUBJECTS) {
    for (const f of QUESTION_FORMS) {
      for (const p of POLITE_PARTICLES) {
        const q = f.replace('%s', s) + (p ? ' ' + p : '');
        out.push(q);
      }
    }
  }
  return out;
}

const queries = generate();
console.log(`\nProperty test — escalation FP detection`);
console.log(`Generated ${queries.length} benign queries\n`);

const fps = [];
for (const q of queries) {
  const result = decideEscalation(q, []);
  if (result.shouldEscalate) {
    fps.push({ query: q, reason: result.reason, category: result.category });
  }
}

const fpRate = (fps.length / queries.length * 100).toFixed(2);
console.log(`False positives: ${fps.length} / ${queries.length} (${fpRate}%)`);

// Acceptable threshold: < 1% FP rate. Above that, the regex is too aggressive
// and needs tuning.
const FP_THRESHOLD = 1.0;
const fpRateNum = (fps.length / queries.length) * 100;

if (fps.length > 0) {
  console.log('\nSample FPs (max 10):');
  for (const fp of fps.slice(0, 10)) {
    console.log(`  - "${fp.query}" → ${fp.reason} [${fp.category}]`);
  }
}

if (fpRateNum > FP_THRESHOLD) {
  console.error(`\n✗ FP rate ${fpRate}% exceeds threshold ${FP_THRESHOLD}%`);
  process.exit(1);
}

console.log(`\n✓ FP rate ${fpRate}% within threshold ${FP_THRESHOLD}%`);
process.exit(0);
