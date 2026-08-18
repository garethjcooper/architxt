/**
 * Architxt Query Language (AQL) types.
 */

export type TokenKind = 'entity' | 'edge' | 'directive';

export interface ParseError {
  message: string;
  line: number;
}

export interface Reference {
  kind: 'entity' | 'edge';
  raw: string;
  id?: string;
  type?: string | null;
  label?: string;
  from?: string;
  to?: string;
  edgeLabel?: string;
}

export interface Block {
  kind: 'graph' | 'table' | 'diagram' | 'narrative';
  body: string;
  bodyReferences: Reference[];
  name?: string;
  type?: string;
  startLine?: number;
}

export interface AqlQuery {
  intentText: string;
  references: Reference[];
  blocks: Block[];
  errors?: ParseError[];
}

export interface RenderToken {
  kind: 'directive' | 'reference' | 'text';
  text: string;
  keyword?: string;
  value?: string;
  reference?: Reference;
}

/** Canonical block directive keywords. */
export const BLOCK_DIRECTIVES: readonly string[];
/** Canonical block-scoped sub-directive keywords allowed inside block directives. */
export const SUB_DIRECTIVE_KEYS: readonly string[];
/** Supported Mermaid diagram types. */
export const MERMAID_DIAGRAM_TYPES: readonly string[];
export const ALLOWED_KEYS_BY_BLOCK: Record<string, Set<string>>;

export function parseEntityReferences(text: string): Reference[];
export function parseEdgeReferences(text: string): Reference[];
export function parseReferences(text: string): Reference[];
export function stripReferences(text: string): string;
export function parseAql(rawQuery: string): AqlQuery;
export function toSectionFocus(aqlQuery: AqlQuery): { intentText: string; sectionFocus: Record<string, string | string[] | Array<{ name?: string; content: string }> | Array<{ name?: string; type?: string; content: string }>> };
export function renderAqlTokens(query: string): RenderToken[];
export function formatEntityToken(label: string, id: string, type?: string | null): string;
export function formatEdgeToken(source: string, target: string, label: string): string;
