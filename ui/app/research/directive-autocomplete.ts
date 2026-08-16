/**
 * Autocomplete and validation helpers for section directives.
 *
 * Mirrors the feel of the [[ entity/edge autocomplete: typing # at the start of
 * a line opens a filtered list, and accepting an item inserts the directive. For
 * block directives we also insert the matching #end so the user has a valid
 * scaffold to fill in.
 */

export type DirectiveKind = 'graph' | 'table' | 'diagram' | 'narrative' | 'name' | 'type' | 'end';

export interface DirectiveAutocompleteItem {
  kind: 'directive';
  id: string;
  label: string;
  sublabel?: string;
  insert: string;
  /** Offset inside `insert` to place the caret after insertion. */
  cursorOffset: number;
  /** If true, selecting this item keeps autocomplete open for a follow-up pick. */
  chain?: boolean;
}

export const BLOCK_DIRECTIVES: DirectiveKind[] = ['graph', 'table', 'diagram', 'narrative'];

export const SUB_DIRECTIVES: DirectiveKind[] = ['name', 'type', 'end'];

export const MERMAID_DIAGRAM_TYPES = [
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'journey',
  'gitGraph',
  'requirementDiagram',
  'mindmap',
  'timeline',
  'c4Context',
  'c4Container',
  'c4Component',
  'c4Dynamic',
  'c4Deployment',
  'quadrantChart',
  'block',
  'network',
  'architecture',
  'xychart-beta',
  'sankey-beta',
];

const ALL_DIRECTIVE_ITEMS: DirectiveAutocompleteItem[] = [
  ...BLOCK_DIRECTIVES.map((d) => ({
    kind: 'directive' as const,
    id: `#${d}`,
    label: `#${d}`,
    sublabel: 'block directive',
    // Insert a scaffold with a trailing #end. For diagram/table, add the most
    // common sub-directives to guide the user.
    insert: makeBlockScaffold(d),
    cursorOffset: makeCursorOffset(d),
  })),
  ...SUB_DIRECTIVES.map((d) => ({
    kind: 'directive' as const,
    id: `#${d}`,
    label: `#${d}`,
    sublabel: d === 'end' ? 'close block' : 'sub-directive',
    insert: `#${d} `,
    cursorOffset: d === 'end' ? `#${d} `.length : `#${d} `.length,
  })),
];

function makeBlockScaffold(d: DirectiveKind): string {
  switch (d) {
    case 'diagram':
      return '#diagram\n#name \n#type \n\n#end';
    case 'table':
      return '#table\n#name \n\n#end';
    case 'graph':
      return '#graph\n\n#end';
    case 'narrative':
      return '#narrative\n\n#end';
    default:
      return `#${d}\n#end`;
  }
}

function makeCursorOffset(d: DirectiveKind): number {
  switch (d) {
    case 'diagram':
      return '#diagram\n#name '.length;
    case 'table':
      return '#table\n#name '.length;
    case 'graph':
      return '#graph\n'.length;
    case 'narrative':
      return '#narrative\n'.length;
    default:
      return `#${d}\n`.length;
  }
}

export interface DirectiveTrigger {
  filter: string;
  replaceStart: number;
  replaceEnd: number;
  /** If true, the current line looks like `#type ` and we should suggest Mermaid types. */
  isTypeLine: boolean;
}

/**
 * Find a directive autocomplete trigger immediately before `offset`.
 *
 * A trigger is a `#` that appears at the start of the current line (after any
 * whitespace), with no intervening newline between it and the cursor.
 */
export function findDirectiveTrigger(query: string, offset: number): DirectiveTrigger | null {
  // Search backwards to the start of the current line.
  let lineStart = offset;
  while (lineStart > 0 && query[lineStart - 1] !== '\n' && query[lineStart - 1] !== '\r') {
    lineStart -= 1;
  }

  const line = query.slice(lineStart, offset);
  const trimmedStart = lineStart + (line.length - line.trimStart().length);
  const trimmed = line.trimStart();

  if (!trimmed.startsWith('#')) return null;

  // Determine whether this is a #type line inside a #diagram block.
  const isTypeLine = /^#type\s*/i.test(trimmed);

  const afterHash = trimmed.slice(1);
  // Only trigger autocomplete when we are still typing the keyword (no spaces
  // after the partial word yet). Once the user hits space we close the picker.
  if (/\s/.test(afterHash) && !isTypeLine) return null;

  return {
    filter: afterHash.toLowerCase(),
    replaceStart: trimmedStart,
    replaceEnd: offset,
    isTypeLine,
  };
}

export function getDirectiveAutocompleteItems(
  query: string,
  offset: number,
  filter: string,
  isTypeLine: boolean,
): DirectiveAutocompleteItem[] {
  if (isTypeLine) {
    const term = filter.toLowerCase().trim();
    const matches = term
      ? MERMAID_DIAGRAM_TYPES.filter((t) => t.toLowerCase().startsWith(term) || t.toLowerCase().includes(term))
      : MERMAID_DIAGRAM_TYPES;
    return matches.slice(0, 8).map((t) => ({
      kind: 'directive' as const,
      id: `type:${t}`,
      label: t,
      sublabel: 'Mermaid diagram type',
      insert: `${t}`,
      cursorOffset: `${t}`.length,
    }));
  }

  const term = filter.toLowerCase().trim();
  const items = ALL_DIRECTIVE_ITEMS.filter((item) => {
    if (!term) return true;
    return item.label.toLowerCase().startsWith(term) || item.id.slice(1).toLowerCase().includes(term);
  });

  // Sort exact prefix matches first.
  return items.sort((a, b) => {
    const aExact = a.id.toLowerCase() === `#${term}` ? 2 : a.id.toLowerCase().startsWith(`#${term}`) ? 1 : 0;
    const bExact = b.id.toLowerCase() === `#${term}` ? 2 : b.id.toLowerCase().startsWith(`#${term}`) ? 1 : 0;
    if (bExact !== aExact) return bExact - aExact;
    return a.label.localeCompare(b.label);
  });
}

export interface DirectiveValidationIssue {
  message: string;
  line?: number;
}

const VALID_DIRECTIVES = new Set(['#graph', '#table', '#diagram', '#narrative', '#name', '#type', '#end']);

/**
 * Validate directive markup and return human-readable issues.
 */
export function validateDirectives(query: string): DirectiveValidationIssue[] {
  const issues: DirectiveValidationIssue[] = [];
  const lines = query.split(/\r?\n/);
  const stack: Array<{ directive: string; line: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('#')) continue;

    const word = trimmed.split(/\s/)[0].toLowerCase();
    if (!VALID_DIRECTIVES.has(word)) {
      issues.push({ message: `Unknown directive ${word}`, line: i + 1 });
      continue;
    }

    if (word === '#end') {
      if (stack.length === 0) {
        issues.push({ message: 'No opening directive for #end', line: i + 1 });
      } else {
        stack.pop();
      }
    } else if (BLOCK_DIRECTIVES.includes(word.slice(1) as DirectiveKind)) {
      stack.push({ directive: word, line: i + 1 });
    }
  }

  for (const open of stack) {
    issues.push({ message: `Unclosed ${open.directive} block (started on line ${open.line})`, line: open.line });
  }

  return issues;
}
