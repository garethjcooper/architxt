'use client';

import { useState, useMemo, useRef, useCallback, useEffect, forwardRef, useImperativeHandle, Fragment, useId } from 'react';
import { Plus } from 'lucide-react';
import { parseNarrativeBlocks, getSectionBlockIds, getSidebarIndent, type NarrativeBlock } from './narrative-blocks';
import { slugifyHeading } from './smart-document-editor';
import { Markdown } from './markdown';
import { MermaidDiagram } from './mermaid-diagram';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';

export interface NarrativeViewerProps {
  /** Markdown narrative content to display/index. Either this or `blocks` must be provided. */
  content?: string;
  /** Controlled block list. When provided, the viewer uses these blocks directly instead of parsing `content`. */
  blocks?: NarrativeBlock[];
  /** Controlled active block id for sidebar highlighting. */
  activeBlockId?: string | null;
  /** Controlled set of active range ids for content highlighting. */
  activeRangeIds?: Set<string>;
  /** Markdown narrative content to display/index. */
  title?: string;
  /** Called when the user clicks a block in the content pane. */
  onBlockClick?: (block: NarrativeBlock) => void;
  /** Called when the user clicks a heading in the index. */
  onHeadingClick?: (id: string, title?: string) => void;
  /** Called when the user chooses to copy a section (heading + its content). Receives an envelope event. */
  onCopySection?: (event: EnvelopeCopyEvent) => void;
  /** Optional extra className for the outer container. */
  className?: string;
  /** Display mode: 'plain' keeps the raw block view; 'markdown' renders formatted Markdown. */
  viewMode?: 'plain' | 'markdown';
  /** Whether to show the left-hand index sidebar. */
  showIndex?: boolean;
  /** Optional key namespace so multiple NarrativeViewers on the same page don't share React keys. */
  keyPrefix?: string;
  /** Optional header content rendered above the sidebar/content panes. */
  header?: React.ReactNode;
  /** Optional id of a block currently being edited. If provided, that block is rendered via renderEditingBlock. */
  editingBlockId?: string;
  /** Optional render prop replacing the block currently being edited. */
  renderEditingBlock?: (block: NarrativeBlock, ctx: { isActive: boolean }) => React.ReactNode;
  /** Optional render prop for extra sidebar row actions, appended inside the default row. */
  renderSidebarRowActions?: (block: NarrativeBlock, ctx: { isActive: boolean; index: number; indent: number }) => React.ReactNode;
  /** Optional render prop for extra content-block actions, appended inside the default block row. */
  renderBlockActions?: (block: NarrativeBlock, ctx: { isActive: boolean }) => React.ReactNode;
  /** Optional callback to add a section/block to a curated page. When provided, a + icon appears on each structural block. */
  onAddToPage?: (event: EnvelopeCopyEvent) => void;
  /** Optional label for the add-to-page action. */
  addToPageLabel?: string;
  /** When true, show copy/add actions in the section index header. Defaults to true when onCopySection/onAddToPage are provided. */
  showHeaderActions?: boolean;
  /**
   * Optional resolver that turns a section (heading + content) into a structured envelope event.
   * If it returns null, the section is treated as narrative.
   */
  resolveSectionCopy?: (heading: string, level: number, contentMarkdown: string) => EnvelopeCopyEvent | null;
  /** Called when the user copies/adds the whole document. Decomposes into one or more envelope events. */
  onCopyWholeDocument?: (events: EnvelopeCopyEvent[]) => void;
}

export const NarrativeViewer = forwardRef(function NarrativeViewer({
  content,
  blocks: blocksProp,
  activeBlockId: activeBlockIdProp,
  activeRangeIds: activeRangeIdsProp,
  title = 'Narrative',
  onBlockClick,
  onHeadingClick,
  onCopySection,
  className = '',
  viewMode = 'plain',
  showIndex = true,
  keyPrefix = '',
  header,
  editingBlockId,
  renderEditingBlock,
  renderSidebarRowActions,
  renderBlockActions,
  onAddToPage,
  addToPageLabel = 'Add to page',
  showHeaderActions,
  resolveSectionCopy,
  onCopyWholeDocument,
}: NarrativeViewerProps, ref: React.Ref<{ scrollToBlock: (id: string) => void }>) {
  const instanceId = useId().replace(/:/g, '');
  const prefix = keyPrefix ? `${keyPrefix}-` : `${instanceId}-`;
  const [internalBlocks, setInternalBlocks] = useState<NarrativeBlock[]>([]);
  const [internalActiveBlockId, setInternalActiveBlockId] = useState<string | null>(null);
  const [internalActiveRangeIds, setInternalActiveRangeIds] = useState<Set<string>>(new Set());
  const blocks = blocksProp ?? internalBlocks;
  const activeBlockId = activeBlockIdProp ?? internalActiveBlockId;
  const activeRangeIds = activeRangeIdsProp ?? internalActiveRangeIds;
  const blockRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const markdownContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (blocksProp) return;
    setInternalBlocks(parseNarrativeBlocks(content || ''));
    setInternalActiveBlockId(null);
    setInternalActiveRangeIds(new Set());
  }, [content, blocksProp]);

  const structuralBlocks = useMemo(() => blocks.filter(b => b.type === 'heading' || b.type === 'image'), [blocks]);

  const effectiveShowHeaderActions = showHeaderActions ?? (Boolean(onCopySection) || Boolean(onAddToPage) || Boolean(onCopyWholeDocument));

  const wholeDocumentMarkdown = useMemo(() => {
    return blocks.filter((b) => !b.deleted).map((b) => b.edited ?? b.raw).join('');
  }, [blocks]);

  const renderedMarkdown = content || wholeDocumentMarkdown;

  const makeSectionEvent = useCallback((b: NarrativeBlock): EnvelopeCopyEvent => {
    const ids = getSectionBlockIds(blocks, b.id);
    const markdown = blocks
      .filter((bb) => ids.includes(bb.id))
      .map((bb) => bb.edited ?? bb.raw)
      .join('');
    if (resolveSectionCopy) {
      const resolved = resolveSectionCopy(b.title ?? '', b.level ?? 0, markdown);
      if (resolved) return resolved;
    }
    if (b.synthetic) {
      return { type: 'narrative', payload: markdown, label: b.title };
    }
    return { type: 'narrative', payload: markdown, label: b.title };
  }, [blocks, resolveSectionCopy]);

  const makeBlockEvent = (raw: string, title?: string): EnvelopeCopyEvent => {
    if (resolveSectionCopy) {
      const resolved = resolveSectionCopy(title ?? '', 0, raw);
      if (resolved) return resolved;
    }
    return { type: 'narrative', payload: raw, label: title };
  };

  const copyWholeDocument = useCallback(() => {
    if (!onCopyWholeDocument) return;
    const events: EnvelopeCopyEvent[] = [];
    const covered = new Set<string>();
    for (const b of structuralBlocks) {
      if (covered.has(b.id)) continue;
      const event = makeSectionEvent(b);
      events.push(event);
      const ids = getSectionBlockIds(blocks, b.id);
      ids.forEach((id) => covered.add(id));
    }
    const proseBlocks = blocks.filter((bb) => !bb.deleted && !covered.has(bb.id));
    if (proseBlocks.length > 0) {
      events.push({ type: 'narrative', payload: proseBlocks.map((bb) => bb.edited ?? bb.raw).join(''), label: title });
    }
    onCopyWholeDocument(events);
  }, [blocks, structuralBlocks, makeSectionEvent, onCopyWholeDocument, title]);

  const scrollToBlock = useCallback((id: string) => {
    const container = markdownContainerRef.current;
    const scrollContainerTo = (el: HTMLElement) => {
      if (!container) return;
      const top =
        el.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    };

    if (viewMode === 'markdown') {
      const block = blocks.find(b => b.id === id);
      if (!block || block.type !== 'heading' || !block.title) return;
      const slug = slugifyHeading(block.title);
      const el = container?.querySelector(`#${CSS.escape(slug)}`) as HTMLElement | null;
      if (el) {
        if (!blocksProp) setInternalActiveBlockId(id);
        scrollContainerTo(el);
      }
      onHeadingClick?.(id, block.title);
      return;
    }

    const rangeIds = getSectionBlockIds(blocks, id);
    if (!blocksProp) {
      setInternalActiveBlockId(id);
      setInternalActiveRangeIds(new Set(rangeIds));
    }
    if (rangeIds.length > 0) {
      const firstEl = blockRefs.current.get(rangeIds[0]);
      if (firstEl) {
        scrollContainerTo(firstEl);
      }
    }
    onHeadingClick?.(id, blocks.find(b => b.id === id)?.title);
  }, [blocks, blocksProp, onHeadingClick, viewMode]);

  useImperativeHandle(ref, () => ({ scrollToBlock }), [scrollToBlock]);

  const handleContentClick = useCallback((block: NarrativeBlock) => {
    if (onBlockClick) {
      onBlockClick(block);
      return;
    }
    let sectionId = block.id;
    if (block.type !== 'heading') {
      const bIdx = blocks.findIndex(bb => bb.id === block.id);
      if (bIdx !== -1) {
        for (let i = bIdx - 1; i >= 0; i--) {
          if (blocks[i].type === 'heading') {
            sectionId = blocks[i].id;
            break;
          }
        }
      }
    }
    scrollToBlock(sectionId);
  }, [blocks, onBlockClick, scrollToBlock]);

  if (blocks.length === 0) {
    return (
      <div className={`flex items-center justify-center text-sm text-white/40 ${className}`}>
        No narrative available.
      </div>
    );
  }

  const defaultSidebarRow = (b: NarrativeBlock, idx: number, isActive: boolean) => {
    const indent = 0.5 + getSidebarIndent(structuralBlocks, idx) * 0.75;
    return (
      <div
        key={`${prefix}index-${b.id}`}
        className={`group/copy flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
          isActive
            ? 'bg-emerald-500/20 text-emerald-300'
            : b.deleted
              ? 'text-white/30 line-through'
              : 'text-white/60 hover:bg-white/5 hover:text-white/90'
        }`}
        style={{ paddingLeft: `${indent}rem` }}
      >
        <button
          type="button"
          onClick={() => scrollToBlock(b.id)}
          className="flex-1 min-w-0 text-left"
        >
          <span className="truncate block" title={b.title}>{b.title}</span>
        </button>
        <div className="flex items-center flex-shrink-0">
          {onAddToPage && b.type === 'heading' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddToPage(makeSectionEvent(b));
              }}
              className="opacity-0 group-hover/copy:opacity-100 focus-visible:opacity-100 p-1 rounded text-white/30 hover:text-purple-300 hover:bg-white/10 transition-opacity"
              title={addToPageLabel}
              aria-label={addToPageLabel}
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
          {renderSidebarRowActions && renderSidebarRowActions(b, { isActive, index: idx, indent })}
        </div>
      </div>
    );
  };

  const defaultBlock = (b: NarrativeBlock, isActive: boolean) => {
    // In plain mode every block is raw text; do not render live Mermaid/HTML tables.
    if (viewMode === 'plain') {
      return (
        <div
          key={`${prefix}block-${b.id}`}
          ref={el => { blockRefs.current.set(b.id, el); }}
          onClick={() => handleContentClick(b)}
          className={`group/block block whitespace-pre-wrap rounded px-2 py-0.5 cursor-pointer transition-colors ${
            isActive
              ? b.deleted
                ? 'bg-white/5 text-white/20 line-through'
                : 'bg-emerald-500/15 text-emerald-300'
              : b.deleted
                ? 'opacity-25 line-through text-white/30'
                : b.edited
                  ? 'text-white/90 border-l-2 border-blue-500/40 pl-1'
                  : b.type === 'heading'
                    ? 'text-emerald-400 font-semibold'
                    : b.type === 'image'
                      ? 'text-amber-400/80 italic'
                      : b.type === 'code'
                        ? 'text-blue-400/80'
                        : b.type === 'table'
                          ? 'text-emerald-400/80'
                          : 'text-white/80'
          }`}
        >
          <div className="flex items-start gap-1">
            <div className="flex-1 min-w-0">{b.edited ?? b.raw}</div>
            {renderBlockActions && !b.deleted && (
              <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/block:opacity-100 transition-opacity">
                {onAddToPage && b.type !== 'text' && !b.synthetic && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToPage(makeBlockEvent(b.raw, b.title));
                    }}
                    className="p-1 rounded text-white/30 hover:text-purple-300 hover:bg-white/10 transition-colors"
                    title={addToPageLabel}
                    aria-label={addToPageLabel}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
                {renderBlockActions(b, { isActive })}
              </div>
            )}
            {!renderBlockActions && onAddToPage && !b.deleted && b.type !== 'text' && !b.synthetic && (
              <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/block:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToPage(makeBlockEvent(b.raw, b.title));
                  }}
                  className="p-1 rounded text-white/30 hover:text-purple-300 hover:bg-white/10 transition-colors"
                  title={addToPageLabel}
                  aria-label={addToPageLabel}
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (b.type === 'code' && b.language === 'mermaid') {
      const content = (b.edited ?? b.raw).replace(/^```mermaid\n?/, '').replace(/\n?```\s*$/, '');
      const name = b.title || 'diagram';
      return (
        <div
          key={`${prefix}block-${b.id}`}
          ref={el => { blockRefs.current.set(b.id, el); }}
          onClick={() => handleContentClick(b)}
          className={`rounded border border-white/10 p-2 cursor-pointer transition-colors ${
            isActive ? 'bg-emerald-500/10' : 'hover:bg-white/5'
          }`}
        >
          <MermaidDiagram name={name} type={name} content={content} />
        </div>
      );
    }

    if (b.type === 'table') {
      const rows = b.raw
        .trim()
        .split('\n')
        .filter((row) => !/^\s*\|?[-:]+\|?\s*$/.test(row) && row.trim());
      if (rows.length < 1) return null;
      const cells = rows.map((r) => r.split('|').map((c) => c.trim()).filter(Boolean));
      const [headers, ...body] = cells;
      return (
        <div
          key={`${prefix}block-${b.id}`}
          ref={el => { blockRefs.current.set(b.id, el); }}
          onClick={() => handleContentClick(b)}
          className={`overflow-x-auto cursor-pointer transition-colors ${isActive ? 'bg-emerald-500/10 rounded' : ''}`}
        >
          <table className="w-full text-left text-[12px] border-collapse">
            <thead>
              <tr className="border-b border-white/20">
                {headers?.map((h, i) => <th key={i} className="py-1 px-2 font-semibold text-white/80">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r} className="border-b border-white/10">
                  {row.map((cell, c) => <td key={c} className="py-1 px-2 text-white/70">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div
        key={`${prefix}block-${b.id}`}
        ref={el => { blockRefs.current.set(b.id, el); }}
        onClick={() => handleContentClick(b)}
        className={`group/block block whitespace-pre-wrap rounded px-2 py-0.5 cursor-pointer transition-colors ${
          isActive
            ? b.deleted
              ? 'bg-white/5 text-white/20 line-through'
              : 'bg-emerald-500/15 text-emerald-300'
            : b.deleted
              ? 'opacity-25 line-through text-white/30'
              : b.edited
                ? 'text-white/90 border-l-2 border-blue-500/40 pl-1'
                : b.type === 'heading'
                  ? 'text-emerald-400 font-semibold'
                  : b.type === 'image'
                    ? 'text-amber-400/80 italic'
                    : b.type === 'code'
                      ? 'text-blue-400/80'
                      : 'text-white/80'
        }`}
      >
        <div className="flex items-start gap-1">
          <div className="flex-1 min-w-0">{b.edited ?? b.raw}</div>
          {renderBlockActions && !b.deleted && (
            <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/block:opacity-100 transition-opacity">
              {onAddToPage && b.type !== 'text' && !b.synthetic && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToPage(makeBlockEvent(b.raw, b.title));
                  }}
                  className="p-1 rounded text-white/30 hover:text-purple-300 hover:bg-white/10 transition-colors"
                  title={addToPageLabel}
                  aria-label={addToPageLabel}
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
              {renderBlockActions(b, { isActive })}
            </div>
          )}
          {!renderBlockActions && onAddToPage && !b.deleted && b.type !== 'text' && !b.synthetic && (
            <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/block:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToPage(makeBlockEvent(b.raw, b.title));
                }}
                className="p-1 rounded text-white/30 hover:text-purple-300 hover:bg-white/10 transition-colors"
                title={addToPageLabel}
                aria-label={addToPageLabel}
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${className}`}>
      {header}
      <div className="flex flex-1 min-h-0 gap-3 overflow-hidden">
        {/* Index sidebar */}
        {showIndex && (
          <div className="w-[13rem] flex-shrink-0 flex flex-col min-h-0 rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden">
            <div className="group/header px-2 py-1.5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center min-w-0">
                <span className="text-[11px] font-medium text-white/70 truncate" title={title}>{title}</span>
                <span className="text-[10px] text-white/40 ml-1 flex-shrink-0">({structuralBlocks.length})</span>
              </div>
              {effectiveShowHeaderActions && onCopyWholeDocument && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyWholeDocument();
                    }}
                    className="opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 p-1 rounded text-white/30 hover:text-purple-300 hover:bg-white/10 transition-opacity"
                    title={addToPageLabel}
                    aria-label={addToPageLabel}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1.5 space-y-0.5">
              {structuralBlocks.length === 0 && (
                <p className="text-xs text-white/30 p-1">No sections found</p>
              )}
              {structuralBlocks.map((b, idx) => {
                const isActive = activeBlockId === b.id;
                return defaultSidebarRow(b, idx, isActive);
              })}
            </div>
          </div>
        )}

        <div
          ref={markdownContainerRef}
          className={`flex-1 min-h-0 rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-y-auto custom-scrollbar ${
            viewMode === 'plain' ? 'py-3 pl-3 pr-5 text-[13px] leading-relaxed font-mono' : 'p-4'
          }`}
        >
          {viewMode === 'markdown' ? (
            <Markdown className="text-[12px] leading-relaxed">{renderedMarkdown}</Markdown>
          ) : (
            blocks.map(b => {
              const isActive = activeRangeIds.has(b.id);
              if (editingBlockId === b.id && renderEditingBlock) {
                return <Fragment key={`${prefix}block-${b.id}`}>{renderEditingBlock(b, { isActive })}</Fragment>;
              }
              return defaultBlock(b, isActive);
            })
          )}
        </div>
      </div>
    </div>
  );
});
