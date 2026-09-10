'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, ScanSearch, ChevronDown, ChevronUp, Wrench, Search } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { entitiesApi, type Entity, documentsApi } from '@/lib/api/client';
import { toast } from 'sonner';
import {
  scanForEntityMatches,
  stripEntityTags,
  insertEntityTags,
  findExistingEntityTags,
  groupExistingTagsByEntity,
  repairMalformedEntityTags,
  type MatchGroup,
  type ExistingTagGroup,
} from './entity-scan-panel';
import {
  EntityTaggedContent,
} from './entity-tagged-content';
import { loadFormatRegistry } from '@/lib/entity-tag-format';
import { colorForType } from '@/components/research-canvas';

interface EntityDetectionDialogProps {
  documentId: number;
  content: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function EntityDetectionDialog({
  documentId,
  content,
  isOpen,
  onClose,
  onSaved,
}: EntityDetectionDialogProps) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [matchGroups, setMatchGroups] = useState<MatchGroup[]>([]);
  const [includedGroupIds, setIncludedGroupIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [includedMatchIds, setIncludedMatchIds] = useState<Set<string>>(new Set());
  const [workingContent, setWorkingContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [showPlainText, setShowPlainText] = useState(false);
  const [highlightRange, setHighlightRange] = useState<{ start: number; end: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Kick off format registry load (no state needed — getCachedFormat is safe)
  useEffect(() => {
    if (isOpen) {
      loadFormatRegistry().catch(() => { /* silent — default fallback handles it */ });
    }
  }, [isOpen]);

  // Initialise working state when dialog opens — only set when there is no prior
  // working copy so a parent content refresh does not wipe unsaved changes.
  useEffect(() => {
    if (isOpen && content && workingContent === '' && originalContent === '') {
      setOriginalContent(content);
      setWorkingContent(content);
    }
  }, [isOpen, content, workingContent, originalContent]);

  // Reset scan state only when dialog transitions from closed to open
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setMatchGroups([]);
      setIncludedGroupIds(new Set());
      setExpandedGroups(new Set());
      setIncludedMatchIds(new Set());
      setShowPlainText(false);
      setSearchQuery('');
    }
    wasOpenRef.current = isOpen;
    if (!isOpen) {
      setWorkingContent('');
      setOriginalContent('');
      setMatchGroups([]);
      setIncludedGroupIds(new Set());
      setExpandedGroups(new Set());
      setIncludedMatchIds(new Set());
      setShowPlainText(false);
      setSearchQuery('');
    }
  }, [isOpen]);

  // Load all entities when dialog opens
  useEffect(() => {
    if (isOpen && entities.length === 0) {
      setEntitiesLoading(true);
      entitiesApi
        .list()
        .then((data) => setEntities(data))
        .catch(() => { /* silently fail */ })
        .finally(() => setEntitiesLoading(false));
    }
  }, [isOpen, entities.length]);

  const handleScan = useCallback(() => {
    // Pass the original tagged content to the shared matcher. It builds the clean
    // text internally and marks existing tag inner-text as tagged, so already-tagged
    // entities are not re-proposed as new matches.
    if (entities.length === 0 || !workingContent) return;
    setScanning(true);
    setTimeout(() => {
      const groups = scanForEntityMatches(entities, workingContent);

      // Merge new groups into existing list — preserve prior selections & expanded state
      setMatchGroups((prev) => {
        const existingIds = new Set(prev.map((g) => g.id));
        const merged = [...prev];
        for (const group of groups) {
          if (!existingIds.has(group.id)) {
            merged.push(group);
          }
        }
        return merged;
      });

      // Auto-select newly discovered groups and their individual matches
      setIncludedGroupIds((prev) => {
        const next = new Set(prev);
        for (const group of groups) {
          next.add(group.id);
        }
        return next;
      });
      setIncludedMatchIds((prev) => {
        const next = new Set(prev);
        for (const group of groups) {
          group.matches.forEach((_, i) => next.add(`${group.id}::${i}`));
        }
        return next;
      });

      setScanning(false);
      setActiveSidebarTab('found');
    }, 50);
  }, [entities, workingContent]);

  const toggleGroup = (groupId: string) => {
    setIncludedGroupIds((prev) => {
      const next = new Set(prev);
      const nowSelected = !next.has(groupId);
      if (nowSelected) next.add(groupId);
      else next.delete(groupId);

      // Sync all matches in this group
      const group = matchGroups.find((g) => g.id === groupId);
      if (group) {
        setIncludedMatchIds((mPrev) => {
          const mNext = new Set(mPrev);
          group.matches.forEach((_, i) => {
            const mid = `${groupId}::${i}`;
            if (nowSelected) mNext.add(mid);
            else mNext.delete(mid);
          });
          return mNext;
        });
      }

      return next;
    });
  };

  const toggleGroupExpanded = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // Per-match selection (only when expanded)
  const toggleMatch = (matchId: string, groupId: string) => {
    setIncludedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
      }
      // If any match in this group is selected, ensure group is also selected
      setIncludedGroupIds((gPrev) => {
        const groupSelected = Array.from(next).some((id) => id.startsWith(`${groupId}::`));
        const gNext = new Set(gPrev);
        if (groupSelected) gNext.add(groupId);
        else if (!groupSelected) gNext.delete(groupId);
        return gNext;
      });
      return next;
    });
  };

  const handleScrollToMatch = (groupId: string, matchIdx: number) => {
    const group = matchGroups.find((g) => g.id === groupId);
    if (!group) return;
    const match = group.matches[matchIdx];
    if (!match) return;

    setShowPlainText(false);

    // Compute raw end: rawStartIndex + matchedText.length in clean text
    const rawEnd = match.rawEndIndex;
    setHighlightRange({ start: match.rawStartIndex, end: rawEnd });
  };

  const handleApply = () => {
    // Filter to only matches that are individually selected
    const groupsToApply = matchGroups
      .filter((g) => includedGroupIds.has(g.id))
      .map((g) => ({
        ...g,
        matches: g.matches.filter((_, i) => includedMatchIds.has(`${g.id}::${i}`)),
      }))
      .filter((g) => g.matches.length > 0);

    if (groupsToApply.length === 0) {
      toast.info('No matches selected to apply');
      return;
    }

    const appliedIds = new Set(groupsToApply.map((g) => g.id));
    const tagged = insertEntityTags(workingContent, groupsToApply, appliedIds);
    const appliedCount = groupsToApply.reduce((sum, g) => sum + g.matches.length, 0);

    setWorkingContent(tagged);
    setHighlightRange(null); // clear highlight — offsets are now invalid

    // Remove applied groups from the list; keep unchecked ones for re-scan / further work
    setMatchGroups((prev) => prev.filter((g) => !appliedIds.has(g.id)));
    setIncludedGroupIds(new Set());
    setIncludedMatchIds(new Set());

    toast.success(`${appliedCount} entity tag${appliedCount === 1 ? '' : 's'} applied`);
  };

  const handleUndo = () => {
    const stripped = stripEntityTags(workingContent);
    if (stripped === workingContent) {
      toast.info('No entity tags to remove');
      return;
    }
    setWorkingContent(stripped);
    setHighlightRange(null); // clear highlight — offsets invalidated
    toast.info('Entity markup removed');
  };

  const handleRepairMalformed = () => {
    if (malformedTags.length === 0) return;
    const repaired = repairMalformedEntityTags(workingContent);
    setWorkingContent(repaired);
    setHighlightRange(null); // clear highlight — offsets invalidated
    toast.info(`${malformedTags.length} malformed tag${malformedTags.length === 1 ? '' : 's'} repaired`);
  };

  const hasChanges = useMemo(
    () => workingContent !== originalContent,
    [workingContent, originalContent]
  );

  const handleSave = useCallback(async () => {
    if (!hasChanges) {
      toast.info('No changes to save');
      return;
    }
    setIsSaving(true);
    try {
      await documentsApi.update(documentId, { content: workingContent || null });
      toast.success('Entity markup saved');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [documentId, workingContent, hasChanges, onSaved, onClose]);

  // Count existing entity tags already in the working content
  const existingTags = useMemo(
    () => findExistingEntityTags(workingContent),
    [workingContent]
  );

  const malformedTags = useMemo(
    () => existingTags.filter((t) => !t.isValid),
    [existingTags]
  );

  const entityById = useMemo(() => {
    const map = new Map<number, Entity>();
    for (const e of entities) map.set(e.id, e);
    return map;
  }, [entities]);

  const entityByEntityId = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const e of entities) map.set(e.entity_id, e);
    return map;
  }, [entities]);

  const existingTagGroups = useMemo(
    () => groupExistingTagsByEntity(workingContent, existingTags),
    [workingContent, existingTags]
  );

  const validExistingTagCount = useMemo(
    () => existingTagGroups.reduce((sum, g) => sum + g.matches.length, 0),
    [existingTagGroups]
  );

  const formatExistingTag = useCallback((group: ExistingTagGroup) => {
    let entity: Entity | undefined;
    if (/^\d+$/.test(group.id)) {
      entity = entityById.get(parseInt(group.id, 10));
    }
    if (!entity) {
      entity = entityByEntityId.get(group.id) ?? entityByEntityId.get(group.entityName);
    }
    const typeName = entity?.type_name;
    const entityId = entity?.entity_id;
    if (typeName && entityId) return `${typeName}:${entityId}`;
    if (entityId) return entityId;
    if (typeName) return typeName;
    return group.id;
  }, [entityById, entityByEntityId]);

  const entityTypeColor = useCallback((group: ExistingTagGroup) => {
    let entity: Entity | undefined;
    if (/^\d+$/.test(group.id)) {
      entity = entityById.get(parseInt(group.id, 10));
    }
    if (!entity) {
      entity = entityByEntityId.get(group.id) ?? entityByEntityId.get(group.entityName);
    }
    return colorForType(entity?.type_name ?? null);
  }, [entityById, entityByEntityId]);

  const handleScrollToExistingMatch = (groupId: string, matchIdx: number) => {
    const group = existingTagGroups.find((g) => g.id === groupId);
    if (!group) return;
    const match = group.matches[matchIdx];
    if (!match) return;

    setShowPlainText(false);
    setHighlightRange({ start: match.start, end: match.end });
  };

  const handleRemoveExistingMatch = (groupId: string, matchIdx: number) => {
    const group = existingTagGroups.find((g) => g.id === groupId);
    if (!group) return;
    const match = group.matches[matchIdx];
    if (!match) return;

    // Remove only this tag from workingContent
    const before = workingContent.slice(0, match.start);
    const after = workingContent.slice(match.end);
    setWorkingContent(before + match.text + after);
    toast.info(`Removed tag for "${match.text}"`);
  };

  const includedMatches = useMemo(() => matchGroups.reduce(
    (sum, g) => sum + g.matches.filter((_, i) => includedMatchIds.has(`${g.id}::${i}`)).length,
    0
  ), [matchGroups, includedMatchIds]);
  const includedGroupsCount = useMemo(
    () => matchGroups.filter((g) => includedGroupIds.has(g.id)).length,
    [matchGroups, includedGroupIds]
  );
  const totalMatches = useMemo(() => matchGroups.reduce((sum, g) => sum + g.matches.length, 0), [matchGroups]);
  const filteredExistingGroups = useMemo(() => {
    if (!searchQuery.trim()) return existingTagGroups;
    const q = searchQuery.toLowerCase();
    return existingTagGroups.filter((g) => g.entityName.toLowerCase().includes(q));
  }, [existingTagGroups, searchQuery]);

  const filteredMatchGroups = useMemo(() => {
    if (!searchQuery.trim()) return matchGroups;
    const q = searchQuery.toLowerCase();
    return matchGroups.filter((g) => g.entityName.toLowerCase().includes(q));
  }, [matchGroups, searchQuery]);

  const [activeSidebarTab, setActiveSidebarTab] = useState<'existing' | 'found'>('existing');

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="!w-[85vw] !max-w-none h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">Entity Detection</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 gap-3 overflow-hidden">
          {/* Sidebar — Match Review */}
          <div className="w-[29rem] flex-shrink-0 flex flex-col min-h-0 rounded-lg border border-white/10 bg-surface-overlay overflow-hidden">
            {/* Header */}
            <div className="px-3 py-2 border-b border-white/10 bg-white/[0.03] flex-shrink-0">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-white/60 shrink-0">
                  {entities.length} entities loaded
                </span>
                <div className="relative flex-1 max-w-[14rem]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-white/30" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search entities..."
                    className="w-full h-7 pl-7 pr-2 rounded-md bg-white/5 border border-white/10 text-xs text-white/80 placeholder:text-white/30 focus:outline-none focus:border-white/20"
                  />
                </div>
              </div>
              {matchGroups.length > 0 && (
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-white/40">
                    {includedMatches} of {totalMatches} new matches
                  </span>
                  <span className="text-[10px] text-white/40">
                    {includedGroupsCount} of {matchGroups.length} groups
                  </span>
                </div>
              )}
            </div>

            <Tabs
              value={activeSidebarTab}
              onValueChange={(v) => setActiveSidebarTab(v as 'existing' | 'found')}
              className="flex-1 min-h-0 overflow-hidden"
            >
              <TabsList className="w-full m-1 bg-white/5 rounded-lg h-9" variant="default">
                <TabsTrigger
                  value="existing"
                  className="flex-1 text-xs font-medium text-white/50 data-active:bg-white/10 data-active:text-white rounded-md"
                >
                  Existing
                  {validExistingTagCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0 text-[10px] text-white/60">
                      {validExistingTagCount}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="found"
                  className="flex-1 text-xs font-medium text-white/50 data-active:bg-white/10 data-active:text-white rounded-md"
                >
                  Found
                  {matchGroups.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0 text-[10px] text-white/60">
                      {totalMatches}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="existing" className="flex-1 min-h-0 overflow-hidden flex flex-col p-0 m-0" keepMounted>
                {existingTagGroups.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-white/30 text-xs italic p-4">
                    No existing entity tags
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                    {[...filteredExistingGroups].sort((a, b) =>
                      a.entityName.localeCompare(b.entityName)
                    ).map((group) => {
                      const typeColor = entityTypeColor(group);
                      return (
                        <div
                          key={group.id}
                          className="group flex flex-col gap-1 rounded border bg-black/10 px-2 py-1.5 text-left transition-colors cursor-pointer border-white/5 hover:bg-white/5"
                          style={{ borderLeftColor: typeColor, borderLeftWidth: 3 }}
                          onClick={() => toggleGroupExpanded(`existing-${group.id}`)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs text-white/90 truncate">{group.entityName.length > 80 ? `${group.entityName.slice(0, 80)}…` : group.entityName}</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] text-white/40 shrink-0">
                                {group.matches.length} occurrence{group.matches.length !== 1 ? 's' : ''}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleGroupExpanded(`existing-${group.id}`); }}
                                className="text-[10px] text-white/30 hover:text-white/60 flex items-center gap-0.5"
                              >
                                {expandedGroups.has(`existing-${group.id}`) ? (
                                  <>
                                    Collapse <ChevronUp className="h-3 w-3" />
                                  </>
                                ) : (
                                  <>
                                    Expand <ChevronDown className="h-3 w-3" />
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-white/40 truncate pr-2">{formatExistingTag(group)}</span>
                          </div>

                          {expandedGroups.has(`existing-${group.id}`) && (
                            <div className="mt-1.5 space-y-1">
                              {group.matches.map((match, i) => {
                                const displayContext = match.lineContext;
                                const idx = displayContext.indexOf(match.text);
                                const before = idx >= 0 ? displayContext.slice(0, idx) : displayContext;
                                const after = idx >= 0 ? displayContext.slice(idx + match.text.length) : '';
                                return (
                                  <div
                                    key={i}
                                    className="group/match rounded border border-white/[0.06] bg-[oklch(0.17_0_0)] px-2 py-1.5 flex items-start gap-2 text-[11px] text-white/60 cursor-pointer hover:border-white/10 hover:bg-[oklch(0.19_0_0)] transition-colors"
                                    onClick={(e) => { e.stopPropagation(); handleScrollToExistingMatch(group.id, i); }}
                                  >
                                    <span className="break-all leading-relaxed line-clamp-3">
                                      {before}
                                      <span className="text-purple-500 font-semibold">{match.text}</span>
                                      {after}
                                    </span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleRemoveExistingMatch(group.id, i); }}
                                      className="opacity-0 group-hover/match:opacity-100 text-white/30 hover:text-destructive-fg transition-opacity p-0.5 shrink-0 mt-0.5"
                                      title="Remove this tag"
                                    >
                                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="found" className="flex-1 min-h-0 overflow-hidden flex flex-col p-0 m-0" keepMounted>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                  {entitiesLoading && matchGroups.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-white/30">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      <span className="text-xs">Loading entities...</span>
                    </div>
                  ) : matchGroups.length === 0 ? (
                    <p className="text-xs text-white/30 italic p-2 text-center">
                      {scanning ? 'Scanning...' : 'Click Scan to find entity matches'}
                    </p>
                  ) : (
                    [...filteredMatchGroups].sort((a, b) =>
                      a.entityName.localeCompare(b.entityName)
                    ).map((group) => (
                      <div
                        key={group.id}
                        className="group flex items-start gap-2 rounded border bg-black/10 px-2 py-1.5 text-left transition-colors cursor-pointer border-white/5 hover:bg-white/5"
                        style={{ borderLeftColor: colorForType(group.entityType), borderLeftWidth: 3 }}
                        onClick={() => toggleGroupExpanded(group.id)}
                      >
                        <Checkbox
                          checked={includedGroupIds.has(group.id)}
                          onCheckedChange={() => toggleGroup(group.id)}
                          className="mt-0.5 shrink-0"
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        />
                        <div className="flex-1 min-w-0 flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs text-white/90 truncate">{group.entityName.length > 80 ? `${group.entityName.slice(0, 80)}…` : group.entityName}</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] text-white/40 shrink-0">
                                {group.matches.length} occurrence{group.matches.length !== 1 ? 's' : ''}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleGroupExpanded(group.id); }}
                                className="text-[10px] text-white/30 hover:text-white/60 flex items-center gap-0.5"
                              >
                                {expandedGroups.has(group.id) ? (
                                  <>
                                    Collapse <ChevronUp className="h-3 w-3" />
                                  </>
                                ) : (
                                  <>
                                    Expand <ChevronDown className="h-3 w-3" />
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-white/40 truncate pr-2">
                              {group.entityType && group.entityId ? `${group.entityType}:${group.entityId}` : group.entityId}
                            </span>
                          </div>

                          {expandedGroups.has(group.id) && (
                            <div className="mt-1.5 space-y-1">
                              {group.matches.map((match, i) => {
                                const matchId = `${group.id}::${i}`;
                                const isSelected = includedMatchIds.has(matchId);
                                const displayContext = match.lineContext;
                                const idx = displayContext.indexOf(group.matchedText);
                                const before = idx >= 0 ? displayContext.slice(0, idx) : displayContext;
                                const after = idx >= 0 ? displayContext.slice(idx + group.matchedText.length) : '';
                                return (
                                  <div
                                    key={matchId}
                                    className="group/match rounded border border-white/[0.06] bg-[oklch(0.17_0_0)] px-2 py-1.5 flex items-start gap-2 text-[11px] text-white/60 cursor-pointer hover:border-white/10 hover:bg-[oklch(0.19_0_0)] transition-colors"
                                    onClick={(e) => { e.stopPropagation(); handleScrollToMatch(group.id, i); }}
                                  >
                                    <Checkbox
                                      checked={isSelected}
                                      onCheckedChange={() => toggleMatch(matchId, group.id)}
                                      className="mt-0.5 shrink-0"
                                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                    />
                                    <span className="break-all leading-relaxed line-clamp-3">
                                      {before}
                                      <span className="font-semibold text-purple-500">{group.matchedText}</span>
                                      {after}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>
            </Tabs>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-white/10 flex items-center justify-end gap-2 flex-shrink-0">
              {existingTags.length > 0 && (
                <Button
                  onClick={handleUndo}
                  className="h-7 px-2.5 text-xs bg-surface-card border border-destructive-bd text-destructive-fg hover:bg-surface-hover"
                >
                  Remove Tags
                </Button>
              )}
              {malformedTags.length > 0 && (
                <Button
                  onClick={handleRepairMalformed}
                  className="h-7 px-2.5 text-xs bg-badge-caution-fg/20 border border-badge-caution-bd text-badge-caution-fg hover:bg-badge-caution-fg/30 flex items-center gap-1"
                >
                  <Wrench className="h-3 w-3" />
                  Repair {malformedTags.length} malformed
                </Button>
              )}
              <Button
                onClick={handleApply}
                disabled={matchGroups.length === 0 || includedMatches === 0}
                className="h-7 px-2.5 text-xs bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Insert Tags
              </Button>
              <Button
                onClick={handleScan}
                disabled={entitiesLoading || scanning || entities.length === 0}
                className="h-7 px-2.5 text-xs bg-surface-hover hover:bg-[oklch(0.30_0_0)] text-white/80 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
                Scan
              </Button>
            </div>
          </div>

          {/* Content pane */}
          <div className="flex-1 min-h-0 rounded-lg border border-white/10 bg-surface-overlay overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 flex-shrink-0">
              <span className="text-[10px] text-white/40 font-sans">
                {showPlainText ? 'Plain text view' : 'Highlighted entities'}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowPlainText((v) => !v)}
                  className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-white/50 hover:text-white/80 hover:border-white/20 transition-colors font-sans"
                >
                  {showPlainText ? 'Show Tags' : 'Show Plain'}
                </button>
              </div>
            </div>
            <div className="flex-1 p-3 overflow-y-auto custom-scrollbar font-mono text-[13px] leading-relaxed">
              {showPlainText ? (
                <pre className="whitespace-pre-wrap text-white/80">{workingContent}</pre>
              ) : (
                <EntityTaggedContent content={workingContent} highlightRange={highlightRange} />
              )}
            </div>
          </div>
        </div>

        {/* Actions bar */}
        <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-white/60 hover:text-white hover:bg-white/5"
          >
            Close
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
