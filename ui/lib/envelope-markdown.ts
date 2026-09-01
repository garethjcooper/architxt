import type { DiscoverStepResponse, ResearchStepSummary, GraphNode, GraphEdge, UnifiedEnvelope, UnifiedNarrativeBlock } from '@/lib/api/client';

type LegacyEnvelope = {
  synthesis?: { narrative?: string | null; narrative_name?: string | null } | null;
  canvas?: {
    graph?: { name?: string | null; nodes?: GraphNode[]; edges?: GraphEdge[] } | null;
    tables?: Array<{ name: string; columns?: string[]; rows: Record<string, any>[] }> | null;
    diagrams?: Array<{ name: string; type: string; content: string }> | null;
  } | null;
};

export type EnvelopeLike = LegacyEnvelope | UnifiedEnvelope | null | undefined;

function isUnifiedEnvelope(envelope: EnvelopeLike): envelope is UnifiedEnvelope {
  if (!envelope || typeof envelope !== 'object') return false;
  return 'narratives' in envelope && !('synthesis' in envelope);
}

function toNarratives(envelope: EnvelopeLike): UnifiedNarrativeBlock[] {
  if (!envelope || typeof envelope !== 'object') return [];
  if (isUnifiedEnvelope(envelope)) {
    return Array.isArray(envelope.narratives)
      ? envelope.narratives.map((n) => ({
          narrative_name: n.narrative_name ?? '',
          narrative: n.narrative ?? '',
        }))
      : [];
  }
  const legacyNarrative = envelope.synthesis?.narrative ?? '';
  const legacyName = envelope.synthesis?.narrative_name ?? '';
  if (typeof legacyNarrative === 'string' && legacyNarrative.trim().length > 0) {
    return [{ narrative_name: legacyName, narrative: legacyNarrative }];
  }
  return [];
}

function toUnified(envelope: EnvelopeLike): Required<UnifiedEnvelope> {
  if (!envelope) {
    return { narratives: [], graph: { name: '', nodes: [], edges: [] }, tables: [], diagrams: [] };
  }

  if (!isUnifiedEnvelope(envelope)) {
    return {
      narratives: toNarratives(envelope),
      graph: {
        name: envelope.canvas?.graph?.name ?? '',
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
    narratives: toNarratives(envelope),
    graph: {
      name: envelope.graph?.name ?? '',
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
  const unified = toUnified(envelope);
  const { narratives, graph, tables, diagrams } = unified;
  const parts: string[] = [];

  for (const block of narratives) {
    if (!block.narrative?.trim()) continue;
    const heading = block.narrative_name?.trim() ? `## ${block.narrative_name.trim()}` : '';
    parts.push(heading ? `${heading}\n\n${block.narrative.trim()}` : block.narrative.trim());
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
    const heading = graph.name?.trim() ? `## Graph: ${graph.name.trim()}` : '## Graph';
    parts.push(`\n\n${heading}\n\n\`\`\`json\n${rawGraphJson}\n\`\`\``);
  }

  return parts.join('').trim();
}

export function normalizeEnvelope(page: ResearchStepSummary | DiscoverStepResponse): UnifiedEnvelope {
  // Prefer the unified envelope field when present; fall back to the legacy
  // split synthesis/canvas shape for non-curated or older responses.
  const envelopeLike = page.envelope ?? { synthesis: page.synthesis, canvas: page.canvas };
  return toUnified(envelopeLike);
}

export function normalizeEnvelopeFromNullable(
  page: ResearchStepSummary | DiscoverStepResponse | null | undefined
): UnifiedEnvelope {
  if (!page) return toUnified(null);
  return normalizeEnvelope(page);
}
