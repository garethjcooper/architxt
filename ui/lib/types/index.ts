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

export interface BankSettings {
  bank_id?: string;
  name?: string;
  retain_mission: string;
  observations_mission: string;
  reflect_mission: string;
  retain_extraction_mode: 'concise' | 'verbose' | 'custom' | 'verbatim' | 'chunks';
  retain_chunk_size: number;
  entities_allow_free_form: boolean;
  disposition: {
    empathy: number;
    literalism: number;
    skepticism: number;
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

export type MentalModelReturns = 'generic';

export const MENTAL_MODEL_RETURNS_OPTIONS: { value: MentalModelReturns; label: string }[] = [
  { value: 'generic', label: 'Generic (directive-driven)' },
];

export function toMentalModelReturns(value: string): MentalModelReturns {
  if (value === 'generic') return 'generic';
  throw new Error(`Invalid mental model returns value: ${value}`);
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
  is_template: boolean;
  template_role?: string | null;
  is_system_template: boolean;
  is_contextual_graph_role?: boolean;
  tags: Tag[];
  entities: Entity[];
  created_at: string;
  updated_at: string;
}

export type TemplateRole = {
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

export interface ViewNode {
  id: string;
  type: 'entity' | 'edge' | 'note' | 'group' | 'shape';
  label?: string;
  name?: string;
  text?: string;
  entity_type?: string;
  style?: Record<string, any>;
  [key: string]: any;
}

export interface ViewEdge {
  id: string;
  type?: string;
  source: string;
  target: string;
  label?: string;
  edge_type?: string;
  ref_id?: string;
  source_ref_id?: string;
  target_ref_id?: string;
  properties?: Record<string, any>;
  style?: Record<string, any>;
  [key: string]: any;
}

export interface ViewGraph {
  nodes: ViewNode[];
  edges: ViewEdge[];
}

export interface ViewControlsState {
  layoutOptions: {
    algorithm: 'layered' | 'stress' | 'mrtree' | 'radial' | 'force';
    direction: 'DOWN' | 'UP' | 'LEFT' | 'RIGHT';
    edgeRouting: 'ORTHOGONAL' | 'POLYLINE' | 'SPLINES';
    crossingMinimization: 'LAYER_SWEEP' | 'MEDIAN_LAYER_SWEEP' | 'INTERACTIVE' | 'NONE';
    greedySwitch: 'TWO_SIDED' | 'ONE_SIDED' | 'OFF';
    edgeMergeMode: 'full' | 'byType' | 'all';
  };
  routingTunables: {
    edgeToEdgeSpacing: number;
    edgeToNodeSpacing: number;
    handleSpacing: number;
    stubSize: number;
    hateCrossings: boolean;
    routeOnlyWhenBlocked: boolean;
    elkNodeNodeSpacing: number;
    elkNodeNodeBetweenLayers: number;
    elkEdgeEdgeBetweenLayers: number;
    elkEdgeNodeBetweenLayers: number;
  };
  nodeTunables: {
    entityNodeMinWidth: number;
    entityNodeMinHeight: number;
    entityNodeTextAlignH: 'left' | 'center' | 'right';
    entityNodeTextAlignV: 'top' | 'center' | 'bottom';
  };
  showEdgeLabels?: boolean;
  showNodeIds?: boolean;
  showHandles?: boolean;
  showNodeColorBar?: boolean;
  backgroundVariant?: 'off' | 'dots' | 'lines' | 'cross';
  topK?: number;
}

export interface ViewLayout {
  positions: Record<string, { x: number; y: number; parent?: string | null }>;
  viewport: { x: number; y: number; zoom: number };
  controls?: ViewControlsState;
}

export interface ViewTimelineSlice {
  id: string;
  at: string;
  type: string;
  summary: string;
  details: {
    added_nodes?: number;
    updated_nodes?: number;
    removed_nodes?: number;
    added_edges?: number;
    updated_edges?: number;
    removed_edges?: number;
    [key: string]: any;
  };
  snapshot_id?: string;
}

export interface View {
  id: string;
  server_id: number;
  bank_id: string;
  name: string;
  diagram_type: 'flowchart' | 'sequenceDiagram' | 'erDiagram' | 'classDiagram' | 'stateDiagram' | 'timeline';
  graph: ViewGraph;
  layout: ViewLayout;
  style_defaults: Record<string, any> | null;
  timeline: ViewTimelineSlice[];
  created_at: string;
  updated_at: string;
}

export interface CreateViewRequest {
  name: string;
  diagram_type?: View['diagram_type'];
  graph?: ViewGraph;
  layout?: ViewLayout;
  style_defaults?: Record<string, any> | null;
  timeline?: ViewTimelineSlice[];
}

export interface UpdateViewRequest {
  name?: string;
  diagram_type?: View['diagram_type'];
  graph?: ViewGraph;
  layout?: ViewLayout;
  style_defaults?: Record<string, any> | null;
  timeline?: ViewTimelineSlice[];
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
