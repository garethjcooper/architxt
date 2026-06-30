/**
 * Server adapter for @architxt/entity-matcher.
 *
 * Wires the shared matcher to the server-side active tag format so callers
 * do not need to pass a format object.
 */

import {
  findExistingEntityTags as sharedFindExistingEntityTags,
  scanForEntityMatches as sharedScanForEntityMatches,
  groupMatchesByEntity as sharedGroupMatchesByEntity,
} from '@architxt/entity-matcher';
import { getActiveFormat } from '../entity-tag-format.js';

function serverFormat() {
  const fmt = getActiveFormat();
  return {
    key: fmt.key,
    regexSource: fmt.regex.source,
    regexFlags: fmt.regex.flags,
    presentInIndicator: '[[' ,
  };
}

/**
 * @param {string} content
 * @returns {Array<{text: string, name: string, entityId?: string, start: number, end: number}>}
 */
export function findExistingEntityTags(content) {
  return sharedFindExistingEntityTags(serverFormat(), content);
}

/**
 * @param {Array<{id: number|string, entity_id: string, name: string, type_name?: string, aliases?: string[], case_match?: string, type_case_match?: string}>} entities
 * @param {string} content
 * @returns {Array<{entityDbId?: number|string, entity_id: string, name: string, type_name?: string, matchedText: string, start: number, end: number, fromTag: boolean}>}
 */
export function scanForEntityMatches(entities, content) {
  const raw = sharedScanForEntityMatches(serverFormat(), entities, content);
  return raw.map((m) => ({
    entityDbId: m.dbId,
    entity_id: m.entity_id,
    name: m.name,
    type_name: m.type_name,
    matchedText: m.matchedText,
    start: m.start,
    end: m.end,
    fromTag: m.fromTag,
  }));
}

/**
 * @param {ReturnType<typeof scanForEntityMatches>} matches
 * @returns {Map<string, {entity_id: string, name: string, type_name?: string, count: number, fromTag: boolean, ranges: Array<{start: number, end: number}>}>}
 */
export function groupMatchesByEntity(matches) {
  return sharedGroupMatchesByEntity(matches);
}
