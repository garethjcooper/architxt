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
 * Parse tag paren content.
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
 * Build a tag string in v1-dual or v2-single style.
 *
 * @param {string} matchedText
 * @param {string} entityName
 * @param {string} entityId
 * @param {'v1-dual'|'v2-single'} [formatKey]
 * @returns {string}
 */
export function buildTag(matchedText, entityName, entityId, formatKey = 'v1-dual') {
  if (formatKey === 'v2-single') {
    return `[[${matchedText} (${entityId})]]`;
  }
  return `[[${matchedText} (${entityName}, ${entityId})]]`;
}

/**
 * @typedef {Object} ExistingTag
 * @property {string} text
 * @property {string} name
 * @property {string} [id]
 * @property {number} start
 * @property {number} end
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
 * @param {Array<{id: number|string, entity_id: string, name: string, type_name?: string, aliases: string[], case_match?: string, type_case_match?: string}>} entities
 * @param {string} content
 * @returns {EntityMatch[]}
 */
export function scanForEntityMatches(format, entities, content) {
  const existingTags = findExistingEntityTags(format, content);

  // Build clean text: untagged regions map 1:1, tagged inner text is preserved.
  let cleanText = '';
  const cleanToRaw = [];
  const taggedRanges = [];
  let lastIndex = 0;
  for (const tag of existingTags) {
    const untagged = content.slice(lastIndex, tag.start);
    for (let i = 0; i < untagged.length; i++) cleanToRaw.push(lastIndex + i);
    cleanText += untagged;

    const innerStart = tag.start + 2; // after "[["
    const innerEnd = tag.end - 2;     // before "]]]"
    const innerText = content.slice(innerStart, innerEnd);
    const tagStartInClean = cleanText.length;
    for (let i = 0; i < innerText.length; i++) cleanToRaw.push(innerStart + i);
    cleanText += innerText;
    taggedRanges.push({ start: tagStartInClean, end: tagStartInClean + innerText.length });
    lastIndex = tag.end;
  }
  const remaining = content.slice(lastIndex);
  for (let i = 0; i < remaining.length; i++) cleanToRaw.push(lastIndex + i);
  cleanText += remaining;

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
    const re = new RegExp(`\\b${escaped}\\b`, flags);

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
  let lastIndex = 0;
  const regex = buildRegex(format);
  let m;
  while ((m = regex.exec(content)) !== null) {
    for (let i = lastIndex; i < m.index; i++) cleanToRaw.push(i);
    const innerText = m[1];
    const innerStart = m.index + 2;
    for (let i = 0; i < innerText.length; i++) cleanToRaw.push(innerStart + i);
    lastIndex = m.index + m[0].length;
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
  const regex = buildRegex(format);
  regex.lastIndex = 0;
  let m;
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

/**
 * Quick check: does content contain entity tags?
 *
 * @param {Format} format
 * @param {string} content
 * @returns {boolean}
 */
export function hasEntityTags(format, content) {
  if (!content) return false;
  return content.includes(format.presentInIndicator);
}
