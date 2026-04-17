import { describe, it, expect, beforeEach } from 'vitest';
import { getEnvValue, clearEnvCache } from '../src/env-resolver.mjs';

describe('getEnvValue', () => {
  beforeEach(() => clearEnvCache());

  it('returns static env value when no DB override', async () => {
    const env = {
      GAS_BOT_WEBHOOK_URL: 'https://example.com/gas',
      DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
    };
    const v = await getEnvValue(env, 'GAS_BOT_WEBHOOK_URL');
    expect(v).toBe('https://example.com/gas');
  });

  it('prefers DB override over static env', async () => {
    const env = {
      GAS_BOT_WEBHOOK_URL: 'https://static.com',
      DB: { prepare: () => ({ bind: () => ({ first: async () => ({ value: 'https://override.com' }) }) }) },
    };
    const v = await getEnvValue(env, 'GAS_BOT_WEBHOOK_URL');
    expect(v).toBe('https://override.com');
  });

  it('returns empty string when neither exists', async () => {
    const env = {
      DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
    };
    const v = await getEnvValue(env, 'NONEXISTENT_KEY');
    expect(v).toBe('');
  });

  it('caches results', async () => {
    let callCount = 0;
    const env = {
      TEST_KEY: 'value',
      DB: { prepare: () => ({ bind: () => ({ first: async () => { callCount++; return null; } }) }) },
    };
    await getEnvValue(env, 'TEST_KEY');
    await getEnvValue(env, 'TEST_KEY');
    expect(callCount).toBe(1); // second call uses cache
  });

  it('clearEnvCache busts specific key', async () => {
    let callCount = 0;
    const env = {
      TEST_KEY: 'value',
      DB: { prepare: () => ({ bind: () => ({ first: async () => { callCount++; return null; } }) }) },
    };
    await getEnvValue(env, 'TEST_KEY');
    clearEnvCache('TEST_KEY');
    await getEnvValue(env, 'TEST_KEY');
    expect(callCount).toBe(2);
  });
});
