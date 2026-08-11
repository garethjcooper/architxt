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
    success?: boolean;
    error?: string;
    metrics?: Record<string, unknown>;
    reason?: string;
  }> | null;
  processing_progress: Record<string, unknown> | null;
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

export interface Directive {
  id: number;
  ext_id: string | null;
  name: string;
  statement: string;
  is_active: boolean;
  priority: number;
  generated_by: 'user' | 'import';
  tags?: Tag[];
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

export interface ContextualGraphBankConfig {
  bank_id: string;
  mode: 'manual' | 'auto';
  refresh_interval?: string;
  restriction?: {
    import?: {
      top_k_nodes?: number;
      min_weight?: number;
      include_patterns?: string[];
      exclude_patterns?: string[];
    };
    deploy?: {
      max_models_per_run?: number;
      allowed_model_types?: string[];
      include_node_ids?: string[];
      exclude_node_ids?: string[];
    };
  };
}

export interface Server {
  id: number;
  base_url: string;
  name: string;
  api_key: string | null;
  api_version: string | null;
  contextual_graph_banks: ContextualGraphBankConfig[];
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
  word_boundary_match: 'boundaries' | 'no-boundaries';
  uses_entity_id_pattern: boolean;
  id_format_prefix: string | null;
  min_id_digits: number;
  id_separator: 'none' | '-';
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
  word_boundary_match: 'boundaries' | 'no-boundaries';
  type_word_boundary_match: 'boundaries' | 'no-boundaries';
  type_uses_entity_id_pattern: boolean;
  type_id_format_prefix: string | null;
  type_min_id_digits: number;
  type_id_separator: 'none' | '-';
  generated_by: 'user' | 'import';
  usage_count?: number;
  overrides?: MentalModelEntityOverrides;
  created_at: string;
  updated_at: string;
}

export type MentalModelReturns =
  | 'narrative'
  | 'graph-known'
  | 'graph-discovery'
  | 'graph-discovered-only'
  | 'narrative-graph-known'
  | 'narrative-graph-discovery'
  | 'narrative-graph-discovered-only';

export const MENTAL_MODEL_RETURNS_OPTIONS: { value: MentalModelReturns; label: string }[] = [
  { value: 'narrative', label: 'Narrative' },
  { value: 'graph-known', label: 'Graph (known nodes)' },
  { value: 'graph-discovery', label: 'Graph (discovery allowed)' },
  { value: 'graph-discovered-only', label: 'Graph (discovered only)' },
  { value: 'narrative-graph-known', label: 'Narrative + graph (known nodes)' },
  { value: 'narrative-graph-discovery', label: 'Narrative + graph (discovery allowed)' },
  { value: 'narrative-graph-discovered-only', label: 'Narrative + graph (discovered only)' },
];

export function toMentalModelReturns(value: string): MentalModelReturns {
  const option = MENTAL_MODEL_RETURNS_OPTIONS.find((o) => o.value === value);
  if (!option) {
    throw new Error(`Invalid mental model returns value: ${value}`);
  }
  return option.value;
}

export interface MentalModel {
  id: number;
  ext_id: string;
  name: string | null;
  source_query: string | null;
  viewp_description: string | null;
  viewp_meta: Record<string, any> | null;
  refresh_after_consolidation: boolean;
  refresh_mode: 'full' | 'delta';
  exclude_all_mental_models: boolean;
  exclude_mental_model_list: string | null;
  max_tokens: number;
  tags_match_mode: 'all_strict' | 'any_strict' | 'all' | 'any' | 'exact';
  dimension: string | null;
  is_template: boolean;
  template_role?: string | null;
  is_system_template: boolean;
  tags: Tag[];
  entities: Entity[];
  created_at: string;
  updated_at: string;
}

export type StandardDimension = {
  value: string;
  label: string;
};

export interface DerivedMentalModel extends MentalModel {
  is_derived: true;
  derived_entity: Entity;
  overrides?: MentalModelEntityOverrides;
  composed_query?: string | null;
  compose_error?: string | null;
}

export interface MentalModelEntityOverrides {
  refresh_mode?: 'full' | 'delta';
  refresh_after_consolidation?: boolean;
  exclude_all_mental_models?: boolean;
  max_tokens?: number;
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
