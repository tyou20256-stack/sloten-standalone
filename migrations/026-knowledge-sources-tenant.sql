-- Add tenant_id to knowledge_sources for true multi-tenant KB isolation.
--
-- Background: 2026-05-09 architecture audit flagged that knowledge_sources
-- has no tenant_id column despite the rest of the data model being
-- tenant-scoped. The Vectorize tenant scoping work (commit 71d3b2d) had to
-- tag chunks with the staff's resolved tenantId rather than the source's
-- own tenant_id. As soon as a 2nd tenant onboards and starts editing KB,
-- the first tenant's vectors get overwritten on reindex.
--
-- This migration adds the column with a default of 'tenant_default' so
-- existing rows are tagged correctly, then adds an index for the common
-- (tenant_id, is_active, priority) query pattern.
--
-- Safe to apply: backfills existing rows to tenant_default (only tenant
-- live today). Vectorize reindex MUST be re-run after deploy so chunk
-- vectors carry the source's actual tenant_id (currently they are tagged
-- with the staff's resolved tenant which is the same value today).
--
-- @idempotent — uses ALTER TABLE IF NOT EXISTS pattern via duplicate-safe
-- error handling at the apply-migrations.mjs level. SQLite doesn't support
-- IF NOT EXISTS on ALTER TABLE; the runner treats "duplicate column" as
-- success.
-- MIGRATION-LINT: safe (additive column with default; no data loss path)

ALTER TABLE knowledge_sources ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_default';

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_tenant_active
  ON knowledge_sources(tenant_id, is_active, priority DESC, id DESC);
