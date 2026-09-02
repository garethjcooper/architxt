'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ServerBankSelectors, type SelectorBank } from '@/app/research-shared/server-bank-selectors';
import { contextualGraphApi } from '@/lib/api/client';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format } from 'date-fns';
import { RefreshCw, XCircle, AlertTriangle } from 'lucide-react';

const logger = createLogger('SyncJobsTab');

type DateRange = 'today' | '2d' | '7d' | '30d' | 'all' | 'custom';

const RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '2d', label: 'Last 2 days' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  running: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  failed: 'bg-red-500/20 text-red-300 border-red-500/30',
  cancelled: 'bg-white/10 text-white/50 border-white/10',
};

const STAGE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-white/20',
  running: 'bg-blue-500 animate-pulse',
  completed: 'bg-emerald-500',
  completed_with_issues: 'bg-amber-500',
  failed: 'bg-red-500',
};

const STAGE_LABEL_COLORS: Record<string, string> = {
  failed: 'text-red-400',
  completed_with_issues: 'text-amber-400',
  running: 'text-blue-400',
  completed: 'text-white/40',
  pending: 'text-white/40',
};

function getIssueCount(job: any): number {
  const stats = job?.stats || {};
  if (typeof stats.issue_count === 'number') return stats.issue_count;
  let count = 0;
  for (const key of Object.keys(stats)) {
    if (key === 'issue_count') continue;
    const stageStats = stats[key]?.stats || stats[key] || {};
    if (typeof stageStats.failed === 'number' && stageStats.failed > 0) count += stageStats.failed;
    if (Array.isArray(stageStats.errors)) count += stageStats.errors.length;
  }
  return count;
}

function collectStageIssues(job: any): Array<{ stage: string; label?: string; extId?: string; messages: string[] }> {
  const issues: Array<{ stage: string; label?: string; extId?: string; messages: string[] }> = [];
  for (const stage of job?.stages || []) {
    const stats = stage?.stats?.stats || stage?.stats || {};
    if (Array.isArray(stats.errors)) {
      for (const item of stats.errors) {
        if (typeof item === 'string') {
          issues.push({ stage: stage.name, label: stage.label, messages: [item] });
        } else if (item && typeof item === 'object') {
          const extId = item.extId || item.id || item.nodeId || item.edgeId;
          const messages = Array.isArray(item.errors)
            ? item.errors
            : Array.isArray(item.messages)
            ? item.messages
            : item.error
            ? [item.error]
            : [JSON.stringify(item)];
          issues.push({ stage: stage.name, label: stage.label, extId, messages });
        }
      }
    }
  }
  return issues;
}

function toIsoStart(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

function toIsoEnd(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return new Date(d.getTime() - 1).toISOString();
}

function rangeToDates(range: DateRange, customSince: string, customUntil: string): { since?: string; until?: string } {
  const now = new Date();
  switch (range) {
    case 'today':
      return { since: toIsoStart(now), until: toIsoEnd(now) };
    case '2d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return { since: toIsoStart(d), until: toIsoEnd(now) };
    }
    case '7d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { since: toIsoStart(d), until: toIsoEnd(now) };
    }
    case '30d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      return { since: toIsoStart(d), until: toIsoEnd(now) };
    }
    case 'custom': {
      const since = customSince ? new Date(customSince).toISOString() : undefined;
      const until = customUntil ? new Date(customUntil).toISOString() : undefined;
      return { since, until };
    }
    case 'all':
    default:
      return {};
  }
}

function formatDuration(start?: string, end?: string): string {
  if (!start) return '-';
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  const ms = Math.max(0, b - a);
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins}m ${rem}s`;
}

export function SyncJobsTab({
  servers,
  banks,
  loadingBanks,
  selectedServerId,
  selectedBankId,
  isActive,
}: {
  servers: Array<{ id: number; name?: string; base_url?: string }>;
  banks: SelectorBank[];
  loadingBanks: boolean;
  selectedServerId: string;
  selectedBankId: string;
  isActive?: boolean;
}) {
  const [jobs, setJobs] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<DateRange>('today');
  const [status, setStatus] = useState<string | null>('');
  const [customSince, setCustomSince] = useState('');
  const [customUntil, setCustomUntil] = useState('');
  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const serverId = selectedServerId ? Number(selectedServerId) : 0;
  const bankId = selectedBankId;

  const filters = useMemo(() => {
    const dates = rangeToDates(range, customSince, customUntil);
    return {
      ...(serverId ? { serverId } : {}),
      ...(bankId ? { bankId } : {}),
      ...(status ? { status } : {}),
      ...(dates.since ? { since: dates.since } : {}),
      ...(dates.until ? { until: dates.until } : {}),
      limit: 100,
    };
  }, [serverId, bankId, status, range, customSince, customUntil]);

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await contextualGraphApi.listSyncJobs(filters);
      setJobs(data);
    } catch (err: any) {
      logger.error('Failed to load sync jobs', { error: err });
      toast.error(`Failed to load sync jobs: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (!isActive) return;
    loadJobs();
  }, [isActive, loadJobs]);

  useEffect(() => {
    if (!autoRefresh || !isActive) return;
    const id = setInterval(loadJobs, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, isActive, loadJobs]);

  const loadJobDetail = useCallback(async (jobId: string) => {
    try {
      setLogsLoading(true);
      const data = await contextualGraphApi.getSyncJob(jobId, { limit: 200 });
      setSelectedJob(data);
    } catch (err: any) {
      logger.error('Failed to load sync job detail', { error: err, jobId });
      toast.error(`Failed to load job detail: ${err.message || err}`);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const handleCancel = useCallback(async (jobId: string) => {
    if (!window.confirm(`Cancel sync job ${jobId}?`)) return;
    try {
      const result = await contextualGraphApi.cancelSyncJob(jobId);
      if (result.success) {
        toast.success('Job cancellation requested');
        await loadJobs();
        if (selectedJob?.id === jobId) {
          await loadJobDetail(jobId);
        }
      } else {
        toast.error(`Cancel failed: ${result.error || result.code || 'unknown'}`);
      }
    } catch (err: any) {
      logger.error('Failed to cancel sync job', { error: err, jobId });
      toast.error(`Cancel failed: ${err.message || err}`);
    }
  }, [loadJobs, loadJobDetail, selectedJob]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange((e.target.value as DateRange) || 'today')}
            className="h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
          >
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={status ?? ''}
            onChange={(e) => setStatus(e.target.value)}
            className="h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value || 'any'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customSince}
              onChange={(e) => setCustomSince(e.target.value)}
              className="h-8 rounded border border-white/10 bg-white/5 px-2 text-xs text-white"
            />
            <span className="text-white/40">→</span>
            <input
              type="date"
              value={customUntil}
              onChange={(e) => setCustomUntil(e.target.value)}
              className="h-8 rounded border border-white/10 bg-white/5 px-2 text-xs text-white"
            />
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1.5 text-[11px] text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-emerald-500"
            />
            Auto-refresh
          </label>
          <Button variant="outline" size="sm" disabled={loading} onClick={loadJobs}>
            <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex mt-2 gap-2">
        <Card className="min-h-0 border-white/10 bg-[oklch(0.23_0_0)] flex flex-col overflow-hidden pt-0" style={{ flex: 1.2 }}>
          <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
            <span className="font-medium text-sm">Sync jobs</span>
            <span className="text-xs font-mono text-emerald-400 bg-black/30 border border-emerald-500/30 px-2 py-0.5 rounded">
              {jobs.length}
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
            {loading ? (
              <div className="p-3 space-y-2">
                <Skeleton className="h-10 w-full bg-white/10" />
                <Skeleton className="h-10 w-full bg-white/10" />
                <Skeleton className="h-10 w-full bg-white/10" />
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-[11px] text-white/40 px-2 py-3">No sync jobs match the current filters.</div>
            ) : (
              jobs.map((job) => {
                const active = selectedJob?.id === job.id;
                const issueCount = getIssueCount(job);
                const hasIssues = issueCount > 0;

                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => {
                      setSelectedJob(job);
                      loadJobDetail(job.id);
                    }}
                    className={cn(
                      'w-full text-left rounded border px-2 py-1.5 transition-colors',
                      active ? 'bg-emerald-900/30 border-emerald-500/50' : 'bg-black/10 border-white/5 hover:bg-white/5'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className={cn('text-[9px] px-1 py-0', STATUS_COLORS[job.status] || 'bg-white/10 text-white/50')}>
                          {job.status}
                        </Badge>
                        {hasIssues && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-500/20 text-amber-300 border-amber-500/30">
                            {issueCount} issue{issueCount === 1 ? '' : 's'}
                          </Badge>
                        )}
                        <span className="text-[10px] font-mono text-white/50 truncate">{job.id.slice(0, 8)}</span>
                      </div>
                      <span className="text-[10px] text-white/40 shrink-0">{formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}</span>
                    </div>
                    <div className="text-[11px] text-white/80 mt-1 truncate">
                      {servers.find((s) => s.id === job.server_id)?.name || `Server ${job.server_id}`} → {job.bank_id}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-white/40">
                      <span>duration {formatDuration(job.started_at, job.finished_at)}</span>
                      {job.error_code && <span className="text-red-400">{job.error_code}</span>}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        <Card className="min-h-0 border-white/10 bg-[oklch(0.23_0_0)] flex flex-col overflow-hidden pt-0" style={{ flex: 1.8 }}>
          {selectedJob ? (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
                <span className="font-medium text-sm">Job {selectedJob.id.slice(0, 8)}</span>
                <div className="flex items-center gap-2">
                  {['pending', 'running'].includes(selectedJob.status) && (
                    <Button variant="outline" size="sm" onClick={() => handleCancel(selectedJob.id)}>
                      <XCircle className="w-3.5 h-3.5 mr-1.5" />
                      Cancel
                    </Button>
                  )}
                  <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', STATUS_COLORS[selectedJob.status] || 'bg-white/10 text-white/50')}>
                    {selectedJob.status}
                  </Badge>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div>
                    <div className="text-white/40 uppercase tracking-wider text-[10px]">Server</div>
                    <div className="text-white/80">{servers.find((s) => s.id === selectedJob.server_id)?.name || `Server ${selectedJob.server_id}`}</div>
                  </div>
                  <div>
                    <div className="text-white/40 uppercase tracking-wider text-[10px]">Bank</div>
                    <div className="text-white/80 font-mono">{selectedJob.bank_id}</div>
                  </div>
                  <div>
                    <div className="text-white/40 uppercase tracking-wider text-[10px]">Created</div>
                    <div className="text-white/80">{format(new Date(selectedJob.created_at), 'yyyy-MM-dd HH:mm:ss')}</div>
                  </div>
                  <div>
                    <div className="text-white/40 uppercase tracking-wider text-[10px]">Duration</div>
                    <div className="text-white/80">{formatDuration(selectedJob.started_at, selectedJob.finished_at)}</div>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Stages</div>
                  <div className="space-y-1">
                    {selectedJob.stages?.map((stage: any) => {
                      const stageIssues = stage.issue_count > 0 || stage.status === 'completed_with_issues';
                      return (
                        <div key={stage.name} className="flex items-center justify-between rounded border border-white/5 bg-black/10 px-2 py-1">
                          <div className="flex items-center gap-2">
                            <span className={cn('w-2 h-2 rounded-full', STAGE_STATUS_COLORS[stage.status] || 'bg-white/20')} />
                            <span className="text-[11px] text-white/80">{stage.label || stage.name}</span>
                            {stageIssues && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                          </div>
                          <div className="flex items-center gap-2">
                            {stage.issue_count > 0 && (
                              <span className="text-[10px] text-amber-400">{stage.issue_count} issue{stage.issue_count === 1 ? '' : 's'}</span>
                            )}
                            <span className={cn('text-[10px]', STAGE_LABEL_COLORS[stage.status] || 'text-white/40')}>
                              {stage.status === 'completed_with_issues' ? 'completed with issues' : stage.status}
                            </span>
                          </div>
                        </div>
                      );
                    }) || <span className="text-white/40 italic">No stage data.</span>}
                  </div>
                </div>

                {selectedJob.error_message && (
                  <div className="rounded border border-red-500/20 bg-red-900/20 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-red-300 mb-1">Error</div>
                    <div className="text-[11px] text-white/80">{selectedJob.error_message}</div>
                    {selectedJob.error_code && <div className="text-[10px] text-red-300 mt-1 font-mono">{selectedJob.error_code}</div>}
                  </div>
                )}

                {(() => {
                  const issues = collectStageIssues(selectedJob);
                  if (issues.length === 0) return null;
                  return (
                    <div className="rounded border border-amber-500/20 bg-amber-900/20 p-2">
                      <div className="text-[10px] uppercase tracking-wider text-amber-300 mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Issues ({issues.length})
                      </div>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {issues.slice(0, 20).map((issue, idx) => (
                          <div key={idx} className="rounded bg-black/20 p-1.5">
                            <div className="text-[10px] text-amber-300/80">
                              {issue.label || issue.stage}
                              {issue.extId && <span className="text-white/50 ml-1 font-mono">{issue.extId}</span>}
                            </div>
                            <ul className="mt-1 space-y-0.5">
                              {issue.messages.slice(0, 3).map((msg, mIdx) => (
                                <li key={mIdx} className="text-[11px] text-white/70">{msg}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                        {issues.length > 20 && (
                          <div className="text-[10px] text-amber-300/70 italic">…and {issues.length - 20} more</div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Logs</div>
                  {logsLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-6 w-full bg-white/10" />
                      <Skeleton className="h-6 w-full bg-white/10" />
                    </div>
                  ) : selectedJob.logs?.length === 0 ? (
                    <span className="text-white/40 italic text-[11px]">No logs captured yet.</span>
                  ) : (
                    <div className="space-y-1">
                      {selectedJob.logs.map((log: any) => (
                        <div key={log.id} className="flex items-start gap-2 rounded border border-white/5 bg-black/10 px-2 py-1.5">
                          <span className={cn('text-[9px] uppercase px-1 rounded shrink-0', log.level === 'error' ? 'bg-red-500/20 text-red-300' : log.level === 'warn' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300')}>
                            {log.level}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-white/40">{format(new Date(log.created_at), 'HH:mm:ss')} {log.stage ? `· ${log.stage}` : ''}</div>
                            <div className="text-[11px] text-white/80">{log.message}</div>
                            {log.details && (
                              <pre className="mt-1 text-[10px] text-white/50 bg-black/20 rounded p-1 overflow-x-auto">
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-white/50 text-sm px-6 text-center">
              <p>Select a sync job from the left to view its stages, logs, and issues.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
