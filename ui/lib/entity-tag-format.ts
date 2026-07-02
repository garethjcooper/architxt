/**
 * Entity Tag Format — UI mirror of server canonical contract
 *
 * This file now re-exports the shared @architxt/entity-matcher primitives
 * and adds runtime format discovery on top.
 */

import { configApi } from '@/lib/api/client';

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

// Runtime-loaded format state
let _cachedFormat: FormatRegistry | null = null;

export async function loadFormatRegistry(): Promise<FormatRegistry> {
  if (_cachedFormat) return _cachedFormat;

  try {
    const data = await configApi.getEntityFormat();
    _cachedFormat = data;
    return data;
  } catch (err) {
    console.warn('[entity-tag-format] Server format fetch failed, using default', err);
    const fallback: FormatRegistry = {
      activeKey: 'v3-single-entity',
      active: {
        key: 'v3-single-entity',
        displayName: 'Single Field with Type Prefix (type:id)',
        regexSource: '\\[\\[(.*?)\\s*(?:\\(([^)]*)\\))?\\]\\]',
        regexFlags: 'g',
        presentInIndicator: '[[',
      },
      registry: {},
    };
    _cachedFormat = fallback;
    return fallback;
  }
}

export function getCachedFormat(): FormatRegistry {
  return _cachedFormat ?? {
    activeKey: 'v3-single-entity',
    active: {
      key: 'v3-single-entity',
      displayName: 'Single Field with Type Prefix (type:id)',
      regexSource: '\\[\\[(.*?)\\s*(?:\\(([^)]*)\\))?\\]\\]',
      regexFlags: 'g',
      presentInIndicator: '[[',
    },
    registry: {},
  };
}

export function getActiveRegex(): RegExp {
  const { active } = getCachedFormat();
  return new RegExp(active.regexSource, active.regexFlags);
}

export function hasEntityTags(content: string | null): boolean {
  if (!content) return false;
  const { active } = getCachedFormat();
  return content.includes(active.presentInIndicator);
}

/** Re-export shared tag primitives. */
export { buildTag, parseTagParen, renderEntityTaggedContent } from '@architxt/entity-matcher';
export type { TagMatchData } from '@architxt/entity-matcher';
