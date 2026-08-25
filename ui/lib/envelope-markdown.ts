import type { DiscoverStepResponse, ResearchStepSummary, GraphNode, GraphEdge } from '@/lib/api/client';

type EnvelopeLike = {
  synthesis?: { narrative?: string | null } | null;
  canvas?: {
    graph?: { nodes?: GraphNode[]; edges?: GraphEdge[] } | null;
    tables?: Array<{ name: string; columns?: string[]; rows: Record<string, any>[] }> | null;
    diagrams?: Array<{ name: string; type: string; content: string }> | null;
  } | null;
};

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

export function formatPropertiesCompact(properties: Record<string, any>): string {
  return Object.entries(properties)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const value = Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}: ${value}`;
    })
    .join(' | ');
}

export function buildEnvelopeMarkdown(envelope: EnvelopeLike | null | undefined): string {
  if (!envelope) return '';
  const parts: string[] = [];

  if (envelope.synthesis?.narrative?.trim()) {
    parts.push(envelope.synthesis.narrative.trim());
  }

  const tables = envelope.canvas?.tables;
  if (tables && tables.length > 0) {
    for (const t of tables) {
      if (!t.rows || t.rows.length === 0) continue;
      const cols = t.columns?.length ? t.columns : Object.keys(t.rows[0]);
      const tableMd = rowsToMarkdownTable(cols, t.rows);
      parts.push(`\n\n## Table: ${t.name}\n\n${tableMd}`);
    }
  }

  const diagrams = envelope.canvas?.diagrams;
  if (diagrams && diagrams.length > 0) {
    for (const d of diagrams) {
      const content = typeof d.content === 'string' ? d.content : JSON.stringify(d.content ?? null, null, 2);
      parts.push(`\n\n## Diagram: ${d.name || d.type || 'Untitled'}\n\n\`\`\`mermaid\n${content}\n\`\`\``);
    }
  }

  const graph = envelope.canvas?.graph;
  if (graph && (graph.nodes?.length || graph.edges?.length)) {
    const nodeRows = graph.nodes?.map((n) => ({
      ID: n.id || '',
      Name: n.name || n.label || '',
      Type: n.type || '',
    })) ?? [];
    const nodeTable = rowsToMarkdownTable(['ID', 'Name', 'Type'], nodeRows);

    const edgeRows = graph.edges?.map((e) => {
      const props = e.properties ? formatPropertiesCompact(e.properties) : '';
      return {
        From: e.from || '',
        To: e.to || '',
        Type: e.type || '',
        Label: e.label || '',
        Detail: e.detail || '',
        Properties: props,
      };
    }) ?? [];
    const edgeTable = rowsToMarkdownTable(['From', 'To', 'Type', 'Label', 'Detail', 'Properties'], edgeRows);

    const rawGraphJson = JSON.stringify(graph, null, 2);
    parts.push(
      `\n\n## Graph: Nodes\n\n${nodeTable}\n\n## Graph: Edges\n\n${edgeTable}\n\n## Graph: Raw JSON\n\n\`\`\`json\n${rawGraphJson}\n\`\`\``,
    );
  }

  return parts.join('').trim();
}
