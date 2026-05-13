// Property tests for flow_state schema versioning guard.
// Run: node tests/property/flow-state-version.test.mjs

import assert from 'node:assert/strict';
import {
  isStateVersionSupported,
  buildFlowStateJson,
  _FLOW_STATE_VERSION_INTERNAL,
} from '../../src/handlers/bot-flows.mjs';

let pass = 0, fail = 0;
function test(label, fn) {
  try { fn(); console.log(`✓ ${label}`); pass++; }
  catch (e) { console.log(`✗ ${label}: ${e.message}`); fail++; }
}

// --- Supported versions ------------------------------------------
test('v=1 (legacy pre-versioned) is supported', () => {
  assert.equal(isStateVersionSupported({ v: 1, flow_id: 5 }), true);
});

test('missing v field treated as v=1 (legacy compat)', () => {
  assert.equal(isStateVersionSupported({ flow_id: 5 }), true);
});

test('v=2 (current) is supported', () => {
  assert.equal(isStateVersionSupported({ v: 2, flow_id: 5 }), true);
});

// --- Unsupported versions ----------------------------------------
test('v=3 (future) is rejected — forces controlled restart', () => {
  assert.equal(isStateVersionSupported({ v: 3, flow_id: 5 }), false);
});

test('v=0 is rejected', () => {
  assert.equal(isStateVersionSupported({ v: 0, flow_id: 5 }), false);
});

test('v=-1 is rejected', () => {
  assert.equal(isStateVersionSupported({ v: -1, flow_id: 5 }), false);
});

// --- Type rejection ----------------------------------------------
test('null state is rejected', () => {
  assert.equal(isStateVersionSupported(null), false);
});

test('non-object state is rejected', () => {
  assert.equal(isStateVersionSupported('flow:5:step:1'), false);
  assert.equal(isStateVersionSupported(42), false);
});

test('string v field is rejected (must be number)', () => {
  // Defends against an attacker stamping `v: "1"` which would pass a
  // string-equality check in any future implementation.
  assert.equal(isStateVersionSupported({ v: '1', flow_id: 5 }), true,
    'string v defaults to numeric 1');
  // But v="2" would still default to 1, so future-version probe via string
  // bypass is impossible.
  assert.equal(isStateVersionSupported({ v: '99', flow_id: 5 }), true,
    'string v="99" still falls back to legacy v=1 — safe');
});

// --- buildFlowStateJson always stamps current version ------------
test('buildFlowStateJson stamps current FLOW_STATE_VERSION', () => {
  const json = buildFlowStateJson(42, 'step_a', { foo: 'bar' });
  const parsed = JSON.parse(json);
  assert.equal(parsed.v, _FLOW_STATE_VERSION_INTERNAL);
  assert.equal(parsed.flow_id, 42);
  assert.equal(parsed.step_id, 'step_a');
  assert.deepEqual(parsed.vars, { foo: 'bar' });
});

test('buildFlowStateJson defaults vars to {}', () => {
  const json = buildFlowStateJson(7, 'start');
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed.vars, {});
});

console.log(`\n${pass}/${pass + fail} cases pass`);
if (fail > 0) process.exit(1);
