'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { parseBlocks, SmartBlock, getSectionBlockIds, getSidebarIndent, slugifyHeading } from './smart-document-editor';
import { Markdown } from './markdown';
import { MermaidDiagram } from './mermaid-diagram';
import { Copy } from 'lucide-react';

export interface NarrativeDiagram {
  name: string;
  type: string;
  content: string;
}

export interface NarrativeViewerProps {
  /** Markdown narrative content to display/index. */
  content: string;
  /** Optional title shown above the index sidebar. */
  title?: string;
  /** Called when the user clicks a heading in the index. */
  onHeadingClick?: (id: string, title?: string) => void;
  /** Called when the user chooses to copy a section (heading + its content). Receives the raw markdown. */
  onCopySection?: (markdown: string, title?: string) => void;
  /** Optional extra className for the outer container. */
  className?: string;
  /** Display mode: 'plain' keeps the raw block view; 'markdown' renders formatted Markdown. */
  viewMode?: 'plain' | 'markdown';
  /** Whether to show the left-hand index sidebar. */
  showIndex?: boolean;
  /** Optional Mermaid diagrams to render inline after the narrative content. @deprecated Diagrams should now be included in the Markdown content itself as fenced mermaid blocks. */
  diagrams?: NarrativeDiagram[];
}

export function NarrativeViewer({
  content,
  title = 'Narrative',
  onHeadingClick,
  onCopySection,
  className = '',
  viewMode = 'plain',
  showIndex = true,
  diagrams,
}: NarrativeViewerProps) {
  const [blocks, setBlocks] = useState<SmartBlock[]>([]);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [activeRangeIds, setActiveRangeIds] = useState<Set<string>>(new Set());
  const blockRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const markdownContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setBlocks(parseBlocks(content));
    setActiveBlockId(null);
    setActiveRangeIds(new Set());
  }, [content]);

  const structuralBlocks = useMemo(() => blocks.filter(b => b.type !== 'text'), [blocks]);

  const scrollToBlock = useCallback((id: string) => {
    if (viewMode === 'markdown') {
      const block = blocks.find(b => b.id === id);
      if (!block || block.type !== 'heading' || !block.title) return;
      const slug = slugifyHeading(block.title);
      const container = markdownContainerRef.current;
      const el = container?.querySelector(`#${CSS.escape(slug)}`) as HTMLElement | null;
      if (el) {
        setActiveBlockId(id);
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      onHeadingClick?.(id, block.title);
      return;
    }

    const rangeIds = getSectionBlockIds(blocks, id);
    setActiveBlockId(id);
    setActiveRangeIds(new Set(rangeIds));
    if (rangeIds.length > 0) {
      const firstEl = blockRefs.current.get(rangeIds[0]);
      if (firstEl) {
        firstEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    onHeadingClick?.(id, blocks.find(b => b.id === id)?.title);
  }, [blocks, onHeadingClick, viewMode]);

  const handleContentClick = useCallback((block: SmartBlock) => {
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
  }, [blocks, scrollToBlock]);

  if (!content || blocks.length === 0) {
    return (
      <div className={`flex items-center justify-center text-sm text-white/40 ${className}`}>
        No narrative available.
      </div>
    );
  }

  return (
    <div className={`flex flex-1 min-h-0 gap-3 overflow-hidden ${className}`}>
      {/* Index sidebar */}
      {showIndex && (
        <div className="w-[13rem] flex-shrink-0 flex flex-col min-h-0 rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden">
          <div className="px-2 py-1.5 border-b border-white/10">
            <span className="text-[11px] font-medium text-white/70">{title}</span>
            <span className="text-[10px] text-white/40 ml-1">({structuralBlocks.length})</span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1.5 space-y-0.5">
            {structuralBlocks.length === 0 ? (
              <p className="text-xs text-white/30 p-1">No sections found</p>
            ) : (
              structuralBlocks.map((b, idx) => (
                <div
                  key={b.id}
                  className="flex items-center gap-1 group/copy"
                >
                  <button
                    type="button"
                    onClick={() => scrollToBlock(b.id)}
                    className={`flex-1 min-w-0 text-left rounded-md px-2 py-1 text-[11px] transition-colors ${
                      activeBlockId === b.id
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'text-white/60 hover:bg-white/5 hover:text-white/90'
                    }`}
                    style={{ paddingLeft: `${0.5 + getSidebarIndent(structuralBlocks, idx) * 0.75}rem` }}
                  >
                    {b.type === 'heading' ? (
                      <span className="truncate block" title={b.title}>{b.title}</span>
                    ) : b.type === 'image' ? (
                      <span className="truncate block text-amber-400/70" title={`[IMAGE:${b.title}]`}>[IMAGE:{b.title}]</span>
                    ) : b.type === 'code' ? (
                      <span className="truncate block text-blue-400/70" title={b.title}>{b.title}</span>
                    ) : b.type === 'table' ? (
                      <span className="truncate block text-emerald-400/70" title="Table">Table</span>
                    ) : null}
                  </button>
                  {onCopySection && b.type === 'heading' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const ids = getSectionBlockIds(blocks, b.id);
                        const markdown = blocks
                          .filter((bb) => ids.includes(bb.id))
                          .map((bb) => bb.raw)
                          .join('');
                        onCopySection(markdown, b.title);
                      }}
                      className="opacity-0 group-hover/copy:opacity-100 focus-visible:opacity-100 flex-shrink-0 p-1 rounded text-white/30 hover:text-emerald-300 hover:bg-white/10 transition-opacity"
                      title="Copy section to page editor"
                      aria-label="Copy section"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))
            )}
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
          <Markdown className="text-[13px] leading-relaxed">{content}</Markdown>
        ) : (
          blocks.map(b => {
            const isActive = activeRangeIds.has(b.id);
            return (
              <div
                key={b.id}
                ref={el => { blockRefs.current.set(b.id, el); }}
                onClick={() => handleContentClick(b)}
                className={`block whitespace-pre-wrap rounded px-2 py-0.5 cursor-pointer transition-colors ${
                  isActive
                    ? b.type === 'heading'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-emerald-500/10 text-emerald-200/90'
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
                {b.raw}
              </div>
            );
          })
        )}
        {diagrams && diagrams.length > 0 && (
          <div className="mt-6 flex flex-col gap-4">
            <hr className="border-white/10" />
            <div className="text-[10px] uppercase text-white/40 font-medium">Legacy diagram pane (deprecated)</div>
            {diagrams.map((d, idx) => (
              <MermaidDiagram key={idx} name={d.name} type={d.type} content={d.content} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
