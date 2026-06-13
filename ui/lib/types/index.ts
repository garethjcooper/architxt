/**
 * Type definitions for architxt API
 * 
 * NOTE: These types reflect the HTTP API response format.
 * The backend routes handle the translation from database column names to API field names.
 */

export interface Document {
  id: number;
  ext_id: string | null;
  content: string | null;
  content_hash: string | null;
  filename: string | null;
  source_path: string | null;
  full_path: string | null;
  authors: string[] | null;
  status:
    | 'uploaded'
    | 'ready_to_extract'
    | 'processing_extract'
    | 'processed_extract_success'
    | 'processed_extract_failed'
    | 'processing_review'
    | 'reviewed'
    | string;
  generated_by: string;
  context_id: number | null;
  context: { id: number; description: string } | null;
  processing_history: Array<{
    from: string;
    to: string;
    at: string;
  }> | null;
  tags: Array<{ id: number; name: string }>;
  metadata: Array<{ id: number; key: string; value: string | null }>;
  content_length_k: number | null;
  has_entities?: boolean;
  timestamp: string | null;
  created_at: string;
  updated_at: string;
}

export interface Context {
  id: number;
  description: string;
  generated_by: 'user' | 'import';
  usage_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  name: string;
  generated_by: 'user' | 'import';
  usage_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Server {
  id: number;
  base_url: string;
  name: string;
  api_key: string | null;
  api_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface Metadata {
  id: number;
  key: string;
  value: string | null;
  generated_by: 'user' | 'import' | 'system';
  expanded?: boolean;
  usage_count?: number;
  created_at: string;
  updated_at: string;
}

export interface EntityType {
  id: number;
  type_name: string;
  description: string | null;
  id_label: string | null;
  name_label: string | null;
  case_match: 'insensitive' | 'sensitive';
  created_at: string;
  updated_at: string;
}

export interface Entity {
  id: number;
  type_id: number;
  type_name: string;
  entity_id: string;
  name: string;
  description: string | null;
  aliases: string[];
  case_match: 'insensitive' | 'sensitive';
  type_case_match: 'insensitive' | 'sensitive';
  generated_by: 'user' | 'import';
  usage_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ApiError {
  error: string;
  code: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export type DocumentStatus = Document['status'];
