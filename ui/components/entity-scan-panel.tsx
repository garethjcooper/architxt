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
  stripEntityTags as sharedStripEntityTags,
  repairMalformedEntityTags as sharedRepairMalformedEntityTags,
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

/** Remove well-formed entity markup tags, leaving plain text. Malformed tags are preserved. */
export function stripEntityTags(content: string): string {
  return sharedStripEntityTags(uiFormat(), content);
}

/** Repair malformed entity tags by stripping their markup and keeping the inner text. */
export function repairMalformedEntityTags(content: string): string {
  return sharedRepairMalformedEntityTags(uiFormat(), content);
}

/** Find all existing entity tags in content */
export interface ExistingTag {
  text: string;
  name: string;
  id?: string;
  start: number;
  end: number;
  isValid?: boolean;
}

export function findExistingEntityTags(content: string): ExistingTag[] {
  return sharedFindExistingEntityTags(uiFormat(), content);
}

/** Strip any [[entity (...id...)]] tags, then return a short snippet around the matched text
 * (a few surrounding lines plus a truncated window on the focus line). */
function narrowMatchContext(
  lineContext: string,
  matchedText: string,
  maxSurroundingLines = 2,
  maxCharsAround = 70
): string {
  if (!lineContext) return matchedText;

  const tagRegex = /\[\[[^\]]+\]\]/g;
  const allLines = lineContext.split('\n').map((l) =>
    l.replace(tagRegex, (tag) => {
      const inner = tag.slice(2, -2).trim();
      // For tag wrappers, keep the inner text but drop the brackets.
      return inner;
    })
  );

  const matchLineIndex = allLines.findIndex((l) => l.includes(matchedText));
  const focusIndex = matchLineIndex >= 0 ? matchLineIndex : 0;
  const focusLine = allLines[focusIndex];

  const start = focusLine.indexOf(matchedText);
  const end = start + matchedText.length;

  let snippet = focusLine;
  if (start >= 0 && focusLine.length > maxCharsAround * 2 + matchedText.length) {
    let beforeStart = Math.max(0, start - maxCharsAround);
    let afterEnd = Math.min(focusLine.length, end + maxCharsAround);
    // Snap to word boundaries so we don't cut mid-word
    while (beforeStart > 0 && focusLine[beforeStart - 1] !== ' ') beforeStart--;
    while (afterEnd < focusLine.length && focusLine[afterEnd] !== ' ') afterEnd++;
    snippet =
      (beforeStart > 0 ? '…' : '') +
      focusLine.slice(beforeStart, afterEnd).trim() +
      (afterEnd < focusLine.length ? '…' : '');
  }

  const beforeCount = Math.min(maxSurroundingLines, focusIndex);
  const afterCount = Math.min(maxSurroundingLines, allLines.length - focusIndex - 1);
  const surrounding: string[] = [];
  for (let i = focusIndex - beforeCount; i <= focusIndex + afterCount; i++) {
    if (i === focusIndex) {
      surrounding.push(snippet);
    } else {
      surrounding.push(allLines[i] ?? '');
    }
  }
  return surrounding.join('\n');
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
  // content here is the original (tagged) working content so that line breaks
  // and positions reflect the document the user sees. The context itself is
  // stripped of entity tags before display.
  const lines = content.split('\n');
  const lineRanges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const line of lines) {
    lineRanges.push({ start: cursor, end: cursor + line.length });
    cursor += line.length + 1;
  }

  const map = new Map<string, ExistingTagGroup>();

  for (const tag of tags) {
    // Skip malformed tags in the grouped existing-entity list; they are handled
    // separately by the repair flow.
    if (!tag.isValid) continue;

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
      lineContext: narrowMatchContext(stripEntityTags(contextLine), tag.text),
    });
  }

  return Array.from(map.values());
}

/** Scan raw content for entity matches, returning groups */
export interface MatchGroup {
  id: string;
  dbId: number;
  entityId: string;
  entityName: string;
  entityType: string | null;
  description: string | null;
  matchedText: string;
  replacementText: string;
  matches: Array<{
    startIndex: number;
    rawStartIndex: number;
    rawEndIndex: number;
    lineContext: string;
  }>;
}

/**
 * Scan raw content for entity matches.
 * The shared matcher builds clean text internally and skips text already inside
 * entity tags, so already-tagged entities are not re-proposed.
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
      word_boundary_match: e.word_boundary_match,
      type_word_boundary_match: e.type_word_boundary_match,
    })),
    content
  );

  const groupMap = new Map<string, MatchGroup>();

  const lines = content.split('\n');
  const lineCount = lines.length;
  let charCount = 0;
  const lineRanges = new Array(lineCount);
  for (let i = 0; i < lineCount; i++) {
    lineRanges[i] = { start: charCount, end: charCount + lines[i].length };
    charCount += lines[i].length + 1;
  }

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
        entityType: entity?.type_name ?? null,
        description: entity?.description ?? null,
        matchedText: m.matchedText,
        replacementText: sharedBuildTag(
          m.matchedText,
          m.name,
          m.entity_id,
          entity?.type_name,
          uiFormat().key as 'v1-dual' | 'v2-single' | 'v3-single-entity'
        ),
        matches: [],
      });
    }

    const rawStart = m.rawStartIndex!;
    let contextLine = '';
    for (let i = 0; i < lineCount; i++) {
      if (rawStart >= lineRanges[i].start && rawStart < lineRanges[i].end + 1) {
        contextLine = lines[i];
        break;
      }
    }

    groupMap.get(groupId)!.matches.push({
      startIndex: m.startIndex!,
      rawStartIndex: m.rawStartIndex!,
      rawEndIndex: m.rawEndIndex!,
      lineContext: narrowMatchContext(contextLine || m.matchedText, m.matchedText),
    });
  }

  return Array.from(groupMap.values());
}

/**
 * Insert entity tags into content for the given match groups.
 * Preserves existing tags — only inserts new ones in untagged regions.
 * Uses raw offsets supplied by the scanner so insertion positions stay aligned
 * with the same clean text used for matching.
 * Right-to-left insertion so earlier offsets stay valid.
 */
export function insertEntityTags(
  content: string,
  groups: MatchGroup[],
  includedGroupIds: Set<string>
): string {
  const allMatches: Array<{
    rawStart: number;
    rawEnd: number;
    tag: string;
  }> = [];

  for (const group of groups) {
    if (!includedGroupIds.has(group.id)) continue;

    const tag = group.replacementText;

    for (const match of group.matches) {
      allMatches.push({
        rawStart: match.rawStartIndex,
        rawEnd: match.rawEndIndex,
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
