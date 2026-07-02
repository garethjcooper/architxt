/**
 * Entity Tag Format — System-level canonical contract
 *
 * This module is the single source of truth for how entity tags are
 * embedded in doc_content, parsed, built, detected, and synced.
 *
 * WARNING: Changing ACTIVE_FORMAT_KEY or a format definition affects:
 *   - SQL queries (LIKE detection in listDocuments)
 *   - Hindsight entity_labels/schema sync
 *   - Content rendering in the UI
 *   - Pipeline extraction if tags are consumed downstream
 *
 * Exported via GET /api/v1/config/entity-format so the UI discovers
 * the active format at runtime. Never hardcode tag syntax elsewhere.
 */

/**
 * @typedef {Object} TagMatchData
 * @property {string} matchedText
 * @property {string} [entityName]
 * @property {string} [entityId]
 */

/**
 * @typedef {Object} EntityTagFormat
 * @property {string} key
 * @property {string} displayName
 * @property {RegExp} regex
 * @property {(match: RegExpMatchArray) => TagMatchData} parse
 * @property {(data: TagMatchData) => string} build
 * @property {(content: string) => boolean} presentIn
 */

// ═══════════════════════════════════════════════════════════════
// Registry of all known formats
// ═══════════════════════════════════════════════════════════════

/** @type {Record<string, EntityTagFormat>} */
const FORMATS = {
  /**
   * v1-dual: [[MatchedText (entity.name, entity.entity_id)]]
   * CURRENT production format. Hindsight entity_labels include
   * both 'id' and 'name' fields.
   */
  'v1-dual': {
    key: 'v1-dual',
    displayName: 'Dual Field (name + id)',
    regex: /\[\[(.*?)\s*(?:\(([^)]*)\))?\]\]/g,

    parse(match) {
      const matchedText = match[1].trim();
      const parenContent = match[2];
      let entityName;
      let entityId;
      if (parenContent) {
        const parts = parenContent.split(',').map((s) => s.trim());
        entityName = parts[0];
        entityId = parts[1];
      }
      return { matchedText, entityName: entityName || matchedText, entityId };
    },

    build(data) {
      if (!data.entityId) return `[[${data.matchedText}]]`;
      return `[[${data.matchedText} (${data.entityName}, ${data.entityId})]]`;
    },

    presentIn(content) {
      return content.includes('[[');
    },
  },

  /**
   * v2-single: [[MatchedText (entity.entity_id)]]
   * Proposed future format. Hindsight entity_labels include
   * only 'id' field. entity_name is a runtime DB lookup.
   */
  'v2-single': {
    key: 'v2-single',
    displayName: 'Single Field (id only)',
    regex: /\[\[(.*?)\s*(?:\(([^)]*)\))?\]\]/g,

    parse(match) {
      const matchedText = match[1].trim();
      const parenContent = match[2];

      // Format-agnostic: comma in parens = v1-dual, no comma = v2-single
      if (parenContent && parenContent.includes(',')) {
        const parts = parenContent.split(',').map((s) => s.trim());
        return {
          matchedText,
          entityName: parts[0] || matchedText,
          entityId: parts[1],
        };
      }

      return {
        matchedText,
        entityId: parenContent ? parenContent.trim() : undefined,
      };
    },

    build(data) {
      if (!data.entityId) return `[[${data.matchedText}]]`;
      return `[[${data.matchedText} (${data.entityId})]]`;
    },

    presentIn(content) {
      return content.includes('[[');
    },
  },

  /**
   * v3-single-entity: [[MatchedText (entity.type_name:entity.entity_id)]]
   * CURRENT production format. Includes entity type prefix in the id field
   * to make tags self-describing while keeping Hindsight sync ID-only.
   */
  'v3-single-entity': {
    key: 'v3-single-entity',
    displayName: 'Single Field with Type Prefix (type:id)',
    regex: /\[\[(.*?)\s*(?:\(([^)]*)\))?\]\]/g,

    parse(match) {
      const matchedText = match[1].trim();
      const parenContent = match[2];

      if (!parenContent) {
        return { matchedText };
      }

      const trimmed = parenContent.trim();

      // v3: "type:id" (colon, no comma)
      if (trimmed.includes(':') && !trimmed.includes(',')) {
        const colonIdx = trimmed.indexOf(':');
        const entityType = trimmed.slice(0, colonIdx).trim() || undefined;
        const entityId = trimmed.slice(colonIdx + 1).trim();
        return {
          matchedText,
          entityId,
          entityType,
        };
      }

      // Backward compatible with older v1/v2 tags
      if (trimmed.includes(',')) {
        const parts = trimmed.split(',').map((s) => s.trim());
        return {
          matchedText,
          entityName: parts[0] || matchedText,
          entityId: parts[1],
        };
      }

      return {
        matchedText,
        entityId: trimmed,
      };
    },

    build(data) {
      if (!data.entityId) return `[[${data.matchedText}]]`;
      return `[[${data.matchedText} (${data.entityType ? `${data.entityType}:` : ''}${data.entityId})]]`;
    },

    presentIn(content) {
      return content.includes('[[');
    },
  },
};

// ═══════════════════════════════════════════════════════════════
// Active selection — change this constant to switch system-wide
// ═══════════════════════════════════════════════════════════════

/** @type {string} */
export const ACTIVE_FORMAT_KEY = 'v3-single-entity';

/**
 * Get the currently active format definition.
 * @returns {EntityTagFormat}
 */
export function getActiveFormat() {
  const fmt = FORMATS[ACTIVE_FORMAT_KEY];
  if (!fmt) throw new Error(`EntityTagFormat "${ACTIVE_FORMAT_KEY}" not found in registry`);
  return fmt;
}

/**
 * Get all registered formats (for UI discovery).
 * @returns {Record<string, EntityTagFormat>}
 */
export function getAllFormats() {
  return FORMATS;
}

// ═══════════════════════════════════════════════════════════════
// SQL helpers (for DB CRUD to consume)
// ═══════════════════════════════════════════════════════════════

/**
 * Returns a SQLite expression that detects presence of entity tags.
 * Both v1 and v2 share [[ ... ]] delimiters, so this is stable.
 *
 * @param {string} [column='d.doc_content']
 * @returns {string}
 */
export function getSqlPresenceExpression(column = 'd.doc_content') {
  return `${column} LIKE '%[[%'`;
}

// ═══════════════════════════════════════════════════════════════
// Hindsight sync helpers
// ═══════════════════════════════════════════════════════════════

/**
 * When pushing entity types to Hindsight as map labels,
 * should we include the 'name' field?
 * v1-dual: yes. v2/v3: no.
 *
 * @returns {boolean}
 */
export function shouldSyncNameField() {
  return ACTIVE_FORMAT_KEY === 'v1-dual';
}

/**
 * Fields that are actually synced/comparable for the active format.
 * The UI should only show diff badges/sections for these fields.
 * v1-dual: ['id', 'name', 'description']
 * v2/v3: ['id', 'description'] (name is not part of the sync contract)
 *
 * @returns {string[]}
 */
export function getSyncedFields() {
  return shouldSyncNameField()
    ? ['id', 'name', 'description']
    : ['id', 'description'];
}
