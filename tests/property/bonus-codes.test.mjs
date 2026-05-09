// Property tests for bonus code matching.
//
// Test agent (2026-05-09 audit) flagged 35 active bonus codes with ZERO
// matching tests. Customers paste codes with full-/half-width spaces, mixed
// case, and punctuation — the matcher must normalize correctly across all
// active production codes.
//
// We exercise the pure helpers directly; matchBonusCode (D1-backed) is
// covered by lifecycle.test.mjs at the integration layer.
//
// Run: node tests/property/bonus-codes.test.mjs

import assert from 'node:assert/strict';
import { removeSpaces, matchOne } from '../../src/bonus-codes.mjs';

let pass = 0, fail = 0;
function test(label, fn) {
  try { fn(); console.log(`✓ ${label}`); pass++; }
  catch (e) { console.log(`✗ ${label}: ${e.message}`); fail++; }
}

// ─── removeSpaces ───────────────────────────────────────────────
test('removeSpaces: strips half-width space', () => assert.equal(removeSpaces('a b c'), 'abc'));
test('removeSpaces: strips full-width space', () => assert.equal(removeSpaces('あ　い　う'), 'あいう'));
test('removeSpaces: strips tab and newline', () => assert.equal(removeSpaces('a\tb\nc'), 'abc'));
test('removeSpaces: empty/null/undefined → ""', () => {
  assert.equal(removeSpaces(''), '');
  assert.equal(removeSpaces(null), '');
  assert.equal(removeSpaces(undefined), '');
});
test('removeSpaces: passthrough for normal text', () => assert.equal(removeSpaces('バモスイボナ'), 'バモスイボナ'));

// ─── matchOne (exact / case_insensitive) ────────────────────────
const TREASURE = ['宝箱1'];
const VAMOS = ['バモスイボナ', 'ばもすいぼな'];
const HONEY4W = ['HONEY4W'];
const ELITE = ['ELITE参加', 'elite参加', 'Elite参加'];
const GW = ['GWフェスティバル', 'gwフェスティバル', 'gw festival', 'GW Festival'];

// Exact mode (default for production codes)
test('matchOne exact: 宝箱1 → 宝箱1', () => assert.equal(matchOne(TREASURE, '宝箱1', 'exact'), '宝箱1'));
test('matchOne exact: 宝箱2 → null (TREASURE only has Day1)', () => assert.equal(matchOne(TREASURE, '宝箱2', 'exact'), null));
test('matchOne exact: 全角バリエーション (alphabetic match)', () => assert.equal(matchOne(VAMOS, 'バモスイボナ', 'exact'), 'バモスイボナ'));
test('matchOne exact: hiragana variation', () => assert.equal(matchOne(VAMOS, 'ばもすいぼな', 'exact'), 'ばもすいぼな'));
test('matchOne exact: case mismatch → null', () => assert.equal(matchOne(['HONEY4W'], 'honey4w', 'exact'), null));
test('matchOne exact: empty input → null', () => assert.equal(matchOne(VAMOS, '', 'exact'), null));
test('matchOne exact: with embedded spaces (must be pre-stripped)', () => {
  // matchOne assumes input already removeSpaces-normalized; this verifies
  // the contract: caller must normalize, matcher does not.
  assert.equal(matchOne(['HONEY4W'], 'HONEY 4W', 'exact'), null);
  assert.equal(matchOne(['HONEY4W'], removeSpaces('HONEY 4W'), 'exact'), 'HONEY4W');
});

// case_insensitive mode (HONEY4W, sakura2026, etc.)
test('matchOne ci: HONEY4W upper', () => assert.equal(matchOne(HONEY4W, 'HONEY4W', 'case_insensitive'), 'HONEY4W'));
test('matchOne ci: honey4w lower', () => assert.equal(matchOne(HONEY4W, 'honey4w', 'case_insensitive'), 'HONEY4W'));
test('matchOne ci: Honey4W mixed', () => assert.equal(matchOne(HONEY4W, 'Honey4W', 'case_insensitive'), 'HONEY4W'));
test('matchOne ci: HONEY4W with trailing chars → null', () => assert.equal(matchOne(HONEY4W, 'HONEY4W!', 'case_insensitive'), null));

// Multi-variant codes
test('matchOne ELITE variant 1', () => assert.equal(matchOne(ELITE, 'ELITE参加', 'exact'), 'ELITE参加'));
test('matchOne ELITE variant 2', () => assert.equal(matchOne(ELITE, 'elite参加', 'exact'), 'elite参加'));
test('matchOne ELITE variant 3', () => assert.equal(matchOne(ELITE, 'Elite参加', 'exact'), 'Elite参加'));

// GW Festival multi-variant case_insensitive.
// matchOne returns the FIRST matching code from the codes array (canonical
// form), not the user's input form. Tests reflect that behavior.
test('matchOne GW upper-jp matches first array entry', () => assert.equal(matchOne(GW, 'GWフェスティバル', 'case_insensitive'), 'GWフェスティバル'));
test('matchOne GW lower-jp still maps to first variant by lowercase compare', () => assert.equal(matchOne(GW, 'gwフェスティバル', 'case_insensitive'), 'GWフェスティバル'));
test('matchOne GW english normalized', () => assert.equal(matchOne(GW, removeSpaces('gw festival'), 'case_insensitive'), 'gw festival'));

// Empty / edge
test('matchOne: empty codes array → null', () => assert.equal(matchOne([], '宝箱1', 'exact'), null));
test('matchOne: codes with extra whitespace get stripped at compare', () => {
  // Production data may have " 宝箱1 " stored in DB by mistake; matcher should
  // still match because it strips spaces from BOTH sides via removeSpaces.
  assert.equal(matchOne([' 宝箱1 '], '宝箱1', 'exact'), ' 宝箱1 ');
});

// Common attack-ish inputs (defense check — must not silently match)
test('matchOne: null byte injection → null', () => assert.equal(matchOne(TREASURE, '宝箱1\x00', 'exact'), null));
test('matchOne: SQL-ish input → null', () => assert.equal(matchOne(TREASURE, "'OR'1'='1", 'exact'), null));

console.log(`\n${pass}/${pass + fail} cases pass`);
process.exit(fail > 0 ? 1 : 0);
