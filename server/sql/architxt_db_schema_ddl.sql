-- architxt Database Schema 
-- All field names use table-specific prefixes to prevent collisions

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

CREATE TABLE documents (
  doc_id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_ext_id TEXT UNIQUE,
  ctxt_id INTEGER,
  doc_status TEXT,
  doc_content TEXT,
  doc_content_hash TEXT,
  doc_content_blocks JSON,
  doc_source_path TEXT,
  doc_filename TEXT,
  doc_full_path TEXT,
  doc_authors JSON,
  doc_processing_history JSON,
  doc_processing_progress JSON,
  doc_generated_by TEXT CHECK(doc_generated_by IN ('user', 'import')),
  doc_timestamp TEXT,
  doc_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  doc_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (ctxt_id) REFERENCES contexts(ctxt_id) ON DELETE SET NULL
);

CREATE TABLE contexts (
  ctxt_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ctxt_desc TEXT ,
  ctxt_generated_by TEXT CHECK(ctxt_generated_by IN ('user', 'import')),
  ctxt_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  ctxt_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE tags (
  tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_name TEXT UNIQUE,
  tag_generated_by TEXT CHECK(tag_generated_by IN ('user', 'import')),
  tag_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  tag_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE metadata (
  meta_id INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_key TEXT NOT NULL,
  meta_value TEXT,
  meta_generated_by TEXT CHECK(meta_generated_by IN ('user', 'import', 'system')),
  meta_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  meta_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UNIQUE(meta_key, meta_value)
);

-- ============================================================================
-- JUNCTION TABLES
-- ============================================================================

CREATE TABLE document_tags (
  tag_id INTEGER NOT NULL,
  doc_id INTEGER NOT NULL,
  doc_tag_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  doc_tag_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (tag_id, doc_id),
  FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE,
  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
);

CREATE TABLE document_metadata (
  meta_id INTEGER NOT NULL,
  doc_id INTEGER NOT NULL,
  doc_meta_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  doc_meta_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (meta_id, doc_id),
  FOREIGN KEY (meta_id) REFERENCES metadata(meta_id) ON DELETE CASCADE,
  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
);

-- ============================================================================
-- SERVER/MEMORYBANK TABLES
-- ============================================================================

CREATE TABLE servers (
  svr_id INTEGER PRIMARY KEY AUTOINCREMENT,
  svr_base_url TEXT NOT NULL,
  svr_name TEXT,
  svr_api_key TEXT,
  svr_api_version TEXT,
  svr_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  svr_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================================
-- PENDING OPERATIONS TABLE (async Hindsight operation tracking)
-- ============================================================================

CREATE TABLE pending_operations (
  pop_id INTEGER PRIMARY KEY AUTOINCREMENT,
  pop_operation_id TEXT NOT NULL,
  pop_server_id INTEGER NOT NULL,
  pop_bank_id TEXT NOT NULL,
  pop_doc_id INTEGER NOT NULL,
  pop_ext_id TEXT,
  pop_action TEXT NOT NULL DEFAULT 'push',
  pop_status TEXT NOT NULL DEFAULT 'pending',
  pop_error_message TEXT,
  pop_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  pop_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (pop_doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
);

CREATE INDEX idx_pending_ops_server_bank ON pending_operations(pop_server_id, pop_bank_id);
CREATE INDEX idx_pending_ops_status ON pending_operations(pop_status);
CREATE INDEX idx_pending_ops_ext_id ON pending_operations(pop_ext_id);
CREATE INDEX idx_pending_ops_doc_id ON pending_operations(pop_doc_id);

-- ============================================================================
-- ENTITY TYPES — classification groups (e.g. Application Component, Service)
-- ============================================================================

CREATE TABLE entity_types (
  et_id INTEGER PRIMARY KEY AUTOINCREMENT,
  et_type_name TEXT NOT NULL UNIQUE,
  et_description TEXT,
  et_id_label TEXT,
  et_name_label TEXT,
  et_case_match TEXT DEFAULT 'insensitive' CHECK (et_case_match IN ('insensitive', 'sensitive')),
  et_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  et_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================================
-- ENTITIES — rows grouped by type, each with id + name + aliases[]
-- ============================================================================

CREATE TABLE entities (
  ent_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ent_type_id INTEGER NOT NULL REFERENCES entity_types(et_id) ON DELETE RESTRICT,
  ent_entity_id TEXT NOT NULL UNIQUE,
  ent_name TEXT NOT NULL UNIQUE,
    ent_description TEXT,
  ent_aliases JSON,           -- array of strings
  ent_case_match TEXT DEFAULT 'insensitive' CHECK (ent_case_match IN ('insensitive', 'sensitive')),
  ent_generated_by TEXT CHECK(ent_generated_by IN ('user', 'import')),
  ent_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  ent_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_entities_type ON entities(ent_type_id);

-- ============================================================================
-- FULL-TEXT SEARCH (FTS5)
-- ============================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  doc_content,
  content='documents',
  content_rowid='doc_id',
  tokenize="unicode61 tokenchars '-_:'"
);

-- ============================================================================
-- MENTAL MODELS — mental model local storage/configuration
-- ============================================================================

CREATE TABLE mental_models (
  mm_id INTEGER PRIMARY KEY AUTOINCREMENT,
  mm_ext_id TEXT NOT NULL UNIQUE,
  mm_name TEXT,
  mm_source_query TEXT,
  mm_refresh_after_consolidation TEXT DEFAULT 'false',
  mm_refresh_mode TEXT DEFAULT 'full',
  mm_exclude_all_mental_models TEXT DEFAULT 'false',
  mm_exclude_mental_model_list TEXT,
  mm_tags_match_mode TEXT DEFAULT 'all_strict',
  mm_is_template TEXT DEFAULT 'false',
  mm_max_tokens INTEGER DEFAULT 2048,
  mm_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  mm_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE mental_model_tags (
  tag_id INTEGER NOT NULL,
  mm_id INTEGER NOT NULL,
  mm_tag_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  mm_tag_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (tag_id, mm_id),
  FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE,
  FOREIGN KEY (mm_id) REFERENCES mental_models(mm_id) ON DELETE CASCADE
);

CREATE TABLE mental_model_entities (
  ent_id INTEGER NOT NULL,
  mm_id INTEGER NOT NULL,
  mm_ent_refresh_mode TEXT,
  mm_ent_refresh_after_consolidation TEXT,
  mm_ent_exclude_all_mental_models TEXT,
  mm_ent_max_tokens INTEGER DEFAULT 2048,
  mm_ent_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  mm_ent_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (ent_id, mm_id),
  FOREIGN KEY (ent_id) REFERENCES entities(ent_id) ON DELETE CASCADE,
  FOREIGN KEY (mm_id) REFERENCES mental_models(mm_id) ON DELETE CASCADE
);

CREATE TABLE directives (
  dir_id INTEGER PRIMARY KEY AUTOINCREMENT,
  dir_ext_id TEXT UNIQUE,
  dir_name TEXT,
  dir_statement TEXT,
  dir_is_active TEXT CHECK (dir_is_active IN ('true', 'false')),
  dir_priority INTEGER DEFAULT 0,
  dir_generated_by TEXT CHECK(dir_generated_by IN ('user', 'import')),
  dir_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  dir_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE directive_tags (
  tag_id INTEGER NOT NULL,
  dir_id INTEGER NOT NULL,
  dir_tag_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  dir_tag_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (tag_id, dir_id),
  FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE,
  FOREIGN KEY (dir_id) REFERENCES directives(dir_id) ON DELETE CASCADE
);
