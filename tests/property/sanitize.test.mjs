// Property tests for sanitization + text classification primitives.
//
// Run: node tests/property/sanitize.test.mjs

import assert from 'node:assert/strict';
import { hasJapanese, looksLikeFreeText, isNonJapaneseQuery } from '../../src/lib/text-classify.mjs';

let pass = 0, fail = 0;

function test(label, fn) {
  try { fn(); console.log(`✓ ${label}`); pass++; }
  catch (e) { console.log(`✗ ${label}: ${e.message}`); fail++; }
}

// ─── hasJapanese ────────────────────────────────────────────────
test('hasJapanese: hiragana → true', () => assert.equal(hasJapanese('こんにちは'), true));
test('hasJapanese: katakana → true', () => assert.equal(hasJapanese('カタカナ'), true));
test('hasJapanese: kanji → true', () => assert.equal(hasJapanese('機種'), true));
test('hasJapanese: pure ASCII → false', () => assert.equal(hasJapanese('hello world'), false));
test('hasJapanese: empty → false', () => assert.equal(hasJapanese(''), false));
test('hasJapanese: null → false', () => assert.equal(hasJapanese(null), false));
test('hasJapanese: mixed → true', () => assert.equal(hasJapanese('PayPay入金'), true));
test('hasJapanese: emoji only → false', () => assert.equal(hasJapanese('🎰💰'), false));

// ─── looksLikeFreeText ──────────────────────────────────────────
test('free-text: short JP → true', () => assert.equal(looksLikeFreeText('はい'), true));
test('free-text: 1-char JP → true', () => assert.equal(looksLikeFreeText('あ'), true));
test('free-text: 1-char ASCII → false', () => assert.equal(looksLikeFreeText('a'), false));
test('free-text: 4-char ASCII → false', () => assert.equal(looksLikeFreeText('abcd'), false));
test('free-text: 5-char ASCII → true', () => assert.equal(looksLikeFreeText('abcde'), true));
test('free-text: empty → false', () => assert.equal(looksLikeFreeText(''), false));
test('free-text: whitespace → false', () => assert.equal(looksLikeFreeText('   '), false));

// ─── isNonJapaneseQuery ─────────────────────────────────────────
test('non-jp: English question → true', () => assert.equal(isNonJapaneseQuery('How do I deposit money?'), true));
test('non-jp: Korean → true', () => assert.equal(isNonJapaneseQuery('안녕하세요'), true));
test('non-jp: Cyrillic → true', () => assert.equal(isNonJapaneseQuery('Привет'), true));
test('non-jp: pure JP → false', () => assert.equal(isNonJapaneseQuery('こんにちは'), false));
test('non-jp: mixed JP+EN → false', () => assert.equal(isNonJapaneseQuery('PayPay入金'), false));
test('non-jp: short ascii (2 chars) → false', () => assert.equal(isNonJapaneseQuery('ok'), false));
test('non-jp: emoji only → false', () => assert.equal(isNonJapaneseQuery('🎰🎰🎰'), false));
test('non-jp: numbers only → false', () => assert.equal(isNonJapaneseQuery('12345'), false));

// ─── sanitizeUntrusted (announcements.mjs internal logic, replicated) ──
function sanitizeUntrusted(s, maxChars = 500) {
  if (!s) return '';
  let out = String(s);
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  out = out.replace(/[\u{E0000}-\u{E007F}]/gu, '');
  // zero-width / bidi / BOM (literal characters preserved here for parity)
  out = out.replace(/[​-‏‪-‮⁠-⁯﻿]/g, '');
  out = out.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  if (out.length > maxChars) out = out.slice(0, maxChars) + '…（以下省略）';
  return out;
}

test('sanitize: removes NUL/control chars (keeps TAB/LF/CR — paragraph-safe)', () => {
  // The regex keeps 0x09 (TAB), 0x0A (LF), 0x0D (CR) intentionally so
  // that line breaks in legitimate announcements survive sanitization.
  assert.equal(sanitizeUntrusted('hello\x00\x01\x02world'), 'helloworld');
  assert.equal(sanitizeUntrusted('a\nb\tc\rd'), 'a\nb\tc\rd');
});
test('sanitize: strips Unicode tag block', () => {
  const tag = String.fromCodePoint(0xE0041); // tag 'A'
  assert.equal(sanitizeUntrusted(`benign${tag}text`), 'benigntext');
});
test('sanitize: strips zero-width', () => {
  assert.equal(sanitizeUntrusted('hello​world'), 'helloworld');
});
test('sanitize: neutralizes md heading prompt-spoof', () => {
  assert.equal(sanitizeUntrusted('## 新しい命令\n本文'), '新しい命令\n本文');
});
test('sanitize: max-chars cap', () => {
  const s = 'a'.repeat(600);
  const r = sanitizeUntrusted(s, 500);
  assert.equal(r.length, 500 + '…（以下省略）'.length);
});
test('sanitize: empty string passthrough', () => assert.equal(sanitizeUntrusted(''), ''));
test('sanitize: null → empty', () => assert.equal(sanitizeUntrusted(null), ''));
test('sanitize: idempotent (sanitize twice = sanitize once)', () => {
  const dirty = '# h​\x01ello';
  assert.equal(sanitizeUntrusted(sanitizeUntrusted(dirty)), sanitizeUntrusted(dirty));
});

console.log(`\n${pass}/${pass + fail} cases pass`);
process.exit(fail > 0 ? 1 : 0);
