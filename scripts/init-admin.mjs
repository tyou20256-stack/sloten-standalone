#!/usr/bin/env node
// Create (or reset) an admin staff_member.
// Usage:
//   node scripts/init-admin.mjs admin@example.com [--remote]
//
// Generates a random 22-char password, PBKDF2-hashes it, upserts the row,
// and prints the password to stdout once. Save it — it's not retrievable later.

import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const email = args.find((a) => !a.startsWith('--'));
const DB = 'sloten_standalone_db';

if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/init-admin.mjs admin@example.com [--remote]');
  process.exit(1);
}

// Web Crypto is available in Node 20+ without imports.
function randomPassword(len = 22) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#%&';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function hashPassword(password) {
  const ITER = 100_000;
  const KEYLEN = 32;
  const SALTLEN = 16;
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALTLEN));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, KEYLEN * 8);
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  return { hash: b64(new Uint8Array(bits)), salt: b64(salt) };
}

function sqlEscape(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

async function main() {
  const password = randomPassword();
  const { hash, salt } = await hashPassword(password);

  const sql = `
INSERT INTO staff_members (email, name, role, password_hash, password_salt, is_active)
VALUES (${sqlEscape(email)}, ${sqlEscape(email.split('@')[0])}, 'admin', ${sqlEscape(hash)}, ${sqlEscape(salt)}, 1)
ON CONFLICT(email) DO UPDATE SET
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt,
  role = 'admin',
  is_active = 1,
  failed_attempts = 0,
  locked_until = NULL,
  updated_at = datetime('now');
`.trim();

  const flags = remote ? '--remote' : '--local';
  try {
    execSync(`wrangler d1 execute ${DB} ${flags} --command=${JSON.stringify(sql)}`, { stdio: 'pipe' });
  } catch (e) {
    console.error('DB execute failed:', e.stdout?.toString() || e.message);
    process.exit(1);
  }

  console.log('==========================================');
  console.log('  Admin staff_member upserted.');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log('  Save this password — not shown again.');
  console.log('==========================================');
}

main().catch((e) => { console.error(e); process.exit(1); });
