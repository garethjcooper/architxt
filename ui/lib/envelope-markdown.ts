import type { DiscoverStepResponse, ResearchStepSummary, GraphNode, GraphEdge } from '@/lib/api/client';

type LegacyEnvelope = {
  synthesis?: { narrative?: string | null } | null;
  canvas?: {
    graph?: { nodes?: GraphNode[]; edges?: GraphEdge[] } | null;
    tables?: Array<{ name: string; columns?: string[]; rows: Record<string, any>[] }> | null;
    diagrams?: Array<{ name: string; type: string; content: string }> | null;
  } | null;
};

type UnifiedEnvelope = {
  narrative: string;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  tables: Array<{ name: string; columns: string[]; rows: Record<string, any>[] }>;
  diagrams: Array<{ name: string; type: string; content: string }>;
};

export type EnvelopeLike = LegacyEnvelope | UnifiedEnvelope | null | undefined;

function isUnifiedEnvelope(envelope: EnvelopeLike): envelope is UnifiedEnvelope {
  if (!envelope || typeof envelope !== 'object') return false;
  return 'narrative' in envelope && !('synthesis' in envelope);
}

function toUnified(envelope: EnvelopeLike): Required<UnifiedEnvelope> {
  if (!envelope) {
    return { narrative: '', graph: { nodes: [], edges: [] }, tables: [], diagrams: [] };
  }
  if (!isUnifiedEnvelope(envelope)) {
    return {
      narrative: envelope.synthesis?.narrative ?? '',
      graph: {
        nodes: envelope.canvas?.graph?.nodes ?? [],
        edges: envelope.canvas?.graph?.edges ?? [],
      },
      tables: (envelope.canvas?.tables ?? []).map((t) => ({
        name: t.name,
        columns: t.columns ?? [],
        rows: t.rows,
      })),
      diagrams: envelope.canvas?.diagrams ?? [],
    };
  }

  return {
    narrative: envelope.narrative ?? '',
    graph: {
      nodes: envelope.graph?.nodes ?? [],
      edges: envelope.graph?.edges ?? [],
    },
    tables: (envelope.tables ?? []).map((t) => ({
      name: t.name,
      columns: t.columns ?? [],
      rows: t.rows,
    })),
    diagrams: envelope.diagrams ?? [],
  };
}

export function escapeMarkdownCell(val: unknown): string {
  if (val === undefined || val === null) return '';
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  return str.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function rowsToMarkdownTable(columns: string[], rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const header = `| ${columns.join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => {
    const cells = columns.map((c) => escapeMarkdownCell(row[c]));
    return `| ${cells.join(' | ')} |`;
  }).join('\n');
  return `${header}\n${sep}\n${body}`;
}

export function parseMarkdownTable(markdown: string): { columns: string[]; rows: Record<string, unknown>[] } | null {
  const lines = markdown.split(/\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const separatorIdx = lines.findIndex((l) => /^\|?\s*[-:]+\s*(\|\s*[-:]+\s*)*\|?\s*$/.test(l));
  if (separatorIdx <= 0 || separatorIdx >= lines.length - 1) return null;

  const parseRow = (line: string): string[] => {
    const trimmed = line.trim();
    const inner = trimmed.startsWith('|') && trimmed.endsWith('|')
      ? trimmed.slice(1, -1)
      : trimmed;
    return inner.split('|').map((c) => c.trim());
  };

  const columns = parseRow(lines[separatorIdx - 1]);
  if (columns.length === 0) return null;

  const rows: Record<string, unknown>[] = [];
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    if (cells.length === 0) continue;
    const row: Record<string, unknown> = {};
    for (let j = 0; j < columns.length; j++) {
      row[columns[j]] = cells[j] ?? '';
    }
    rows.push(row);
  }

  return rows.length > 0 ? { columns, rows } : null;
}

export function formatPropertiesCompact(properties: Record<string, any>): string {
  return Object.entries(properties)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const value = Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}: ${value}`;
    })
    .join(' | ');
}

export function buildEnvelopeMarkdown(envelope: EnvelopeLike): string {
  const { narrative, graph, tables, diagrams } = toUnified(envelope);
  const parts: string[] = [];

  if (narrative.trim()) {
    parts.push(narrative.trim());
  }

  if (tables && tables.length > 0) {
    for (const t of tables) {
      if (!t.rows || t.rows.length === 0) continue;
      const cols = t.columns?.length ? t.columns : Object.keys(t.rows[0]);
      const tableMd = rowsToMarkdownTable(cols, t.rows);
      parts.push(`\n\n## Table: ${t.name}\n\n${tableMd}`);
    }
  }

  if (diagrams && diagrams.length > 0) {
    for (const d of diagrams) {
      const content = typeof d.content === 'string' ? d.content : JSON.stringify(d.content ?? null, null, 2);
      parts.push(`\n\n## Diagram: ${d.name || d.type || 'Untitled'}\n\n\`\`\`mermaid\n${content}\n\`\`\``);
    }
  }

  if (graph && (graph.nodes?.length || graph.edges?.length)) {
    const rawGraphJson = JSON.stringify(graph, null, 2);
    parts.push(`\n\n## Graph\n\n\`\`\`json\n${rawGraphJson}\n\`\`\``);
  }

  return parts.join('').trim();
}

export function normalizeEnvelope(page: ResearchStepSummary | DiscoverStepResponse): Required<UnifiedEnvelope> {
  // Prefer the unified envelope field when present; fall back to the legacy
  // split synthesis/canvas shape for non-curated or older responses.
  const envelopeLike = page.envelope ?? { synthesis: page.synthesis, canvas: page.canvas };
  return toUnified(envelopeLike);
}
