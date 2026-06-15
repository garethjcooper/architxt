'use client';

import { useState, useEffect, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Plus,
  Trash2,
  Box,
  Layers,
  Users,
  Search,
  X,
  RefreshCw,
  Download,
  Table as TableIcon,
} from 'lucide-react';
import { entitiesApi, entityTypesApi, type Entity, type EntityType } from '@/lib/api/client';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { BatchProgressDialog, type BatchItem, type BatchResult } from '@/components/batch-progress-dialog';
import { CreateEntityDialog } from '@/components/create-entity-dialog';
import { CreateEntityTypeDialog } from '@/components/create-entity-type-dialog';
import { ViewEntityDialog } from '@/components/view-entity-dialog';
import { ViewEntityTypeDialog } from '@/components/view-entity-type-dialog';
import { ImportDialog, parseEntityImport } from '@/components/import-dialog';
import { BadgeExpandIcon } from '@/components/icons/badge-expand-icon';
import { BadgeCompactIcon } from '@/components/icons/badge-compact-icon';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('EntitiesPage');

export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── Shared modals ── */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmDesc, setConfirmDesc] = useState('');
  const [confirmVariant, setConfirmVariant] = useState<'destructive'>('destructive');
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

  /* ── Batch progress ── */
  const [batchProgressOpen, setBatchProgressOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchDescription, setBatchDescription] = useState('');
  const [batchOperation, setBatchOperation] = useState<(item: BatchItem) => Promise<void>>(() => async () => {});

  /* ── Import state ── */
  const [importOpen, setImportOpen] = useState(false);

  /* ── Entities tab state ── */
  const [createEntityOpen, setCreateEntityOpen] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [viewEntityOpen, setViewEntityOpen] = useState(false);
  const [entitySearch, setEntitySearch] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState<number | 'all'>('all');

  /* ── Freeze panes state ── */
  const [freeze, setFreeze] = useState(false);
  const [compactBadges, setCompactBadges] = useState(false);
  const [showAllBadges, setShowAllBadges] = useState(false);

  /* ── Entity Types tab state ── */
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [selectedEntityType, setSelectedEntityType] = useState<EntityType | null>(null);
  const [viewTypeOpen, setViewTypeOpen] = useState(false);

  /* ── Derived: filtered entities ── */
  const filteredEntities = useMemo(() => {
    let list = entities;
    if (entityTypeFilter !== 'all') {
      list = list.filter((e) => e.type_id === entityTypeFilter);
    }
    if (!entitySearch.trim()) return list;
    const q = entitySearch.toLowerCase();
    return list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.entity_id.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q)) ||
        (entityTypes.find((t) => t.id === e.type_id)?.type_name.toLowerCase().includes(q) || false)
    );
  }, [entities, entityTypeFilter, entitySearch]);

  const entityMulti = useMultiSelect(filteredEntities);

  // Always show selected rows even when filtered out by search
  const displayEntities = useMemo(() => {
    if (!entitySearch.trim()) return filteredEntities;
    const visibleIds = new Set(filteredEntities.map((e) => e.id));
    const selectedHidden = entities.filter((e) => entityMulti.selected.has(e.id) && !visibleIds.has(e.id));
    return [...filteredEntities, ...selectedHidden];
  }, [filteredEntities, entities, entitySearch, entityMulti.selected]);

  const entityMultiAll =
    filteredEntities.length > 0 &&
    filteredEntities.every((e) => entityMulti.selected.has(e.id));

  const toggleEntityMultiAll = () => {
    const next = new Set(entityMulti.selected);
    const allSelected = filteredEntities.every((e) => next.has(e.id));
    for (const ent of filteredEntities) {
      if (allSelected) next.delete(ent.id);
      else next.add(ent.id);
    }
    entityMulti.setSelected(next);
  };

  /* ── Derived: entity types (no search, simple) ── */
  const typeMulti = useMultiSelect(entityTypes);

  /* ── Fetch ── */
  const fetchAll = async () => {
    setLoading(true);
    try {
      const [entData, typeData] = await Promise.all([
        entitiesApi.list(),
        entityTypesApi.list(),
      ]);
      setEntities(entData);
      setEntityTypes(typeData);
    } catch (err: any) {
      logger.error('Failed to fetch', { error: err });
      toast.error(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  /* ── Delete helpers ── */
  const openDeleteEntities = () => {
    const ids = Array.from(entityMulti.selected) as number[];
    const impactedDocs = ids.reduce((sum, id) => {
      const ent = entities.find((e) => e.id === id);
      return sum + (ent?.usage_count || 0);
    }, 0);
    setConfirmTitle('Delete Selected Entities');
    setConfirmDesc(
      impactedDocs > 0
        ? `Are you sure you want to delete ${entityMulti.selected.size} entity(ies)? This will remove entity references from ${impactedDocs} document${impactedDocs !== 1 ? 's' : ''}. This action cannot be undone.`
        : `Are you sure you want to delete ${entityMulti.selected.size} entity(ies)? This action cannot be undone.`
    );
    setConfirmVariant('destructive');
    setConfirmAction(() => () => {
      setBatchTitle('Deleting Entities');
      setBatchDescription(`${ids.length} entity${ids.length !== 1 ? 'ies' : 'y'}`);
      setBatchItems(ids.map((id) => {
        const ent = entities.find((e) => e.id === id);
        return { id, label: ent?.name || `Entity #${id}` };
      }));
      setBatchOperation(() => async (item: BatchItem) => {
        await entitiesApi.delete(item.id as number);
      });
      setBatchProgressOpen(true);
    });
    setConfirmOpen(true);
  };

  const openDeleteTypes = () => {
    setConfirmTitle('Delete Selected Entity Types');
    setConfirmDesc(`Are you sure you want to delete ${typeMulti.selected.size} type(s)? Entities of these types will become orphaned. This cannot be undone.`);
    setConfirmVariant('destructive');
    setConfirmAction(() => () => {
      const ids = Array.from(typeMulti.selected) as number[];
      setBatchTitle('Deleting Entity Types');
      setBatchDescription(`${ids.length} type${ids.length !== 1 ? 's' : ''}`);
      setBatchItems(ids.map((id) => {
        const t = entityTypes.find((x) => x.id === id);
        return { id, label: t?.type_name || `Type #${id}` };
      }));
      setBatchOperation(() => async (item: BatchItem) => {
        await entityTypesApi.delete(item.id as number);
      });
      setBatchProgressOpen(true);
    });
    setConfirmOpen(true);
  };

  const handleDeleteConfirmed = () => {
    confirmAction?.();
    setConfirmOpen(false);
  };

  const handleBatchComplete = (results: BatchResult[]) => {
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    if (failed === 0) {
      toast.success(`${succeeded} item${succeeded !== 1 ? 's' : ''} deleted`);
    } else if (succeeded === 0) {
      toast.error(`All ${failed} delete operations failed`);
    } else {
      toast.warning(`${succeeded} deleted, ${failed} failed`);
    }
    entityMulti.clearSelection();
    typeMulti.clearSelection();
    fetchAll();
  };

  /* ── Handlers ── */
  const handleEntityClick = (item: Entity) => {
    setSelectedEntity(item);
    setViewEntityOpen(true);
  };

  const handleTypeClick = (type: EntityType, e: React.MouseEvent) => {
    e.preventDefault();
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) return;
    setSelectedEntityType(type);
    setViewTypeOpen(true);
  };

  const entityTypeName = (typeId: number) =>
    entityTypes.find((t) => t.id === typeId)?.type_name || 'Unknown';

  return (
    <PageShell title="Entities" loading={loading}>
      <Tabs defaultValue="entities" className="flex flex-col flex-1 min-h-0">
        <TabsList variant="line" className="mb-2 shrink-0">
          <TabsTrigger value="entities" className="text-xs">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Entities
          </TabsTrigger>
          <TabsTrigger value="types" className="text-xs">
            <Layers className="h-3.5 w-3.5 mr-1.5" />
            Entity Types
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════
            TAB: Entities
           ═══════════════════════════════════════════════════════════ */}
        <TabsContent value="entities" className="flex flex-col flex-1 min-h-0 mt-0">
          {/* Action bar */}
          <div className="flex items-center gap-2 mb-2 shrink-0">
            {/* Type filter */}
            <select
              value={entityTypeFilter}
              onChange={(e) => {
                const v = e.target.value;
                setEntityTypeFilter(v === 'all' ? 'all' : Number(v));
              }}
              className="h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
            >
              <option value="all">All Types</option>
              {entityTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.type_name}</option>
              ))}
            </select>

            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
              <Input
                value={entitySearch}
                onChange={(e) => setEntitySearch(e.target.value)}
                placeholder="Search name, id, aliases, type…"
                className="h-8 pl-7 pr-7 text-xs rounded-full bg-white/5 border-2 border-white/10 text-white placeholder:text-white/30 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
              />
              {entitySearch && (
                <button
                  onClick={() => setEntitySearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex-1" />
            <div className="w-px h-5 bg-white/10 mx-1" />

            <Button onClick={() => setImportOpen(true)} title="Import" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><Download className="h-3.5 w-3.5" /></Button>
            <Button onClick={fetchAll} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
            <Button
              onClick={openDeleteEntities}
              disabled={entityMulti.selected.size === 0}
              className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-red-500/30 text-red-400 hover:bg-[oklch(0.27_0_0)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => setCreateEntityOpen(true)}
              className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"
              title="Add"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Table card */}
          <div className={[
            "rounded-md bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col flex-1 min-h-0 overflow-hidden",
            !freeze ? "max-h-[calc(100vh-240px)]" : "",
          ].filter(Boolean).join(" ")}>
            {/* Header bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-emerald-900/20 border-b border-emerald-500/30 shrink-0">
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAllBadges(!showAllBadges)}
                  title={showAllBadges ? 'Limit to 3 badges' : 'Show all badges'}
                  className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", showAllBadges ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
                >
                  <BadgeExpandIcon className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setCompactBadges(!compactBadges)}
                  title={compactBadges ? 'Expand badges' : 'Compact badges'}
                  className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", compactBadges ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
                >
                  <BadgeCompactIcon className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setFreeze(!freeze)}
                  title={!freeze ? 'Unfreeze panes' : 'Freeze panes'}
                  className={["inline-flex items-center justify-center h-6 w-6 rounded transition-colors", !freeze ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
                >
                  <TableIcon className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs font-mono text-emerald-400 bg-black/30 border border-emerald-500/30 px-2 py-0.5 rounded">
                  {filteredEntities.length} ({entityMulti.selected.size})
                </span>
              </div>
            </div>

            <div className={["flex-1 overflow-auto", !freeze ? "min-h-0" : ""].filter(Boolean).join(" ")}>
              {displayEntities.length === 0 && !loading ? (
                <div className="text-center py-12">
                  <Box className="h-8 w-8 opacity-30 mx-auto mb-3" />
                  <p className="text-white/50 text-sm">No entities found.</p>
                </div>
              ) : (
                <table className="w-full caption-bottom text-sm">
                  <TableHeader>
                    <TableRow className="border-b border-white/10">
                      <TableHead className={["w-12 py-2 px-4", !freeze && "sticky top-0 left-0 z-30 bg-[oklch(0.23_0_0)] border-r border-white/5"].filter(Boolean).join(" ")}>
                        <Checkbox
                          checked={entityMultiAll}
                          onCheckedChange={toggleEntityMultiAll}
                        />
                      </TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Entity ID</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Name</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Type</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left w-16", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Match</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Documents</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Aliases</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayEntities.map((item) => (
                      <TableRow
                        key={item.id}
                        className={`border-b border-white/5 transition-colors cursor-pointer ${
                          entityMulti.selected.has(item.id) ? 'bg-emerald-900/20' : 'hover:bg-white/5'
                        }`}
                        onClick={() => handleEntityClick(item)}
                      >
                        <TableCell className={["py-1.5 px-4", !freeze && `sticky left-0 z-10 border-r border-white/5 ${entityMulti.selected.has(item.id) ? 'bg-emerald-900/20' : 'bg-[oklch(0.23_0_0)]'}`].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={entityMulti.selected.has(item.id)}
                            onCheckedChange={() => entityMulti.toggleSelection(item.id)}
                          />
                        </TableCell>
                        <TableCell className="py-1.5 px-4 text-xs text-white/50 font-mono">{item.entity_id}</TableCell>
                        <TableCell className="py-1.5 px-4 text-xs font-medium text-white/80">{item.name}</TableCell>
                        <TableCell className="py-1.5 px-4">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                              entitySearch.trim() && (entityTypes.find((t) => t.id === item.type_id)?.type_name.toLowerCase().includes(entitySearch.toLowerCase()) || false)
                                ? 'bg-blue-800/30 text-blue-200 border-blue-700/40 ring-1 ring-blue-400/40'
                                : 'bg-blue-800/15 text-blue-400 border-blue-700/20'
                            }`}
                          >
                            {entityTypeName(item.type_id)}
                          </span>
                        </TableCell>
                        <TableCell className="py-1.5 px-4">
                          {(() => {
                            const resolved = item.case_match ?? item.type_case_match ?? 'insensitive';
                            const isSensitive = resolved === 'sensitive';
                            return (
                              <span
                                title={isSensitive ? 'Case-sensitive match' : 'Case-insensitive match (default)'}
                                className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-mono font-medium border ${
                                  isSensitive
                                    ? 'bg-amber-800/15 text-amber-400 border-amber-700/20'
                                    : 'bg-white/5 text-white/20 border-white/5'
                                }`}
                              >
                                {isSensitive ? 'Aa' : 'aa'}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="py-1.5 px-4">
                          {item.usage_count ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-blue-400/20 text-blue-300 border border-blue-400/30">
                              {item.usage_count} document{item.usage_count !== 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="text-white/20 text-[10px]">-</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 px-4">
                          {item.aliases.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {(showAllBadges ? item.aliases : item.aliases.slice(0, 3))?.map((a, i) => {
                                const isHit = entitySearch.trim() && a.toLowerCase().includes(entitySearch.toLowerCase());
                                return (
                                  <span
                                    key={i}
                                    className={`${!compactBadges ? 'inline-flex truncate max-w-[120px]' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                                      isHit
                                        ? 'bg-purple-800/30 text-purple-200 border-purple-700/40 ring-1 ring-purple-400/40'
                                        : 'bg-purple-800/15 text-purple-400 border-purple-700/20'
                                    }`}
                                  >
                                    {a}
                                  </span>
                                );
                              })}
                              {!showAllBadges && item.aliases.length > 3 && (
                                <span
                                  className={`text-[10px] px-1 rounded ${
                                    entitySearch.trim() && item.aliases.slice(3).some((a) => a.toLowerCase().includes(entitySearch.toLowerCase()))
                                      ? 'text-purple-300 bg-purple-400/15'
                                      : 'text-white/30'
                                  }`}
                                >
                                  +{item.aliases.length - 3}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-white/20 text-[10px]">-</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 px-4 text-xs text-white/50">
                          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════
            TAB: Entity Types
           ═══════════════════════════════════════════════════════════ */}
        <TabsContent value="types" className="flex flex-col flex-1 min-h-0 mt-0">
          {/* Action bar */}
          <div className="flex items-center gap-2 mb-2 shrink-0">
            <div className="flex-1" />
            <div className="w-px h-5 bg-white/10 mx-1" />
            <Button onClick={fetchAll} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
            <Button
              onClick={openDeleteTypes}
              disabled={typeMulti.selected.size === 0}
              className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-red-500/30 text-red-400 hover:bg-[oklch(0.27_0_0)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => setCreateTypeOpen(true)}
              className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"
              title="Add"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Table card */}
          <div className="rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col flex-1 min-h-0">
            {/* Header bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-blue-900/20 border-b border-blue-500/30 shrink-0">
              <div className="flex-1" />
              <span className="text-xs font-mono text-blue-400 bg-black/30 border border-blue-500/30 px-2 py-0.5 rounded">
                {entityTypes.length} ({typeMulti.selected.size})
              </span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {entityTypes.length === 0 && !loading ? (
                <div className="text-center py-12">
                  <Layers className="h-8 w-8 opacity-30 mx-auto mb-3" />
                  <p className="text-white/50 text-sm">No entity types found.</p>
                  <p className="text-white/30 text-xs mt-1">Create a type first, then add entities.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-white/10">
                      <TableHead className="w-12 py-2 px-4">
                        <Checkbox
                          checked={typeMulti.isAllSelected}
                          onCheckedChange={typeMulti.toggleAll}
                        />
                      </TableHead>
                      <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left">Type Name</TableHead>
                      <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left">Description</TableHead>
                      <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left">ID Label</TableHead>
                      <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left">Name Label</TableHead>
                      <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left w-16">Match</TableHead>
                      <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left">Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entityTypes.map((type) => (
                      <TableRow
                        key={type.id}
                        className={`border-b border-white/5 transition-colors cursor-pointer ${
                          typeMulti.selected.has(type.id) ? 'bg-blue-900/20' : 'hover:bg-white/5'
                        }`}
                        onClick={(e) => handleTypeClick(type, e)}
                      >
                        <TableCell className="py-1.5 px-4" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={typeMulti.selected.has(type.id)}
                            onCheckedChange={() => typeMulti.toggleSelection(type.id)}
                          />
                        </TableCell>
                        <TableCell className="py-1.5 px-4 text-xs font-medium text-white/80">
                          {type.type_name}
                        </TableCell>
                        <TableCell className="py-1.5 px-4 text-xs text-white/60">
                          {type.description || <span className="text-white/20">-</span>}
                        </TableCell>
                        <TableCell className="py-1.5 px-4 text-xs text-white/50">
                          {type.id_label || <span className="text-white/20">-</span>}
                        </TableCell>
                        <TableCell className="py-1.5 px-4 text-xs text-white/50">
                          {type.name_label || <span className="text-white/20">-</span>}
                        </TableCell>
                        <TableCell className="py-1.5 px-4">
                          {(() => {
                            const isSensitive = (type.case_match ?? 'insensitive') === 'sensitive';
                            return (
                              <span
                                title={isSensitive ? 'Case-sensitive match (default for entities of this type)' : 'Case-insensitive match (default for entities of this type)'}
                                className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-mono font-medium border ${
                                  isSensitive
                                    ? 'bg-amber-800/15 text-amber-400 border-amber-700/20'
                                    : 'bg-white/5 text-white/20 border-white/5'
                                }`}
                              >
                                {isSensitive ? 'Aa' : 'aa'}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="py-1.5 px-4 text-xs text-white/50">
                          {formatDistanceToNow(new Date(type.created_at), { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ═══════════════════════════════════════════════════════════
          MODALS
         ═══════════════════════════════════════════════════════════ */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={confirmTitle}
        description={confirmDesc}
        onConfirm={handleDeleteConfirmed}
        confirmLabel="Delete"
        variant={confirmVariant}
      />

      <BatchProgressDialog
        open={batchProgressOpen}
        onClose={() => {
          setBatchProgressOpen(false);
          setBatchItems([]);
        }}
        title={batchTitle}
        description={batchDescription}
        items={batchItems}
        operation={batchOperation}
        onComplete={handleBatchComplete}
      />

      <CreateEntityDialog
        open={createEntityOpen}
        onOpenChange={setCreateEntityOpen}
        entityTypes={entityTypes}
        onEntityCreated={fetchAll}
        defaultTypeId={entityTypeFilter !== 'all' ? entityTypeFilter : undefined}
      />

      <CreateEntityTypeDialog
        open={createTypeOpen}
        onOpenChange={setCreateTypeOpen}
        onEntityTypeCreated={fetchAll}
      />

      <ViewEntityDialog
        open={viewEntityOpen}
        onOpenChange={setViewEntityOpen}
        entity={selectedEntity}
        entityTypes={entityTypes}
        onEntityUpdated={fetchAll}
      />

      <ViewEntityTypeDialog
        open={viewTypeOpen}
        onOpenChange={setViewTypeOpen}
        entityType={selectedEntityType}
        onEntityTypeUpdated={fetchAll}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import Entities"
        description="Paste CSV with entity_id, entity_name, entity_type, entity_description, entity_aliases, case_match. entity_type must match an existing type name. Aliases are a packed CSV string. case_match is optional ('insensitive' or 'sensitive')."
        placeholder={`entity_id,entity_name,entity_type,entity_description,entity_aliases,case_match\n"COM-001","Billing System","ac","Strategic billing platform","BS, Billing System, BillingSys","insensitive"\n"COM-002","Finance Gateway","ac","Core finance API","FG, Finance API","sensitive"`}
        parser={(input) => parseEntityImport(input, entityTypes.map((t) => ({ type_name: t.type_name, id: t.id })))}
        onImport={async (item) => {
          await entitiesApi.create({
            type_id: item.data.type_id,
            entity_id: item.data.entity_id,
            name: item.data.entity_name,
            description: item.data.description,
            aliases: item.data.aliases || [],
            case_match: item.data.case_match,
            generated_by: 'import',
          });
        }}
        onDone={() => fetchAll()}
        columns={[
          { key: 'entity_id', label: 'Entity ID', width: '100px' },
          { key: 'entity_name', label: 'Name', width: '140px' },
          { key: 'type_name', label: 'Type', width: '70px' },
          { key: 'description', label: 'Description', width: '200px' },
          { key: 'aliases', label: 'Aliases', width: '140px' },
          { key: 'case_match', label: 'Match', width: '70px' },
        ]}
      />
    </PageShell>
  );
}
