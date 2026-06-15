/**
 * HTTP API Client for architxt Backend
 * 
 * 100% decoupled - only HTTP calls to Express backend
 */

import type { Document, Context, Tag, Server, Metadata, Entity, EntityType } from '../types';

const API_URL = '/api/v1';  // Relative - uses Next.js rewrite to backend

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      data?.error || `Request failed: ${response.statusText}`,
      response.status,
      data?.code || 'UNKNOWN_ERROR'
    );
  }

  return data as T;
}

// Documents API
export const documentsApi = {
  list: (params?: { status?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    query.set('limit', (params?.limit ?? 1000).toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    const queryString = query.toString();
    return fetchApi<Document[]>(`/documents${queryString ? '?' + queryString : ''}`);
  },

  get: (id: number) => fetchApi<Document>(`/documents/${id}`),

  getProcessingStatus: () =>
    fetchApi<{
      processing: {
        document: { id: number; ext_id: string | null; filename: string | null; status: string };
        progress: any | null;
        history: any | null;
      } | null;
    }>(`/documents/processing`),

  getContent: (id: number) =>
    fetchApi<{ content: string | null; content_hash: string | null; content_blocks: any[] | null }>(`/documents/${id}/content`),

  getProcessingHistory: (id: number) =>
    fetchApi<{ processing_history: any[] | null }>(`/documents/${id}/processinghistory`),

  create: (file: File, extId: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('ext_id', extId);
    return fetch(`${API_URL}/documents`, {
      method: 'POST',
      body: formData,
    });
  },

  // API field names: context_id (not DB ctxt_id)
  update: (id: number, data: { ext_id?: string; context_id?: number | null; content?: string | null; blocks?: any[] | null }) => 
    fetchApi<{ success: boolean }>(`/documents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) => 
    fetchApi<void>(`/documents/${id}`, { method: 'DELETE' }),

  // Workflow
  getImage: (id: number, imageId: string) =>
    fetch(`${API_URL}/documents/${id}/images/${imageId}`),

  claim: (id: number) => 
    fetchApi<Document>(`/documents/${id}/claim`, { method: 'POST' }),

  release: (id: number, reason: string) => 
    fetchApi<Document>(`/documents/${id}/release`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  markReady: (id: number) => 
    fetchApi<Document>(`/documents/${id}/ready`, { method: 'POST' }),

  process: (id: number) => 
    fetchApi<Document>(`/documents/${id}/process`, { method: 'POST' }),

  // Cancel processing
  cancel: (id: number) =>
    fetchApi<{ id: number; status: string; cancelled: boolean }>(`/documents/${id}/cancel`, { method: 'POST' }),

  // Process document with action type
  processDocument: (id: number, actionType: string) => {
    const endpoint = {
      'uploaded': `/documents/${id}/process`,
      'extracting': `/documents/${id}/cancel`,
      'extracted_unpublished': `/documents/${id}/process`,
      'extracted_published': `/documents/${id}/process`,
      'extracted_failed': `/documents/${id}/process`,
    }[actionType];
    
    if (!endpoint) throw new Error(`Unknown action type: ${actionType}`);
    return fetchApi<Document>(endpoint, { method: 'POST' });
  },

  // Extract endpoints
  getSource: (id: number) => 
    fetch(`${API_URL}/documents/${id}/source`),

  submitExtracted: (id: number, data: { markdown: string; images?: string[] }) => 
    fetchApi<void>(`/documents/${id}/extracted`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Tags — GET returns Tag[] (via toApiDocumentTag which maps tag_* → API names)
  getTags: (id: number) => 
    fetchApi<Tag[]>(`/documents/${id}/tags`),

  // POST /add body uses API field name: { id: tagId }
  addTag: (docId: number, tagId: number, confidence: number = 1.0) => 
    fetchApi<{ document_id: number; id: number }>(`/documents/${docId}/tags/add`, {
      method: 'POST',
      body: JSON.stringify({ id: tagId, confidence }),
    }),

  // POST /remove body uses API field name: { id: tagId }
  removeTag: (docId: number, tagId: number) => 
    fetchApi<void>(`/documents/${docId}/tags/remove`, {
      method: 'POST',
      body: JSON.stringify({ id: tagId }),
    }),

  // Metadata — GET returns Metadata[]
  getMetadata: (id: number) => 
    fetchApi<Metadata[]>(`/documents/${id}/metadata`),

  // Expanded metadata — includes computed system preset values
  getExpandedMetadata: (id: number) =>
    fetchApi<Metadata[]>(`/documents/${id}/metadata/expanded`),

  // POST /add body uses API field name: { id: metaId }
  addMetadata: (docId: number, metaId: number) =>
    fetchApi<{ document_id: number; id: number }>(`/documents/${docId}/metadata/add`, {
      method: 'POST',
      body: JSON.stringify({ id: metaId }),
    }),

  // POST /remove body uses API field name: { id: metaId }
  removeMetadata: (docId: number, metaId: number) =>
    fetchApi<void>(`/documents/${docId}/metadata/remove`, {
      method: 'POST',
      body: JSON.stringify({ id: metaId }),
    }),

  // Batch metadata update — use API list field names
  batchUpdateMetadata: (docIds: number[], metadataToAdd: number[] = [], metadataToRemove: number[] = []) =>
    fetchApi<{ success: boolean; docs_updated: number; metadata_added: number; metadata_removed: number }>(
      '/documents/batch/updatemetadata',
      {
        method: 'POST',
        body: JSON.stringify({ document_ids: docIds, metadata_to_add: metadataToAdd, metadata_to_remove: metadataToRemove }),
      }
    ),

  // Batch tag update — use API list field names
  batchUpdateTags: (docIds: number[], tagsToAdd: number[] = [], tagsToRemove: number[] = []) =>
    fetchApi<{ success: boolean; docs_updated: number; tags_added: number; tags_removed: number }>(
      '/documents/batch/updatetags',
      {
        method: 'POST',
        body: JSON.stringify({ document_ids: docIds, tags_to_add: tagsToAdd, tags_to_remove: tagsToRemove }),
      }
    ),

  // Batch context update — use API field names
  batchUpdateContexts: (docIds: number[], contextId: number | null) =>
    fetchApi<{ success: boolean; docs_updated: number }>(
      '/documents/batch/context',
      {
        method: 'POST',
        body: JSON.stringify({ document_ids: docIds, context_id: contextId }),
      }
    ),
};

// Contexts API
export const contextsApi = {
  list: () => fetchApi<Context[]>('/contexts?limit=1000'),
  get: (id: number) => fetchApi<Context>(`/contexts/${id}`),
  create: (data: { description: string }) => 
    fetchApi<{ id: number }>('/contexts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  // Contexts API accepts name+description on update (even though schema only has description)
  update: (id: number, data: { name?: string; description?: string }) => 
    fetchApi<void>(`/contexts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: number) => 
    fetchApi<void>(`/contexts/${id}`, { method: 'DELETE' }),
};

// Tags API
export const tagsApi = {
  list: () => fetchApi<Tag[]>('/tags?limit=1000'),
  get: (id: number) => fetchApi<Tag>(`/tags/${id}`),
  create: (data: { name: string; generated_by?: 'user' | 'import' }) => 
    fetchApi<{ id: number }>('/tags', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: number, data: { name?: string }) => 
    fetchApi<void>(`/tags/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: number) => fetchApi<void>(`/tags/${id}`, { method: 'DELETE' }),
};

// Servers API
export const serversApi = {
  list: () => fetchApi<Server[]>('/servers'),
  get: (id: number) => fetchApi<Server>(`/servers/${id}`),
  create: (data: { base_url: string; name?: string; api_key?: string; api_version?: string }) => 
    fetchApi<{ id: number }>('/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: number, data: { base_url?: string; name?: string; api_key?: string; api_version?: string }) => 
    fetchApi<void>(`/servers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: number) => fetchApi<void>(`/servers/${id}`, { method: 'DELETE' }),
  // Health check
  checkHealth: (id: number) => 
    fetchApi<{ status: string; timestamp: string; [key: string]: any }>(`/servers/${id}/health`),
  // List banks from server
  listBanks: (id: number) =>
    fetchApi<Array<{ id: string; name: string; description?: string }>>(`/servers/${id}/banks`),
};

// Metadata API
export const metadataApi = {
  list: () => fetchApi<Metadata[]>('/metadata?limit=1000'),
  get: (id: number) => fetchApi<Metadata>(`/metadata/${id}`),
  create: (data: { key: string; value?: string; generated_by?: 'user' | 'import' }) => 
    fetchApi<{ id: number }>('/metadata', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: number, data: { key?: string; value?: string; generated_by?: 'user' | 'import' }) => 
    fetchApi<void>(`/metadata/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: number) => fetchApi<void>(`/metadata/${id}`, { method: 'DELETE' }),
};

// Entities API
export const entitiesApi = {
  list: () => fetchApi<Entity[]>('/entities'),
  get: (id: number) => fetchApi<Entity>(`/entities/${id}`),
  create: (data: {
    type_id: number;
    entity_id: string;
    name: string;
    description?: string;
    aliases?: string[];
    case_match?: 'insensitive' | 'sensitive';
    generated_by?: 'user' | 'import';
  }) => fetchApi<{ id: number }>('/entities', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: number, data: {
    type_id?: number;
    entity_id?: string;
    name?: string;
    description?: string;
    aliases?: string[];
    case_match?: 'insensitive' | 'sensitive';
    generated_by?: 'user' | 'import';
  }) => fetchApi<void>(`/entities/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: number) => fetchApi<void>(`/entities/${id}`, { method: 'DELETE' }),
};

export const entityTypesApi = {
  list: () => fetchApi<EntityType[]>('/entities/types'),
  get: (id: number) => fetchApi<EntityType>(`/entities/types/${id}`),
  create: (data: {
    type_name: string;
    description?: string;
    id_label?: string;
    name_label?: string;
    case_match?: 'insensitive' | 'sensitive';
  }) => fetchApi<{ id: number }>('/entities/types', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: number, data: {
    type_name?: string;
    description?: string;
    id_label?: string;
    name_label?: string;
    case_match?: 'insensitive' | 'sensitive';
  }) => fetchApi<void>(`/entities/types/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: number) => fetchApi<void>(`/entities/types/${id}`, { method: 'DELETE' }),
};

// Health check
export const healthApi = {
  check: () => 
    fetchApi<{ status: string; timestamp: string }>('/health'),
};

// Hindsight Sync API
export const hindsightApi = {
  diff: (serverId: number, bankId: string, object: 'documents' | 'entities' = 'documents') =>
    fetchApi<{
      data: {
        same: any[];
        different: any[];
        only_architxt: any[];
        only_hindsight: any[];
      };
      counts: {
        same: number;
        different: number;
        only_architxt: number;
        only_hindsight: number;
        total: number;
      };
    }>(`/hindsight/diff?server_id=${serverId}&bank_id=${encodeURIComponent(bankId)}&object=${object}`),

  pull: (serverId: number, bankId: string, documentId: string) =>
    fetchApi<{ success: boolean; created: boolean; document: any }>('/hindsight/pull', {
      method: 'POST',
      body: JSON.stringify({ server_id: serverId, bank_id: bankId, document_id: documentId }),
    }),

  push: (serverId: number, bankId: string, docId: number) =>
    fetchApi<{ success: boolean; operation_id: string; popId: number | null }>('/hindsight/push', {
      method: 'POST',
      body: JSON.stringify({ server_id: serverId, bank_id: bankId, doc_id: docId }),
    }),

  pushEntities: (serverId: number, bankId: string, typeNames?: string[]) =>
    fetchApi<{ success: boolean; mapLabelsPushed?: number }>('/hindsight/entities/push', {
      method: 'POST',
      body: JSON.stringify({ server_id: serverId, bank_id: bankId, type_names: typeNames }),
    }),

  pullEntities: (serverId: number, bankId: string, typeNames?: string[]) =>
    fetchApi<{ success: boolean; createdTypes?: number; createdEntities?: number; updatedEntities?: number; deletedEntities?: number }>('/hindsight/entities/pull', {
      method: 'POST',
      body: JSON.stringify({ server_id: serverId, bank_id: bankId, type_names: typeNames }),
    }),

  compare: (serverId: number, bankId: string, documentId: string) =>
    fetchApi<{
      ext_id: string;
      architxt_id: number;
      fields: Array<{
        name: string;
        architxt: any;
        hindsight: any;
        same: boolean;
      }>;
    }>(`/hindsight/compare?server_id=${serverId}&bank_id=${encodeURIComponent(bankId)}&document_id=${encodeURIComponent(documentId)}`),

  /**
   * List local pending operations for a server+bank (excludes acknowledged).
   */
  listOperations: (serverId: number, bankId: string) =>
    fetchApi<{
      success: boolean;
      operations: Array<{
        pop_id: number;
        pop_operation_id: string;
        pop_server_id: number;
        pop_bank_id: string;
        pop_doc_id: number;
        pop_ext_id: string | null;
        pop_action: string;
        pop_status: string;
        pop_error_message: string | null;
        pop_created_at: string;
        pop_updated_at: string;
      }>;
      server_id: number;
      bank_id: string;
    }>(`/hindsight/operations?server_id=${serverId}&bank_id=${encodeURIComponent(bankId)}`),

  dismissOperation: (popId: number) =>
    fetchApi<{ success: boolean; dismissed: number }>(`/hindsight/operations/${popId}`, {
      method: 'DELETE',
    }),

  /**
   * List ALL pending operations across all servers/banks (global status indicator).
   */
  listAllOperations: () =>
    fetchApi<{
      success: boolean;
      operations: Array<{
        pop_id: number;
        pop_operation_id: string;
        pop_server_id: number;
        pop_bank_id: string;
        pop_doc_id: number;
        pop_ext_id: string | null;
        pop_action: string;
        pop_status: string;
        pop_error_message: string | null;
        pop_created_at: string;
        pop_updated_at: string;
      }>;
    }>('/hindsight/operations/all'),
};

export { ApiError };

// Re-export types for convenient importing
export type { Document, Context, Tag, Server, Metadata, Entity, EntityType };

// Config API — entity tag format discovery
export const configApi = {
  getEntityFormat: () =>
    fetchApi<{
      activeKey: string;
      active: {
        key: string;
        displayName: string;
        regexSource: string;
        regexFlags: string;
        presentInIndicator: string;
      };
      registry: Record<
        string,
        {
          key: string;
          displayName: string;
          regexSource: string;
          regexFlags: string;
          presentInIndicator: string;
        }
      >;
    }>('/config/entity-format'),
};

export interface PromptSection {
  enabled:     { value: boolean | '—'; envVar: string };
  provider:    { value: string; envVar: string };
  model:       { value: string; envVar: string };
  temperature: { value: number | '—'; envVar: string };
  task_prompt: { value: string; envVar: string };
  system_prompt:{ value: string; envVar: string };
  timeout_ms:  { value: number | '—'; envVar: string };
}

export interface DiagramPromptSection extends PromptSection {
  batch_size:   { value: number | '—'; envVar: string };
  max_batches:  { value: number | '—'; envVar: string };
  concurrency:  { value: number | '—'; envVar: string };
}

export type ConfigValue = { value: string | boolean | number | number | string[] | null; envVar: string };

export interface SettingsSnapshot {
  prompts: {
    diagram_description: DiagramPromptSection | null;
    document_denoise_llm: PromptSection | null;
    document_denoise: Record<string, ConfigValue>;
  };
  docling: {
    service_url: ConfigValue;
  };
  entity_tag: {
    active_key: ConfigValue;
    active_name: ConfigValue;
    synced_fields: ConfigValue;
    sync_name: ConfigValue;
  };
  entity_match: {
    pattern: ConfigValue;
    description: ConfigValue;
  };
  server: {
    port: ConfigValue;
    host: ConfigValue;
    env: ConfigValue;
  };
  ui: {
    port: ConfigValue;
    api_base_url: ConfigValue;
  };
}

export const settingsApi = {
  get: () => fetchApi<SettingsSnapshot>('/config/settings'),
  restart: () =>
    fetchApi<{ success: boolean; message: string; method: string }>('/config/restart', {
      method: 'POST',
    }),
};
