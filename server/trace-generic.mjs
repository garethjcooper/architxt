// trace-generic.js
import { parseSectionDirectives } from './src/prompts/section-directives.js';

// Simulate stripped topic (what reflect receives after frontend parses)
const topic = 'what is [[ICMS (a-com:COM-002)]] what is [[Singleview (a-com:COM-001)]]';
const { intentText, sectionFocus } = parseSectionDirectives(topic);

console.log('=== PARSED FROM STRIPPED TOPIC ===');
console.log('intentText:', JSON.stringify(intentText));
console.log('sectionFocus:', JSON.stringify(sectionFocus, null, 2));

// Simulate what reflect sends
const focus = {
  graph: 'show data flows',
  table: [
    { name: 'Data Flows', content: 'list interface name, protocol and destination systems for the data flows' },
    { name: 'table-abc', content: 'list [[Singleview (a-com:COM-001)]] capabilities' }
  ],
  narrative: intentText
};

function formatFocusVariable(raw) {
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null && 'content' in raw[0]) {
    const directives = raw;
    const lines = directives
      .filter((d) => d.content?.trim() !== '')
      .map((d) => {
        const content = d.content.trim();
        if (d.name?.trim()) return `- **${d.name.trim()}** — ${content}`;
        return `- ${content}`;
      });
    return lines.join('\n');
  }
  if (Array.isArray(raw)) {
    const lines = raw.filter((s) => typeof s === 'string' && s.trim() !== '').map((s) => `- ${s.trim()}`);
    return lines.join('\n');
  }
  if (!raw || typeof raw !== 'string' || raw.trim() === '') return '';
  return `- ${raw.trim()}`;
}

const merged = {
  ARCHITXT_TOPIC: intentText || '',
  ARCHITXT_GRAPH_FOCUS: formatFocusVariable(focus.graph),
  ARCHITXT_TABLE_FOCUS: formatFocusVariable(focus.table),
  ARCHITXT_NARRATIVE_FOCUS: formatFocusVariable(focus.narrative),
};

console.log('\n=== MERGED FOCUS VARIABLES ===');
for (const [k, v] of Object.entries(merged)) {
  console.log(k + ':');
  console.log(v);
  console.log('---');
}

function deriveSectionFocusFromVariables(variables) {
  const focus = {};
  if (variables.ARCHITXT_GRAPH_FOCUS?.trim()) {
    focus.graph = variables.ARCHITXT_GRAPH_FOCUS.trim().replace(/^- /, '');
  }
  if (variables.ARCHITXT_TABLE_FOCUS?.trim()) {
    const lines = variables.ARCHITXT_TABLE_FOCUS.trim().split('\n').filter((l) => l.trim());
    focus.table = lines.map((line) => {
      const m = line.match(/^\*\*(.+?)\*\*\s*—\s*(.+)$/);
      if (m) return { name: m[1].trim(), content: m[2].trim() };
      return { content: line.replace(/^- /, '').trim() };
    });
  }
  if (variables.ARCHITXT_NARRATIVE_FOCUS?.trim()) {
    focus.narrative = variables.ARCHITXT_NARRATIVE_FOCUS.trim().replace(/^- /, '');
  }
  return Object.keys(focus).length > 0 ? focus : undefined;
}

const derived = deriveSectionFocusFromVariables(merged);
console.log('\n=== DERIVED SECTION FOCUS ===');
console.log(JSON.stringify(derived, null, 2));

function buildConditionalFragments(sectionFocus) {
  const extra = [];
  if (sectionFocus?.graph) {
    extra.push('output-format-graph-contextual.md');
  }
  if (sectionFocus?.table) {
    extra.push('output-format-table-contextual.md');
  }
  return extra;
}

const extra = buildConditionalFragments(derived);
console.log('\n=== CONDITIONAL FRAGMENTS ===');
console.log(extra);

function computeSectionState(sectionFocus) {
  const active = [];
  const empty = [];
  if (sectionFocus?.graph) active.push('graph');
  else empty.push('graph');
  if (sectionFocus?.table?.length) active.push('tables');
  else empty.push('tables');
  if (sectionFocus?.narrative) active.push('narrative');
  else empty.push('narrative');
  if (active.length === 0) {
    return { active: ['narrative'], empty: ['graph', 'tables'] };
  }
  return { active, empty };
}

const sectionState = computeSectionState(derived);
console.log('\n=== SECTION STATE ===');
console.log(JSON.stringify(sectionState, null, 2));

function formatSectionInstructions({ active, empty }) {
  const lines = [];
  lines.push('### Section rules');
  lines.push('');
  lines.push(`Active output sections: ${active.map((s) => `\`${s}\``).join(', ')}.`);
  lines.push(`Empty output sections (must remain exactly as shown in the envelope example): ${empty.map((s) => `\`${s}\``).join(', ')}.`);
  lines.push('');
  if (!active.includes('narrative')) {
    lines.push('Do not answer the topic in narrative prose. All findings must be expressed through the structured output sections above.');
    lines.push('');
  }
  return lines.join('\n');
}

const instructions = formatSectionInstructions(sectionState);
console.log('\n=== SECTION INSTRUCTIONS ===');
console.log(instructions);

// Simulate generic template fragments
const baseFragments = ["contextual-patch.md","section-focus.md","entity-catalog.md","entity-id-format.md","node-discovery-policy-known.md","edge-vocabulary.md","node-eligibility.md","label-rules.md","provenance-rules.md"];
const patchIndex = baseFragments.indexOf('contextual-patch.md');
if (patchIndex !== -1 && extra.length > 0) {
  baseFragments.splice(patchIndex + 1, 0, ...extra);
}
console.log('\n=== EFFECTIVE FRAGMENTS (generic) ===');
console.log(baseFragments);
