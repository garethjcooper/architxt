import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

/**
 * Config helpers for fail-fast validation
 */
const getEnv = (name, defaultValue) => {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(`Missing required environment variable: ${name}`);
};

const getInt = (name, defaultValue) => {
  const value = process.env[name];
  if (value !== undefined && value !== '') {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) return parsed;
  }
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(`Missing or invalid integer environment variable: ${name}`);
};

/**
 * Provider registry - centralizes LLM endpoint configuration
 * Stages reference providers by name, not by URL
 */
export const providers = {
  ollama_local: {
    base_url: getEnv('ARCHITXT_OLLAMA_LOCAL_URL', 'http://localhost:11434'),
    api_key: getEnv('ARCHITXT_OLLAMA_LOCAL_API_KEY', 'ollamaapikey'),
    default_model: getEnv('ARCHITXT_OLLAMA_LOCAL_DEFAULT_MODEL', 'qwen3.5:4b'),
    timeout_ms: getInt('ARCHITXT_OLLAMA_LOCAL_TIMEOUT_MS', 300000),
    chat_style: getEnv('ARCHITXT_OLLAMA_LOCAL_CHAT_STYLE', 'ollama_local')
  },
  ollama_cloud: {
    base_url: getEnv('ARCHITXT_OLLAMA_CLOUD_URL', 'https://ollama.com/v1'),
    api_key: getEnv('ARCHITXT_OLLAMA_CLOUD_API_KEY', ''),
    default_model: getEnv('ARCHITXT_OLLAMA_CLOUD_DEFAULT_MODEL', 'kimi-k2.5:cloud'),
    timeout_ms: getInt('ARCHITXT_OLLAMA_CLOUD_TIMEOUT_MS', 300000),
    chat_style: getEnv('ARCHITXT_OLLAMA_CLOUD_CHAT_STYLE', 'openai')
  },
  openai: {
    base_url: getEnv('ARCHITXT_OPENAI_URL', 'https://api.openai.com/v1'),
    api_key: getEnv('ARCHITXT_OPENAI_API_KEY', ''),
    default_model: getEnv('ARCHITXT_OPENAI_DEFAULT_MODEL', 'gpt-4o'),
    timeout_ms: getInt('ARCHITXT_OPENAI_TIMEOUT_MS', 60000),
    chat_style: getEnv('ARCHITXT_OPENAI_CHAT_STYLE', 'openai')
  },
  anthropic: {
    base_url: getEnv('ARCHITXT_ANTHROPIC_URL', 'https://api.anthropic.com/v1'),
    api_key: getEnv('ARCHITXT_ANTHROPIC_API_KEY', ''),
    default_model: getEnv('ARCHITXT_ANTHROPIC_DEFAULT_MODEL', 'claude-3-sonnet-20240229'),
    timeout_ms: getInt('ARCHITXT_ANTHROPIC_TIMEOUT_MS', 180000),
    chat_style: getEnv('ARCHITXT_ANTHROPIC_CHAT_STYLE', 'openai')
  }
};

export const PROMPTS = {
  diagram_description: {
    task: `Image Handling

    If the confidence score for image data extraction is below 0.8 (High) then do not extract - respond with "Low confidence score".
    If the image lacks identifiable systems, components, connections or structured data - respond with "Not an image".

    If the image does not look like a typical diagram (uml, architecture, flow diagram etc) then return a a structured extraction of the data or information:
    → Include one line at the top of the description informing of the elements extracted
    → Do not return any other outro text just the information from the image.
    

    If the image looks like a diagram (uml, architecture, flow diagram etc), for each:
    → Do not return any introduction or clarifying text, just the information from the image.
    → If there is other structured information on the diagram extract that.
    → Extract as Systems Inventory + Connection Mappings tables

[image]

**Systems Inventory:**

| System Name | Type | Description |
|-------------|------|-------------|
| {name} | system/database/service/external/process | {what it does} |

**Connection Mappings:**

| System From | System To | Flow Text | Direction | Description |
|------|-----|------|-----------|
| {system} | {system} | {text on flow line} | -> / <- / <-> / - | description of data/action |

[/image]

Directionality:

• -> : One-way flow (A sends to B)
• <- : One-way flow (B receives from A)
• <-> : Bidirectional
• - : No direction/no flow shown

[/image]`,

    system: `You are an image analysis assistant. Analyze diagrams and extract system information with confidence scores. Return structured output as markdown list items.`
  },
  document_denoise_llm: {
    task: `TASK: Fix intra-word spacing artifacts in paragraph text. Treat all other content as literal data to copy unchanged.

INSTRUCTIONS:

1. IDENTIFY and FIX paragraph and heading text: Lines and headings that contain actual sentences (words separated by spaces, with punctuation).

2. Patterns to fix:
   - split letters: e.g. "A u d i e n c e" → "Audience" 
   - mid-word break: e.g. integ ration" → "integration" 
   - only at sentence start, followed by lowercase: e.g. "T h e" → "The" 
   - broken hyphenation: e.g. "under-\nstanding" → "understanding" 

3. COPY VERBATIM — do not "understand" or "process", just echo exactly:
   - ALL lines containing | (tables)
   - ALL [image] or {{image}} type tags and content inside them

DO NOT:
- Try to parse table structure

4. OUTPUT FORMAT: Return the complete text with ONLY the fixes applied.`,
    system: `You are a text cleanup assistant.`
  }

};

export const config = {
  providers,
  docling: {
    serviceUrl: process.env.DOCLING_SERVICE_URL || 'http://localhost:5001',
    forceOcr: getEnv('ARCHITXT_DOCLING_FORCE_OCR', 'false') === 'true',
  },
  server: {
    port: parseInt(process.env.ARCHITXT_PORT || '3000', 10),
    host: process.env.ARCHITXT_HOST || '0.0.0.0',
    env: process.env.ARCHITXT_NODE_ENV || 'development'
  },
  ui: {
    port: parseInt(process.env.ARCHITXT_UI_PORT || '3001', 10),
    host: process.env.ARCHITXT_UI_HOST || process.env.ARCHITXT_HOST || '0.0.0.0',
    apiBaseUrl: process.env.ARCHITXT_UI_API_BASE_URL || 'http://localhost:3000'
  },
  database: {
    path: process.env.ARCHITXT_DB_PATH || path.join(rootDir, 'database', 'architxt.db'),
    timeout_ms: parseInt(process.env.ARCHITXT_DB_TIMEOUT_MS || '10000', 10),
    wal_mode: true
  },
  daemon: {
    spawnExtract: process.env.SPAWN_EXTRACT_DAEMON !== 'false',
    spawnHindsightPoll: process.env.SPAWN_HINDSIGHT_POLL_DAEMON !== 'false',
  },
  logging: {
    level: process.env.ARCHITXT_LOG_LEVEL || 'debug',
    dir: process.env.ARCHITXT_LOG_DIR || path.join(rootDir, 'logs'),
    max_size: 10485760,
    max_files: 10
  },
  storage: {
    path: process.env.ARCHITXT_STORAGE_PATH || path.join(rootDir, 'documents'),
    temp_dir: process.env.ARCHITXT_TEMP_DIR || path.join(rootDir, 'tmp'),
    max_file_size: parseInt(process.env.ARCHITXT_MAX_FILE_SIZE || '104857600', 10)
  },
  extractdaemon: {
    poll_interval_ms: parseInt(process.env.ARCHITXT_EXTRACT_DAEMON_POLL_INTERVAL_MS || '5000', 10),
    orphan_threshold_minutes: parseInt(process.env.ARCHITXT_EXTRACT_DAEMON_ORPHAN_THRESHOLD_MINUTES || '600', 10)
  },
  hindsightPollDaemon: {
    poll_interval_ms: parseInt(process.env.ARCHITXT_HINDSIGHT_POLL_INTERVAL_MS || '5000', 10),
    stale_threshold_ms: parseInt(process.env.ARCHITXT_HINDSIGHT_STALE_THRESHOLD_MS || '300000', 10),
  },
  diagram_description: {
    enabled: getEnv('ARCHITXT_VISION_ENABLED', 'true') === 'true',
    provider: getEnv('ARCHITXT_VISION_PROVIDER', 'ollama_cloud'),
    model: getEnv('ARCHITXT_VISION_MODEL', 'ministral-3:14b-cloud'),
    task_prompt: getEnv('ARCHITXT_VISION_PROMPT', PROMPTS.diagram_description.task),
    system_prompt: getEnv('ARCHITXT_VISION_SYSTEM_PROMPT', PROMPTS.diagram_description.system),
    timeout_ms: getInt('ARCHITXT_VISION_TIMEOUT_MS', 300000),
    batch_size: getInt('ARCHITXT_DIAGRAM_BATCH_SIZE', 2),
    max_batches: getInt('ARCHITXT_DIAGRAM_MAX_BATCHES', -1),
    concurrency: getInt('ARCHITXT_DIAGRAM_CONCURRENCY', 3),
    temperature: parseFloat(getEnv('ARCHITXT_DIAGRAM_TEMPERATURE', '0.0'))
  },
  research: {
    synthesize: {
      provider: getEnv('ARCHITXT_RESEARCH_SYNTHESIZE_PROVIDER', 'ollama_cloud'),
      model: getEnv('ARCHITXT_RESEARCH_SYNTHESIZE_MODEL', ''),
      temperature: parseFloat(getEnv('ARCHITXT_RESEARCH_SYNTHESIZE_TEMPERATURE', '0.2')),
      max_tokens: getEnv('ARCHITXT_RESEARCH_SYNTHESIZE_MAX_TOKENS', '') !== ''
        ? getInt('ARCHITXT_RESEARCH_SYNTHESIZE_MAX_TOKENS', 0)
        : undefined,
      system_prompt: getEnv('ARCHITXT_RESEARCH_SYNTHESIZE_SYSTEM_PROMPT', 'You are a synthesis assistant. Read the provided corpus (narratives, entities, edges) and the user\'s intent, then produce a single, self-contained synthesis as a JSON object. The output must always include both a Markdown "narrative" and a "graph" object with "nodes" and "edges" arrays. If you choose to surface entities in the graph, every returned node id must exist in the corpus and every edge must connect two of those returned node ids using a relationship label grounded in the corpus. If no relationships can be justified, return edges: []. If no entities should be surfaced, return nodes: [] and edges: []. Do not omit the graph object, do not omit the edges array, and do not invent nodes, ids, labels, or flows that are not grounded in the corpus.'),
      task_prompt: getEnv('ARCHITXT_RESEARCH_SYNTHESIZE_TASK_PROMPT', 'Using the corpus as background context, write a focused Markdown narrative that answers the user\'s intent. Then return a JSON object with two top-level keys: "narrative" (the Markdown text) and "graph" (an object containing "nodes" and "edges" arrays). The graph must reuse ONLY entity ids and labels from the corpus. Every edge must have source and target ids that appear in graph.nodes and a label grounded in the source material. If no edges are justified, explicitly return "edges": []. Do not return a graph with nodes but no edges. The "narrative" field must be Markdown text only; do NOT embed the graph JSON inside the narrative.'),
    },
  },
  document_denoise_llm: {
    enabled: getEnv('ARCHITXT_DENOISE_LLM_ENABLED', 'true') === 'true',
    provider: getEnv('ARCHITXT_DENOISE_LLM_PROVIDER', 'ollama_cloud'),
    model: getEnv('ARCHITXT_DENOISE_LLM_MODEL', 'ministral-3:14b-cloud'),
    timeout_ms: getInt('ARCHITXT_DENOISE_LLM_TIMEOUT_MS', 600000),
    task_prompt: getEnv('ARCHITXT_DENOISE_LLM_PROMPT', PROMPTS.document_denoise_llm.task),
    system_prompt: getEnv('ARCHITXT_DENOISE_LLM_SYSTEM_PROMPT', PROMPTS.document_denoise_llm.system),
    temperature: parseFloat(getEnv('ARCHITXT_DENOISE_LLM_TEMPERATURE', '0.1'))
  },
  document_denoise: {
    enabled: getEnv('ARCHITXT_DENOISE_ENABLED', 'true') === 'true',
    remove_page_numbers: getEnv('ARCHITXT_DENOISE_REMOVE_PAGE_NUMBERS', '1') === '1',
    remove_confidential_headers: getEnv('ARCHITXT_DENOISE_REMOVE_CONFIDENTIAL', '1') === 'true',
    remove_document_ids: getEnv('ARCHITXT_DENOISE_REMOVE_DOC_IDS', '1') === '1',
    unescape_html_entities: getEnv('ARCHITXT_DENOISE_UNESCAPE_HTML', '1') === '1',
    normalize_whitespace: getEnv('ARCHITXT_DENOISE_NORMALIZE_WS', '1') === '1',
    remove_non_ascii: getEnv('ARCHITXT_DENOISE_REMOVE_NON_ASCII', '1') === '1',
    max_consecutive_newlines: getInt('ARCHITXT_DENOISE_MAX_NEWLINES', 3)
  }

};
