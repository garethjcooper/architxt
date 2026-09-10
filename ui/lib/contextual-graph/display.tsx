'use client';

import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { mentalModelsApi } from '@/lib/api/client';

const TYPE_PALETTE = [
  '#E06C75', // red
  '#98C379', // green
  '#E5C07B', // yellow
  '#61AFEF', // blue
  '#C678DD', // purple
  '#56B6C2', // cyan
  '#FFEB3B', // bright yellow
  '#FF9800', // amber
  '#00BCD4', // sky
];

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function colorForType(type?: string | null): string {
  if (!type) return '#64748b';
  return TYPE_PALETTE[hashString(type) % TYPE_PALETTE.length];
}

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

export type ModelScope =
  | { node_id: string }
  | { source_id: string; target_id: string }
  | { seed_id: string };

export type ModelRef = {
  role?: string;
  ext_id?: string;
  scope?: ModelScope;
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

export function getEdgeSortGroup(edge: DisplayEdge, roles?: Set<string>): string {
  return getEdgeContextPairKey(edge, roles) || [edge.source_id, edge.target_id].sort().join('|');
}

export function getEdgeSortRank(edge: DisplayEdge, roles?: Set<string>): number {
  if (isUndirectedEdge(edge)) return 0;
  if (hasEdgeContextRef(edge, roles)) return 1;
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
    <div className="rounded border border-white/5 bg-overlay overflow-hidden">
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

// Obsolete hardcoded role -> scope badge map. Kept for backwards compatibility
// until all consumers are migrated; prefer getRoleScopeLabel() which derives the
// derivation_scope from the template_roles table, and getRoleLabel() for the
// human-readable role name.
export const MODEL_ROLE_LABELS: Record<string, string> = {
  sys_entity_summary: 'NODE',
  sys_entity_capabilities: 'NODE',
  sys_edge_context: 'EDGE',
  sys_discovery_context: 'SEED',
};

const CONTEXTUAL_ROLES = new Set([
  'sys_entity_summary',
  'sys_entity_capabilities',
  'sys_edge_context',
  'sys_discovery_context',
]);

function roleIsEntityLike(role?: string): boolean {
  return role === 'sys_entity_summary' || role === 'sys_entity_capabilities' || role === 'sys_discovery_context';
}

export function isContextualRole(role?: string): boolean {
  return typeof role === 'string' && (CONTEXTUAL_ROLES.has(role) || !!roleScopeMap?.[role]);
}

export function getContextualPatchRefs(item: DisplayNode | DisplayEdge): ModelRef[] {
  const refs = item.modelRefs.filter((ref) => ref.ext_id && isContextualRole(ref.role));
  if ('source_id' in item && 'target_id' in item) {
    return refs.filter((ref) => roleIsEdgeLike(ref.role));
  }
  return refs.filter((ref) => roleIsEntityLike(ref.role) || roleIsNodeLike(ref.role));
}

function roleIsNodeLike(role?: string): boolean {
  return !!roleScopeMap?.[role || ''];
}

function roleIsEdgeLike(role?: string): boolean {
  return roleScopeMap?.[role || ''] === 'EDGE' || role === 'sys_edge_context';
}

// Client-side derivation of a scope badge from a role id. Mirrors the
// server-side template_roles table. Falls back to a readable label for unknown
// roles; use getDerivationScope() when only NODE/EDGE/SEED/PATCH is needed.
export function getRoleScopeLabel(role?: string): string {
  if (!role) return 'PATCH';
  const scope = getRoleScope(role);
  if (scope) return scope.toUpperCase();
  return role.replace(/^sys_/, '').replace(/_/g, ' ').toUpperCase();
}

// Clean derivation scope (NODE / EDGE / SEED) for the scope badge.
// Falls back to deriving from the ref's own scope object when the role is not
// present in the template_roles table (e.g. custom/imported roles).
export function getDerivationScope(role?: string, refScope?: ModelScope): string {
  const roleScope = getRoleScope(role);
  if (roleScope === 'NODE' || roleScope === 'EDGE' || roleScope === 'SEED') return roleScope;
  if (refScope) {
    if ('node_id' in refScope) return 'NODE';
    if ('source_id' in refScope && 'target_id' in refScope) return 'EDGE';
    if ('seed_id' in refScope) return 'SEED';
  }
  return '-';
}

// Human-readable role label from the template_roles table.
export function getRoleLabel(role?: string): string {
  if (!role) return 'Unknown role';
  return roleLabelMap?.[role] || role.replace(/^sys_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getRoleScope(role?: string): string {
  return roleScopeMap?.[role || ''] || MODEL_ROLE_LABELS[role || ''];
}

let roleScopeMap: Record<string, string> | null = null;
let roleLabelMap: Record<string, string> | null = null;

export async function loadRoleScopeMap(): Promise<Record<string, string>> {
  if (roleScopeMap && roleLabelMap) return roleScopeMap;
  try {
    const roles = await mentalModelsApi.listTemplateRoles();
    roleScopeMap = Object.fromEntries(
      (roles || []).map((r: { value: string; label?: string; derivation_scope?: string }) => [r.value, (r.derivation_scope || '').toUpperCase()]),
    );
    roleLabelMap = Object.fromEntries(
      (roles || []).map((r: { value: string; label?: string }) => [r.value, r.label || '']),
    );
    return roleScopeMap;
  } catch {
    roleLabelMap = Object.fromEntries(Object.entries(MODEL_ROLE_LABELS).map(([k]) => [k, k.replace(/^sys_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())]));
    return MODEL_ROLE_LABELS;
  }
}

export function setRoleScopeMap(map: Record<string, string>) {
  roleScopeMap = map;
}

export function hasEdgeContextRef(edge: DisplayEdge, roles?: Set<string>): boolean {
  return edge.modelRefs.some((r) => r.role && ((roles?.has(r.role) ?? false) || roleIsEdgeLike(r.role)));
}

export function getEdgeContextPairKey(edge: DisplayEdge, roles?: Set<string>): string | null {
  const ref = edge.modelRefs.find((r) => r.role && ((roles?.has(r.role) ?? false) || roleIsEdgeLike(r.role)));
  if (!ref?.scope || !('source_id' in ref.scope) || !('target_id' in ref.scope)) return null;
  const { source_id: a, target_id: b } = ref.scope as { source_id: string; target_id: string };
  return [a, b].sort().join('|');
}

export function EntityListRow({
  node,
  active,
  onClick,
}: {
  node: DisplayNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const typeLine = node.type && !node.id.startsWith(`${node.type}:`) ? `${node.type}:${node.id}` : node.id;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors',
        active
          ? 'border-white/10 bg-white/10'
          : 'border-white/5 bg-black/20 hover:bg-white/5'
      )}
      style={{ borderLeftColor: colorForType(node.type), borderLeftWidth: 3 }}
    >
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <div className="text-xs text-white/90 truncate">{node.label}</div>
        <div className="text-[10px] text-white/50 font-mono truncate">{typeLine}</div>
      </div>
    </button>
  );
}

export function EdgeListRow({
  edge,
  active,
  onClick,
  sourceLabel,
  targetLabel,
  edgeContextCount,
}: {
  edge: DisplayEdge;
  active?: boolean;
  onClick?: () => void;
  sourceLabel?: string;
  targetLabel?: string;
  edgeContextCount?: number;
}) {
  const sourceDisplay = sourceLabel || edge.source_id;
  const targetDisplay = targetLabel || edge.target_id;
  const secondary = edge.label || edge.type || edge.id;
  const description = edge.detail;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors',
        active
          ? 'border-white/10 bg-white/10'
          : 'border-white/5 bg-black/20 hover:bg-white/5'
      )}
      style={{ borderLeftColor: colorForType(edge.type || 'edge'), borderLeftWidth: 3 }}
    >
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <div className="text-xs text-white/90 truncate">
          {sourceDisplay} <span className="text-white/40">→</span> {targetDisplay}
        </div>
        <div className="text-[10px] text-white/50 font-mono truncate">
          {description || secondary}
        </div>
      </div>
      {edgeContextCount !== undefined && edgeContextCount > 0 && (
        <span
          className="text-[9px] text-white/50 px-1 py-0.5 rounded border border-white/10 bg-white/5 shrink-0"
          title={`${edgeContextCount} physical edge${edgeContextCount === 1 ? '' : 's'} in this edge context`}
        >
          {edgeContextCount} edge{edgeContextCount === 1 ? '' : 's'}
        </span>
      )}
    </button>
  );
}

export function PatchRefRow({
  ref: refProp,
  active,
  onClick,
}: {
  ref: ModelRef;
  active?: boolean;
  onClick?: () => void;
}) {
  const { role, ext_id: extId, last_refresh_status: lastRefreshStatus } = refProp;
  const scopeLabel = getRoleScopeLabel(role);
  const roleLabel = getRoleLabel(role);
  const type = role || 'patch';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors',
        active
          ? 'border-white/10 bg-white/10'
          : 'border-white/5 bg-black/20 hover:bg-white/5'
      )}
      style={{ borderLeftColor: colorForType(type), borderLeftWidth: 3 }}
    >
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/90 truncate" title={role}>{roleLabel}</span>
          <Badge className="text-[10px] h-4 px-1 bg-emerald-900/30 text-emerald-300 border-emerald-500/20">
            {scopeLabel}
          </Badge>
          {lastRefreshStatus && (
            <span className={cn(
              'text-[10px]',
              lastRefreshStatus === 'error' ? 'text-red-400' : 'text-emerald-400'
            )}>
              {lastRefreshStatus}
            </span>
          )}
        </div>
        <div className="text-[10px] text-white/50 font-mono truncate">{extId}</div>
      </div>
    </button>
  );
}
