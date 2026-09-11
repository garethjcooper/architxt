import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleTemplates } from '../../../../src/services/research/handlers/templates.js';

function makeMentalModel(structuredOutput) {
  return {
    success: true,
    mentalModel: {
      reflect_response: {
        structured_output: structuredOutput,
      },
    },
  };
}

describe('handleTemplates narrative fallback', () => {
  it('does not stringify structured_output object when narrative is empty but diagrams exist', async () => {
    const structuredOutput = {
      narrative: '',
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [
        {
          name: 'COM-001 Data Flows',
          type: 'erDiagram',
          content: 'erDiagram\n  Singleview }o--|| ICMS : "sends usage/charges to"',
        },
      ],
    };

    const fetchMentalModel = async () => makeMentalModel(structuredOutput);

    const result = await handleTemplates(1, 'bank', '', {
      selections: [{ kind: 'derived_model', ext_id: 'architxt-dataflow-txt-{entity-id}-{entity-name}', name: 'architxt-dataflow-txt-{entity-id}-{entity-name}' }],
      fetchMentalModel,
    });

    assert.equal(result.success, true);
    assert.ok(result.narratives.length > 0, 'should have at least one narrative');
    assert.ok(
      result.narratives.some((n) => n.narrative_name === 'architxt-dataflow-txt-{entity-id}-{entity-name}'),
      'should include per-model name',
    );
    assert.ok(!result.narratives.some((n) => n.narrative.includes('[object Object]')), 'should not stringify the content object');
    assert.ok(!result.narratives.some((n) => n.narrative.includes('"graph"')), 'should not dump raw JSON envelope into narrative');
    assert.equal(result.diagrams.length, 1);
    assert.equal(result.diagrams[0].name, 'COM-001 Data Flows');
  });

  it('uses narrative text when present', async () => {
    const fetchMentalModel = async () =>
      makeMentalModel({
        narrative: '# Summary\n\nIt works.',
        graph: { nodes: [], edges: [] },
        tables: [],
        diagrams: [],
      });

    const result = await handleTemplates(1, 'bank', '', {
      selections: [{ kind: 'derived_model', ext_id: 'mm-1', name: 'Model One' }],
      fetchMentalModel,
    });

    assert.equal(result.success, true);
    assert.ok(result.narratives.some((n) => n.narrative === '# Summary\n\nIt works.' && n.narrative_name === 'Model One'));
  });

  it('falls back to JSON stringification only when no narrative, graph, tables, or diagrams exist', async () => {
    const fetchMentalModel = async () =>
      makeMentalModel({
        narrative: '',
        graph: { nodes: [], edges: [] },
        tables: [],
        diagrams: [],
      });

    const result = await handleTemplates(1, 'bank', '', {
      selections: [{ kind: 'derived_model', ext_id: 'mm-1', name: 'Model One' }],
      fetchMentalModel,
    });

    assert.equal(result.success, true);
    assert.ok(!result.narratives.some((n) => n.narrative.includes('[object Object]')));
    assert.ok(result.narratives.some((n) => n.narrative.includes('"narrative": ""') || n.narrative.includes('{')));
  });
});
