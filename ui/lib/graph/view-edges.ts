import type { ViewEdge } from '@/lib/types';
import type { EdgeMergeMode } from '@/app/views/components/view-editor-options';

export interface BundledViewEdge extends ViewEdge {
  bundledEdges?: ViewEdge[];
  bundledCount?: number;
  bidirectional?: boolean;
  canonicalOnly?: boolean;
}

function isCanonicalEdge(e: ViewEdge): boolean {
  return (
    e.id?.startsWith('hindsight-') ||
    e.properties?.provenance?.source === 'hindsight' ||
    e.edge_type === 'hindsight'
  );
}

/** Group parallel view edges for visual bundling.
 *
 *  - 'all':   no bundling; each edge is rendered individually.
 *  - 'byType': bundle edges that share the same directed endpoint pair AND edge_type.
 *  - 'full':   bundle all edges that share the same directed endpoint pair.
 *
 *  Canonical/hindsight edges are suppressed when contextual edges already exist
 *  for the same directed endpoint pair, matching the canvas rendering behaviour.
 */
export function bundleViewEdges(edges: ViewEdge[], mode: EdgeMergeMode): BundledViewEdge[] {
  // Pairs that have at least one contextual (non-canonical) edge.
  const contextualPairs = new Set(
    edges
      .filter((e) => !isCanonicalEdge(e))
      .map((e) => `${e.source}|${e.target}`)
  );

  function keepCanonical(e: ViewEdge): boolean {
    if (!isCanonicalEdge(e)) return true;
    const pair = `${e.source}|${e.target}`;
    return !contextualPairs.has(pair);
  }

  if (mode === 'all') {
    return edges
      .filter(keepCanonical)
      .map((e) => ({
        ...e,
        bundledEdges: [],
        bundledCount: 1,
        bidirectional: false,
        canonicalOnly: isCanonicalEdge(e),
      }));
  }

  if (mode === 'full') {
    const filtered = edges.filter(keepCanonical);
    const groups = new Map<string, ViewEdge[]>();
    for (const e of filtered) {
      const pair = `${e.source}|${e.target}`;
      const list = groups.get(pair) || [];
      list.push(e);
      groups.set(pair, list);
    }
    const result: BundledViewEdge[] = [];
    for (const [, group] of groups) {
      const canonicalOnly = group.every(isCanonicalEdge);
      const representative = pickRepresentative(group);
      const bundled = group.filter((e) => e.id !== representative.id);
      const directions = new Set(group.map((e) => `${e.source}|${e.target}`));
      const bidirectional = directions.size > 1;
      result.push({
        ...representative,
        bundledEdges: bundled,
        bundledCount: group.length,
        bidirectional,
        canonicalOnly,
      });
    }
    return result;
  }

  const groups = new Map<string, ViewEdge[]>();
  for (const e of edges) {
    const pair = `${e.source}|${e.target}`;
    const key = `${pair}|${e.edge_type || ''}`;
    const list = groups.get(key) || [];
    list.push(e);
    groups.set(key, list);
  }

  const result: BundledViewEdge[] = [];
  for (const [key, group] of groups) {
    const pair = key.split('|').slice(0, 2).join('|');
    const canonicalOnly = group.every(isCanonicalEdge);
    if (canonicalOnly && contextualPairs.has(pair)) continue;

    const representative = pickRepresentative(group);
    const bundled = group.filter((e) => e.id !== representative.id);
    const directions = new Set(group.map((e) => `${e.source}|${e.target}`));
    const bidirectional = directions.size > 1;
    result.push({
      ...representative,
      bundledEdges: bundled,
      bundledCount: group.length,
      bidirectional,
      canonicalOnly,
    });
  }
  return result;
}

function pickRepresentative(group: ViewEdge[]): ViewEdge {
  return group.find((e) => e.edge_type) || group[0];
}

/** Given a set of selected visible edge ids and the current merge mode, return
 *  the underlying real contextual edges represented by those selections.
 *
 *  This mirrors the bundling decision made by the canvas so the detail panel
 *  fetches mental-model content for the correct edge set.
 */
export function resolveRepresentedEdges(
  edges: ViewEdge[],
  selectedIds: string[],
  mode: EdgeMergeMode,
): ViewEdge[] {
  if (mode === 'all') {
    const byId = new Map(edges.map((e) => [e.id, e]));
    return selectedIds
      .map((id) => byId.get(id))
      .filter((e): e is ViewEdge => Boolean(e));
  }

  const bundled = bundleViewEdges(edges, mode);
  const byId = new Map(bundled.map((e) => [e.id, e]));
  const represented = new Map<string, ViewEdge>();

  for (const id of selectedIds) {
    const visible = byId.get(id);
    if (!visible) continue;
    represented.set(visible.id, visible);
    for (const inner of visible.bundledEdges || []) {
      represented.set(inner.id, inner);
    }
  }

  return Array.from(represented.values());
}
