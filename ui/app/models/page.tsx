'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { mentalModelsApi, entitiesApi, ApiError } from '@/lib/api/client';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import type { MentalModel } from '@/lib/types/index';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { ManageModelTagsDialog } from '@/components/manage-model-tags-dialog';
import { ManageModelEntitiesDialog } from '@/components/manage-model-entities-dialog';
import { ManageModelConfigDialog } from '@/components/manage-model-config-dialog';
import { ModelForm } from '@/components/model-form';
import { ModelDetailsDialog } from '@/components/model-details-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Plus, Trash2, RefreshCw, Tag, Search, X, TableIcon, Settings2, LayoutTemplate, MessageSquareText } from 'lucide-react';
import { EntityIcon } from '@/components/icons/entity-icon';
import { toast } from 'sonner';
import { PageShell } from '@/app/components/page-shell';
import type { EntityLike as AqlEntityLike } from '@/components/aql-editor';
import { BadgeExpandIcon } from '@/components/icons/badge-expand-icon';
import { BadgeCompactIcon } from '@/components/icons/badge-compact-icon';
import { Button } from '@/components/ui/button';
import { createLogger } from '@/lib/logger';
import { DerivedModelQueryPreviewDialog } from '@/components/derived-model-query-preview-dialog';
import { SystemTemplateQueryPreviewDialog } from '@/app/contextual-graph/manager/system-template-query-preview-dialog';
import { familyClass } from '@/lib/status-badge';

const logger = createLogger('ModelsPage');

export default function ModelsPage() {
  return (
    <Suspense fallback={
      <PageShell title="Mental Models" loading={true}>
        <div className="rounded-md overflow-hidden bg-surface-card border border-on-dark/[0.08]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg">
            <span className="font-medium text-sm">Mental Models</span>
          </div>
          <div className="py-8 text-center text-foreground-faint">Loading...</div>
        </div>
      </PageShell>
    }>
      <ModelsPageContent />
    </Suspense>
  );
}

function ModelsPageContent() {
  const [models, setModels] = useState<MentalModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [manageTagsDialogOpen, setManageTagsDialogOpen] = useState(false);
  const [manageEntitiesDialogOpen, setManageEntitiesDialogOpen] = useState(false);
  const [manageConfigDialogOpen, setManageConfigDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<MentalModel | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [queryPreviewModel, setQueryPreviewModel] = useState<MentalModel | null>(null);
  const [composePreviewModel, setComposePreviewModel] = useState<MentalModel | null>(null);
  const [composePreviewLoading, setComposePreviewLoading] = useState(false);
  const [composePreviewResult, setComposePreviewResult] = useState<string | null>(null);
  const [composePreviewError, setComposePreviewError] = useState<string | null>(null);
  const [freeze, setFreeze] = useState(false);
  const [compactBadges, setCompactBadges] = useState(false);
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [search, setSearch] = useState('');
  const searchParams = useSearchParams();

  const [availableEntities, setAvailableEntities] = useState<AqlEntityLike[]>([]);
  const [templateRoleOptions, setTemplateRoleOptions] = useState<{ value: string; label: string; derivation_scope: string }[]>([]);
  const [availableTemplateRoles, setAvailableTemplateRoles] = useState<{ value: string; label: string; derivation_scope: string }[]>([]);

  const roleLookup = useMemo(() => {
    const map = new Map<string, { label: string; derivation_scope: string }>();
    for (const role of templateRoleOptions) {
      map.set(role.value, { label: role.label, derivation_scope: role.derivation_scope });
    }
    return map;
  }, [templateRoleOptions]);

  const filteredModels = useMemo(() => {
    let filtered = models;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((m) => {
        const roleInfo = m.template_role ? roleLookup.get(m.template_role) : null;
        return (
          m.id.toString().includes(q) ||
          (m.ext_id && m.ext_id.toLowerCase().includes(q)) ||
          (m.name && m.name.toLowerCase().includes(q)) ||
          (m.source_query && m.source_query.toLowerCase().includes(q)) ||
          (m.template_role && m.template_role.toLowerCase().includes(q)) ||
          (roleInfo?.label.toLowerCase().includes(q)) ||
          (roleInfo?.derivation_scope.toLowerCase().includes(q)) ||
          (m.tags?.some((t) => t.name.toLowerCase().includes(q))) ||
          (m.entities?.some((e) => e.name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q)))
        );
      });
    }
    return filtered;
  }, [models, search, roleLookup]);

  const { selected, toggleSelection, toggleAll, clearSelection } = useMultiSelect(filteredModels);
  const hasSelectedContextualGraphModel = useMemo(() => {
    return Array.from(selected).some((id) => {
      const model = models.find((m) => m.id === id);
      return !!model?.template_role && model.is_contextual_graph_role;
    });
  }, [selected, models]);

  const displayModels = useMemo(() => {
    if (!search.trim()) return filteredModels;
    const visibleIds = new Set(filteredModels.map((item) => item.id));
    const selectedHidden = models.filter((item) => selected.has(item.id) && !visibleIds.has(item.id));
    return [...filteredModels, ...selectedHidden];
  }, [filteredModels, models, search, selected]);

  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      setCreateDialogOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchModels();
    // Load all roles for display/lookup; failure here would hide role labels/scopes in the table.
    mentalModelsApi.listTemplateRoles().then((roles) => {
      setTemplateRoleOptions(roles);
    }).catch((err) => {
      logger.error('Failed to load all template roles for display lookup', { error: err instanceof Error ? err.message : String(err) });
    });
    // Load only assignable roles for the create dropdown.
    mentalModelsApi.listTemplateRoles({ available: true }).then((roles) => {
      setAvailableTemplateRoles(roles);
    }).catch((err) => {
      logger.error('Failed to load available template roles for create dropdown', { error: err instanceof Error ? err.message : String(err) });
    });

    // Load Architxt's own entity catalogue to power [[ completion in source queries.
    entitiesApi.list().then((entities) => {
      setAvailableEntities(entities.map((e) => ({
        id: e.entity_id,
        entity_id: e.entity_id,
        label: e.name,
        type: e.type_name,
      })));
    }).catch((err) => {
      logger.error('Failed to load entities for source-query completion', { error: err instanceof Error ? err.message : String(err) });
    });
  }, []);

  async function fetchModels() {
    try {
      setLoading(true);
      setError(null);
      clearSelection();
      const response = await mentalModelsApi.list({ limit: 1000 });
      setModels(Array.isArray(response) ? response : []);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(String(err), 500, 'CLIENT_ERROR');
      setError(apiErr);
      logger.error('Failed to load mental models', { error: apiErr.message });
    } finally {
      setLoading(false);
    }
  }

  const openDeleteConfirm = () => {
    setDeleteConfirmOpen(true);
  };

  const handleDeleteSelectedConfirmed = async () => {
    const ids = Array.from(selected) as number[];
    try {
      await Promise.all(ids.map((id) => mentalModelsApi.delete(id)));
      toast.success(`Deleted ${ids.length} mental model(s)`);
      clearSelection();
      setDeleteConfirmOpen(false);
      fetchModels();
    } catch (err) {
      toast.error('Failed to delete mental models');
    }
  };

  const handleRowClick = (model: MentalModel) => {
    setSelectedModel(model);
    setDetailsOpen(true);
  };

  const handleViewQuery = async (model: MentalModel, e: React.MouseEvent) => {
    e.stopPropagation();
    if (model.is_template && !model.is_system_template && !model.template_role) {
      setQueryPreviewModel(model);
      return;
    }

    const role = (model.is_system_template || model.template_role)
      ? (model.template_role || model.ext_id)
      : 'generic';
    if (!role) {
      toast.error('Model has no role to compose');
      return;
    }

    setComposePreviewModel(model);
    setComposePreviewLoading(true);
    setComposePreviewResult(null);
    setComposePreviewError(null);

    try {
      const res = await mentalModelsApi.composePreview([
        {
          role,
          template_role: (model.is_system_template || model.template_role) ? role : undefined,
          returns: 'generic',
          source_query: model.source_query || '',
        },
      ]);
      const row = res.results[0];
      if (row?.compose_error) {
        setComposePreviewError(row.compose_error);
      } else {
        setComposePreviewResult(row?.composed_query ?? null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setComposePreviewError(message);
      toast.error(`Failed to compose query: ${message}`);
    } finally {
      setComposePreviewLoading(false);
    }
  };

  const closeQueryPreview = () => {
    setQueryPreviewModel(null);
  };

  const closeComposePreview = () => {
    setComposePreviewModel(null);
    setComposePreviewResult(null);
    setComposePreviewError(null);
  };

  const formatDate = (date?: string | null) => {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-GB');
  };

  const badgeText = (text: string) => {
    if (compactBadges || text.length <= 30) return text;
    return text.slice(0, 30) + '...';
  };

  const isAllSelected = filteredModels.length > 0 && selected.size === filteredModels.length;

  return (
    <>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <PageShell title="Mental Models" loading={loading}>
        {
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search id, ext id, name, source query, tags, entities…"
                className="h-8 pl-7 pr-7 text-xs rounded-full bg-surface-card border-2 border-border-default text-foreground-default placeholder:text-foreground-placeholder focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring-subtle"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-subtle hover:text-foreground-faint"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Button onClick={() => setManageTagsDialogOpen(true)} disabled={selected.size === 0} className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-surface-card border border-accent-primary-bd text-accent-primary-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Tag className="h-3.5 w-3.5" />Tags</Button>
            <Button onClick={() => setManageEntitiesDialogOpen(true)} disabled={selected.size === 0 || hasSelectedContextualGraphModel} title={hasSelectedContextualGraphModel ? 'Entities cannot be attached to contextual graph template roles' : undefined} className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-surface-card border border-accent-primary-bd text-accent-primary-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><EntityIcon className="h-3.5 w-3.5" />Entities</Button>
            <Button onClick={() => setManageConfigDialogOpen(true)} disabled={selected.size === 0} className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-surface-card border border-border-strong text-foreground-muted hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Settings2 className="h-3.5 w-3.5" />Config</Button>
            <div className="flex-1" />
            <div className="w-px h-5 bg-surface-panel mx-1" />
            <Button onClick={fetchModels} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-border-default text-foreground-default hover:bg-surface-hover transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
            <Button onClick={openDeleteConfirm} disabled={selected.size === 0} title="Delete" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-destructive-bd text-destructive-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Trash2 className="h-3.5 w-3.5" /></Button>
            <Button onClick={() => setCreateDialogOpen(true)} title="Add" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-border-default text-foreground-default hover:bg-surface-hover transition-colors"><Plus className="h-3.5 w-3.5" /></Button>
          </div>
        }
        <div className="rounded-md bg-surface-card border border-on-dark/[0.08] flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex items-center justify-end px-3 py-2 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAllBadges(!showAllBadges)}
                title={showAllBadges ? 'Limit to 3 badges' : 'Show all badges'}
                className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", showAllBadges ? "bg-accent-secondary-bg text-accent-secondary-fg border border-accent-secondary-bd" : "text-foreground-subtle hover:text-foreground-faint border border-transparent"].join(" ")}
              >
                <BadgeExpandIcon className="h-5 w-5" />
              </button>
              <button
                onClick={() => setCompactBadges(!compactBadges)}
                title={compactBadges ? 'Expand badges' : 'Compact badges'}
                className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", compactBadges ? "bg-accent-secondary-bg text-accent-secondary-fg border border-accent-secondary-bd" : "text-foreground-subtle hover:text-foreground-faint border border-transparent"].join(" ")}
              >
                <BadgeCompactIcon className="h-5 w-5" />
              </button>
              <button
                onClick={() => setFreeze(!freeze)}
                title={freeze ? 'Unfreeze panes' : 'Freeze panes'}
                className={["inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors", freeze ? "bg-accent-secondary-bg text-accent-secondary-fg border border-accent-secondary-bd" : "text-foreground-subtle hover:text-foreground-faint border border-transparent"].join(" ")}
              >
                <TableIcon className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs font-mono text-accent-secondary-fg bg-surface-inset border border-accent-secondary-bd px-2 py-0.5 rounded">{filteredModels.length} ({selected.size})</span>
            </div>
          </div>

          <div className={["flex-1 overflow-auto", !freeze ? "min-h-0" : ""].filter(Boolean).join(" ")}>
            <table className="w-full caption-bottom text-sm table-fixed">
              <TableHeader>
                <TableRow className="border-b border-border-default">
                  <TableHead className={["w-12 py-1.5 px-4", !freeze && "sticky top-0 left-0 z-30 bg-surface-card border-r border-border-subtle"].filter(Boolean).join(" ")}>
                    <Checkbox checked={isAllSelected} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead className={["w-12 text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>ID</TableHead>
                  <TableHead className={["w-20 text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Template</TableHead>
                  <TableHead className={["w-[16%] text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Template Role</TableHead>
                  <TableHead className={["w-16 text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Scope</TableHead>
                  <TableHead className={["w-[16%] text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>External ID</TableHead>
                  <TableHead className={["w-[16%] text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Name</TableHead>
                  <TableHead className={["text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Entities</TableHead>
                  <TableHead className={["text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Tags</TableHead>
                  <TableHead className={["w-24 text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Tags Match</TableHead>
                  <TableHead className={["w-28 text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Refresh Type</TableHead>
                  <TableHead className={["w-32 text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Refresh After</TableHead>
                  <TableHead className={["w-24 text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Exclude All</TableHead>
                  <TableHead className={["w-24 text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Max Tokens</TableHead>
                  <TableHead className={["w-32 text-xs uppercase text-foreground-faint font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Created</TableHead>
                  <TableHead className={["w-10 text-xs uppercase text-foreground-faint font-medium py-1.5 px-2", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-b border-border-subtle">
                      <TableCell className={["py-1.5 px-4", !freeze && "sticky left-0 z-10 bg-surface-card border-r border-border-subtle"].filter(Boolean).join(" ")}><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-8" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-14" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : displayModels.length === 0 ? (
                  <TableRow>
                  <TableCell colSpan={17} className="text-center py-8 text-foreground-faint">
                      <div className="flex flex-col items-center gap-2">
                        <EntityIcon className="h-8 w-8 opacity-50" />
                        <p>No mental models found.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayModels.map((model) => (
                    <TableRow
                      key={model.id}
                      onClick={() => handleRowClick(model)}
                      className={`border-b border-border-subtle transition-colors cursor-pointer ${
                        selected.has(model.id) ? 'bg-accent-primary-bg' : 'hover:bg-surface-card'
                      }`}
                    >
                      <TableCell className={["py-1.5 px-4", !freeze && `sticky left-0 z-10 border-r border-border-subtle ${selected.has(model.id) ? 'bg-accent-primary-bg' : 'bg-surface-card'}`].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(model.id)}
                          onCheckedChange={() => toggleSelection(model.id)}
                        />
                      </TableCell>
                      <TableCell className="py-1.5 px-4 font-mono text-xs">{model.id}</TableCell>
                      <TableCell className="py-1.5 px-4 text-xs">
                        {model.is_system_template ? (
                          <Badge className="text-[10px] px-2.5 py-1 border inline-flex items-center gap-1 bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd">
                            System
                          </Badge>
                        ) : model.is_template ? (
                          <Badge className="text-[10px] px-2.5 py-1 border inline-flex items-center gap-1 bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd">
                            Template
                          </Badge>
                        ) : (
                          <span className="text-foreground-placeholder">-</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5 px-4 font-mono text-xs text-foreground-default font-semibold">
                        {(() => {
                          const roleInfo = model.template_role ? roleLookup.get(model.template_role) : null;
                          if (!roleInfo) return <span className="text-foreground-placeholder">-</span>;
                          return (
                            <span className="truncate max-w-full inline-block" title={`${model.template_role}`}>
                              {roleInfo.label}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs">
                        {(() => {
                          const roleInfo = model.template_role ? roleLookup.get(model.template_role) : null;
                          if (!roleInfo) return <span className="text-foreground-placeholder">-</span>;
                          const scope = roleInfo.derivation_scope;
                          const scopeClass = 'bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd';
                          return (
                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide border ${scopeClass}`}>
                              {scope.toUpperCase()}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="py-1.5 px-4 font-mono text-xs text-foreground-default font-semibold">
                        <span className="truncate max-w-full inline-block">{model.ext_id || '-'}</span>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs text-foreground-faint">{model.name || '-'}</TableCell>
                      <TableCell className="py-1.5 px-4 text-xs whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {(showAllBadges ? model.entities : model.entities?.slice(0, 3))?.map((e) => {
                            const isHit = search.trim() && (e.name.toLowerCase().includes(search.toLowerCase()) || e.entity_id.toLowerCase().includes(search.toLowerCase()));
                            return (
                              <span
                                key={e.id}
                                className={`${!compactBadges ? 'inline-flex truncate max-w-[100px]' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                                  isHit
                                    ? `${familyClass.entity} ring-1 ring-badge-entity-fg/50`
                                    : familyClass.entity
                                }`}
                                title={`${e.entity_id} — ${e.name}`}
                              >
                                {badgeText(`${e.entity_id} — ${e.name}`)}
                              </span>
                            );
                          })}
                          {!showAllBadges && (model.entities?.length || 0) > 3 && (
                            <span
                              className={`text-[10px] px-1 rounded ${
                                search.trim() && model.entities!.slice(3).some((e) => e.name.toLowerCase().includes(search.toLowerCase()) || e.entity_id.toLowerCase().includes(search.toLowerCase()))
                                  ? 'text-badge-entity-fg bg-badge-entity-bg'
                                  : 'text-foreground-placeholder'
                              }`}
                            >
                              +{model.entities!.length - 3}
                            </span>
                          )}
                          {(!model.entities || model.entities.length === 0) && (
                            <span className="text-foreground-placeholder text-xs">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {(showAllBadges ? model.tags : model.tags?.slice(0, 3))?.map((t) => {
                            const isHit = search.trim() && t.name.toLowerCase().includes(search.toLowerCase());
                            return (
                              <span
                                key={t.id}
                                className={`${!compactBadges ? 'inline-flex truncate max-w-[100px]' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                                  isHit
                                    ? 'bg-accent-primary-bg/80 text-accent-primary-fg border-accent-primary-bd ring-1 ring-accent-primary-fg/50'
                                    : 'bg-accent-primary-bg text-accent-primary-fg border-accent-primary-bd'
                                }`}
                                title={t.name}
                              >
                                {badgeText(t.name)}
                              </span>
                            );
                          })}
                          {!showAllBadges && (model.tags?.length || 0) > 3 && (
                            <span
                              className={`text-[10px] px-1 rounded ${
                                search.trim() && model.tags!.slice(3).some((t) => t.name.toLowerCase().includes(search.toLowerCase()))
                                  ? 'text-accent-primary-fg bg-accent-primary-bg/60'
                                  : 'text-foreground-placeholder'
                              }`}
                            >
                              +{model.tags!.length - 3}
                            </span>
                          )}
                          {(!model.tags || model.tags.length === 0) && (
                            <span className="text-foreground-placeholder text-xs">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs text-foreground-faint">
                        {model.tags_match_mode ?? 'all_strict'}
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd">
                          {model.refresh_mode === 'delta' ? 'Delta' : 'Full'}
                        </span>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                          model.refresh_after_consolidation
                            ? 'bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd'
                            : 'bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd'
                        }`}>
                          {model.refresh_after_consolidation ? 'ON' : 'OFF'}
                        </span>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                          model.exclude_all_mental_models
                            ? 'bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd'
                            : 'bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd'
                        }`}>
                          {model.exclude_all_mental_models ? 'ON' : 'OFF'}
                        </span>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs font-mono text-foreground-faint">
                        {model.max_tokens ?? 2048}
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs text-foreground-subtle">
                        {formatDistanceToNow(new Date(model.created_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="py-1.5 px-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => handleViewQuery(model, e)}
                          title="Preview composed query"
                        >
                          <MessageSquareText className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </table>
          </div>
        </div>
      </PageShell>

      <ManageModelTagsDialog
        isOpen={manageTagsDialogOpen}
        onClose={() => setManageTagsDialogOpen(false)}
        selectedModelIds={useMemo(() => Array.from(selected), [selected])}
        onTagsUpdated={() => {
          clearSelection();
          fetchModels();
        }}
      />

      <ManageModelEntitiesDialog
        isOpen={manageEntitiesDialogOpen}
        onClose={() => setManageEntitiesDialogOpen(false)}
        selectedModelIds={useMemo(() => Array.from(selected), [selected])}
        onEntitiesUpdated={() => {
          clearSelection();
          fetchModels();
        }}
      />

      <ManageModelConfigDialog
        isOpen={manageConfigDialogOpen}
        onClose={() => setManageConfigDialogOpen(false)}
        selectedModelIds={useMemo(() => Array.from(selected), [selected])}
        models={models}
        onConfigUpdated={() => {
          clearSelection();
          fetchModels();
        }}
      />

      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop">
          <div className="bg-surface-card border border-border-default rounded-lg p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-lg font-semibold text-foreground-default mb-2">Delete Selected Models</h2>
            <p className="text-sm text-foreground-faint mb-6">Are you sure you want to delete {selected.size} mental model(s)? This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)} className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card">Cancel</Button>
              <Button onClick={handleDeleteSelectedConfirmed} className="bg-destructive-fg hover:bg-destructive-fg/80 text-foreground-default">Delete</Button>
            </div>
          </div>
        </div>
      )}

      {createDialogOpen && (
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold text-foreground-default">Create Mental Model</DialogTitle>
            </DialogHeader>
            <ModelForm
              mode="create"
              templateRoles={availableTemplateRoles}
              availableEntities={availableEntities}
              availableEdges={[]}
              onSubmit={async (data) => {
                try {
                  await mentalModelsApi.create(data);
                  toast.success('Mental model created');
                  setCreateDialogOpen(false);
                  fetchModels();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to create mental model');
                }
              }}
              onCancel={() => setCreateDialogOpen(false)}
              submitLabel="Create"
            />
          </DialogContent>
        </Dialog>
      )}

      {detailsOpen && selectedModel && (
        <ModelDetailsDialog
          model={selectedModel}
          open={detailsOpen}
          onOpenChange={(open) => {
            setDetailsOpen(open);
            if (!open) setSelectedModel(null);
          }}
          onUpdated={() => {
            setDetailsOpen(false);
            setSelectedModel(null);
            fetchModels();
          }}
          templateRoles={templateRoleOptions}
          availableEntities={availableEntities}
          availableEdges={[]}
        />
      )}

      {queryPreviewModel && (
        <DerivedModelQueryPreviewDialog
          isOpen={!!queryPreviewModel}
          onClose={closeQueryPreview}
          modelId={queryPreviewModel.id}
          derived={[]}
        />
      )}

      <SystemTemplateQueryPreviewDialog
        isOpen={!!composePreviewModel}
        onClose={closeComposePreview}
        refItem={composePreviewModel ? { role: composePreviewModel.template_role || composePreviewModel.ext_id, ext_id: composePreviewModel.ext_id, scope: undefined } : null}
        composedQuery={composePreviewResult}
        composeError={composePreviewError}
        loading={composePreviewLoading}
      />
    </>
  );
}
