/**
 * Shared entity matcher — source of truth for both server and UI.
 *
 * Mirror policy:
 *   - Tag format is discovered at runtime by callers supplying a `format`.
 *     The format object matches the contract returned by the server config
 *     endpoint: { key, regexSource, regexFlags, presentInIndicator }.
 *   - This package stays dependency-free. It does not import Node-only or
 *     DOM-only modules.
 */

/**
 * @typedef {Object} TagMatchData
 * @property {string} matchedText
 * @property {string} [entityName]
 * @property {string} [entityId]
 */

/**
 * @typedef {Object} Format
 * @property {string} key
 * @property {string} regexSource
 * @property {string} regexFlags
 * @property {string} presentInIndicator
 */

/**
 * @param {Format} format
 * @returns {RegExp}
 */
export function buildRegex(format) {
  return new RegExp(format.regexSource, format.regexFlags);
}

/**
 * Build a tag string in v1-dual, v2-single, or v3-single-entity style.
 *
 * @param {string} matchedText
 * @param {string} entityName
 * @param {string} entityId
 * @param {string} [entityType]
 * @param {'v1-dual'|'v2-single'|'v3-single-entity'} [formatKey]
 * @returns {string}
 */
export function buildTag(matchedText, entityName, entityId, entityType, formatKey = 'v1-dual') {
  if (formatKey === 'v3-single-entity') {
    if (!entityId) return `[[${matchedText}]]`;
    return `[[${matchedText} (${entityType ? `${entityType}:` : ''}${entityId})]]`;
  }
  if (formatKey === 'v2-single') {
    if (!entityId) return `[[${matchedText}]]`;
    return `[[${matchedText} (${entityId})]]`;
  }
  if (!entityId) return `[[${matchedText}]]`;
  return `[[${matchedText} (${entityName}, ${entityId})]]`;
}

/**
 * Parse tag paren content.
 *
 * Supports:
 *   - v1-dual: "Name, id"
 *   - v2-single: "id"
 *   - v3-single-entity: "type:id"
 *
 * @param {string} matchedText
 * @param {string} [parenContent]
 * @returns {TagMatchData}
 */
export function parseTagParen(matchedText, parenContent) {
  if (!parenContent) {
    return { matchedText };
  }

  const trimmed = parenContent.trim();

  // v3-single-entity: "type:id" (colon present, no comma)
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
}

/**
 * Determine whether a tag at [start, end) in content is well-formed.
 * Malformed if the inner text contains brackets, splits a word, contains
 * line breaks, looks like JSON, or is unreasonably long for an entity name.
 */
function isValidTag(content, start, end) {
  if (start < 0 || end > content.length || end - start < 5) return false;
  const innerStart = start + 2;
  const innerEnd = end - 2;
  if (innerStart >= innerEnd) return false;
  const inner = content.slice(innerStart, innerEnd);
  if (inner.includes('[') || inner.includes(']')) return false;
  if (inner.includes('\n') || inner.includes('\r')) return false;

  // Treat JSON-like/code blobs as malformed tags that should be repaired.
  const MAX_INNER_LEN = 200;
  if (inner.length > MAX_INNER_LEN) return false;
  const jsonLike = /^\s*[\{\[]|[\}\]]\s*$/.test(inner);
  if (jsonLike) return false;

  const before = content[start - 1];
  const after = content[end];
  const wordBefore = before !== undefined && /\w/.test(before);
  const wordAfter = after !== undefined && /\w/.test(after);
  if (wordBefore && wordAfter) return false;

  return true;
}

/**
 * @typedef {Object} ExistingTag
 * @property {string} text
 * @property {string} name
 * @property {string} [id]
 * @property {number} start
 * @property {number} end
 * @property {boolean} isValid
 */

/**
 * Find existing entity tags in raw content.
 *
 * @param {Format} format
 * @param {string} content
 * @returns {ExistingTag[]}
 */
export function findExistingEntityTags(format, content) {
  const tags = [];
  const regex = buildRegex(format);
  let m;
  regex.lastIndex = 0;
  while ((m = regex.exec(content)) !== null) {
    const matchedText = m[1].trim();
    const parenContent = m[2];
    const parsed = parseTagParen(matchedText, parenContent);
    const start = m.index;
    const end = m.index + m[0].length;
    tags.push({
      text: parsed.matchedText,
      name: parsed.entityName || parsed.matchedText,
      id: parsed.entityId,
      start,
      end,
      isValid: isValidTag(content, start, end),
    });
  }
  return tags;
}

/**
 * Remove well-formed entity tags, leaving plain text. Malformed tags are kept
 * as-is so they cannot corrupt downstream offset calculations.
 *
 * @param {Format} format
 * @param {string} content
 * @returns {string}
 */
export function stripEntityTags(format, content) {
  const tags = findExistingEntityTags(format, content);
  let result = '';
  let lastIndex = 0;
  for (const tag of tags) {
    if (!tag.isValid) continue;
    result += content.slice(lastIndex, tag.start);
    result += tag.text;
    lastIndex = tag.end;
  }
  result += content.slice(lastIndex);
  return result;
}

/**
 * @typedef {Object} EntityMatch
 * @property {number|string} dbId
 * @property {string} entity_id
 * @property {string} name
 * @property {string} [type_name]
 * @property {string} matchedText
 * @property {number} start
 * @property {number} end
 * @property {boolean} fromTag
 * @property {number} [startIndex]  // clean-text offset, for UI consumers
 * @property {number} [rawStartIndex] // raw offset, for UI consumers
 */

/**
 * Scan raw content for entity matches, both tagged and untagged.
 *
 * @param {Format} format
 * @param {Array<{id: number|string, entity_id: string, name: string, type_name?: string, aliases: string[], case_match?: string, type_case_match?: string, word_boundary_match?: string, type_word_boundary_match?: string}>} entities
 * @param {string} content
 * @returns {EntityMatch[]}
 */
export function scanForEntityMatches(format, entities, content) {
  const existingTags = findExistingEntityTags(format, content);

  // Build clean text: untagged regions map 1:1, valid tag inner text is preserved,
  // malformed tag raw text is preserved (to keep offsets aligned) but marked tagged.
  let cleanText = '';
  const cleanToRaw = [];
  const taggedRanges = [];
  let lastIndex = 0;
  for (const tag of existingTags) {
    const untagged = content.slice(lastIndex, tag.start);
    for (let i = 0; i < untagged.length; i++) cleanToRaw.push(lastIndex + i);
    cleanText += untagged;

    const tagStartInClean = cleanText.length;
    if (tag.isValid) {
      const innerStart = tag.start + 2; // after "[["
      const innerEnd = tag.end - 2;     // before "]]]"
      const innerText = content.slice(innerStart, innerEnd);
      for (let i = 0; i < innerText.length; i++) cleanToRaw.push(innerStart + i);
      cleanText += innerText;
      taggedRanges.push({ start: tagStartInClean, end: tagStartInClean + innerText.length });
    } else {
      // Malformed tag: keep raw text (including brackets) in clean text so
      // offsets stay aligned with the raw document, but mark range tagged so we
      // do not propose matches inside it.
      const rawTagText = content.slice(tag.start, tag.end);
      for (let i = 0; i < rawTagText.length; i++) cleanToRaw.push(tag.start + i);
      cleanText += rawTagText;
      taggedRanges.push({ start: tagStartInClean, end: tagStartInClean + rawTagText.length });
    }
    lastIndex = tag.end;
  }
  const remaining = content.slice(lastIndex);
  for (let i = 0; i < remaining.length; i++) cleanToRaw.push(lastIndex + i);
  cleanText += remaining;
  cleanToRaw.push(content.length);

  const isTagged = (start, end) => taggedRanges.some((r) => start < r.end && end > r.start);

  const eligibility = [];
  const seen = new Set();
  for (const entity of entities) {
    const texts = [entity.name, ...(entity.aliases || [])].filter(Boolean);
    for (const text of texts) {
      if (!text || !text.trim()) continue;
      const key = `${entity.id}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      eligibility.push({ text, entity });
    }
  }

  eligibility.sort((a, b) => b.text.length - a.text.length);

  const matchedRanges = new Set();
  const matches = [];

  for (const { text, entity } of eligibility) {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const caseRule = entity.case_match || entity.type_case_match || 'insensitive';
    const flags = caseRule === 'sensitive' ? 'g' : 'gi';
    const boundaryRule = entity.word_boundary_match || entity.type_word_boundary_match || 'boundaries';
    const boundaryPrefix = boundaryRule === 'no-boundaries' ? '' : '\\b';
    const boundarySuffix = boundaryRule === 'no-boundaries' ? '' : '\\b';
    const re = new RegExp(`${boundaryPrefix}${escaped}${boundarySuffix}`, flags);

    let match;
    while ((match = re.exec(cleanText)) !== null) {
      const start = match.index;
      const end = start + text.length;

      if (isTagged(start, end)) continue;

      let covered = false;
      for (let i = start; i < end; i++) {
        if (matchedRanges.has(i)) {
          covered = true;
          break;
        }
      }
      if (covered) continue;

      for (let i = start; i < end; i++) matchedRanges.add(i);

      matches.push({
        dbId: entity.id,
        entity_id: entity.entity_id,
        name: entity.name,
        type_name: entity.type_name,
        matchedText: text,
        start,
        end,
        fromTag: false,
        startIndex: start,
        rawStartIndex: cleanToRaw[start],
        rawEndIndex: cleanToRaw[end],
      });
    }
  }

  // Prepend instant tag matches, preserving raw offsets.
  const tagMatches = existingTags
    .filter((tag) => tag.id)
    .map((tag) => {
      const matchedEntity = entities.find((e) => e.entity_id === tag.id) || {};
      return {
        dbId: matchedEntity.id,
        entity_id: tag.id,
        name: tag.name,
        type_name: matchedEntity.type_name,
        matchedText: tag.text,
        start: tag.start,
        end: tag.end,
        fromTag: true,
        startIndex: tag.start,
        rawStartIndex: tag.start,
        rawEndIndex: tag.end,
      };
    });

  return [...tagMatches, ...matches].sort((a, b) => a.start - b.start);
}

/**
 * Group matches by canonical entity id.
 *
 * @param {EntityMatch[]} matches
 * @returns {Map<string, {entity_id: string, name: string, type_name?: string, count: number, fromTag: boolean, ranges: Array<{start: number, end: number}>}>}
 */
export function groupMatchesByEntity(matches) {
  const map = new Map();
  for (const m of matches) {
    if (!map.has(m.entity_id)) {
      map.set(m.entity_id, {
        entity_id: m.entity_id,
        name: m.name,
        type_name: m.type_name,
        count: 0,
        fromTag: false,
        ranges: [],
      });
    }
    const g = map.get(m.entity_id);
    g.count += 1;
    g.fromTag = g.fromTag || m.fromTag;
    g.ranges.push({ start: m.start, end: m.end });
  }
  return map;
}

/**
 * Build clean-to-raw offset map. Untagged text maps 1:1; inner tag text maps
 * to the characters between [[ and ]].
 *
 * @param {Format} format
 * @param {string} content
 * @returns {number[]}
 */
export function buildCleanToRawMap(format, content) {
  const cleanToRaw = [];
  const tags = findExistingEntityTags(format, content);
  let lastIndex = 0;
  for (const tag of tags) {
    if (!tag.isValid) continue;
    for (let i = lastIndex; i < tag.start; i++) cleanToRaw.push(i);
    const innerStart = tag.start + 2;
    for (let i = 0; i < tag.text.length; i++) cleanToRaw.push(innerStart + i);
    lastIndex = tag.end;
  }
  for (let i = lastIndex; i < content.length; i++) cleanToRaw.push(i);
  cleanToRaw.push(content.length);
  return cleanToRaw;
}

/**
 * Split content into renderable segments: plain text + entity tags.
 *
 * @param {Format} format
 * @param {string} content
 * @returns {Array<{type: 'text'|'entity', content: string, name?: string, id?: string, start: number, end: number}>}
 */
export function renderEntityTaggedContent(format, content) {
  const segments = [];
  let lastIndex = 0;
  const tags = findExistingEntityTags(format, content);
  for (const tag of tags) {
    if (tag.start > lastIndex) {
      segments.push({
        type: 'text',
        content: content.slice(lastIndex, tag.start),
        start: lastIndex,
        end: tag.start,
      });
    }

    if (tag.isValid) {
      segments.push({
        type: 'entity',
        content: tag.text,
        name: tag.name,
        id: tag.id,
        start: tag.start,
        end: tag.end,
      });
    } else {
      segments.push({
        type: 'text',
        content: content.slice(tag.start, tag.end),
        start: tag.start,
        end: tag.end,
      });
    }
    lastIndex = tag.end;
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

/**
 * Repair malformed entity tags by stripping their bracket markup and metadata,
 * leaving only the matched inner text. Well-formed tags are preserved.
 *
 * @param {Format} format
 * @param {string} content
 * @returns {string}
 */
export function repairMalformedEntityTags(format, content) {
  const tags = findExistingEntityTags(format, content);
  let result = '';
  let lastIndex = 0;
  for (const tag of tags) {
    if (!tag.isValid) {
      result += content.slice(lastIndex, tag.start);
      result += tag.text;
      lastIndex = tag.end;
    }
  }
  result += content.slice(lastIndex);
  return result;
}

/**
 * Quick check: does content contain *inserted* entity tags?
 * Requires at least one `[[matchedText (entityId)]]` pattern so raw `[[`
 * markers or `[[text]]` placeholders without IDs do not count.
 *
 * @param {Format} format
 * @param {string} content
 * @returns {boolean}
 */
export function hasEntityTags(format, content) {
  if (!content) return false;
  const tags = findExistingEntityTags(format, content);
  return tags.some((t) => t.id);
}
