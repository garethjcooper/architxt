-- ============================================================================
-- SYSTEM SEED DATA
-- ============================================================================
-- Idempotent inserts: INSERT OR IGNORE skips duplicates via the
-- UNIQUE(meta_key, meta_value) constraint on the metadata table.
-- These entries are tagged with generated_by='system' and are read-only.
--
-- Array-based placeholders (Tags, Entities, Authors) are expected to produce
-- multiple metadata entries per document during retain expansion.
-- ============================================================================

INSERT OR IGNORE INTO metadata (meta_key, meta_value, meta_generated_by) VALUES
  ('architxt-tags',                   '{tags}',                  'system'),
  ('architxt-entity-match-pattern',   '{entity-match-pattern}',  'system'),
  ('architxt-entities',               '{entities}',              'system'),
  ('architxt-document-size',          '{document-size}',         'system'),
  ('architxt-document-full-path',     '{document-full-path}',    'system'),
  ('architxt-file-name',              '{document-file-name}',    'system'),
  ('architxt-document-date',          '{document-date}',         'system'),
  ('architxt-author',                 '{document-author}',       'system');
