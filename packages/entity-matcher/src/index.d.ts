export interface TagMatchData {
  matchedText: string;
  entityName?: string;
  entityId?: string;
}

export interface Format {
  key: string;
  regexSource: string;
  regexFlags: string;
  presentInIndicator: string;
}

export interface ExistingTag {
  text: string;
  name: string;
  id?: string;
  start: number;
  end: number;
}

export interface EntityMatch {
  dbId?: number | string;
  entity_id: string;
  name: string;
  type_name?: string;
  matchedText: string;
  start: number;
  end: number;
  fromTag: boolean;
  startIndex?: number;
  rawStartIndex?: number;
}

export interface EntityLike {
  id: number | string;
  entity_id: string;
  name: string;
  type_name?: string;
  aliases?: string[];
  case_match?: string;
  type_case_match?: string;
}

export function buildRegex(format: Format): RegExp;
export function parseTagParen(matchedText: string, parenContent?: string): TagMatchData;
export function buildTag(matchedText: string, entityName: string, entityId: string, formatKey?: 'v1-dual' | 'v2-single'): string;
export function findExistingEntityTags(format: Format, content: string): ExistingTag[];
export function scanForEntityMatches(format: Format, entities: EntityLike[], content: string): EntityMatch[];
export function groupMatchesByEntity(matches: EntityMatch[]): Map<string, { entity_id: string; name: string; type_name?: string; count: number; fromTag: boolean; ranges: Array<{ start: number; end: number }> }>;
export function buildCleanToRawMap(format: Format, content: string): number[];
export function renderEntityTaggedContent(format: Format, content: string): Array<{ type: 'text' | 'entity'; content: string; name?: string; id?: string; start: number; end: number }>;
export function hasEntityTags(format: Format, content: string): boolean;
