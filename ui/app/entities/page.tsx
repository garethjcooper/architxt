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
  Settings2,
  FileText,
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
import { ManageEntityConfigDialog } from '@/components/manage-entity-config-dialog';
import { EntityDocumentsDialog } from '@/components/entity-documents-dialog';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import { formatEntityIdPattern } from '@/lib/entity-id-pattern';
import { familyClass } from '@/lib/status-badge';

const logger = createLogger('EntitiesPage');

export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── Shared modals ── */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmDesc, setConfirmDesc] = useState('');
  const [confirmVariant, setConfirmVariant] = useState<'destructive' | 'default'>('destructive');
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
  const [manageConfigDialogOpen, setManageConfigDialogOpen] = useState(false);

  /* ── Freeze panes state ── */
  const [freeze, setFreeze] = useState(false);

  /* ── Entity Types tab state ── */
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [selectedEntityType, setSelectedEntityType] = useState<EntityType | null>(null);
  const [viewTypeOpen, setViewTypeOpen] = useState(false);
  const [entityDocumentsOpen, setEntityDocumentsOpen] = useState(false);

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
      toast.success(`${succeeded} item${succeeded !== 1 ? 's' : ''} updated`);
    } else if (succeeded === 0) {
      toast.error(`All ${failed} operations failed`);
    } else {
      toast.warning(`${succeeded} updated, ${failed} failed`);
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
              className="h-8 rounded-md border border-white/10 bg-surface-card px-2.5 text-sm text-white/80 focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle outline-none"
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
                className="h-8 pl-7 pr-7 text-xs rounded-full bg-white/5 border-2 border-white/10 text-white placeholder:text-white/30 focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring-subtle"
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

            <Button
              onClick={() => setManageConfigDialogOpen(true)}
              disabled={entityMulti.selected.size === 0}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-surface-card border border-white/20 text-white/80 hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Settings2 className="h-3.5 w-3.5" />Config
            </Button>

            <Button
              onClick={() => setEntityDocumentsOpen(true)}
              disabled={entityMulti.selected.size === 0}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-surface-card border border-white/20 text-white/80 hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText className="h-3.5 w-3.5" />Documents
            </Button>

            <div className="flex-1" />
            <div className="w-px h-5 bg-white/10 mx-1" />

            <Button onClick={() => setImportOpen(true)} title="Import" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-white/10 text-white hover:bg-surface-hover transition-colors"><Download className="h-3.5 w-3.5" /></Button>
            <Button onClick={fetchAll} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-white/10 text-white hover:bg-surface-hover transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
            <Button
              onClick={openDeleteEntities}
              disabled={entityMulti.selected.size === 0}
              className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-red-500/30 text-red-400 hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => setCreateEntityOpen(true)}
              className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-white/10 text-white hover:bg-surface-hover transition-colors"
              title="Add"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Table card */}
          <div className={[
            "rounded-md bg-surface-card border border-white/[0.08] flex flex-col flex-1 min-h-0 overflow-hidden",
            !freeze ? "max-h-[calc(100vh-240px)]" : "",
          ].filter(Boolean).join(" ")}>
            {/* Header bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-accent-primary-bg border-b border-accent-primary-bd shrink-0">
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFreeze(!freeze)}
                  title={!freeze ? 'Unfreeze panes' : 'Freeze panes'}
                  className={["inline-flex items-center justify-center h-6 w-6 rounded transition-colors", !freeze ? "bg-accent-primary-bg text-accent-primary-fg border border-accent-primary-bd" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
                >
                  <TableIcon className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs font-mono text-accent-primary-fg bg-black/30 border border-accent-primary-bd px-2 py-0.5 rounded">
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
                      <TableHead className={["w-12 py-2 px-4", !freeze && "sticky top-0 left-0 z-30 bg-surface-card border-r border-white/5"].filter(Boolean).join(" ")}>
                        <Checkbox
                          checked={entityMultiAll}
                          onCheckedChange={toggleEntityMultiAll}
                        />
                      </TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Entity ID</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left w-20", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Pattern</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Name</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Type</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left w-16", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Case</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left w-16", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Boundary</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Documents</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Aliases</TableHead>
                      <TableHead className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayEntities.map((item) => (
                      <TableRow
                        key={item.id}
                        className={`border-b border-white/5 transition-colors cursor-pointer ${
                          entityMulti.selected.has(item.id) ? 'bg-accent-primary-bg' : 'hover:bg-white/5'
                        }`}
                        onClick={() => handleEntityClick(item)}
                      >
                        <TableCell className={["py-1.5 px-4", !freeze && `sticky left-0 z-10 border-r border-white/5 ${entityMulti.selected.has(item.id) ? 'bg-accent-primary-bg' : 'bg-surface-card'}`].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={entityMulti.selected.has(item.id)}
                            onCheckedChange={() => entityMulti.toggleSelection(item.id)}
                          />
                        </TableCell>
                        <TableCell className="py-1.5 px-4 text-xs text-white/50 font-mono">{item.entity_id}</TableCell>
                        <TableCell className="py-1.5 px-4 text-xs font-mono text-white/70">
                          {(() => {
                            const type = entityTypes.find((t) => t.id === item.type_id);
                            if (!type?.uses_entity_id_pattern) {
                              return <span className="text-white/20 text-[10px]">-</span>;
                            }
                            return <span title={formatEntityIdPattern(type)}>{formatEntityIdPattern(type)}</span>;
                          })()}
                        </TableCell>
                        <TableCell className="py-1.5 px-4">
                          <span
                            className={`${familyClass.entity} text-[10px]`}
                            title={item.name}
                          >
                            {item.name}
                          </span>
                        </TableCell>
                        <TableCell className="py-1.5 px-4 text-xs text-white/70">
                          {entityTypeName(item.type_id)}
                        </TableCell>
                        <TableCell className="py-1.5 px-4">
                          {(() => {
                            const entityValue = item.case_match ?? 'insensitive';
                            const typeValue = item.type_case_match ?? 'insensitive';
                            const isSensitive = entityValue === 'sensitive';
                            const differs = entityValue !== typeValue;
                            return (
                              <span
                                title={differs ? `Entity override — entity type: case-${typeValue}` : `Case-${isSensitive ? 'sensitive' : 'insensitive'} match`}
                                className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-mono font-medium border ${
                                  isSensitive
                                    ? 'bg-accent-secondary-bg text-accent-secondary-fg border-accent-secondary-bd'
                                    : 'bg-white/5 text-white/40 border-white/10'
                                } ${differs ? 'ring-1 ring-accent-secondary-fg/40' : ''}`}
                              >
                                {isSensitive ? 'Aa' : 'aa'}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="py-1.5 px-4">
                          {(() => {
                            const entityValue = item.word_boundary_match ?? 'boundaries';
                            const typeValue = item.type_word_boundary_match ?? 'boundaries';
                            const hasBoundaries = entityValue === 'boundaries';
                            const differs = entityValue !== typeValue;
                            const typeLabel = typeValue === 'boundaries' ? 'whole-word' : 'no boundaries';
                            return (
                              <span
                                title={differs ? `Entity override — entity type: ${typeLabel}` : `${hasBoundaries ? 'Whole-word' : 'No boundaries'} match`}
                                className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-mono font-medium border ${
                                  !hasBoundaries
                                    ? 'bg-diff-differ-bg text-diff-differ-fg border-diff-differ-bd'
                                    : 'bg-white/5 text-white/40 border-white/10'
                                } ${differs ? 'ring-1 ring-diff-differ-fg/40' : ''}`}
                              >
                                {hasBoundaries ? '∂' : '∞'}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="py-1.5 px-4">
                          {item.usage_count ? (
                            <span className="text-white/70 text-[10px]">
                              {item.usage_count} document{item.usage_count !== 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="text-white/20 text-[10px]">-</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 px-4">
                          {item.aliases.length > 0 ? (
                            (() => {
                              const full = item.aliases.join(', ');
                              const isHit = entitySearch.trim() && item.aliases.some((a) => a.toLowerCase().includes(entitySearch.toLowerCase()));
                              const truncated = full.length > 50 ? full.slice(0, 50).replace(/,\s*[^,]*$/, '') + '…' : full;
                              return (
                                <span
                                  title={full}
                                  className={`text-[10px] ${isHit ? 'text-badge-entity-fg' : 'text-white/60'}`}
                                >
                                  {truncated}
                                </span>
                              );
                            })()
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
            <Button onClick={fetchAll} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-white/10 text-white hover:bg-surface-hover transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
            <Button
              onClick={openDeleteTypes}
              disabled={typeMulti.selected.size === 0}
              className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-red-500/30 text-red-400 hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => setCreateTypeOpen(true)}
              className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-white/10 text-white hover:bg-surface-hover transition-colors"
              title="Add"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Table card */}
          <div className="rounded-md overflow-hidden bg-surface-card border border-white/[0.08] flex flex-col flex-1 min-h-0">
            {/* Header bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-accent-primary-bg border-b border-accent-primary-bd shrink-0">
              <div className="flex-1" />
              <span className="text-xs font-mono text-accent-primary-fg bg-black/30 border border-accent-primary-bd px-2 py-0.5 rounded">
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
                      <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left w-20">Pattern</TableHead>
                      <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left w-16">Case</TableHead>
                      <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left w-16">Boundary</TableHead>
                      <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left">Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entityTypes.map((type) => (
                      <TableRow
                        key={type.id}
                        className={`border-b border-white/5 transition-colors cursor-pointer ${
                          typeMulti.selected.has(type.id) ? 'bg-accent-primary-bg' : 'hover:bg-white/5'
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
                        <TableCell className="py-1.5 px-4">
                          {type.uses_entity_id_pattern ? (
                            (() => {
                              const sep = type.id_separator === '-' ? '-' : '';
                              const digits = Math.min(type.min_id_digits ?? 3, 6);
                              const placeholder = '0'.repeat(digits);
                              return (
                                <span
                                  title={`${placeholder.length} digit(s)`}
                                  className="inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-mono font-medium border bg-accent-primary-bg text-accent-primary-fg border-accent-primary-bd"
                                >
                                  {type.id_format_prefix || ''}{sep}{placeholder}
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-white/20 text-xs">-</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 px-4">
                          {(() => {
                            const isSensitive = (type.case_match ?? 'insensitive') === 'sensitive';
                            return (
                              <span
                                title={isSensitive ? 'Case-sensitive match (default for entities of this type)' : 'Case-insensitive match (default for entities of this type)'}
                                className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-mono font-medium border ${
                                  isSensitive
                                    ? 'bg-accent-secondary-bg text-accent-secondary-fg border-accent-secondary-bd'
                                    : 'bg-white/5 text-white/20 border-white/5'
                                }`}
                              >
                                {isSensitive ? 'Aa' : 'aa'}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="py-1.5 px-4">
                          {(() => {
                            const hasBoundaries = (type.word_boundary_match ?? 'boundaries') === 'boundaries';
                            return (
                              <span
                                title={hasBoundaries ? 'Respects word boundaries (default)' : 'Substring match'}
                                className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-mono font-medium border ${
                                  hasBoundaries
                                    ? 'bg-white/5 text-white/20 border-white/5'
                                    : 'bg-diff-differ-bg text-diff-differ-fg border-diff-differ-bd'
                                }`}
                              >
                                {hasBoundaries ? '∂' : '∞'}
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

      <ViewEntityDialog
        open={viewEntityOpen}
        onOpenChange={setViewEntityOpen}
        entity={selectedEntity}
        entityTypes={entityTypes}
        onEntityUpdated={fetchAll}
      />

      <CreateEntityTypeDialog
        open={createTypeOpen}
        onOpenChange={setCreateTypeOpen}
        onEntityTypeCreated={fetchAll}
      />

      <ViewEntityTypeDialog
        entityType={selectedEntityType}
        open={viewTypeOpen}
        onOpenChange={setViewTypeOpen}
        onEntityTypeUpdated={fetchAll}
      />

      <ManageEntityConfigDialog
        isOpen={manageConfigDialogOpen}
        onClose={() => setManageConfigDialogOpen(false)}
        selectedEntityIds={useMemo(() => Array.from(entityMulti.selected), [entityMulti.selected])}
        entities={entities}
        entityTypes={entityTypes}
        onConfigUpdated={() => {
          entityMulti.clearSelection();
          fetchAll();
        }}
      />

      <EntityDocumentsDialog
        isOpen={entityDocumentsOpen}
        onClose={() => setEntityDocumentsOpen(false)}
        selectedEntityIds={useMemo(() => Array.from(entityMulti.selected), [entityMulti.selected])}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import Entities"
        description="Paste CSV with entity_id, entity_name, entity_type, entity_description, entity_aliases, case_match, word_boundary_match. entity_type must match an existing type name. Aliases are a packed CSV string. case_match and word_boundary_match are optional ('insensitive'/'sensitive' and 'boundaries'/'no-boundaries')."
        placeholder={`entity_id,entity_name,entity_type,entity_description,entity_aliases,case_match,word_boundary_match\n"COM-001","Billing System","ac","Strategic billing platform","BS, Billing System, BillingSys","insensitive","boundaries"\n"COM-002","Finance Gateway","ac","Core finance API","FG, Finance API","sensitive","no-boundaries"`}
        parser={(input) => parseEntityImport(input, entityTypes.map((t) => ({ type_name: t.type_name, id: t.id })))}
        onImport={async (item) => {
          await entitiesApi.create({
            type_id: item.data.type_id,
            entity_id: item.data.entity_id,
            name: item.data.entity_name,
            description: item.data.description,
            aliases: item.data.aliases || [],
            case_match: item.data.case_match,
            word_boundary_match: item.data.word_boundary_match,
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
          { key: 'case_match', label: 'Case', width: '60px' },
          { key: 'word_boundary_match', label: 'Boundary', width: '60px' },
        ]}
      />
    </PageShell>
  );
}
