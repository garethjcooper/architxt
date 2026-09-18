'use client';

import { useState, useMemo, useRef, useCallback, useEffect, forwardRef, useImperativeHandle, Fragment, useId } from 'react';
import { Plus, Eye, FileText, FileSearch, Table2, GitGraph, Workflow } from 'lucide-react';
import { parseNarrativeBlocks, getSectionBlockIds, getSidebarIndent, type NarrativeBlock } from './narrative-blocks';

import { Markdown } from './markdown';
import { MermaidDiagram } from './mermaid-diagram';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';

interface SyntheticHeadingInfo {
  kind: 'narrative' | 'table' | 'graph' | 'diagram';
  name: string;
}

function parseSyntheticHeadingTitle(title?: string): SyntheticHeadingInfo | null {
  if (!title) return null;
  const trimmed = title.trim();
  const narrativeMatch = trimmed.match(/^Narrative:\s*(.+)$/i);
  if (narrativeMatch) return { kind: 'narrative', name: narrativeMatch[1].trim() };
  const graphMatch = trimmed.match(/^Graph(?::\s*(.+))?$/i);
  if (graphMatch) return { kind: 'graph', name: graphMatch[1]?.trim() || trimmed };
  const tableMatch = trimmed.match(/^Table:\s*(.+)$/i);
  if (tableMatch) return { kind: 'table', name: tableMatch[1].trim() };
  const diagramMatch = trimmed.match(/^Diagram:\s*(.+)$/i);
  if (diagramMatch) return { kind: 'diagram', name: diagramMatch[1].trim() };
  return null;
}

const SECTION_ICON_CLASS = 'h-4 w-4 shrink-0';

function sectionIcon(kind: SyntheticHeadingInfo['kind']) {
  switch (kind) {
    case 'table': return <Table2 className={SECTION_ICON_CLASS} />;
    case 'graph': return <GitGraph className={SECTION_ICON_CLASS} />;
    case 'diagram': return <Workflow className={SECTION_ICON_CLASS} />;
    default: return <FileText className={SECTION_ICON_CLASS} />;
  }
}

function formatSectionLabel(title?: string) {
  const parsed = parseSyntheticHeadingTitle(title);
  if (!parsed) return { icon: null, label: title || '' };
  return { icon: sectionIcon(parsed.kind), label: parsed.name };
}

function resolveMarkdownHeadingIcon(text: string): { icon: React.ReactNode; text: string } | null {
  const parsed = parseSyntheticHeadingTitle(text);
  if (!parsed) return null;
  return { icon: sectionIcon(parsed.kind), text: parsed.name };
}

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
  /** Controlled sidebar width in pixels. When omitted, width is managed internally and persisted per-instance. */
  sidebarWidth?: number;
  /** Called when the sidebar width changes (e.g. during resize). */
  onSidebarWidthChange?: (width: number) => void;
  /** Optional key namespace so multiple NarrativeViewers on the same page don't share React keys. */
  keyPrefix?: string;
  /** Optional header content rendered above the sidebar/content panes. */
  header?: React.ReactNode;
  /** Optional resolver that returns the memory ids backing a section, used by the evidence action. */
  resolveSectionEvidence?: (heading: string, narrativeId?: string, tableId?: string, diagramId?: string) => string[] | null;
  /** Optional callback when the user requests to see the evidence backing a section. Receives the section's memory ids and a human-readable label. */
  onShowEvidence?: (memoryIds: string[], label: string) => void;
  /** Optional label for the evidence action. */
  evidenceLabel?: string;
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
  resolveSectionCopy?: (heading: string, level: number, contentMarkdown: string, tableId?: string, diagramId?: string) => EnvelopeCopyEvent | null;
  /** Called when the user copies/adds the whole document. Decomposes into one or more envelope events. */
  onCopyWholeDocument?: (events: EnvelopeCopyEvent[]) => void;
  /** Optional callback when the user focuses a section to examine it in a dedicated modal. Receives the heading block, the section markdown, and any structured event resolved from it. */
  onFocusSection?: (block: NarrativeBlock, markdown: string, resolvedEvent: EnvelopeCopyEvent | null) => void;
  /** Optional label for the focus action. */
  focusLabel?: string;
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
  sidebarWidth: sidebarWidthProp,
  onSidebarWidthChange,
  keyPrefix = '',
  header,
  onFocusSection,
  resolveSectionEvidence,
  onShowEvidence,
  evidenceLabel = 'Evidence',
  renderEditingBlock,
  renderSidebarRowActions,
  renderBlockActions,
  onAddToPage,
  addToPageLabel = 'Add to page',
  showHeaderActions,
  resolveSectionCopy,
  onCopyWholeDocument,
  focusLabel = 'Focus section',
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
  const storageKey = 'narrative-sidebar-width';
  const isControlled = sidebarWidthProp !== undefined;
  const [internalWidth, setInternalWidth] = useState(13 * 16); // 13rem default
  const sidebarWidth = isControlled ? sidebarWidthProp : internalWidth;
  const isDraggingRef = useRef(false);

  // Hydration-safe: restore the saved width after mount so the first server
  // render stays at the default and the client only updates once hydrated.
  useEffect(() => {
    if (isControlled || typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        setInternalWidth(Math.max(10 * 16, Number(saved)));
      }
    } catch {
      // ignore storage errors
    }
  }, [isControlled]);

  useEffect(() => {
    if (isControlled || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, String(internalWidth));
    } catch {
      // ignore storage errors
    }
  }, [isControlled, internalWidth]);

  const setSidebarWidth = useCallback((width: number) => {
    if (isControlled) {
      onSidebarWidthChange?.(width);
    } else {
      setInternalWidth(width);
    }
  }, [isControlled, onSidebarWidthChange]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // Disable pointer events on the content pane while dragging so interactive
    // controls (e.g. the diagram fit toggle) don't receive stray clicks when the
    // cursor passes over them during a resize.
    if (markdownContainerRef.current) {
      markdownContainerRef.current.style.pointerEvents = 'none';
    }

    const onMove = (moveEv: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const container = markdownContainerRef.current?.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const minWidth = 10 * 16;
      const maxWidth = rect.width * 0.5;
      const x = moveEv.clientX - rect.left;
      setSidebarWidth(Math.max(minWidth, Math.min(maxWidth, x)));
    };

    const onUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (markdownContainerRef.current) {
        markdownContainerRef.current.style.pointerEvents = '';
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);
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
    const evidence = resolveSectionEvidence?.(b.title ?? '', b.__narrativeId, b.__tableId, b.__diagramId) ?? [];
    const base: Omit<EnvelopeCopyEvent, 'type'> & { type: 'narrative' } = {
      type: 'narrative',
      payload: markdown,
      label: b.title,
      evidence,
      id: b.__narrativeId,
    };
    if (resolveSectionCopy) {
      const resolved = resolveSectionCopy(b.title ?? '', b.level ?? 0, markdown, b.__tableId, b.__diagramId);
      if (resolved) return { ...resolved, evidence, id: resolved.id ?? b.__narrativeId };
    }
    return base;
  }, [blocks, resolveSectionCopy, resolveSectionEvidence]);

  const makeBlockEvent = (raw: string, title?: string, narrativeId?: string, tableId?: string, diagramId?: string): EnvelopeCopyEvent => {
    const evidence = resolveSectionEvidence?.(title ?? '', narrativeId, tableId, diagramId) ?? [];
    const base: EnvelopeCopyEvent = { type: 'narrative', payload: raw, label: title, evidence, id: narrativeId };
    if (resolveSectionCopy) {
      const resolved = resolveSectionCopy(title ?? '', 0, raw, tableId, diagramId);
      if (resolved) return { ...resolved, evidence, id: resolved.id ?? narrativeId };
    }
    return base;
  };

  const handleFocusSection = useCallback((b: NarrativeBlock) => {
    if (!onFocusSection) return;
    const ids = getSectionBlockIds(blocks, b.id);
    const markdown = blocks
      .filter((bb) => ids.includes(bb.id))
      .map((bb) => bb.edited ?? bb.raw)
      .join('');
    let resolved: EnvelopeCopyEvent | null = null;
    if (resolveSectionCopy) {
      resolved = resolveSectionCopy(b.title ?? '', b.level ?? 0, markdown);
    }
    onFocusSection(b, markdown, resolved);
  }, [blocks, resolveSectionCopy, onFocusSection]);

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
  }, [blocks, blocksProp, onHeadingClick]);

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
      <div className={`flex items-center justify-center text-sm text-foreground-placeholder ${className}`}>
        No narrative available.
      </div>
    );
  }

  const defaultSidebarRow = (b: NarrativeBlock, idx: number, isActive: boolean) => {
    const indent = 0.5 + getSidebarIndent(structuralBlocks, idx) * 0.75;
    const { icon, label } = formatSectionLabel(b.title);
    return (
      <div
        key={`${prefix}index-${b.id}`}
        className={`group/copy flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
          isActive
            ? 'bg-narrative-active-bg text-narrative-active-fg'
            : b.deleted
              ? 'text-narrative-deleted line-through'
              : 'text-foreground-faint hover:bg-surface-card hover:text-foreground-default'
        }`}
        style={{ paddingLeft: `${indent}rem` }}
      >
        <button
          type="button"
          onClick={() => scrollToBlock(b.id)}
          className="flex-1 min-w-0 text-left"
        >
          <span className="flex items-center gap-1.5 truncate" title={b.title}>
            {icon}
            {label}
          </span>
        </button>
        <div className="flex items-center gap-0.5 flex-shrink-0 max-w-0 overflow-hidden group-hover/copy:max-w-fit focus-within:max-w-fit transition-[max-width]">
          {onShowEvidence && b.type === 'heading' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const evidenceIds = resolveSectionEvidence?.(b.title ?? '', undefined, b.__tableId, b.__diagramId) ?? [];
                if (evidenceIds.length === 0) return;
                onShowEvidence(evidenceIds, b.title || evidenceLabel);
              }}
              className="p-1 rounded text-foreground-subtle hover:text-accent-primary-fg hover:bg-accent-primary-bg transition-colors"
              title={evidenceLabel}
              aria-label={evidenceLabel}
            >
              <FileSearch className="h-3 w-3" />
            </button>
          )}
          {onFocusSection && b.type === 'heading' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleFocusSection(b);
              }}
              className="p-1 rounded text-foreground-placeholder hover:text-accent-primary-fg hover:bg-accent-primary-bg transition-colors"
              title={focusLabel}
              aria-label={focusLabel}
            >
              <Eye className="h-3 w-3" />
            </button>
          )}
          {onAddToPage && b.type === 'heading' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddToPage(makeSectionEvent(b));
              }}
              className="p-1 rounded text-foreground-placeholder hover:text-accent-primary-fg hover:bg-accent-primary-bg transition-colors"
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
                ? 'bg-surface-subtle text-narrative-deleted line-through'
                : 'bg-narrative-active-bg text-narrative-active-fg'
              : b.deleted
                ? 'opacity-25 line-through text-narrative-deleted'
                : b.edited
                  ? 'text-narrative-edited border-l-2 border-narrative-edited-bd pl-1'
                  : b.type === 'heading'
                    ? 'text-narrative-heading font-semibold'
                    : b.type === 'image'
                      ? 'text-narrative-image italic'
                      : b.type === 'code'
                        ? 'text-narrative-code'
                        : b.type === 'table'
                          ? 'text-narrative-table'
                          : 'text-narrative-text'
          }`}
        >
          <div className="flex items-start gap-1">
            <div className="flex-1 min-w-0">
              {b.type === 'heading' ? (
                <span className="flex items-center gap-1.5">
                  {formatSectionLabel(b.title).icon}
                  <span>{formatSectionLabel(b.title).label}</span>
                </span>
              ) : (
                b.edited ?? b.raw
              )}
            </div>
            {renderBlockActions && !b.deleted && (
              <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/block:opacity-100 transition-opacity">
                {onAddToPage && b.type !== 'text' && !b.synthetic && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToPage(makeBlockEvent(b.raw, b.title, b.__narrativeId, b.__tableId, b.__diagramId));
                    }}
                    className="p-1 rounded text-foreground-placeholder hover:text-accent-primary-fg hover:bg-accent-primary-bg transition-colors"
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
                    onAddToPage(makeBlockEvent(b.raw, b.title, b.__narrativeId, b.__tableId, b.__diagramId));
                  }}
                  className="p-1 rounded text-foreground-placeholder hover:text-accent-primary-fg hover:bg-accent-primary-bg transition-colors"
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
          className={`rounded border border-border-default p-2 cursor-pointer transition-colors ${
            isActive ? 'bg-narrative-active-bg' : 'hover:bg-surface-card'
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
          className={`overflow-x-auto cursor-pointer transition-colors ${isActive ? 'bg-narrative-active-bg rounded' : ''}`}
        >
          <table className="w-full text-left text-[12px] border-collapse">
            <thead>
              <tr className="border-b border-border-default">
                {headers?.map((h, i) => <th key={i} className="py-1 px-2 font-semibold text-foreground-default">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r} className="border-b border-border-subtle">
                  {row.map((cell, c) => <td key={c} className="py-1 px-2 text-foreground-muted">{cell}</td>)}
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
              ? 'bg-surface-subtle text-narrative-deleted line-through'
              : 'bg-narrative-active-bg text-narrative-active-fg'
            : b.deleted
              ? 'opacity-25 line-through text-foreground-faint'
              : b.edited
                ? 'text-narrative-edited border-l-2 border-narrative-edited-bd pl-1'
                : b.type === 'heading'
                  ? 'text-narrative-heading font-semibold'
                  : b.type === 'image'
                    ? 'text-narrative-image italic'
                    : b.type === 'code'
                      ? 'text-narrative-code'
                      : 'text-narrative-text'
        }`}
      >
        <div className="flex items-start gap-1">
          <div className="flex-1 min-w-0">
            {b.type === 'heading' ? (
              <span className="flex items-center gap-1.5">
                {formatSectionLabel(b.title).icon}
                <span>{formatSectionLabel(b.title).label}</span>
              </span>
            ) : (
              b.edited ?? b.raw
            )}
          </div>
          {renderBlockActions && !b.deleted && (
            <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/block:opacity-100 transition-opacity">
              {onAddToPage && b.type !== 'text' && !b.synthetic && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToPage(makeBlockEvent(b.raw, b.title, b.__narrativeId, b.__tableId, b.__diagramId));
                  }}
                  className="p-1 rounded text-foreground-placeholder hover:text-accent-primary-fg hover:bg-accent-primary-bg transition-colors"
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
                  onAddToPage(makeBlockEvent(b.raw, b.title, b.__narrativeId));
                }}
                className="p-1 rounded text-foreground-placeholder hover:text-accent-primary-fg hover:bg-accent-primary-bg transition-colors"
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
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Index sidebar */}
        {showIndex && (
          <div className="contents mr-3">
            <div
              className="flex flex-col min-h-0 rounded-md border border-border-default bg-surface-overlay overflow-hidden"
              style={{ width: sidebarWidth, flexShrink: 0 }}
            >
              <div className="group/header px-2 py-1.5 border-b border-border-default flex items-center justify-between">
                <div className="flex items-center min-w-0">
                  <span className="text-[11px] font-medium text-foreground-muted truncate" title={title}>{title}</span>
                  <span className="text-[10px] text-foreground-subtle ml-1 flex-shrink-0">({structuralBlocks.length})</span>
                </div>
                {effectiveShowHeaderActions && onCopyWholeDocument && (
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyWholeDocument();
                      }}
                      className="opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 p-1 rounded text-foreground-subtle hover:text-accent-primary-fg hover:bg-accent-primary-bg transition-opacity"
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
                  <p className="text-xs text-foreground-subtle p-1">No sections found</p>
                )}
                {structuralBlocks.map((b, idx) => {
                  const isActive = activeBlockId === b.id;
                  return defaultSidebarRow(b, idx, isActive);
                })}
              </div>
            </div>
            <div className="w-3 shrink-0 cursor-col-resize flex items-center justify-center group">
              <div
                role="separator"
                aria-orientation="vertical"
                onMouseDown={startResize}
                onDoubleClick={() => setSidebarWidth(13 * 16)}
                className="w-1 h-16 rounded-full bg-border-default group-hover:bg-accent-primary-solid transition-colors"
                title="Drag to resize, double-click to reset"
              />
            </div>
          </div>
        )}

        <div
          ref={markdownContainerRef}
          className={`flex-1 min-w-0 min-h-0 rounded-md border border-border-default bg-surface-overlay overflow-y-auto custom-scrollbar ${
            viewMode === 'plain' ? 'py-3 pl-3 pr-5 text-[13px] leading-relaxed font-mono' : 'p-4'
          }`}
        >
          {viewMode === 'markdown' ? (
            structuralBlocks
              .filter((b) => !b.deleted)
              .map((section, sectionIdx) => {
                const sectionIds = getSectionBlockIds(blocks, section.id);
                const sectionMarkdown = blocks
                  .filter((bb) => sectionIds.includes(bb.id) && !bb.deleted)
                  .map((bb) => bb.edited ?? bb.raw)
                  .join('');
                const isLast = sectionIdx === structuralBlocks.filter((bb) => !bb.deleted).length - 1;
                return (
                  <div
                    key={`${prefix}section-${section.id}`}
                    ref={(el) => {
                      // Register the section container itself for the heading block.
                      blockRefs.current.set(section.id, el);
                      // Also register the children so scrollToBlock on a sub-block works.
                      sectionIds.forEach((id, i) => {
                        if (i === 0) return;
                        blockRefs.current.set(id, el);
                      });
                    }}
                    className={`${isLast ? '' : 'border-b border-border-subtle pb-3 mb-3'}`}
                  >
                    <Markdown className="text-[12px] leading-relaxed" headingIconResolver={resolveMarkdownHeadingIcon}>
                      {sectionMarkdown}
                    </Markdown>
                  </div>
                );
              })
          ) : (
            blocks.map(b => {
              const isActive = activeRangeIds.has(b.id);
              if (renderEditingBlock) {
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
