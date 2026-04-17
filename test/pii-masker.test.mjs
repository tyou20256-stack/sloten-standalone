import { describe, it, expect } from 'vitest';
import { maskPII } from '../src/pii-masker.mjs';

describe('maskPII', () => {
  it('masks email addresses', () => {
    expect(maskPII('連絡先: test@example.com です')).toContain('[EMAIL]');
    expect(maskPII('test@example.com')).not.toContain('test@example.com');
  });

  it('masks Japanese phone numbers', () => {
    expect(maskPII('電話番号は 090-1234-5678 です')).toContain('[PHONE]');
    expect(maskPII('08012345678')).toContain('[PHONE]');
  });

  it('masks 12-digit sequences as MyNumber', () => {
    expect(maskPII('123456789012')).toContain('[MYNUMBER]');
  });

  it('preserves 20-digit txn IDs (not PII-masked at masker level)', () => {
    // 20-digit transaction IDs are handled by extractor.mjs shouldRejectFaqPair,
    // not by pii-masker. The masker focuses on phone/email/MyNumber/card.
    const result = maskPII('取引番号 02246825413292220418');
    expect(result).toContain('02246825413292220418');
  });

  it('preserves non-PII text', () => {
    expect(maskPII('ログインできません')).toBe('ログインできません');
    expect(maskPII('ゲームがフリーズした')).toBe('ゲームがフリーズした');
  });

  it('handles null/undefined gracefully', () => {
    expect(maskPII(null)).toBe('');
    expect(maskPII(undefined)).toBe('');
    expect(maskPII('')).toBe('');
  });
});
