// Unified intent classifier for customer messages.
// Aggregates all detection logic into a single classifyIntent() call.
//
// Priority (fixed): escalation > menu_keyword > machine > announcement > non_japanese > rag_default
// Mutual exclusion: machine wins over announcement when both fire.
//
// Step 1 (shadow mode): classifyIntent is called alongside existing logic;
// its result is logged to ai_logs.retrieval_trace but does NOT drive routing.
// Step 2 (future): classifyIntent drives routing; old detectors removed.

import { decideEscalation } from '../escalation.mjs';
import { findKeywordMenu } from '../handlers/bot-menus.mjs';
import { detectMachineQuery } from '../handlers/pachi-machines.mjs';
import { detectAnnouncementQuery } from '../handlers/announcements.mjs';
import { isNonJapaneseQuery } from './text-classify.mjs';

/**
 * @typedef {Object} ClassifierResult
 * @property {'escalation'|'menu_keyword'|'machine'|'announcement'|'non_japanese'|'rag_default'} primary
 * @property {string[]} secondary - Other matched intents (lower priority)
 * @property {number} confidence - 0..1
 * @property {Object} evidence - Detailed match info per detector
 */

/**
 * Classify user intent from message text.
 *
 * @param {string} message - Raw user message
 * @param {Object} env - CF Worker env bindings
 * @param {Object} [context] - Optional context
 * @param {string} [context.tenantId]
 * @param {Array}  [context.history] - Conversation history for escalation
 * @returns {Promise<ClassifierResult>}
 */
export async function classifyIntent(message, env, context = {}) {
  const msg = message || '';
  const matched = [];
  const evidence = {};

  // 1. Escalation (sync, fast)
  const esc = decideEscalation(msg, context.history || []);
  if (esc.shouldEscalate) {
    matched.push({ intent: 'escalation', confidence: 1.0 });
    evidence.escalation = { reason: esc.reason, responseText: esc.responseText };
  }

  // 2. Keyword menu (async — DB lookup)
  try {
    const kwMenu = await findKeywordMenu(env, context.tenantId || 'tenant_default', msg);
    if (kwMenu) {
      matched.push({ intent: 'menu_keyword', confidence: 0.95 });
      evidence.menu_keyword = { menu_id: kwMenu.id, title: kwMenu.title };
    }
  } catch (e) {
    // Don't silently drop — this is shadow mode now, but a Step 2 migration
    // depends on the classifier being trustworthy. Log so we can spot DB
    // outages or schema drift.
    console.warn('[intent-classifier] menu_keyword lookup failed:', e?.message);
  }

  // 3. Machine spec (sync regex)
  const machineDetect = detectMachineQuery(msg);
  if (machineDetect.isMachineQuery) {
    matched.push({ intent: 'machine', confidence: machineDetect.confidence });
    evidence.machine = {
      patterns: machineDetect.matched_patterns,
      blacklisted: machineDetect.blacklisted || false,
    };
  }

  // 4. Announcements (sync regex)
  if (detectAnnouncementQuery(msg)) {
    matched.push({ intent: 'announcement', confidence: 0.8 });
    evidence.announcement = { detected: true };
  }

  // 5. Non-Japanese (sync)
  if (isNonJapaneseQuery(msg)) {
    matched.push({ intent: 'non_japanese', confidence: 0.9 });
    evidence.non_japanese = { detected: true };
  }

  // --- Priority resolution ---
  const PRIORITY = ['escalation', 'menu_keyword', 'machine', 'announcement', 'non_japanese'];

  if (matched.length === 0) {
    return {
      primary: 'rag_default',
      secondary: [],
      confidence: 0.5,
      evidence,
    };
  }

  // Sort by priority order
  matched.sort((a, b) => {
    const ai = PRIORITY.indexOf(a.intent);
    const bi = PRIORITY.indexOf(b.intent);
    return ai - bi;
  });

  const primary = matched[0].intent;
  const secondary = matched.slice(1).map((m) => m.intent);

  return {
    primary,
    secondary,
    confidence: matched[0].confidence,
    evidence,
  };
}
