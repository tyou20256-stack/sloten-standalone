-- @idempotent — 000-schema-bootstrap.sql
-- Consolidated golden schema for fresh deployments. Re-runnable; every
-- statement uses IF NOT EXISTS. Equivalent to applying 001..013 in order.
-- For brand-new environments, prefer this single file over the numbered set.

-- ============================================================
-- contacts
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  email TEXT, phone TEXT, name TEXT, avatar_url TEXT, metadata TEXT,
  is_identified INTEGER NOT NULL DEFAULT 0,
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(tenant_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_external_id ON contacts(external_id);

-- ============================================================
-- conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  contact_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'bot' CHECK(status IN ('bot','open','closed')),
  assignee_id INTEGER,
  team_id INTEGER,
  priority TEXT DEFAULT 'normal',
  labels TEXT DEFAULT '',
  snoozed_until TEXT,
  last_message_at TEXT, last_message_preview TEXT,
  unread_count_staff INTEGER NOT NULL DEFAULT 0,
  unread_count_customer INTEGER NOT NULL DEFAULT 0,
  metadata TEXT, external_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);
CREATE INDEX IF NOT EXISTS idx_conv_tenant_status ON conversations(tenant_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_contact ON conversations(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_assignee ON conversations(assignee_id, status) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_priority ON conversations(tenant_id, priority, status);
CREATE INDEX IF NOT EXISTS idx_conv_team ON conversations(team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_external_id ON conversations(external_id);

-- ============================================================
-- messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  sender_type TEXT NOT NULL CHECK(sender_type IN ('customer','bot','staff','system')),
  sender_id TEXT,
  content TEXT,
  content_type TEXT NOT NULL DEFAULT 'text' CHECK(content_type IN ('text','input_select','file','system_event')),
  content_attributes TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_msg_tenant_sender ON messages(tenant_id, sender_type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_id);

-- ============================================================
-- faq / templates / knowledge_sources / knowledge_chunks
CREATE TABLE IF NOT EXISTS faq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  question TEXT NOT NULL, answer TEXT NOT NULL, category TEXT, language TEXT DEFAULT 'ja',
  keywords TEXT, priority INTEGER DEFAULT 0, usage_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0, helpful_count INTEGER DEFAULT 0, unhelpful_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_faq_tenant_active ON faq(tenant_id, is_active, priority DESC);
CREATE INDEX IF NOT EXISTS idx_faq_category ON faq(tenant_id, category);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  name TEXT NOT NULL, category TEXT, content TEXT NOT NULL, language TEXT DEFAULT 'ja',
  shortcut TEXT, usage_count INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tpl_tenant ON templates(tenant_id, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_tpl_shortcut ON templates(tenant_id, shortcut) WHERE shortcut IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT, title TEXT, content TEXT, raw_html TEXT, metadata TEXT,
  source_type TEXT DEFAULT 'url', priority INTEGER DEFAULT 3, content_hash TEXT,
  auto_refresh INTEGER DEFAULT 0, last_refreshed_at TEXT, category TEXT DEFAULT 'general',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL, content TEXT NOT NULL, embedding TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ks_active_priority ON knowledge_sources(is_active, priority, id DESC);
CREATE INDEX IF NOT EXISTS idx_kc_source ON knowledge_chunks(source_id, chunk_index);

-- ============================================================
-- staff + auth
CREATE TABLE IF NOT EXISTS staff_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  email TEXT UNIQUE NOT NULL, name TEXT, role TEXT DEFAULT 'agent' CHECK(role IN ('admin','agent','viewer')),
  phone TEXT, department TEXT, hired_at TEXT, bio TEXT, language TEXT DEFAULT 'ja',
  password_hash TEXT, password_salt TEXT,
  session_token_hash TEXT, session_expires_at TEXT,
  failed_attempts INTEGER DEFAULT 0, locked_until TEXT, last_login_at TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_session ON staff_members(session_token_hash) WHERE session_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff_members(email);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, name TEXT, settings TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant_default', 'Default Tenant');

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- labels + teams
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  name TEXT NOT NULL, color TEXT DEFAULT '#6b7280', description TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_tenant_name ON labels(tenant_id, name);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  name TEXT NOT NULL, description TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_tenant_name ON teams(tenant_id, name);
CREATE TABLE IF NOT EXISTS team_members (
  team_id INTEGER NOT NULL, staff_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, staff_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_team_members_staff ON team_members(staff_id);

-- ============================================================
-- ai_prompts + ai_logs + ai_log_feedback
CREATE TABLE IF NOT EXISTS ai_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  name TEXT NOT NULL, description TEXT, system_prompt TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 50 CHECK (weight >= 0 AND weight <= 100),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_active ON ai_prompts(tenant_id, is_active, weight);

CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  conversation_id TEXT, message_id TEXT, provider TEXT NOT NULL, model TEXT NOT NULL,
  system_prompt TEXT, input TEXT, output TEXT,
  tokens_in INTEGER, tokens_out INTEGER, latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'ok', error_message TEXT,
  prompt_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_tenant_status ON ai_logs(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_conversation ON ai_logs(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_prompt ON ai_logs(prompt_id) WHERE prompt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_log_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ai_log_id INTEGER NOT NULL, staff_id INTEGER,
  rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ai_log_id) REFERENCES ai_logs(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_feedback_log_staff ON ai_log_feedback(ai_log_id, staff_id);
