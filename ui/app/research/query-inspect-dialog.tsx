'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { ResearchStepSummary, ResearchStepCall } from '@/lib/api/client';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: ResearchStepSummary | null;
}

function formatBytes(chars: number | undefined) {
  if (chars == null) return '—';
  if (chars < 1024) return `${chars} chars`;
  return `${(chars / 1024).toFixed(1)} k chars`;
}

function formatTokens(tokens: number | undefined) {
  if (tokens == null) return '—';
  return `${tokens.toLocaleString()} tok`;
}

function formatDuration(ms: number | undefined) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          toast.success(label ? `${label} copied` : 'Copied to clipboard');
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex items-center gap-1 text-[10px] text-white/50 hover:text-emerald-300 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

function CallRow({ call, index }: { call: ResearchStepCall; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = call.status === 'success' ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="border border-white/10 rounded bg-black/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-white/50" />
        ) : (
          <ChevronRight className="w-3 h-3 text-white/50" />
        )}
        <span className="text-xs font-mono text-white/60 w-5">{index + 1}</span>
        <Badge variant="outline" className="text-[10px] h-5">{call.tool}</Badge>
        <span className="text-[11px] text-white/70">{call.mode}</span>
        {call.topic_goal && (
          <span className="text-[10px] text-white/40">• {call.topic_goal}</span>
        )}
        <span className={`ml-auto text-[11px] ${statusColor}`}>
          {call.status === 'success' ? 'ok' : 'fail'}
        </span>
        <span className="text-[10px] text-white/40 font-mono tabular-nums">
          {formatDuration(call.duration_ms)}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-white/5">
          <div className="grid grid-cols-2 gap-2 text-[11px] pt-2">
            <div className="text-white/40">Payload:</div>
            <div className="text-white/70 font-mono text-right">{formatBytes(call.request_payload_chars)}</div>
            <div className="text-white/40">Duration:</div>
            <div className="text-white/70 font-mono text-right">{formatDuration(call.duration_ms)}</div>
            <div className="text-white/40">Status:</div>
            <div className={`text-right ${statusColor}`}>{call.status}</div>
          </div>
          {call.error && (
            <div className="rounded bg-red-900/20 border border-red-500/20 px-2 py-1">
              <div className="text-[10px] text-red-400 font-medium">Error</div>
              <div className="text-[11px] text-white/70 whitespace-pre-wrap">{call.error}</div>
              {call.code && (
                <div className="text-[10px] text-white/40 font-mono mt-0.5">{call.code}</div>
              )}
            </div>
          )}
          {call.metrics && Object.keys(call.metrics).length > 0 && (
            <div className="rounded bg-black/30 border border-white/10 px-2 py-1">
              <div className="text-[10px] text-white/40 font-medium mb-1">Metrics</div>
              <pre className="text-[10px] text-white/60 font-mono whitespace-pre-wrap">
                {JSON.stringify(call.metrics, null, 2)}
              </pre>
            </div>
          )}
          {(call.model || call.usage) && (
            <div className="grid grid-cols-2 gap-2 text-[11px] items-center">
              {call.model && (
                <>
                  <div className="text-white/40">Model:</div>
                  <div className="text-white/70 font-mono text-right truncate" title={call.model}>{call.model}</div>
                </>
              )}
              {call.usage && (
                <>
                  <div className="text-white/40">Usage:</div>
                  <div className="text-white/70 font-mono text-right">{formatTokens(call.usage.total_tokens)}</div>
                </>
              )}
            </div>
          )}
          {call.request && (
            <div className="rounded bg-black/30 border border-white/10 px-2 py-1 space-y-1">
              <div className="text-[10px] text-white/40 font-medium">Request</div>
              <div className="flex items-center gap-2 text-[11px]">
                <Badge variant="outline" className="text-[10px] h-4">{call.request.method}</Badge>
                <span className="text-white/70 font-mono truncate" title={call.request.url}>{call.request.url}</span>
              </div>
              <pre className="text-[10px] text-white/60 font-mono whitespace-pre-wrap max-h-48 overflow-auto">
                {JSON.stringify(call.request.body, null, 2)}
              </pre>
            </div>
          )}
          {call.prompt_text && (
            <div className="rounded bg-black/30 border border-white/10 px-2 py-1">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-white/40 font-medium">Prompt</div>
                <CopyButton text={call.prompt_text} label="Prompt" />
              </div>
              <pre className="text-[10px] text-white/60 font-mono whitespace-pre-wrap max-h-48 overflow-auto">
                {call.prompt_text}
              </pre>
            </div>
          )}
          {call.response_text && (
            <div className="rounded bg-black/30 border border-white/10 px-2 py-1">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-white/40 font-medium">Response</div>
                <CopyButton text={call.response_text} label="Response" />
              </div>
              <pre className="text-[10px] text-white/60 font-mono whitespace-pre-wrap max-h-48 overflow-auto">
                {call.response_text}
              </pre>
            </div>
          )}
          {call.response_summary && (
            <div className="rounded bg-black/30 border border-white/10 px-2 py-1">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-white/40 font-medium">Response summary</div>
                <CopyButton text={JSON.stringify(call.response_summary, null, 2)} label="Response summary" />
              </div>
              <pre className="text-[10px] text-white/60 font-mono whitespace-pre-wrap max-h-48 overflow-auto">
                {JSON.stringify(call.response_summary, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function QueryInspectDialog({ open, onOpenChange, step }: Props) {
  const calls = step?.calls ?? [];
  const totalPayload = calls.reduce((sum, c) => sum + (c.request_payload_chars ?? 0), 0);
  const duration = calls.reduce((sum, c) => sum + (c.duration_ms ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base font-semibold text-white">
            Query: {step?.intent_text || '—'}
          </DialogTitle>
          <div className="flex items-center gap-2 text-[11px] text-white/50">
            <span>#{step?.id}</span>
            <span>•</span>
            <span className="font-mono">{step?.action_type || 'discover'}</span>
            <span>•</span>
            <span>{calls.length} call{calls.length === 1 ? '' : 's'}</span>
            <span>•</span>
            <span>{formatDuration(duration)} total</span>
            <span>•</span>
            <span>{formatBytes(totalPayload)} payload</span>
          </div>
        </DialogHeader>

        <Tabs defaultValue="calls" className="flex flex-col flex-1 min-h-0">
          <TabsList variant="line" className="shrink-0">
            <TabsTrigger value="calls" className="text-xs">Tool Calls ({calls.length})</TabsTrigger>
            <TabsTrigger value="json" className="text-xs">Raw JSON</TabsTrigger>
          </TabsList>
          <TabsContent value="calls" className="flex-1 min-h-0 mt-0 overflow-y-auto">
            {calls.length === 0 ? (
              <p className="text-xs text-white/40 py-2">No tool calls recorded for this step.</p>
            ) : (
              <div className="space-y-1.5 pr-1">
                {calls.map((call, i) => (
                  <CallRow key={i} call={call} index={i} />
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="json" className="mt-0">
            <div className="flex justify-end mb-1">
              <CopyButton text={JSON.stringify(step, null, 2)} label="Raw JSON" />
            </div>
            <pre className="max-h-[50vh] overflow-auto text-[10px] text-white/70 font-mono bg-black/30 border border-white/10 rounded p-2">
              {JSON.stringify(step, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>

        <DialogHeader className="shrink-0 mt-2">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
