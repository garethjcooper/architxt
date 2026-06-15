'use client';

/**
 * Entity tag utilities — pure text transforms, no offset tracking.
 *
 * These functions are format-aware: they read the active tag format
 * from the server via /api/v1/config/entity-format.
 *
 * Tag syntax (current active format — v1-dual):
 *   [[MatchedText (entity.name, entity.entity_id)]]
 *
 * If entity_id is omitted:
 *   [[MatchedText (entity.name)]]
 *
 * To switch formats server-wide, change ACTIVE_FORMAT_KEY in
 * server/src/entity-tag-format.js. The UI discovers the new format
 * on next page load via loadFormatRegistry().
 */

import type { Entity } from '@/lib/api/client';
import {
  getActiveRegex,
  parseTagParen,
  buildTag,
  hasEntityTags,
} from '@/lib/entity-tag-format';

/** Remove all entity markup tags, leaving plain text */
export function stripEntityTags(content: string): string {
  const regex = getActiveRegex();
  return content.replace(regex, '$1');
}

/** Find all existing entity tags in content */
export interface ExistingTag {
  text: string;     // display / matched text
  name: string;     // entity name (from paren)
  id?: string;      // entity id (from paren, if present)
  start: number;
  end: number;
}

export function findExistingEntityTags(content: string): ExistingTag[] {
  const tags: ExistingTag[] = [];
  const regex = getActiveRegex();
  let m: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((m = regex.exec(content)) !== null) {
    const matchedText = m[1].trim();
    const parenContent = m[2];

    const parsed = parseTagParen(matchedText, parenContent);

    tags.push({
      text: parsed.matchedText,
      name: parsed.entityName || parsed.matchedText,
      id: parsed.entityId,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return tags;
}

/** Group existing tags by entity and collect per-occurrence context */
export interface ExistingTagGroup {
  id: string;          // entity_id (e.g. "SYS-003")
  entityName: string;  // entity name from parens
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
    cursor += line.length + 1; // +1 for newline
  }

  const map = new Map<string, ExistingTagGroup>();

  for (const tag of tags) {
    // Find the line this tag appears on
    let lineIndex = -1;
    let contextLine = '';
    for (let i = 0; i < lineRanges.length; i++) {
      if (tag.start >= lineRanges[i].start && tag.start < lineRanges[i].end + 1) {
        lineIndex = i;
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
  id: string; // entityDbId:matchedText
  dbId: number;     // numeric DB id — for grouping
  entityId: string; // e.g. "SYS-001" — written into tag parens
  entityName: string;
  description: string | null;
  matchedText: string;
  replacementText: string; // preview shown in UI
  matches: Array<{
    startIndex: number; // offset in the CLEAN text
    rawStartIndex: number; // offset in the RAW content (for scrolling linkage)
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
  // Build clean text while tracking which ranges were inside existing tags
  let cleanText = '';
  const taggedRanges: Array<{ start: number; end: number }> = [];
  const cleanToRaw: number[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const regex = getActiveRegex();
  while ((m = regex.exec(content)) !== null) {
    // Untagged region before this tag — maps 1:1 to raw
    const untaggedText = content.slice(lastIndex, m.index);
    for (let i = 0; i < untaggedText.length; i++) {
      cleanToRaw.push(lastIndex + i);
    }
    cleanText += untaggedText;
    const innerText = m[1]; // text inside [[...]]
    const innerStart = m.index + 2; // after "[["
    for (let i = 0; i < innerText.length; i++) {
      cleanToRaw.push(innerStart + i);
    }
    const tagStartInClean = cleanText.length;
    cleanText += innerText;
    taggedRanges.push({ start: tagStartInClean, end: tagStartInClean + innerText.length });
    lastIndex = m.index + m[0].length;
  }
  // Remaining untagged region
  const remaining = content.slice(lastIndex);
  for (let i = 0; i < remaining.length; i++) {
    cleanToRaw.push(lastIndex + i);
  }
  cleanText += remaining;

  // Helper: check if range overlaps any tagged range
  const isTagged = (start: number, end: number) =>
    taggedRanges.some((r) => start < r.end && end > r.start);

  const eligibility: Array<{ text: string; entity: Entity }> = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    const texts = [entity.name, ...entity.aliases].filter(Boolean);
    for (const text of texts) {
      if (!text || text.trim().length === 0) continue;
      const key = `${entity.id}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      eligibility.push({ text, entity });
    }
  }

  eligibility.sort((a, b) => b.text.length - a.text.length);

  const matchedRanges = new Set<number>();
  const groupMap = new Map<string, MatchGroup>();

  for (const { text, entity } of eligibility) {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const resolvedMatch = entity.case_match ?? entity.type_case_match ?? 'insensitive';
    const flags = resolvedMatch === 'sensitive' ? 'g' : 'gi';
    const re = new RegExp(`\\b${escaped}\\b`, flags);

    let match: RegExpExecArray | null;
    while ((match = re.exec(cleanText)) !== null) {
      const start = match.index;
      const end = start + text.length;

      // Skip if this text was already inside an entity tag
      if (isTagged(start, end)) continue;

      let covered = false;
      for (let i = start; i < end; i++) {
        if (matchedRanges.has(i)) {
          covered = true;
          break;
        }
      }
      if (covered) continue;

      for (let i = start; i < end; i++) {
        matchedRanges.add(i);
      }

      const replacement = buildTag(text, entity.name, entity.entity_id);

      const lines = cleanText.split('\n');
      let charCount = 0;
      let contextLine = '';
      for (const line of lines) {
        if (charCount <= start && start < charCount + line.length) {
          contextLine = line;
          break;
        }
        charCount += line.length + 1;
      }

      const groupId = `${entity.id}:${text}`;
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, {
          id: groupId,
          dbId: entity.id,
          entityId: entity.entity_id,
          entityName: entity.name,
          description: entity.description,
          matchedText: text,
          replacementText: replacement,
          matches: [],
        });
      }

      groupMap.get(groupId)!.matches.push({
        startIndex: start,
        rawStartIndex: cleanToRaw[start],
        lineContext: contextLine || text,
      });
    }
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
  // Build clean-to-raw offset mapping so we can insert into raw content
  // while leaving existing tags untouched.
  const cleanToRaw: number[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const regex = getActiveRegex();

  while ((m = regex.exec(content)) !== null) {
    // Untagged region before this tag — maps 1:1
    for (let i = lastIndex; i < m.index; i++) {
      cleanToRaw.push(i);
    }
    // Inner text of the tag — appears in clean text, maps inside the raw tag
    const innerText = m[1];
    const innerStart = m.index + 2; // after "[["
    for (let i = 0; i < innerText.length; i++) {
      cleanToRaw.push(innerStart + i);
    }
    lastIndex = m.index + m[0].length;
  }
  // Remaining untagged region
  for (let i = lastIndex; i < content.length; i++) {
    cleanToRaw.push(i);
  }
  // Sentinel: end of clean text → end of raw text
  cleanToRaw.push(content.length);

  // Collect matches to insert, mapping clean offsets to raw positions
  const allMatches: Array<{
    cleanStart: number;
    rawStart: number;
    rawEnd: number;
    tag: string;
  }> = [];

  for (const group of groups) {
    if (!includedGroupIds.has(group.id)) continue;

    const tag = buildTag(group.matchedText, group.entityName, group.entityId);

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

  // Sort right-to-left by raw position so earlier offsets stay valid
  allMatches.sort((a, b) => b.rawStart - a.rawStart);

  // Insert directly into raw content — existing tags are untouched
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
  start?: number; // offset in the raw content (for entity segments)
  end?: number;   // end offset in raw content
}

export function renderEntityTaggedContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  const regex = getActiveRegex();
  regex.lastIndex = 0;
  while ((m = regex.exec(content)) !== null) {
    if (m.index > lastIndex) {
      segments.push({
        type: 'text',
        content: content.slice(lastIndex, m.index),
        start: lastIndex,
        end: m.index,
      });
    }

    const matchedText = m[1].trim();
    const parenContent = m[2];
    const parsed = parseTagParen(matchedText, parenContent);

    segments.push({
      type: 'entity',
      content: parsed.matchedText,
      name: parsed.entityName,
      id: parsed.entityId,
      start: m.index,
      end: m.index + m[0].length,
    });
    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: 'text',
      content: content.slice(lastIndex),
      start: lastIndex,
      end: content.length,
    });
  }

  return segments;
}

// Re-export for consumers that only need the presence check
export { hasEntityTags };
