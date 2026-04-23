#!/usr/bin/env node
// Chunk knowledge_sources.content into knowledge_chunks rows for
// finer-grained retrieval (HANDOFF/ai-accuracy-discussion/04-data-engineer.md §2).
//
// Strategy:
//   - Split by Markdown heading (^##) first, then by paragraph, then by
//     char-count cap (400 JA chars).
//   - 15% overlap (~60 chars) between adjacent chunks to preserve context.
//   - Prefix each chunk with its heading_path so the FTS index + LLM context
//     both know "where this came from".
//
// Usage:
//   node scripts/chunk-knowledge.mjs                 # dry-run preview
//   node scripts/chunk-knowledge.mjs --apply         # write to staging-bk D1
//   node scripts/chunk-knowledge.mjs --apply --embed # also push to Vectorize (future)

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const CONFIG = 'wrangler.staging-bk.toml';
const DB = 'sloten_standalone_db_staging_bk';
const TMP = 'seeds/_seed-chunks.sql';

const APPLY = process.argv.includes('--apply');
const EMBED = process.argv.includes('--embed');

const TARGET_CHARS = 400;   // JP: roughly 200-280 tokens
const MIN_CHARS = 120;      // too-short chunks get merged
const OVERLAP_CHARS = 60;   // ~15% overlap

function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

function splitByHeading(md) {
  const lines = md.split(/\r?\n/);
  const sections = [];
  let current = { heading: '', body: [] };
  for (const line of lines) {
    const m = line.match(/^(##+)\s+(.*)/);
    if (m) {
      if (current.body.length || current.heading) sections.push(current);
      current = { heading: m[2].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.length || current.heading) sections.push(current);
  return sections;
}

function splitByParagraph(text) {
  return text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
}

// Greedy accumulator: grow a chunk up to TARGET_CHARS, then emit with overlap.
function chunksFrom(heading, body) {
  const paragraphs = splitByParagraph(body);
  if (paragraphs.length === 0) return [];

  const chunks = [];
  let buf = '';
  for (const p of paragraphs) {
    const candidate = buf ? `${buf}\n\n${p}` : p;
    if (candidate.length <= TARGET_CHARS) {
      buf = candidate;
    } else {
      if (buf) chunks.push(buf);
      // If single paragraph exceeds target, emit in slices with overlap.
      if (p.length > TARGET_CHARS) {
        let i = 0;
        while (i < p.length) {
          const end = Math.min(p.length, i + TARGET_CHARS);
          chunks.push(p.slice(i, end));
          if (end >= p.length) break;
          i = end - OVERLAP_CHARS;
        }
        buf = '';
      } else {
        buf = p;
      }
    }
  }
  if (buf && buf.length >= MIN_CHARS) chunks.push(buf);
  else if (buf && chunks.length) chunks[chunks.length - 1] += '\n\n' + buf; // merge tiny tail

  // Prefix with heading for retrieval signal.
  return chunks.map((c, idx) => ({
    heading_path: heading || '',
    content: heading ? `[${heading}]\n${c}` : c,
    chunk_idx: idx,
    token_count: Math.ceil(c.length * 0.65),  // rough JP token approximation
    content_hash: sha256(c),
  }));
}

// Fetch all active manual_kb sources from D1.
function fetchSources() {
  const out = execSync(
    `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote ` +
    `--command "SELECT id, title, content FROM knowledge_sources ` +
    `WHERE is_active = 1 AND content IS NOT NULL AND length(content) > 200" --json`,
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  return parsed[0]?.results || [];
}

function main() {
  console.log(`Fetching active knowledge_sources from ${DB} (remote)...`);
  const sources = fetchSources();
  console.log(`  -> ${sources.length} sources`);

  const all = [];
  for (const src of sources) {
    const md = src.content || '';
    const sections = splitByHeading(md);
    let chunkIdx = 0;
    for (const s of sections) {
      const sectionChunks = chunksFrom(s.heading, s.body.join('\n'));
      for (const c of sectionChunks) {
        all.push({ ...c, source_id: src.id, chunk_idx: chunkIdx++ });
      }
    }
    console.log(`  - source #${src.id} "${src.title}" -> ${chunkIdx} chunks`);
  }

  console.log(`\nTotal: ${all.length} chunks across ${sources.length} sources`);

  if (!APPLY) {
    console.log('\n[dry-run] Pass --apply to write to D1.');
    console.log('Sample first 3 chunks:');
    for (const c of all.slice(0, 3)) {
      console.log('  ' + '-'.repeat(60));
      console.log(`  source=${c.source_id} idx=${c.chunk_idx} tokens≈${c.token_count}`);
      console.log(`  heading: ${c.heading_path}`);
      console.log(`  content[:120]: ${c.content.slice(0, 120).replace(/\n/g, ' / ')}`);
    }
    return;
  }

  // Build idempotent SQL: delete previous chunks, then re-insert.
  const escSql = (s) => String(s ?? '').replace(/'/g, "''");
  const lines = [
    `DELETE FROM knowledge_chunks WHERE source_id IN (SELECT id FROM knowledge_sources WHERE is_active = 1);`,
  ];
  for (const c of all) {
    lines.push(
      `INSERT INTO knowledge_chunks (source_id, chunk_index, content, heading_path, token_count, content_hash) ` +
      `VALUES (${c.source_id}, ${c.chunk_idx}, '${escSql(c.content)}', '${escSql(c.heading_path)}', ${c.token_count}, '${escSql(c.content_hash)}');`,
    );
  }
  writeFileSync(TMP, lines.join('\n'));
  try {
    console.log(`\nApplying ${all.length} chunks to ${DB} (remote)...`);
    execSync(
      `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --file=${TMP}`,
      { stdio: 'inherit', maxBuffer: 50 * 1024 * 1024 },
    );
    console.log('OK');
  } finally {
    try { unlinkSync(TMP); } catch (_) {}
  }

  if (EMBED) {
    console.log('\n[embed] Vectorize push not yet wired — will be enabled after');
    console.log('  `wrangler vectorize create sloten-kb-index-staging --dimensions=1024 --metric=cosine`');
    console.log('  Run `npm run deploy --config wrangler.staging-bk.toml` first,');
    console.log('  then re-run this script with --embed.');
  }
}

main();
