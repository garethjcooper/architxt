'use client';

/**
 * Entity Scan Panel — UI for detecting and applying entity tags.
 *
 * Uses @architxt/entity-matcher as the source of truth for:
 *   - existing tag discovery
 *   - clean-text entity scanning
 *   - tag building
 *
 * UI-only concerns (grouping cards, per-match apply, rendering) stay here.
 */

import type { Entity } from '@/lib/api/client';
import { getCachedFormat } from '@/lib/entity-tag-format';
import {
  buildTag as sharedBuildTag,
  findExistingEntityTags as sharedFindExistingEntityTags,
  scanForEntityMatches as sharedScanForEntityMatches,
  buildCleanToRawMap as sharedBuildCleanToRawMap,
  renderEntityTaggedContent as sharedRenderEntityTaggedContent,
} from '@architxt/entity-matcher';

function uiFormat() {
  const { active } = getCachedFormat();
  return {
    key: active.key,
    regexSource: active.regexSource,
    regexFlags: active.regexFlags,
    presentInIndicator: active.presentInIndicator,
  };
}

/** Remove all entity markup tags, leaving plain text */
export function stripEntityTags(content: string): string {
  const regex = new RegExp(uiFormat().regexSource, uiFormat().regexFlags);
  return content.replace(regex, '$1');
}

/** Find all existing entity tags in content */
export interface ExistingTag {
  text: string;
  name: string;
  id?: string;
  start: number;
  end: number;
}

export function findExistingEntityTags(content: string): ExistingTag[] {
  return sharedFindExistingEntityTags(uiFormat(), content);
}

/** Group existing tags by entity and collect per-occurrence context */
export interface ExistingTagGroup {
  id: string;
  entityName: string;
  matches: Array<{
    text: string;
    start: number;
    end: number;
    lineContext: string;
  }>;
}

export function groupExistingTagsByEntity(
  content: string,
  tags: ExistingTag[]
): ExistingTagGroup[] {
  const lines = content.split('\n');
  const lineRanges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const line of lines) {
    lineRanges.push({ start: cursor, end: cursor + line.length });
    cursor += line.length + 1;
  }

  const map = new Map<string, ExistingTagGroup>();

  for (const tag of tags) {
    let contextLine = '';
    for (let i = 0; i < lineRanges.length; i++) {
      if (tag.start >= lineRanges[i].start && tag.start < lineRanges[i].end + 1) {
        contextLine = lines[i];
        break;
      }
    }

    if (!map.has(tag.id!)) {
      map.set(tag.id!, {
        id: tag.id!,
        entityName: tag.name,
        matches: [],
      });
    }
    map.get(tag.id!)!.matches.push({
      text: tag.text,
      start: tag.start,
      end: tag.end,
      lineContext: contextLine,
    });
  }

  return Array.from(map.values());
}

/** Scan clean text for entity matches, returning groups */
export interface MatchGroup {
  id: string;
  dbId: number;
  entityId: string;
  entityName: string;
  description: string | null;
  matchedText: string;
  replacementText: string;
  matches: Array<{
    startIndex: number;
    rawStartIndex: number;
    lineContext: string;
  }>;
}

/**
 * Scan content for entity matches.
 * Skips text that is already inside entity tags.
 * Match source: entity.name + entity.aliases.
 */
export function scanForEntityMatches(
  entities: Entity[],
  content: string
): MatchGroup[] {
  const rawMatches = sharedScanForEntityMatches(
    uiFormat(),
    entities.map((e) => ({
      id: e.id,
      entity_id: e.entity_id,
      name: e.name,
      type_name: e.type_name,
      aliases: e.aliases,
      case_match: e.case_match,
      type_case_match: e.type_case_match,
    })),
    content
  );

  const groupMap = new Map<string, MatchGroup>();
  const cleanToRaw = sharedBuildCleanToRawMap(uiFormat(), content);
  const cleanText = stripEntityTags(content);

  for (const m of rawMatches) {
    if (m.fromTag) continue; // UI scan panel only shows untagged proposed matches

    const groupId = `${m.dbId}:${m.matchedText}`;
    if (!groupMap.has(groupId)) {
      const entity = entities.find((e) => e.id === m.dbId);
      groupMap.set(groupId, {
        id: groupId,
        dbId: Number(m.dbId),
        entityId: m.entity_id,
        entityName: m.name,
        description: entity?.description ?? null,
        matchedText: m.matchedText,
        replacementText: sharedBuildTag(
          m.matchedText,
          m.name,
          m.entity_id,
          uiFormat().key as 'v1-dual' | 'v2-single'
        ),
        matches: [],
      });
    }

    const lines = cleanText.split('\n');
    let charCount = 0;
    let contextLine = '';
    for (const line of lines) {
      if (charCount <= m.startIndex! && m.startIndex! < charCount + line.length) {
        contextLine = line;
        break;
      }
      charCount += line.length + 1;
    }

    groupMap.get(groupId)!.matches.push({
      startIndex: m.startIndex!,
      rawStartIndex: cleanToRaw[m.startIndex!],
      lineContext: contextLine || m.matchedText,
    });
  }

  return Array.from(groupMap.values());
}

/**
 * Insert entity tags into content for the given match groups.
 * Preserves existing tags — only inserts new ones in untagged regions.
 * Match offsets from groups are in clean-text coordinates.
 * Builds a clean-to-raw offset map to find correct insertion positions.
 * Right-to-left insertion so earlier offsets stay valid.
 */
export function insertEntityTags(
  content: string,
  groups: MatchGroup[],
  includedGroupIds: Set<string>
): string {
  const cleanToRaw = sharedBuildCleanToRawMap(uiFormat(), content);
  const allMatches: Array<{
    cleanStart: number;
    rawStart: number;
    rawEnd: number;
    tag: string;
  }> = [];

  for (const group of groups) {
    if (!includedGroupIds.has(group.id)) continue;

    const tag = group.replacementText;

    for (const match of group.matches) {
      const cleanStart = match.startIndex;
      const cleanEnd = cleanStart + group.matchedText.length;
      allMatches.push({
        cleanStart,
        rawStart: cleanToRaw[cleanStart],
        rawEnd: cleanToRaw[cleanEnd],
        tag,
      });
    }
  }

  allMatches.sort((a, b) => b.rawStart - a.rawStart);

  let result = content;
  for (const match of allMatches) {
    const before = result.slice(0, match.rawStart);
    const after = result.slice(match.rawEnd);
    result = before + match.tag + after;
  }

  return result;
}

/** Split content into renderable segments: plain text + entity tags */
export interface ContentSegment {
  type: 'text' | 'entity';
  content: string;
  name?: string;
  id?: string;
  start?: number;
  end?: number;
}

export function renderEntityTaggedContent(content: string): ContentSegment[] {
  return sharedRenderEntityTaggedContent(uiFormat(), content);
}

// Re-export for consumers that only need the presence check
export { hasEntityTags } from '@architxt/entity-matcher';
