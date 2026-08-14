'use client';

import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export type BackendNode = {
  id: string;
  labels: string[];
  properties: Record<string, any>;
};

export type BackendEdge = {
  id: string;
  source_id: string;
  target_id: string;
  type: string | null;
  labels?: string[];
  properties: Record<string, any>;
};

export type ModelRef = {
  role?: string;
  ext_id?: string;
  attached_at?: string;
  fetched_at?: string;
  content_hash?: string;
  last_refresh_status?: 'ok' | 'error' | 'skipped' | string;
  last_refresh_at?: string;
  last_refresh_error?: string;
};

export type DisplayNode = {
  id: string;
  type: string;
  label: string;
  labels: string[];
  properties: Record<string, any>;
  modelRefs: ModelRef[];
};

export type DisplayEdge = {
  id: string;
  source_id: string;
  target_id: string;
  type: string | null;
  labels: string[];
  label?: string;
  detail?: string;
  properties: Record<string, any>;
  modelRefs: ModelRef[];
};

export function backendNodeToDisplayNode(node: BackendNode): DisplayNode {
  const type = node.labels[0] ?? (typeof node.id === 'string' && node.id.includes(':') ? node.id.split(':')[0] : 'entity');
  const label = node.properties.display_name || node.properties.name || node.properties.label || node.id;
  return {
    id: node.id,
    labels: node.labels,
    type,
    label,
    properties: node.properties,
    modelRefs: node.properties.provenance?.model_refs || [],
  };
}

export function backendEdgeToDisplayEdge(edge: BackendEdge): DisplayEdge {
  return {
    id: edge.id,
    source_id: edge.source_id,
    target_id: edge.target_id,
    type: edge.type,
    labels: edge.labels || [],
    label: edge.properties.label,
    detail: edge.properties.detail,
    properties: edge.properties,
    modelRefs: edge.properties.provenance?.model_refs || [],
  };
}

export function isGroundedNode(node: DisplayNode): boolean {
  return node.labels.includes('canonical') || node.labels.includes('grounded');
}

export function isCandidateNode(node: DisplayNode): boolean {
  return node.labels.includes('candidate');
}

export function isCandidateEdge(edge: DisplayEdge): boolean {
  return edge.properties.labels?.includes('candidate') ?? false;
}

export function isGroundedEdge(edge: DisplayEdge): boolean {
  return !isCandidateEdge(edge);
}

export function isUndirectedEdge(edge: DisplayEdge): boolean {
  return edge.properties.directed === false;
}

export function hasEdgeContextRef(edge: DisplayEdge): boolean {
  return edge.modelRefs.some((r) => r.role === 'sys_edge_context');
}

export function getEdgeContextPairKey(edge: DisplayEdge): string | null {
  const ref = edge.modelRefs.find(
    (r) => r.role === 'sys_edge_context' && r.ext_id?.startsWith('edge-ctx-')
  );
  if (!ref?.ext_id) return null;
  const pairPart = ref.ext_id.slice('edge-ctx-'.length);
  if (!pairPart.includes('|')) return null;
  const [a, b] = pairPart.split('|');
  return [a, b].sort().join('|');
}

export function getEdgeSortGroup(edge: DisplayEdge): string {
  return getEdgeContextPairKey(edge) || [edge.source_id, edge.target_id].sort().join('|');
}

export function getEdgeSortRank(edge: DisplayEdge): number {
  if (isUndirectedEdge(edge)) return 0;
  if (hasEdgeContextRef(edge)) return 1;
  return 2;
}

export function getLastRefreshedAt(modelRefs: ModelRef[]): string | null {
  const timestamps = modelRefs
    .filter((r) => r.fetched_at)
    .map((r) => new Date(r.fetched_at!).getTime())
    .filter((t) => !isNaN(t));
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
}

export function formatRelative(value?: string | null): string {
  if (!value) return 'never';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return formatDistanceToNow(d, { addSuffix: true });
}

export function renderValue(value: unknown): React.ReactNode {
  if (value === undefined || value === null) return <span className="text-white/40 italic">null</span>;
  if (typeof value === 'string') {
    return value.trim().length === 0
      ? <span className="text-white/40 italic">empty</span>
      : <p className="whitespace-pre-wrap text-white/80">{value}</p>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="font-mono text-white/80">{String(value)}</span>;
  }
  return (
    <pre className="text-[11px] text-white/70 bg-black/20 rounded p-1.5 overflow-x-auto">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded border border-white/5 bg-black/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-white/50" /> : <ChevronRight className="w-3.5 h-3.5 text-white/50" />}
        <span className="text-[11px] font-medium text-white/80">{title}</span>
      </button>
      {open && <div className="px-2.5 pb-2.5 pt-1 space-y-2">{children}</div>}
    </div>
  );
}

export function PropertyRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">{label}</div>
      {renderValue(value)}
    </div>
  );
}