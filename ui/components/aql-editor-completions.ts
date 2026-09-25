'use client';

import { insertCompletionText, startCompletion, type Completion } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  formatEntityToken,
  formatEdgeToken,
  BLOCK_DIRECTIVES,
  SUB_DIRECTIVE_KEYS,
  ALLOWED_KEYS_BY_BLOCK,
} from '@architxt/aql';

export interface EntityLike {
  id: string;
  entity_id?: string | null;
  name?: string | null;
  label?: string | null;
  type?: string | null;
}

export interface EdgeLike {
  from: string;
  to: string;
  label?: string | null;
  type?: string | null;
}

const DIRECTIVE_KEYWORDS = [
  'diagram',
  'table',
  'graph',
  'narrative',
  'diagram-name',
  'diagram-type',
  'table-name',
  'graph-name',
  'narrative-name',
  'end',
];

const MERMAID_DIAGRAM_TYPES = [
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'timeline',
  'radar-beta',
  'architecture-beta',
  'mindmap',
  'venn-beta',
];

export function getCurrentBlockKind(state: EditorState): string | null {
  const text = state.doc.toString();
  let currentBlock: string | null = null;
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(i, lineEnd);
    const blockMatch = line.match(/^#(diagram|table|graph|narrative)\b/);
    if (blockMatch) {
      currentBlock = blockMatch[1];
    } else if (/^#end\b/.test(line)) {
      currentBlock = null;
    }
    i = lineEnd + 1;
  }
  return currentBlock;
}

export function buildDirectiveCompletions(filter: string, state: EditorState): Completion[] {
  const term = filter.toLowerCase();
  const blockKind = getCurrentBlockKind(state);
  const allowed = new Set<string>(['end']);
  if (blockKind) {
    const blockAllowed = ALLOWED_KEYS_BY_BLOCK[blockKind as keyof typeof ALLOWED_KEYS_BY_BLOCK];
    if (blockAllowed) {
      blockAllowed.forEach((k) => allowed.add(k));
    }
  } else {
    BLOCK_DIRECTIVES.forEach((k) => allowed.add(k));
  }
  const keywords = DIRECTIVE_KEYWORDS.filter((kw) => allowed.has(kw));

  // If the user has typed an exact block-directive prefix, exclude longer
  // sub-directives that merely happen to start with the same text so that
  // #table does not jump to #table-name.
  const typedExactBlock = BLOCK_DIRECTIVES.includes(term);
  const filteredKeywords = keywords.filter((kw) => {
    if (!kw.startsWith(term)) return false;
    if (typedExactBlock) return BLOCK_DIRECTIVES.includes(kw) || kw === term;
    return true;
  });

  return filteredKeywords.map((kw) => {
    let apply: Completion['apply'];
    let boost = 0;
    if (kw === 'diagram') {
      apply = (view, _completion, from, to) => {
        const text = '#diagram\n#diagram-name \n#diagram-type \n#end';
        const cursor = from + '#diagram\n#diagram-name '.length;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: cursor, head: cursor },
        });
      };
      boost = 99;
    } else if (kw === 'table') {
      apply = (view, _completion, from, to) => {
        const text = '#table\n#table-name \n#end';
        const cursor = from + '#table\n#table-name '.length;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: cursor, head: cursor },
        });
      };
      boost = 99;
    } else if (kw === 'graph') {
      apply = (view, _completion, from, to) => {
        const text = '#graph\n#graph-name \n#end';
        const cursor = from + '#graph\n#graph-name '.length;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: cursor, head: cursor },
        });
      };
      boost = 99;
    } else if (kw === 'narrative') {
      apply = (view, _completion, from, to) => {
        const text = '#narrative\n#narrative-name \n#end';
        const cursor = from + '#narrative\n#narrative-name '.length;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: cursor, head: cursor },
        });
      };
      boost = 99;
    } else if (kw === 'end') {
      apply = '#end';
    } else if (
      kw === 'diagram-name' ||
      kw === 'diagram-type' ||
      kw === 'table-name' ||
      kw === 'graph-name' ||
      kw === 'narrative-name'
    ) {
      apply = `#${kw} `;
    } else {
      apply = `#${kw}`;
    }
    return { label: `#${kw}`, apply, type: 'keyword', boost };
  });
}

export function buildTypeCompletions(filter: string): Completion[] {
  const term = filter.toLowerCase();
  return MERMAID_DIAGRAM_TYPES.filter(
    (t) => t.toLowerCase().startsWith(term) || t.toLowerCase().includes(term),
  ).map((t) => ({ label: t, apply: t, type: 'type' }));
}

export function buildEntityCompletions(
  entities: EntityLike[],
  edges: EdgeLike[],
  includeEdges: boolean,
  filter: string,
): Completion[] {
  const rawTerm = filter.toLowerCase().trim();
  const termTokens = rawTerm.split(/[^a-z0-9]+/).filter(Boolean);
  const matchesTokens = (hay: string) => {
    if (termTokens.length === 0) return true;
    const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
    return termTokens.every((t) => words.some((w) => w.startsWith(t)));
  };

  const options: Completion[] = [];
  for (const e of entities) {
    const hay = `${e.type || ''} ${e.label || ''} ${e.id || ''}`.toLowerCase();
    if (!matchesTokens(hay)) continue;
    const qualified = e.type && !e.id.startsWith(`${e.type}:`) ? `${e.type}:${e.id}` : e.id;
    const insertText = formatEntityToken(e.label || e.id, e.id, e.type);
    options.push({
      label: e.label || e.id,
      detail: qualified,
      apply: (view, _completion, from, to) => {
        view.dispatch(insertCompletionText(view.state, insertText, from, to));
      },
      type: 'property',
    });
  }

  if (includeEdges) {
    const entityLabelMap = new Map(entities.map((e) => [e.id, e.label || e.id]));
    for (const edge of edges) {
      const sourceLabel = entityLabelMap.get(edge.from) || edge.from;
      const targetLabel = entityLabelMap.get(edge.to) || edge.to;
      const rel = edge.label || edge.type || 'edge';
      const hay = `${sourceLabel} ${edge.from} ${targetLabel} ${edge.to} ${rel}`.toLowerCase();
      if (!matchesTokens(hay)) continue;
      const insertText = formatEdgeToken(edge.from, edge.to, rel);
      options.push({
        label: `${sourceLabel} — ${rel} → ${targetLabel}`,
        detail: `${edge.from} → ${edge.to}`,
        apply: (view, _completion, from, to) => {
          view.dispatch(insertCompletionText(view.state, insertText, from, to));
        },
        type: 'enum',
      });
    }
  }

  if (options.length === 0) {
    options.push({
      label: 'No matching entities or edges',
      apply: () => {},
      type: 'text',
    });
  } else {
    options.sort((a, b) => a.label.length - b.label.length);
  }

  return options;
}

export function completionInputHandler(
  triggers: { directive?: boolean; entity?: boolean },
): any {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (triggers.entity && text === '[') {
      const prev = view.state.doc.sliceString(Math.max(0, from - 1), from);
      if (prev !== '[') return false;
      Promise.resolve().then(() => startCompletion(view));
      return false;
    }
    if (triggers.directive && text === '#') {
      Promise.resolve().then(() => startCompletion(view));
      return false;
    }
    return false;
  });
}

// Re-export constants so consumers don't need to import from @architxt/aql separately.
export { BLOCK_DIRECTIVES, SUB_DIRECTIVE_KEYS, ALLOWED_KEYS_BY_BLOCK, formatEntityToken, formatEdgeToken };
