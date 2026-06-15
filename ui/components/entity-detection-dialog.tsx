'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, ScanSearch, Check, Undo2, ChevronDown, ChevronUp } from 'lucide-react';
import { entitiesApi, type Entity, documentsApi } from '@/lib/api/client';
import { toast } from 'sonner';
import {
  scanForEntityMatches,
  stripEntityTags,
  insertEntityTags,
  findExistingEntityTags,
  hasEntityTags,
  groupExistingTagsByEntity,
  type MatchGroup,
  type ExistingTagGroup,
} from './entity-scan-panel';
import {
  EntityTaggedContent,
} from './entity-tagged-content';
import { loadFormatRegistry } from '@/lib/entity-tag-format';

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

  // Kick off format registry load (no state needed — getCachedFormat is safe)
  useEffect(() => {
    if (isOpen) {
      loadFormatRegistry().catch(() => { /* silent — default fallback handles it */ });
    }
  }, [isOpen]);

  // Initialise working state when dialog opens — only reset scan state on OPEN, not on content refresh
  useEffect(() => {
    if (isOpen && content) {
      setOriginalContent(content);
      setWorkingContent(content);
    }
  }, [isOpen, content]);

  // Reset scan state only when dialog transitions from closed to open
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setMatchGroups([]);
      setIncludedGroupIds(new Set());
      setExpandedGroups(new Set());
      setIncludedMatchIds(new Set());
      setShowPlainText(false);
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
    const rawEnd = match.rawStartIndex + group.matchedText.length;
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

  const existingTagGroups = useMemo(
    () => groupExistingTagsByEntity(workingContent, existingTags),
    [workingContent, existingTags]
  );

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

  const includedCount = matchGroups.filter((g) => includedGroupIds.has(g.id)).length;
  const totalMatches = matchGroups.reduce((sum, g) => sum + g.matches.length, 0);
  const includedMatches = matchGroups.reduce(
    (sum, g) => sum + g.matches.filter((_, i) => includedMatchIds.has(`${g.id}::${i}`)).length,
    0
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="!w-[85vw] !max-w-none h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">Entity Detection</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 gap-3 overflow-hidden">
          {/* Sidebar — Match Review */}
          <div className="w-[29rem] flex-shrink-0 flex flex-col min-h-0 rounded-lg border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden">
            {/* Header */}
            <div className="px-3 py-2 border-b border-white/10 bg-white/[0.03] flex-shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/60">
                  {entities.length} entities loaded
                </span>
              </div>
              {existingTags.length > 0 && (
                <div className="mt-1.5">
                  <span className="text-[10px] text-white/40">
                    {existingTags.length} existing tag{existingTags.length === 1 ? '' : 's'} in document
                  </span>
                </div>
              )}
              {matchGroups.length > 0 && (
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-white/40">
                    {includedMatches} of {totalMatches} new matches
                  </span>
                  <span className="text-[10px] text-white/40">
                    {includedCount} of {matchGroups.length} groups
                  </span>
                </div>
              )}
            </div>

            {/* Existing Tags panel */}
            {existingTags.length > 0 && (
              <div className="border-b border-white/10 flex-shrink-0 max-h-[40%] flex flex-col">
                <div className="px-3 py-1.5 bg-white/[0.02] flex items-center justify-between">
                  <span className="text-[10px] font-medium text-white/50">Existing Tags</span>
                  <span className="text-[10px] text-white/30">{existingTags.length} occurrence{existingTags.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                  {existingTagGroups.map((group) => (
                    <div
                      key={group.id}
                      className="rounded-md border border-white/10 bg-white/[0.02] hover:border-purple-500/20 hover:bg-purple-900/5 transition-colors"
                    >
                      <div className="flex items-start gap-2 px-2 py-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-medium text-white/80">
                              &ldquo;{group.entityName}&rdquo;
                            </span>
                            <span className="text-[10px] text-white/30">→</span>
                            <span className="text-xs text-purple-300">
                              &ldquo;[[{group.entityName} ({group.id})]]&rdquo;
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-white/40">
                              {group.matches.length} occurrence{group.matches.length !== 1 ? 's' : ''}
                            </span>
                            <span className="text-[10px] text-white/20">·</span>
                            <span className="text-[10px] text-white/40">{group.id}</span>
                            <button
                              onClick={() => toggleGroupExpanded(`existing-${group.id}`)}
                              className="text-[10px] text-white/30 hover:text-white/60 ml-auto flex items-center gap-0.5"
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
                      </div>

                      {expandedGroups.has(`existing-${group.id}`) && (
                        <div className="mt-1.5 space-y-1 px-2 pb-2">
                          {group.matches.map((match, i) => (
                            <div
                              key={i}
                              className="group flex items-start gap-2 text-[10px] text-white/30 pl-2 border-l border-white/10 cursor-pointer hover:text-white/50"
                              onClick={() => handleScrollToExistingMatch(group.id, i)}
                            >
                              <span className="break-all leading-relaxed">
                                {match.lineContext.slice(0, match.lineContext.indexOf(match.text))}
                                <span className="text-purple-300 font-medium">{match.text}</span>
                                {match.lineContext.slice(match.lineContext.indexOf(match.text) + match.text.length)}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveExistingMatch(group.id, i); }}
                                className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-opacity p-0.5 shrink-0"
                                title="Remove this tag"
                              >
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Match groups list */}
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
                matchGroups.map((group) => (
                  <div
                    key={group.id}
                    className={`rounded-md border transition-colors ${
                      includedGroupIds.has(group.id)
                        ? 'bg-purple-900/10 border-purple-500/20'
                        : 'border-white/5 opacity-50'
                    }`}
                  >
                    <div className="flex items-start gap-2 px-2 py-1.5">
                      <Checkbox
                        checked={includedGroupIds.has(group.id)}
                        onCheckedChange={() => toggleGroup(group.id)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium text-white/80">&ldquo;{group.matchedText}&rdquo;</span>
                          <span className="text-[10px] text-white/30">→</span>
                          <span className="text-xs text-purple-300">&ldquo;{group.replacementText}&rdquo;</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] text-white/40">
                            {group.matches.length} occurrence{group.matches.length !== 1 ? 's' : ''}
                          </span>
                          <span className="text-[10px] text-white/20">·</span>
                          <span className="text-[10px] text-white/40">{group.entityId}</span>
                          <button
                            onClick={() => toggleGroupExpanded(group.id)}
                            className="text-[10px] text-white/30 hover:text-white/60 ml-auto flex items-center gap-0.5"
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

                        {expandedGroups.has(group.id) && (
                          <div className="mt-1.5 space-y-1 px-2 pb-1.5">
                            {group.matches.map((match, i) => {
                              const matchId = `${group.id}::${i}`;
                              const isSelected = includedMatchIds.has(matchId);
                              const before = match.lineContext.slice(0, match.lineContext.indexOf(group.matchedText));
                              const after = match.lineContext.slice(match.lineContext.indexOf(group.matchedText) + group.matchedText.length);
                              return (
                                <div
                                  key={matchId}
                                  className={`group flex items-start gap-2 text-[10px] pl-2 border-l border-white/10 cursor-pointer transition-colors ${
                                    isSelected ? 'text-white/60' : 'text-white/30 hover:text-white/50'
                                  }`}
                                  onClick={() => handleScrollToMatch(group.id, i)}
                                >
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => toggleMatch(matchId, group.id)}
                                    className="mt-0.5 shrink-0"
                                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                  />
                                  <span className="break-all leading-relaxed">
                                    {before}
                                    <span className={`font-medium ${isSelected ? 'text-purple-300' : 'text-purple-400/60'}`}>{group.matchedText}</span>
                                    {after}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-white/10 flex items-center justify-end gap-2 flex-shrink-0">
              {existingTags.length > 0 && (
                <Button
                  onClick={handleUndo}
                  className="h-7 px-2.5 text-xs bg-[oklch(0.23_0_0)] border border-red-500/30 text-red-400 hover:bg-[oklch(0.27_0_0)] flex items-center gap-1"
                >
                  <Undo2 className="h-3 w-3" />
                  Remove Tags
                </Button>
              )}
              <Button
                onClick={handleApply}
                disabled={matchGroups.length === 0 || includedMatches === 0}
                className="h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <Check className="h-3 w-3" />
                Insert Tags
              </Button>
              <Button
                onClick={handleScan}
                disabled={entitiesLoading || scanning || entities.length === 0}
                className="h-7 px-2.5 text-xs bg-[oklch(0.27_0_0)] hover:bg-[oklch(0.30_0_0)] text-white/80 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
                Scan
              </Button>
            </div>
          </div>

          {/* Content pane */}
          <div className="flex-1 min-h-0 rounded-lg border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 flex-shrink-0">
              <span className="text-[10px] text-white/40 font-sans">
                {showPlainText ? 'Plain text view' : 'Highlighted entities'}
              </span>
              <button
                onClick={() => setShowPlainText((v) => !v)}
                className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-white/50 hover:text-white/80 hover:border-white/20 transition-colors font-sans"
              >
                {showPlainText ? 'Show Tags' : 'Show Plain'}
              </button>
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
            className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
