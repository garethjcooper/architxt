/**
 * Entity Tag Format — UI mirror of server canonical contract
 *
 * This file MUST stay in sync with server/src/entity-tag-format.js.
 * The UI discovers the active format at runtime via configApi.getEntityFormat().
 * Never hardcode tag syntax in components.
 */

import { configApi } from '@/lib/api/client';

export interface TagMatchData {
  matchedText: string;
  entityName?: string;
  entityId?: string;
}

export interface EntityTagFormat {
  key: string;
  displayName: string;
  regexSource: string;
  regexFlags: string;
  presentInIndicator: string;
}

export interface FormatRegistry {
  activeKey: string;
  active: EntityTagFormat;
  registry: Record<string, EntityTagFormat>;
}

// ═══════════════════════════════════════════════════════════════
// Hardcoded default matching server/src/entity-tag-format.js.
// Used as fallback before runtime load completes. Never blocks render.
// ═══════════════════════════════════════════════════════════════
const DEFAULT_FORMAT: FormatRegistry = {
  activeKey: 'v2-single',
  active: {
    key: 'v2-single',
    displayName: 'Single Field (id only)',
    regexSource: '\\[\\[(.*?)\\s*(?:\\(([^)]*)\\))?\\]\\]',
    regexFlags: 'g',
    presentInIndicator: '[[',
  },
  registry: {
    'v1-dual': {
      key: 'v1-dual',
      displayName: 'Dual Field (name + id)',
      regexSource: '\\[\\[(.*?)\\s*(?:\\(([^)]*)\\))?\\]\\]',
      regexFlags: 'g',
      presentInIndicator: '[[',
    },
    'v2-single': {
      key: 'v2-single',
      displayName: 'Single Field (id only)',
      regexSource: '\\[\\[(.*?)\\s*(?:\\(([^)]*)\\))?\\]\\]',
      regexFlags: 'g',
      presentInIndicator: '[[',
    },
  },
};

// Runtime-loaded format state (upgraded from default when server responds)
let _cachedFormat: FormatRegistry | null = null;

/**
 * Load the active entity tag format from the server.
 * Caches result after first call; subsequent callers get the cached value.
 */
export async function loadFormatRegistry(): Promise<FormatRegistry> {
  if (_cachedFormat) return _cachedFormat;

  try {
    const data = await configApi.getEntityFormat();
    _cachedFormat = data;
    return data;
  } catch (err) {
    console.warn('[entity-tag-format] Server format fetch failed, using default', err);
    _cachedFormat = DEFAULT_FORMAT;
    return DEFAULT_FORMAT;
  }
}

/**
 * Get cached format registry.
 * Safe to call during render — returns the hardcoded default if the server
 * format has not been loaded yet. The default matches the server canonical
 * so behaviour is correct even before the async fetch completes.
 */
export function getCachedFormat(): FormatRegistry {
  return _cachedFormat ?? DEFAULT_FORMAT;
}

/**
 * Build a RegExp from the active format definition.
 */
export function getActiveRegex(): RegExp {
  const { active } = getCachedFormat();
  return new RegExp(active.regexSource, active.regexFlags);
}

/**
 * Quick check: does content contain entity tags?
 */
export function hasEntityTags(content: string | null): boolean {
  if (!content) return false;
  const { active } = getCachedFormat();
  return content.includes(active.presentInIndicator);
}

/**
 * Parse a tag match. Format-agnostic — detects v1 vs v2 per-tag by checking
 * for a comma in the paren content. This allows mixed documents (old v1 tags
 * alongside new v2 tags) to render and scan correctly regardless of the
 * globally active format.
 */
export function parseTagParen(
  matchedText: string,
  parenContent: string | undefined
): TagMatchData {
  if (!parenContent) {
    return { matchedText };
  }

  const trimmed = parenContent.trim();

  // v1-dual: contains a comma → "entityName, entityId"
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((s) => s.trim());
    const entityName = parts[0];
    const entityId = parts[1];
    return {
      matchedText,
      entityName: entityName || matchedText,
      entityId,
    };
  }

  // v2-single: no comma → "entityId"
  return {
    matchedText,
    entityId: trimmed,
  };
}

/**
 * Build a tag string using the current active format.
 */
export function buildTag(
  matchedText: string,
  entityName: string,
  entityId: string
): string {
  const { activeKey } = getCachedFormat();

  if (activeKey === 'v2-single') {
    return `[[${matchedText} (${entityId})]]`;
  }

  // v1-dual
  return `[[${matchedText} (${entityName}, ${entityId})]]`;
}
