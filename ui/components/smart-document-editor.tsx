'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Loader2, FileText, Undo2, Hash, Image, Trash2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { documentsApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { ImageReviewModal, extractImageDescription } from './image-review-modal';
import { stripEntityTags } from './entity-scan-panel';
import { getActiveRegex } from '@/lib/entity-tag-format';

export interface SmartBlock {
  id: string;
  type: 'text' | 'heading' | 'image';
  raw: string;        // original, never changes
  edited?: string;    // working copy, any block can have one
  deleted?: boolean;
  level?: number;
  title?: string;
}

export function parseBlocks(content: string): SmartBlock[] {
  const blocks: SmartBlock[] = [];
  const lines = content.split(/\n/);
  let textBuffer: string[] = [];
  let blockId = 0;

  const flushText = () => {
    if (textBuffer.length) {
      blocks.push({ id: `b${blockId++}`, type: 'text', raw: textBuffer.join('\n') + '\n' });
      textBuffer = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    const imageOpenMatch = line.match(/^\[IMAGE:([^\]]+)\]$/);

    if (headingMatch) {
      flushText();
      blocks.push({
        id: `b${blockId++}`,
        type: 'heading',
        raw: line + '\n',
        level: headingMatch[1].length,
        title: headingMatch[2],
      });
      i++;
    } else if (imageOpenMatch) {
      flushText();
      const imageId = imageOpenMatch[1];
      const imageLines: string[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const closeMatch = lines[j].match(
          new RegExp(`^\\[/IMAGE:${imageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]$`)
        );
        imageLines.push(lines[j]);
        if (closeMatch) break;
        j++;
      }
      blocks.push({
        id: `b${blockId++}`,
        type: 'image',
        raw: imageLines.join('\n') + '\n',
        title: imageId,
      });
      i = j + 1;
    } else {
      textBuffer.push(line);
      i++;
    }
  }
  flushText();
  return blocks;
}

function buildContent(blocks: SmartBlock[]): string {
  return blocks.filter(b => !b.deleted).map(b => b.edited ?? b.raw).join('');
}

/** Check whether a saved block array still matches the current content string.
 *  Returns false if content changed externally (reprocess, manual edit), so we re-parse fresh.
 */
function blocksMatchContent(blocks: any[], content: string): boolean {
  try {
    const rebuilt = (blocks as SmartBlock[]).filter(b => !b.deleted).map(b => b.edited ?? b.raw).join('');
    return rebuilt === content;
  } catch {
    return false;
  }
}

/** Check whether blocks and content differ ONLY by entity tags.
 *  If true, we can reconcile — preserve structural state (deleted, edited)
 *  and just update block texts to include the new entity tags.
 */
function blocksMatchIgnoringTags(blocks: any[], content: string): boolean {
  try {
    const rebuilt = (blocks as SmartBlock[])
      .filter(b => !b.deleted)
      .map(b => stripEntityTags(b.edited ?? b.raw))
      .join('');
    return rebuilt === stripEntityTags(content);
  } catch {
    return false;
  }
}

/** Build a clean-to-raw offset map so we can insert entity tags
 *  into the correct positions in the raw content string.
 */
function buildCleanToRawMap(content: string): number[] {
  const cleanToRaw: number[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const regex = getActiveRegex();
  while ((m = regex.exec(content)) !== null) {
    // Untagged region before this tag — maps 1:1
    for (let i = lastIndex; i < m.index; i++) cleanToRaw.push(i);
    // Inner text of the tag — appears in clean text, maps inside the raw tag
    const innerText = m[1];
    const innerStart = m.index + 2; // after "[["
    for (let i = 0; i < innerText.length; i++) cleanToRaw.push(innerStart + i);
    lastIndex = m.index + m[0].length;
  }
  // Remaining untagged region
  for (let i = lastIndex; i < content.length; i++) cleanToRaw.push(i);
  // Sentinel: end of clean text → end of raw text
  cleanToRaw.push(content.length);
  return cleanToRaw;
}

/** Preserve block structure while updating texts to include entity tags from content.
 *  Each block's text is replaced by the corresponding tagged segment from raw content.
 *  Deleted/edited flags are untouched. Edited blocks keep their edited text (with tags). */
function reconcileBlocks(blocks: SmartBlock[], content: string): SmartBlock[] {
  const cleanToRaw = buildCleanToRawMap(content);
  const cleanLen = cleanToRaw.length;

  let cleanOffset = 0;
  return blocks.map(b => {
    if (b.deleted) return b;
    const oldText = b.edited ?? b.raw;
    const oldCleanLen = stripEntityTags(oldText).length;

    const blockCleanStart = cleanOffset;
    const blockCleanEnd = cleanOffset + oldCleanLen;

    const rawStart = cleanToRaw[blockCleanStart];
    const rawEnd = blockCleanEnd < cleanLen ? cleanToRaw[blockCleanEnd] : content.length;
    const taggedSegment = content.slice(rawStart, rawEnd);

    cleanOffset += oldCleanLen;

    if (taggedSegment === oldText) return b;
    return b.edited !== undefined
      ? { ...b, edited: taggedSegment }
      : { ...b, raw: taggedSegment };
  });
}

/**
 * Find all block ids that belong to the section starting at `targetId`.
 * For a heading: everything from that heading up to (but not including)
 * the next heading at the same or higher level (lower-numbered H).
 * For images/text: just that single block.
 */
function getSectionBlockIds(blocks: SmartBlock[], targetId: string): string[] {
  const idx = blocks.findIndex(b => b.id === targetId);
  if (idx === -1) return [];
  const target = blocks[idx];
  if (target.type !== 'heading') return [targetId];
  const ids = [targetId];
  for (let i = idx + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'heading' && b.level! <= target.level!) break;
    ids.push(b.id);
  }
  return ids;
}

/** How many 0.75rem steps to indent a structural block in the sidebar. */
function getSidebarIndent(structuralBlocks: SmartBlock[], index: number): number {
  const block = structuralBlocks[index];
  if (block.type === 'heading') return block.level! - 1;
  // Images / other: nest under the closest preceding heading
  for (let i = index - 1; i >= 0; i--) {
    if (structuralBlocks[i].type === 'heading') {
      return structuralBlocks[i].level!;
    }
  }
  return 0;
}

/** Convert a heading title into a URL-safe slug. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'heading';
}

export { getSectionBlockIds, getSidebarIndent };

interface SmartDocumentEditorProps {
  documentId: number;
  content: string | null;
  contentBlocks?: any[] | null;
  contentLoading: boolean;
  onSaved?: () => void;
  onClose?: () => void;
}

export function SmartDocumentEditor({ documentId, content, contentBlocks, contentLoading, onSaved, onClose }: SmartDocumentEditorProps) {
  const [blocks, setBlocks] = useState<SmartBlock[]>([]);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [activeRangeIds, setActiveRangeIds] = useState<Set<string>>(new Set());
  const [showRemoved, setShowRemoved] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [previewBlock, setPreviewBlock] = useState<SmartBlock | null>(null);
  const blockRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [originalContent, setOriginalContent] = useState<string>('');

  // Parse when content changes — prefer persisted blocks if they still match content
  useEffect(() => {
    if (content) {
      setOriginalContent(content);
      if (Array.isArray(contentBlocks) && blocksMatchContent(contentBlocks, content)) {
        setBlocks(contentBlocks as SmartBlock[]);
      } else if (Array.isArray(contentBlocks) && blocksMatchIgnoringTags(contentBlocks, content)) {
        setBlocks(reconcileBlocks(contentBlocks as SmartBlock[], content));
      } else {
        setBlocks(parseBlocks(content));
      }
      setActiveBlockId(null);
      setActiveRangeIds(new Set());
      setEditingBlockId(null);
    } else {
      setOriginalContent('');
      setBlocks([]);
    }
  }, [content, contentBlocks]);

  const structuralBlocks = useMemo(() => blocks.filter(b => b.type !== 'text'), [blocks]);
  const removedCount = useMemo(() => blocks.filter(b => b.deleted).length, [blocks]);
  const editedCount = useMemo(() => blocks.filter(b => b.edited !== undefined).length, [blocks]);
  const currentContent = useMemo(() => buildContent(blocks), [blocks]);
  const hasChanges = useMemo(() => currentContent !== originalContent, [currentContent, originalContent]);

  // Character accounting: raw content lengths
  const totalChars = useMemo(() =>
    blocks.filter(b => !b.deleted).reduce((sum, b) => sum + (b.edited ?? b.raw).length, 0),
    [blocks]
  );
  const removedChars = useMemo(() =>
    blocks.filter(b => b.deleted).reduce((sum, b) => sum + (b.edited ?? b.raw).length, 0),
    [blocks]
  );

  const toggleDelete = useCallback((id: string) => {
    setBlocks(prev => prev.map(b => (b.id === id ? { ...b, deleted: !b.deleted } : b)));
  }, []);

  const removeSection = useCallback((id: string) => {
    const ids = getSectionBlockIds(blocks, id);
    setBlocks(prev => prev.map(b => ids.includes(b.id) ? { ...b, deleted: true } : b));
  }, [blocks]);

  const restoreSection = useCallback((id: string) => {
    const ids = getSectionBlockIds(blocks, id);
    setBlocks(prev => prev.map(b => ids.includes(b.id) ? { ...b, deleted: false } : b));
  }, [blocks]);

  const handleDiscard = useCallback(() => {
    if (originalContent) {
      setBlocks(parseBlocks(originalContent));
    } else {
      setBlocks([]);
    }
    setActiveBlockId(null);
    setActiveRangeIds(new Set());
    setEditingBlockId(null);
    onClose?.();
  }, [originalContent, onClose]);

  const handleSave = useCallback(async () => {
    if (!originalContent || !hasChanges) {
      toast.info('No changes to save');
      return;
    }
    setIsSaving(true);
    try {
      await documentsApi.update(documentId, { content: currentContent || null, blocks });
      toast.success('Content updated');
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [documentId, currentContent, blocks, hasChanges, originalContent, onSaved, onClose]);

  const scrollToBlock = useCallback((id: string) => {
    setActiveBlockId(id);
    const rangeIds = getSectionBlockIds(blocks, id);
    setActiveRangeIds(new Set(rangeIds));
    if (rangeIds.length > 0) {
      const firstEl = blockRefs.current.get(rangeIds[0]);
      if (firstEl) firstEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [blocks]);

  if (contentLoading) {
    return (
      <div className="flex items-center justify-center flex-1 text-white/40">
        <Loader2 className="h-5 w-5 text-white/40 animate-spin" />
        <span className="ml-2 text-sm">Loading content...</span>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-white/40">
        <FileText className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No content available</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      {/* Stats */}
      <div className="flex justify-between items-center px-1">
        <p className="text-[11px] text-white/40">
          {blocks.length - removedCount} of {blocks.length} blocks visible
          {removedCount > 0 && (
            <span className="text-amber-400"> ({removedCount} removed · {removedChars.toLocaleString()} chars)</span>
          )}
          {editedCount > 0 && (
            <span className="text-blue-400 ml-1">({editedCount} edited)</span>
          )}
          <span className="text-white/25 ml-1">· {totalChars.toLocaleString()} chars retained</span>
        </p>
      </div>

      {/* Main workspace */}
      <div className="flex flex-1 min-h-0 gap-3 overflow-hidden">
        {/* Sidebar */}
        <div className="w-[29rem] flex-shrink-0 flex flex-col min-h-0 rounded-lg border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden">
          <div className="px-2 py-1.5 flex justify-end">
            <button
              onClick={() => setShowRemoved(v => !v)}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                showRemoved
                  ? 'border-amber-500/30 text-amber-400 hover:border-amber-500/50'
                  : 'border-white/10 text-white/40 hover:text-white/60'
              }`}
            >
              {showRemoved ? 'Hide removed' : 'Show removed'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-2 space-y-0.5">
            {structuralBlocks.length === 0 ? (
              <p className="text-xs text-white/30 italic p-2">No headings or images found</p>
            ) : (
              structuralBlocks.map((b, idx) => {
                if (b.deleted && !showRemoved) return null;
                return (
                  <SidebarRow
                    key={b.id}
                    block={b}
                    indent={getSidebarIndent(structuralBlocks, idx)}
                    isActive={activeBlockId === b.id}
                    onClick={() => scrollToBlock(b.id)}
                    onToggleDelete={() => {
                      if (b.deleted) {
                        b.type === 'heading' ? restoreSection(b.id) : toggleDelete(b.id);
                      } else {
                        b.type === 'heading' ? removeSection(b.id) : toggleDelete(b.id);
                      }
                    }}
                    onPreview={b.type === 'image' ? () => setPreviewBlock(b) : undefined}
                    onRevertEdit={() => setBlocks(prev => prev.map(bb => bb.id === b.id ? { ...bb, edited: undefined } : bb))}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Content pane */}
        <div className="flex-1 min-h-0 rounded-lg border border-white/10 bg-[oklch(0.18_0_0)] p-3 overflow-y-auto custom-scrollbar font-mono text-[13px] leading-relaxed"
             style={{ maxHeight: '100%' }}>
          {blocks.map(b => {
            if (b.deleted && !showRemoved) return null;
            const isEditing = editingBlockId === b.id;
            return (
              <div
                key={b.id}
                ref={el => { blockRefs.current.set(b.id, el); }}
                className={`group/row block whitespace-pre-wrap transition-colors rounded px-0.5 ${
                  activeRangeIds.has(b.id)
                    ? b.deleted
                      ? 'bg-white/5 text-white/20 line-through'
                      : b.type === 'image'
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-emerald-500/15 text-emerald-300'
                    : b.deleted
                      ? 'opacity-25 line-through text-white/30'
                      : b.edited
                        ? 'text-white/90 border-l-2 border-blue-500/40 pl-1'
                        : b.type === 'heading'
                          ? 'text-emerald-400 font-semibold'
                          : b.type === 'image'
                            ? 'text-amber-400/80 italic'
                            : 'text-white/80'
                }`}
                onClick={!isEditing ? () => {
                  let sectionId = b.id;
                  if (b.type !== 'heading') {
                    const bIdx = blocks.findIndex(bb => bb.id === b.id);
                    if (bIdx !== -1) {
                      for (let i = bIdx - 1; i >= 0; i--) {
                        if (blocks[i].type === 'heading') {
                          sectionId = blocks[i].id;
                          break;
                        }
                      }
                    }
                  }
                  setActiveBlockId(sectionId);
                  setActiveRangeIds(new Set(getSectionBlockIds(blocks, sectionId)));
                  requestAnimationFrame(() => {
                    const sidebarEl = document.getElementById(`sidebar-row-${sectionId}`);
                    if (sidebarEl) sidebarEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  });
                } : undefined}
              >
                {isEditing ? (
                  <BlockEditor
                    value={editValue}
                    onChange={setEditValue}
                    onSave={() => {
                      const edited = b.type === 'image'
                        ? `[IMAGE:${b.title}]\n${editValue}\n[/IMAGE:${b.title}]\n`
                        : b.type === 'heading'
                          ? `${'#'.repeat(b.level ?? 1)} ${editValue}\n`
                          : editValue;
                      setBlocks(prev => prev.map(bb => bb.id === b.id ? { ...bb, edited } : bb));
                      setEditingBlockId(null);
                    }}
                    onCancel={() => setEditingBlockId(null)}
                  />
                ) : (
                  <div className="flex items-start gap-1">
                    <div className="flex-1 min-w-0">
                      {b.edited ?? b.raw}
                    </div>
                    {!b.deleted && (
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {b.edited && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setBlocks(prev => prev.map(bb => bb.id === b.id ? { ...bb, edited: undefined } : bb));
                            }}
                            className="opacity-0 group-hover/row:opacity-100 p-0.5 rounded text-white/30 hover:text-blue-400 hover:bg-blue-500/10 transition-opacity"
                            title="Revert to original"
                          >
                            <Undo2 className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                          const initialValue = b.type === 'image'
                            ? extractImageDescription(b.edited ?? b.raw)
                            : b.type === 'heading'
                              ? (b.edited ?? b.raw).replace(/^#{1,6}\s+/, '').replace(/\n$/, '')
                              : (b.edited ?? b.raw);
                          setEditValue(initialValue);
                          setEditingBlockId(b.id);
                          setActiveBlockId(b.id);
                          setActiveRangeIds(new Set([b.id]));
                          }}
                          className="opacity-0 group-hover/row:opacity-100 p-0.5 rounded text-white/30 hover:text-blue-400 hover:bg-blue-500/10 transition-opacity"
                          title="Edit block"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions bar */}
      <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
        <Button
          variant="ghost"
          onClick={handleDiscard}
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
          {isSaving ? 'Saving...' : 'Save Edits'}
        </Button>
      </div>

      {/* Image preview modal */}
      {previewBlock && (
        <ImageReviewModal
          documentId={documentId}
          imageId={previewBlock.title!}
          description={extractImageDescription(previewBlock.raw)}
          isDeleted={!!previewBlock.deleted}
          isOpen={!!previewBlock}
          onClose={() => setPreviewBlock(null)}
          onToggleDelete={() => {
            toggleDelete(previewBlock.id);
            setPreviewBlock(prev => prev ? { ...prev, deleted: !prev.deleted } : null);
          }}
        />
      )}
    </div>
  );
}

interface SidebarRowProps {
  block: SmartBlock;
  indent: number;
  isActive: boolean;
  onClick: () => void;
  onToggleDelete: () => void;
  onPreview?: () => void;
  onRevertEdit?: () => void;
}

function SidebarRow({ block, indent, isActive, onClick, onToggleDelete, onPreview, onRevertEdit }: SidebarRowProps) {
  const isDeleted = !!block.deleted;
  const isEdited = block.edited !== undefined;
  return (
    <div
      id={`sidebar-row-${block.id}`}
      className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
        isActive
          ? block.type === 'image'
            ? `bg-amber-500/20 text-amber-300 ${isDeleted ? 'line-through' : ''}`
            : `bg-emerald-500/20 text-emerald-300 ${isDeleted ? 'line-through' : ''}`
          : isDeleted
            ? 'text-white/30 line-through'
            : 'text-white/60 hover:bg-white/5 hover:text-white/90'
      }`}
      style={{ paddingLeft: `${0.5 + indent * 0.75}rem` }}
    >
      <button onClick={onClick} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
        {block.type === 'heading' ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-white/30 flex-shrink-0 select-none">
              {'#'.repeat(block.level!)}&nbsp;
            </span>
            <span className="truncate">{block.title}</span>
            {isEdited && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-blue-500/60 flex-shrink-0" title="Edited" />}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 min-w-0">
            <Image className={`h-3 w-3 flex-shrink-0 ${isDeleted ? 'text-white/15' : 'text-amber-400/50'}`} />
            <span className={`truncate ${isDeleted ? 'text-white/20' : 'text-amber-400/70'}`}>[IMAGE:{block.title}]</span>
            {isEdited && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-blue-500/60 flex-shrink-0" title="Edited" />}
          </div>
        )}
      </button>
      <div className={`flex items-center gap-0.5 transition-opacity flex-shrink-0 ${isDeleted ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {block.type === 'image' && onPreview && (
          <button
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
            className="p-0.5 rounded text-white/40 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
            title="Preview image"
          >
            <Eye className="h-3 w-3" />
          </button>
        )}
        {isEdited && onRevertEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onRevertEdit(); }}
            className="p-0.5 rounded text-white/40 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
            title="Revert edit"
          >
            <Undo2 className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleDelete(); }}
          className={`p-0.5 rounded transition-colors ${
            isDeleted
              ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
              : 'text-white/40 hover:text-red-400 hover:bg-red-500/20'
          }`}
          title={isDeleted ? 'Restore' : block.type === 'heading' ? 'Remove section' : 'Remove image'}
        >
          {isDeleted ? <Undo2 className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}

/* ── Inline block editor ────────────────────────────── */

interface BlockEditorProps {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function BlockEditor({ value, onChange, onSave, onCancel }: BlockEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="flex flex-col gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); onSave(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-[13px] text-white/90 font-mono leading-relaxed resize-none focus:outline-none focus:border-blue-500/50"
        rows={Math.min(10, value.split('\n').length + 1)}
        spellCheck={false}
      />
      <div className="flex justify-end gap-1.5">
        <button
          onClick={onCancel}
          className="text-[10px] px-2 py-0.5 rounded text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          className="text-[10px] px-2 py-0.5 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
        >
          Ctrl+Enter to save
        </button>
      </div>
    </div>
  );
}
