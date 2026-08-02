'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectValue,
  SelectTrigger,
  SelectPopup,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { serversApi, contextualGraphApi } from '@/lib/api/client';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import {
  Download,
  Sparkles,
  Plus,
  Trash2,
  Edit,
  RefreshCw,
  Network,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ContextualGraphPage');

interface GraphNode {
  id: string;
  labels: string[];
  properties: Record<string, any>;
}

interface GraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  type: string | null;
  properties: Record<string, any>;
}

interface LogEntry {
  id: string;
  time: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  details?: any;
}

export default function ContextualGraphPage() {
  const [servers, setServers] = useState<Array<{ id: number; name: string }>>([]);
  const [banks, setBanks] = useState<Array<{ bank_id: string; name: string }>>([]);
  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
  } = usePersistentServerBank(servers, banks);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loadingServers, setLoadingServers] = useState(true);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [runningImport, setRunningImport] = useState(false);
  const [runningAddContext, setRunningAddContext] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'nodes' | 'edges' | 'log'>('nodes');

  const [nodeDialogOpen, setNodeDialogOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<GraphNode | null>(null);
  const [nodeForm, setNodeForm] = useState({ id: '', labels: '', properties: '{}' });

  const [edgeDialogOpen, setEdgeDialogOpen] = useState(false);
  const [editingEdge, setEditingEdge] = useState<GraphEdge | null>(null);
  const [edgeForm, setEdgeForm] = useState({ id: '', source_id: '', target_id: '', type: '', properties: '{}' });

  const [runDiscovery, setRunDiscovery] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const serverId = selectedServerId ? Number(selectedServerId) : 0;
  const bankId = selectedBankId;

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', details?: any) => {
    setLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        time: new Date().toLocaleTimeString(),
        message,
        type,
        details,
      },
      ...prev,
    ]);
  }, []);

  useEffect(() => {
    async function loadServers() {
      try {
        setLoadingServers(true);
        const data = await serversApi.list();
        setServers(data.map((s) => ({ id: s.id, name: s.name || s.base_url })));
      } catch (err) {
        logger.error('Failed to load servers', { error: err });
        toast.error('Failed to load servers');
      } finally {
        setLoadingServers(false);
      }
    }
    loadServers();
  }, []);

  useEffect(() => {
    if (!serverId) {
      setBanks([]);
      return;
    }
    async function loadBanks() {
      try {
        setLoadingBanks(true);
        const data = await serversApi.listBanks(serverId);
        setBanks(data);
      } catch (err) {
        logger.error('Failed to load banks', { error: err, serverId });
        toast.error('Failed to load banks');
      } finally {
        setLoadingBanks(false);
      }
    }
    loadBanks();
  }, [serverId]);

  const loadGraph = useCallback(async () => {
    if (!serverId || !bankId) return;
    try {
      setLoadingGraph(true);
      const [nodesData, edgesData] = await Promise.all([
        contextualGraphApi.listNodes(serverId, bankId, { limit: 1000 }),
        contextualGraphApi.listEdges(serverId, bankId, { limit: 1000 }),
      ]);
      setNodes(nodesData);
      setEdges(edgesData);
      addLog(`Loaded ${nodesData.length} nodes, ${edgesData.length} edges`, 'info');
    } catch (err: any) {
      logger.error('Failed to load graph', { error: err, serverId, bankId });
      addLog(`Failed to load graph: ${err.message || err}`, 'error');
      toast.error('Failed to load graph');
    } finally {
      setLoadingGraph(false);
    }
  }, [serverId, bankId, addLog]);

  useEffect(() => {
    if (serverId && bankId) {
      loadGraph();
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [serverId, bankId, loadGraph]);

  const handleImport = async () => {
    if (!serverId || !bankId) {
      toast.error('Select a server and bank first');
      return;
    }
    try {
      setRunningImport(true);
      addLog(`Importing Hindsight skeleton for ${bankId}...`, 'info');
      const result = await contextualGraphApi.import(serverId, bankId);
      if (result.success) {
        addLog(
          `Imported ${result.imported?.nodes ?? 0} nodes, ${result.imported?.edges ?? 0} edges (raw: ${result.raw?.nodes ?? 0}/${result.raw?.edges ?? 0})`,
          'success',
          result
        );
        toast.success('Skeleton imported');
        await loadGraph();
      } else {
        addLog(`Import failed: ${result.error}`, 'error', result);
        toast.error(result.error || 'Import failed');
      }
    } catch (err: any) {
      addLog(`Import error: ${err.message || err}`, 'error');
      toast.error('Import error');
    } finally {
      setRunningImport(false);
    }
  };

  const handleAddContext = async () => {
    if (!serverId || !bankId) {
      toast.error('Select a server and bank first');
      return;
    }
    try {
      setRunningAddContext(true);
      addLog(`Running add-context for ${bankId} (discovery=${runDiscovery})...`, 'info');
      const result = await contextualGraphApi.addContext(serverId, bankId, {
        neighborhood: { run_discovery: runDiscovery },
      });
      if (result.success) {
        addLog(
          `Queued entity=${result.queued?.entity ?? 0} edge=${result.queued?.edge ?? 0} discover=${result.queued?.discover ?? 0}. Deployed ${result.deployed?.length ?? 0}, failed ${result.failed?.length ?? 0}.`,
          'success',
          result
        );
        if (result.failed && result.failed.length > 0) {
          for (const f of result.failed) {
            addLog(`Deploy failed: ${f.ext_id} — ${f.error}`, 'warning', f);
          }
        }
        toast.success('Add-context complete');
        await loadGraph();
      } else {
        addLog(`Add-context failed: ${result.error}`, 'error', result);
        toast.error(result.error || 'Add-context failed');
      }
    } catch (err: any) {
      addLog(`Add-context error: ${err.message || err}`, 'error');
      toast.error('Add-context error');
    } finally {
      setRunningAddContext(false);
    }
  };

  const handleClear = async () => {
    if (!serverId || !bankId) {
      toast.error('Select a server and bank first');
      return;
    }
    try {
      setClearing(true);
      addLog(`Clearing working graph for ${bankId}...`, 'warning');
      const result = await contextualGraphApi.clear(serverId, bankId);
      if (result.success) {
        const clearedNodes = result.cleared?.nodes ?? 0;
        const clearedEdges = result.cleared?.edges ?? 0;
        addLog(`Cleared ${clearedNodes} nodes and ${clearedEdges} edges for ${bankId}`, 'success', result);
        toast.success(`Cleared ${clearedNodes} nodes and ${clearedEdges} edges`);
        await loadGraph();
      } else {
        addLog(`Clear failed: ${result.error}`, 'error', result);
        toast.error(result.error || 'Clear failed');
      }
    } catch (err: any) {
      addLog(`Clear error: ${err.message || err}`, 'error');
      toast.error('Clear error');
    } finally {
      setClearing(false);
      setClearConfirmOpen(false);
    }
  };

  const openNodeDialog = (node?: GraphNode) => {
    if (node) {
      setEditingNode(node);
      setNodeForm({
        id: node.id,
        labels: node.labels.join(', '),
        properties: JSON.stringify(node.properties, null, 2),
      });
    } else {
      setEditingNode(null);
      setNodeForm({ id: '', labels: 'active', properties: '{}' });
    }
    setNodeDialogOpen(true);
  };

  const saveNode = async () => {
    if (!serverId || !bankId) return;
    try {
      const labels = nodeForm.labels
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      const properties = JSON.parse(nodeForm.properties || '{}');
      const id = nodeForm.id.trim();
      if (!id) {
        toast.error('Node id is required');
        return;
      }
      await contextualGraphApi.upsertNode(id, serverId, bankId, { labels, properties });
      addLog(`Upserted node ${id}`, 'success');
      toast.success('Node saved');
      setNodeDialogOpen(false);
      await loadGraph();
    } catch (err: any) {
      addLog(`Failed to save node: ${err.message || err}`, 'error');
      toast.error('Failed to save node');
    }
  };

  const deleteNode = async (id: string) => {
    if (!serverId || !bankId) return;
    try {
      await contextualGraphApi.deleteNode(id, serverId, bankId);
      addLog(`Deleted node ${id}`, 'success');
      toast.success('Node deleted');
      await loadGraph();
    } catch (err: any) {
      addLog(`Failed to delete node: ${err.message || err}`, 'error');
      toast.error('Failed to delete node');
    }
  };

  const openEdgeDialog = (edge?: GraphEdge) => {
    if (edge) {
      setEditingEdge(edge);
      setEdgeForm({
        id: edge.id,
        source_id: edge.source_id,
        target_id: edge.target_id,
        type: edge.type || '',
        properties: JSON.stringify(edge.properties, null, 2),
      });
    } else {
      setEditingEdge(null);
      setEdgeForm({ id: '', source_id: '', target_id: '', type: '', properties: '{"directed": false}' });
    }
    setEdgeDialogOpen(true);
  };

  const saveEdge = async () => {
    if (!serverId || !bankId) return;
    try {
      const properties = JSON.parse(edgeForm.properties || '{}');
      const id = edgeForm.id.trim();
      const sourceId = edgeForm.source_id.trim();
      const targetId = edgeForm.target_id.trim();
      if (!id || !sourceId || !targetId) {
        toast.error('Edge id, source, and target are required');
        return;
      }
      await contextualGraphApi.upsertEdge(id, serverId, bankId, {
        source_id: sourceId,
        target_id: targetId,
        type: edgeForm.type.trim() || null,
        properties,
      });
      addLog(`Upserted edge ${id}`, 'success');
      toast.success('Edge saved');
      setEdgeDialogOpen(false);
      await loadGraph();
    } catch (err: any) {
      addLog(`Failed to save edge: ${err.message || err}`, 'error');
      toast.error('Failed to save edge');
    }
  };

  const deleteEdge = async (id: string) => {
    if (!serverId || !bankId) return;
    try {
      await contextualGraphApi.deleteEdge(id, serverId, bankId);
      addLog(`Deleted edge ${id}`, 'success');
      toast.success('Edge deleted');
      await loadGraph();
    } catch (err: any) {
      addLog(`Failed to delete edge: ${err.message || err}`, 'error');
      toast.error('Failed to delete edge');
    }
  };

  const scopeReady = serverId > 0 && bankId;

  return (
    <PageShell
      title="Contextual Graph"
      subtitle="Import Hindsight skeletons, run context jobs, and curate the working graph."
      count={activeTab === 'nodes' ? nodes.length : edges.length}
      countLabel={activeTab === 'nodes' ? 'node' : 'edge'}
      tabs={[
        { value: 'nodes', label: 'Nodes' },
        { value: 'edges', label: 'Edges' },
        { value: 'log', label: 'Log' },
      ]}
      activeTab={activeTab}
      onTabChange={(v) => setActiveTab(v as typeof activeTab)}
      loading={loadingServers || loadingBanks || loadingGraph}
    >
      <div className="space-y-4 flex flex-col flex-1 min-h-0">
        {/* Scope + Actions */}
        <Card className="bg-[oklch(0.23_0_0)] border-white/[0.08]">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5 min-w-[200px]">
                <Label className="text-xs text-white/60">Hindsight Server</Label>
                <Select value={selectedServerId} onValueChange={(v) => setSelectedServerId(v ?? '')} disabled={loadingServers}>
                  <SelectTrigger className="bg-black/20 border-white/10">
                    <SelectValue placeholder={loadingServers ? 'Loading...' : 'Select server'} />
                  </SelectTrigger>
                  <SelectPopup>
                    {servers.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name} (#{s.id})
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              <div className="space-y-1.5 min-w-[200px]">
                <Label className="text-xs text-white/60">Bank</Label>
                <Select value={selectedBankId} onValueChange={(v) => setSelectedBankId(v ?? '')} disabled={!serverId || loadingBanks}>
                  <SelectTrigger className="bg-black/20 border-white/10">
                    <SelectValue placeholder={loadingBanks ? 'Loading...' : 'Select bank'} />
                  </SelectTrigger>
                  <SelectPopup>
                    {banks.map((b) => (
                      <SelectItem key={b.bank_id} value={b.bank_id}>
                        {b.name || b.bank_id}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              <Button
                variant="outline"
                onClick={handleImport}
                disabled={!scopeReady || runningImport || runningAddContext}
                className="border-white/10"
              >
                <Download className="h-4 w-4 mr-2" />
                {runningImport ? 'Importing...' : 'Import Skeleton'}
              </Button>

              <Button
                onClick={handleAddContext}
                disabled={!scopeReady || runningImport || runningAddContext}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {runningAddContext ? 'Running...' : 'Add Context'}
              </Button>

              <div className="flex items-center gap-2 pb-1">
                <Checkbox
                  id="run-discovery"
                  checked={runDiscovery}
                  onCheckedChange={(c) => setRunDiscovery(c === true)}
                />
                <Label htmlFor="run-discovery" className="text-xs text-white/70 cursor-pointer">
                  Run discovery queue
                </Label>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={loadGraph}
                disabled={!scopeReady || loadingGraph}
                className="ml-auto"
              >
                <RefreshCw className={`h-4 w-4 ${loadingGraph ? 'animate-spin' : ''}`} />
              </Button>

              <Button
                variant="outline"
                onClick={() => setClearConfirmOpen(true)}
                disabled={!scopeReady || runningImport || runningAddContext || clearing}
                className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {clearing ? 'Clearing...' : 'Clear Working Graph'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Main content by tab */}
        {activeTab === 'nodes' && (
          <Card className="flex-1 min-h-0 bg-[oklch(0.23_0_0)] border-white/[0.08] flex flex-col">
            <CardHeader className="py-3 px-4 border-b border-white/[0.08]">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Network className="h-4 w-4" />
                  Working Graph Nodes
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => openNodeDialog()} className="border-white/10">
                  <Plus className="h-4 w-4 mr-1" /> Add Node
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.08] hover:bg-transparent">
                    <TableHead className="text-white/50">ID</TableHead>
                    <TableHead className="text-white/50">Labels</TableHead>
                    <TableHead className="text-white/50">Properties</TableHead>
                    <TableHead className="text-white/50 w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-white/40 py-8">
                        No nodes for this scope. Import a skeleton or add one manually.
                      </TableCell>
                    </TableRow>
                  )}
                  {nodes.map((node) => (
                    <TableRow key={node.id} className="border-white/[0.06]">
                      <TableCell className="font-mono text-xs max-w-[200px] truncate" title={node.id}>
                        {node.id}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {node.labels.map((label) => (
                            <Badge key={label} variant="secondary" className="text-[10px] bg-white/10 text-white/80">
                              {label}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <pre className="text-[10px] text-white/60 max-w-[300px] truncate">
                          {JSON.stringify(node.properties)}
                        </pre>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openNodeDialog(node)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300" onClick={() => deleteNode(node.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {activeTab === 'edges' && (
          <Card className="flex-1 min-h-0 bg-[oklch(0.23_0_0)] border-white/[0.08] flex flex-col">
            <CardHeader className="py-3 px-4 border-b border-white/[0.08]">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <ArrowRight className="h-4 w-4" />
                  Working Graph Edges
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => openEdgeDialog()} className="border-white/10">
                  <Plus className="h-4 w-4 mr-1" /> Add Edge
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.08] hover:bg-transparent">
                    <TableHead className="text-white/50">ID</TableHead>
                    <TableHead className="text-white/50">Source</TableHead>
                    <TableHead className="text-white/50">Target</TableHead>
                    <TableHead className="text-white/50">Type</TableHead>
                    <TableHead className="text-white/50">Properties</TableHead>
                    <TableHead className="text-white/50 w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {edges.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-white/40 py-8">
                        No edges for this scope. Import a skeleton or add one manually.
                      </TableCell>
                    </TableRow>
                  )}
                  {edges.map((edge) => (
                    <TableRow key={edge.id} className="border-white/[0.06]">
                      <TableCell className="font-mono text-xs max-w-[150px] truncate" title={edge.id}>
                        {edge.id}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[150px] truncate" title={edge.source_id}>
                        {edge.source_id}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[150px] truncate" title={edge.target_id}>
                        {edge.target_id}
                      </TableCell>
                      <TableCell className="text-xs text-white/70">{edge.type || '-'}</TableCell>
                      <TableCell>
                        <pre className="text-[10px] text-white/60 max-w-[250px] truncate">
                          {JSON.stringify(edge.properties)}
                        </pre>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdgeDialog(edge)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300" onClick={() => deleteEdge(edge.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {activeTab === 'log' && (
          <Card className="flex-1 min-h-0 bg-[oklch(0.23_0_0)] border-white/[0.08] flex flex-col">
            <CardHeader className="py-3 px-4 border-b border-white/[0.08]">
              <CardTitle className="text-sm font-medium">Operation Log</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-0 overflow-auto">
              <div className="p-4 space-y-2">
                {logs.length === 0 && (
                  <p className="text-white/40 text-sm">No operations yet.</p>
                )}
                {logs.map((log) => (
                  <div key={log.id} className="text-sm border-l-2 pl-3 py-1" style={{ borderColor: log.type === 'success' ? '#10b981' : log.type === 'error' ? '#ef4444' : log.type === 'warning' ? '#f59e0b' : '#6b7280' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/40 font-mono">{log.time}</span>
                      <span className={log.type === 'success' ? 'text-emerald-400' : log.type === 'error' ? 'text-red-400' : log.type === 'warning' ? 'text-amber-400' : 'text-white/70'}>
                        {log.message}
                      </span>
                    </div>
                    {log.details && (
                      <pre className="text-[10px] text-white/40 mt-1 overflow-x-auto">
                        {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Clear Working Graph Confirmation Dialog */}
      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent className="bg-[oklch(0.24_0_0)] border-white/10 text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <Trash2 className="h-5 w-5" />
              Clear Working Graph?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/70 py-2">
            This will permanently delete every node and edge in the working graph for
            <span className="text-white font-mono"> {bankId || 'this bank'}</span>.
            This does not affect Hindsight, mental models, or the catalog.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearConfirmOpen(false)} className="border-white/10" disabled={clearing}>
              Cancel
            </Button>
            <Button onClick={handleClear} className="bg-red-600 hover:bg-red-700" disabled={clearing}>
              {clearing ? 'Clearing...' : 'Clear Working Graph'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Node Dialog */}
      <Dialog open={nodeDialogOpen} onOpenChange={setNodeDialogOpen}>
        <DialogContent className="bg-[oklch(0.24_0_0)] border-white/10 text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingNode ? 'Edit Node' : 'Add Node'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-white/60">ID</Label>
              <Input
                value={nodeForm.id}
                onChange={(e) => setNodeForm({ ...nodeForm, id: e.target.value })}
                disabled={!!editingNode}
                className="bg-black/20 border-white/10 font-mono text-sm"
                placeholder="svc:SVC-001"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-white/60">Labels (comma-separated)</Label>
              <Input
                value={nodeForm.labels}
                onChange={(e) => setNodeForm({ ...nodeForm, labels: e.target.value })}
                className="bg-black/20 border-white/10 text-sm"
                placeholder="active, canonical"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-white/60">Properties (JSON)</Label>
              <Textarea
                value={nodeForm.properties}
                onChange={(e) => setNodeForm({ ...nodeForm, properties: e.target.value })}
                className="bg-black/20 border-white/10 font-mono text-xs min-h-[120px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNodeDialogOpen(false)} className="border-white/10">Cancel</Button>
            <Button onClick={saveNode} className="bg-emerald-600 hover:bg-emerald-700">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edge Dialog */}
      <Dialog open={edgeDialogOpen} onOpenChange={setEdgeDialogOpen}>
        <DialogContent className="bg-[oklch(0.24_0_0)] border-white/10 text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEdge ? 'Edit Edge' : 'Add Edge'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-white/60">ID</Label>
              <Input
                value={edgeForm.id}
                onChange={(e) => setEdgeForm({ ...edgeForm, id: e.target.value })}
                disabled={!!editingEdge}
                className="bg-black/20 border-white/10 font-mono text-sm"
                placeholder="edge-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-white/60">Source ID</Label>
                <Input
                  value={edgeForm.source_id}
                  onChange={(e) => setEdgeForm({ ...edgeForm, source_id: e.target.value })}
                  className="bg-black/20 border-white/10 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-white/60">Target ID</Label>
                <Input
                  value={edgeForm.target_id}
                  onChange={(e) => setEdgeForm({ ...edgeForm, target_id: e.target.value })}
                  className="bg-black/20 border-white/10 font-mono text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-white/60">Type (optional)</Label>
              <Input
                value={edgeForm.type}
                onChange={(e) => setEdgeForm({ ...edgeForm, type: e.target.value })}
                className="bg-black/20 border-white/10 text-sm"
                placeholder="depends-on"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-white/60">Properties (JSON)</Label>
              <Textarea
                value={edgeForm.properties}
                onChange={(e) => setEdgeForm({ ...edgeForm, properties: e.target.value })}
                className="bg-black/20 border-white/10 font-mono text-xs min-h-[120px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdgeDialogOpen(false)} className="border-white/10">Cancel</Button>
            <Button onClick={saveEdge} className="bg-emerald-600 hover:bg-emerald-700">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
