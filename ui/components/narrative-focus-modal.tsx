'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ResizeHandle } from '@/app/workspace/_components/panel-layout';
import { copyText } from '@/lib/clipboard-utils';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';

export interface NarrativeFocusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Initial narrative name and markdown content. */
  name: string;
  content: string;
  /** Called when Apply is pressed with the updated narrative. */
  onApply?: (event: EnvelopeCopyEvent) => void;
  /** When true, renders a read-only view with no editing controls. */
  readOnly?: boolean;
}

const darkMarkdownTheme = EditorView.theme({
  '&': {
    height: '100%',
    width: '100%',
    fontSize: '13px',
    lineHeight: '1.6',
    backgroundColor: 'transparent',
    color: '#e5e7eb',
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  '.cm-content': { width: '100%', minWidth: '0', padding: '6px 8px', caretColor: 'white' },
  '.cm-line': { whiteSpace: 'pre-wrap' },
  '.cm-cursor': { borderLeftColor: 'white' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(255, 255, 255, 0.15)' },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
  '.cm-gutters': { display: 'none' },
});

export function NarrativeFocusModal({ open, onOpenChange, name, content, onApply, readOnly = false }: NarrativeFocusModalProps) {
  const [draftName, setDraftName] = useState(name);
  const [draftContent, setDraftContent] = useState(content);
  const [sourceWidth, setSourceWidth] = useState(50);
  const draggingRef = useRef(false);

  useEffect(() => {
    setDraftName(name);
    setDraftContent(content);
  }, [name, content]);

  const extensions = useMemo(() => [oneDark, darkMarkdownTheme], []);

  const startResize = useCallback((e: React.MouseEvent) => {
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    e.preventDefault();
    draggingRef.current = true;

    const onMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      const rect = container.getBoundingClientRect();
      const pct = Math.min(80, Math.max(20, ((rect.right - moveEvent.clientX) / rect.width) * 100));
      setSourceWidth(pct);
    };

    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const handleApply = useCallback(() => {
    const finalName = draftName.trim();
    onApply?.({
      type: 'narrative',
      payload: JSON.stringify({ name: finalName, content: draftContent }),
      label: finalName || 'Narrative',
    });
    onOpenChange(false);
  }, [draftName, draftContent, onApply, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] h-[90vh] max-w-none sm:max-w-none flex flex-col" showCloseButton>
        <DialogHeader className="shrink-0">
          <DialogTitle>Narrative: {name || 'Untitled'}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <div className="shrink-0 flex items-center gap-2">
            <span className="text-xs text-white/60">Name:</span>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              disabled={readOnly}
              className="flex-1 min-w-0 px-2 py-1 rounded bg-black/30 border border-white/10 text-[12px] text-white/80 focus:outline-none focus:border-emerald-500/50 disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="Narrative name"
            />
          </div>
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden">
              <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-white/70 flex items-center justify-between shrink-0">
                <span>Preview</span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-4">
                <div className="prose prose-invert prose-sm max-w-none">
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {draftContent}
                  </Markdown>
                </div>
              </div>
            </div>
            {!readOnly && <ResizeHandle direction="vertical" onMouseDown={startResize} title="Drag to resize panels" />}
            <div
              className="min-h-0 flex flex-col rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden"
              style={{ flexBasis: `${sourceWidth}%`, minWidth: '16rem', maxWidth: '80%' }}
            >
              <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-white/70 flex items-center justify-between shrink-0">
                <span>{readOnly ? 'Markdown source (read-only)' : 'Markdown source'}</span>
                <button
                  type="button"
                  onClick={() => copyText(draftContent, 'Markdown')}
                  className="p-1 rounded text-white/40 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                  title="Copy markdown source"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <CodeMirror
                  value={draftContent}
                  onChange={(v) => setDraftContent(v)}
                  extensions={extensions}
                  theme="none"
                  height="100%"
                  className="h-full text-[13px]"
                  editable={!readOnly}
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="button" size="sm" onClick={handleApply}>
              Apply
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
