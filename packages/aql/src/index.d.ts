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

export const BLOCK_DIRECTIVES: Set<string>;
export const SUB_DIRECTIVE_KEYS: Set<string>;
export const MERMAID_DIAGRAM_TYPES: Set<string>;
export const ALLOWED_KEYS_BY_BLOCK: Record<string, Set<string>>;

export function parseEntityReferences(text: string): Reference[];
export function parseEdgeReferences(text: string): Reference[];
export function parseReferences(text: string): Reference[];
export function stripReferences(text: string): string;
export function parseAql(rawQuery: string): AqlQuery;
export function renderAqlTokens(query: string): RenderToken[];
