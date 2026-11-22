import assert from 'node:assert';
import { describe, it } from 'node:test';
import { mineSequences } from '../src/services/trace/sequence-miner.js';

describe('sequence-miner', () => {
  const profile = {
    orderColumns: ['step'],
    correlationColumns: ['traceId'],
    tokenColumns: ['actor', 'action', 'status'],
    separator: '|',
    minSteps: 1, // most fixtures build single-step sequences; default-2 behaviour is tested separately
    includeTokenComponents: true,
    maxExampleKeys: 3,
    entityColumn: 'actor',
    directionColumn: 'direction',
  };

  function row(traceId, step, actor, action, status, direction = 'REQ') {
    return { traceId, step, actor, action, status, direction };
  }

  it('groups by correlation key and orders by order columns', () => {
    const rows = [
      row('t1', '2', 'AuthService', 'complete', 'ok'),
      row('t1', '1', 'AuthService', 'start', 'ok'),
      row('t2', '1', 'AuthService', 'start', 'ok'),
      row('t2', '2', 'DbService', 'lookup', 'ok'),
    ];

    const { markdown, stats } = mineSequences(rows, profile);

    assert.equal(stats.inputRows, 4);
    assert.equal(stats.eligibleRows, 4);
    assert.equal(stats.ineligibleRows, 0);
    assert.equal(stats.correlationKeyCount, 2);
    assert.equal(stats.sequenceCount, 2);

    // Default: no numbering — headings carry only the descriptive entity-flow name.
    assert.ok(markdown.includes('## AuthService'));
    assert.ok(markdown.includes('## AuthService → DbService'));
    assert.ok(!markdown.includes('## Sequence'));
    assert.ok(markdown.includes('**Signature**: `AuthService:start:ok | AuthService:complete:ok`'));
    assert.ok(markdown.includes('**Signature**: `AuthService:start:ok | DbService:lookup:ok`'));
  });

  it('aggregates identical signatures and counts distinct correlation keys', () => {
    const rows = [
      row('t1', '1', 'AuthService', 'start', 'ok'),
      row('t1', '2', 'DbService', 'lookup', 'ok'),
      row('t2', '1', 'AuthService', 'start', 'ok'),
      row('t2', '2', 'DbService', 'lookup', 'ok'),
      row('t3', '1', 'AuthService', 'start', 'ok'),
      row('t3', '2', 'DbService', 'lookup', 'ok'),
    ];

    const { markdown, stats } = mineSequences(rows, profile);
    assert.equal(stats.sequenceCount, 1);
    assert.equal(stats.correlationKeyCount, 3);
    assert.ok(markdown.includes('Frequency**: 3 traces'));
  });

  it('marks rows ineligible only when order columns are missing', () => {
    const rows = [
      row('t1', '1', 'AuthService', 'start', 'ok'),
      { traceId: 't2', actor: 'DbService', action: 'lookup', status: 'ok', direction: 'REQ' }, // missing order col
      { step: '1', actor: 'AuthService', action: 'start', status: 'ok', direction: 'REQ' }, // missing correlation col — still eligible
      row('t3', '1', 'AuthService', 'start', 'ok'),
    ];

    const { stats } = mineSequences(rows, profile);
    assert.equal(stats.inputRows, 4);
    assert.equal(stats.eligibleRows, 3);
    assert.equal(stats.ineligibleRows, 1);
  });

  it('correlates rows on present values only — a sparse id refines grouping when present, never blobbed into one - group', () => {
    // correlationColumns = [traceId, messageId]; messageId is sparse.
    const sparseProfile = { ...profile, correlationColumns: ['traceId', 'messageId'] };
    const rows = [
      // tx1 with messageId m1
      { traceId: 'tx1', messageId: 'm1', step: '1', actor: 'AuthService', action: 'start', status: 'ok', direction: 'REQ' },
      // tx1 with messageId m2 — different messageId => different group
      { traceId: 'tx1', messageId: 'm2', step: '2', actor: 'AuthService', action: 'complete', status: 'ok', direction: 'REQ' },
      // tx1 WITHOUT messageId — joins the group keyed by traceId alone…
      // but neither present group matches "tx1" exactly, so it gets its own
      // group keyed on the present values only.
      { traceId: 'tx1', step: '3', actor: 'DbService', action: 'lookup', status: 'ok', direction: 'REQ' },
      // tx2 with no messageId
      { traceId: 'tx2', step: '1', actor: 'AuthService', action: 'start', status: 'ok', direction: 'REQ' },
      { traceId: 'tx2', step: '2', actor: 'DbService', action: 'lookup', status: 'ok', direction: 'REQ' },
    ];

    const { stats } = mineSequences(rows, sparseProfile);
    assert.equal(stats.inputRows, 5);
    assert.equal(stats.eligibleRows, 5);
    assert.equal(stats.ineligibleRows, 0);
    // groups: tx1|m1, tx1|m2, tx1 (messageId absent), tx2 (messageId absent)
    assert.equal(stats.correlationKeyCount, 4);
  });

  it('falls back to a single - group only when ALL correlation values are absent', () => {
    const rows = [
      row('t1', '1', 'AuthService', 'start', 'ok'),
      { step: '2', actor: 'DbService', action: 'lookup', status: 'ok', direction: 'REQ' }, // no traceId
      { traceId: '', step: '3', actor: 'DbService', action: 'lookup', status: 'ok', direction: 'REQ' }, // blank traceId
      row('t2', '1', 'AuthService', 'start', 'ok'),
    ];

    const { markdown, stats } = mineSequences(rows, profile);
    assert.equal(stats.inputRows, 4);
    assert.equal(stats.eligibleRows, 4);
    assert.equal(stats.ineligibleRows, 0);
    // t1, t2, and one shared - group for the two sparse rows
    assert.equal(stats.correlationKeyCount, 3);
    assert.ok(markdown.includes('`-`'));
  });

  it('keeps rows with - token columns (only entity/direction are mandatory)', () => {
    const rows = [
      row('t1', '1', 'AuthService', 'start', 'ok'),
      { traceId: 't1', step: '2', actor: 'AuthService', action: 'complete', direction: 'REQ' },
    ];

    // Default (flag absent) is ON, but missing token components no longer
    // disqualify the row — it renders with - in the token columns.
    const { markdown, stats } = mineSequences(rows, profile);
    assert.equal(stats.inputRows, 2);
    assert.equal(stats.eligibleRows, 2);
    assert.equal(stats.ineligibleRows, 0);
    assert.ok(markdown.includes('AuthService | REQ | `AuthService:complete:-`'));
  });

  it('excludes rows with missing entity/direction values by default', () => {
    const rows = [
      row('t1', '1', 'AuthService', 'start', 'ok'),
      { traceId: 't1', step: '2', actor: 'AuthService', action: 'complete', status: 'ok' }, // no direction
      { traceId: 't1', step: '3', action: 'finish', status: 'ok', direction: 'REQ' }, // no entity
      row('t1', '4', 'AuthService', 'finish', 'ok', ''), // empty direction
    ];

    // Default (flag absent) is ON: rows 2–4 are excluded.
    const { markdown, stats } = mineSequences(rows, profile);
    assert.equal(stats.inputRows, 4);
    assert.equal(stats.eligibleRows, 1);
    assert.equal(stats.ineligibleRows, 3);
    assert.ok(!markdown.includes('complete'));
    assert.ok(!markdown.includes('finish'));

    // Explicit ON behaves the same.
    const on = mineSequences(rows, { ...profile, excludeMissingTokens: true });
    assert.equal(on.stats.ineligibleRows, 3);

    // Explicit OFF keeps the rows and substitutes - in the standard columns.
    const off = mineSequences(rows, { ...profile, excludeMissingTokens: false });
    assert.equal(off.stats.eligibleRows, 4);
    assert.equal(off.stats.ineligibleRows, 0);
    assert.ok(off.markdown.includes('| AuthService | - |'));
    assert.ok(off.markdown.includes('| - | REQ |'));
  });

  it('joins token components in the configured tokenColumns order', () => {
    const rows = [
      { traceId: 't1', step: '1', actor: 'AuthService', action: 'Start', status: 'OK', direction: 'REQ' },
    ];

    const { markdown } = mineSequences(rows, { ...profile, tokenColumns: ['status', 'action', 'actor'] });
    assert.ok(markdown.includes('`OK:Start:AuthService`'));
    // Component columns follow the same order in the rendered table.
    assert.ok(markdown.includes('| Step | Entity | Direction | Token | Status | Action | Actor |'));
    assert.ok(markdown.includes('| 1 | AuthService | REQ | `OK:Start:AuthService` |'));
  });

  it('normalises signature tokens while preserving display case', () => {
    const rows = [
      row('t1', '1', 'AuthService', 'Start', 'OK'),
      row('t1', '2', 'AuthService', 'Complete', 'OK'),
    ];

    const { markdown } = mineSequences(rows, profile);
    assert.ok(markdown.includes('`AuthService:Start:OK`'));
    assert.ok(markdown.includes('`AuthService:Complete:OK`'));
  });

  it('caps example keys by maxExampleKeys', () => {
    const rows = [];
    for (let i = 1; i <= 5; i++) {
      rows.push(row(`trace-${i}`, '1', 'AuthService', 'start', 'ok'));
    }

    const { markdown } = mineSequences(rows, { ...profile, maxExampleKeys: 2 });
    const matches = markdown.match(/`trace-\d+`/g);
    assert.equal(matches.length, 2);
  });

  it('sorts by frequency descending when configured', () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => row(`a${i}`, '1', 'X', 'x', 'ok')),
      ...Array.from({ length: 1 }, (_, i) => row(`b${i}`, '1', 'Y', 'y', 'ok')),
      ...Array.from({ length: 2 }, (_, i) => row(`c${i}`, '1', 'Z', 'z', 'ok')),
    ];

    const { markdown } = mineSequences(rows, { ...profile, tokenColumns: ['actor'], sortOrder: 'frequency-desc' });
    const sequenceHeaders = markdown.match(/## [^\n]+/g);
    assert.deepEqual(sequenceHeaders, ['## X', '## Z', '## Y']);
    // Raw signature is still available as a bullet under each heading.
    assert.ok(markdown.includes('**Signature**: `X`'));
  });

  it('sorts by signature ascending when configured', () => {
    const rows = [
      row('t1', '1', 'Charlie', 'x', 'ok'),
      row('t2', '1', 'Alpha', 'x', 'ok'),
      row('t3', '1', 'Bravo', 'x', 'ok'),
    ];

    const { markdown } = mineSequences(rows, { ...profile, tokenColumns: ['actor'], sortOrder: 'signature-asc' });
    const match = markdown.match(/## [^\n]+/g);
    assert.deepEqual(match, ['## Alpha', '## Bravo', '## Charlie']);
  });

  it('uses numeric ordering for order columns when values are numbers', () => {
    const rows = [
      row('t1', '10', 'AuthService', 'start', 'ok'),
      row('t1', '2', 'AuthService', 'middle', 'ok'),
      row('t1', '1', 'AuthService', 'end', 'ok'),
    ];

    const { markdown } = mineSequences(rows, profile);
    const stepTokens = markdown.match(/\| \d+ \| [^|]+ \| [^|]+ \| `([^`]+)` \|/g);
    assert.deepEqual(stepTokens, [
      '| 1 | AuthService | REQ | `AuthService:end:ok` |',
      '| 2 | AuthService | REQ | `AuthService:middle:ok` |',
      '| 3 | AuthService | REQ | `AuthService:start:ok` |',
    ]);
  });

  it('leads the output table with the standard Entity and Direction columns', () => {
    const rows = [row('t1', '1', 'AuthService', 'start', 'ok')];
    const { markdown } = mineSequences(rows, { ...profile, includeTokenComponents: false });
    assert.ok(markdown.includes('| Step | Entity | Direction | Token |'));
    assert.ok(markdown.includes('| 1 | AuthService | REQ | `AuthService:start:ok` |'));
  });

  it('omits token component columns when includeTokenComponents is false', () => {
    const rows = [row('t1', '1', 'AuthService', 'start', 'ok')];
    const { markdown } = mineSequences(rows, { ...profile, includeTokenComponents: false });
    assert.ok(markdown.includes('| Step | Entity | Direction | Token |'));
    assert.ok(!markdown.includes('| Actor |'));
  });

  it('rejects invalid profiles', () => {
    assert.throws(() => mineSequences([], null), /sequenceProfile is required/);
    assert.throws(
      () => mineSequences([], { orderColumns: [], correlationColumns: ['traceId'], tokenColumns: ['actor'], entityColumn: 'actor', directionColumn: 'direction' }),
      /orderColumns must be a non-empty array/
    );
    assert.throws(
      () => mineSequences([], { orderColumns: ['step'], correlationColumns: [], tokenColumns: ['actor'], entityColumn: 'actor', directionColumn: 'direction' }),
      /correlationColumns must be a non-empty array/
    );
    assert.throws(
      () => mineSequences([], { orderColumns: ['step'], correlationColumns: ['traceId'], tokenColumns: [], entityColumn: 'actor', directionColumn: 'direction' }),
      /tokenColumns must be a non-empty array/
    );
  });

  it('requires entityColumn and directionColumn', () => {
    const rows = [row('t1', '1', 'AuthService', 'start', 'ok')];
    assert.throws(
      () => mineSequences(rows, { orderColumns: ['step'], correlationColumns: ['traceId'], tokenColumns: ['actor', 'action'] }),
      /entityColumn is required/
    );
    assert.throws(
      () => mineSequences(rows, { orderColumns: ['step'], correlationColumns: ['traceId'], tokenColumns: ['actor', 'action'], entityColumn: 'actor' }),
      /directionColumn is required/
    );
    assert.throws(
      () => mineSequences(rows, { ...profile, entityColumn: '' }),
      /entityColumn is required/
    );
  });

  it('leads the output table with standard Entity and Direction columns', () => {
    const rows = [
      { traceId: 't1', step: '1', actor: 'OrderService', action: 'create', status: 'ok', direction: 'REQUEST' },
      { traceId: 't1', step: '2', actor: 'PaymentService', action: 'charge', status: 'ok', direction: 'RESPONSE' },
    ];

    const { markdown } = mineSequences(rows, profile);

    assert.ok(markdown.includes('**Entity field**: `actor`'));
    assert.ok(markdown.includes('**Direction field**: `direction`'));
    assert.ok(markdown.includes('| Step | Entity | Direction | Token | Actor | Action | Status |'));
    assert.ok(markdown.includes('| 1 | OrderService | REQUEST | `OrderService:create:ok` |'));
    assert.ok(markdown.includes('| 2 | PaymentService | RESPONSE | `PaymentService:charge:ok` |'));
  });

  it('substitutes - for absent entity/direction values when exclusion is off', () => {
    const rows = [
      { traceId: 't1', step: '1', actor: 'AuthService', action: 'start', status: 'ok' },
    ];
    const { markdown } = mineSequences(rows, { ...profile, excludeMissingTokens: false });
    assert.ok(markdown.includes('| 1 | AuthService | - | `AuthService:start:ok` |'));
  });

  it('uses "-" as the default missing-value placeholder', () => {
    const rows = [
      { traceId: 't1', step: '1', actor: 'AuthService', action: 'start' }, // no status, no direction
    ];
    const { markdown } = mineSequences(rows, { ...profile, excludeMissingTokens: false });
    assert.ok(markdown.includes('| 1 | AuthService | - | `AuthService:start:-` |'));
  });

  it('honours a custom missingValue in token/entity/direction/correlation output', () => {
    const rows = [
      { step: '1', actor: 'AuthService', action: 'start' }, // no traceId, no status, no direction
      { traceId: 't1', step: '1', actor: 'AuthService', action: 'start', status: 'ok', direction: 'REQ' },
    ];
    const { markdown } = mineSequences(rows, {
      ...profile,
      excludeMissingTokens: false,
      missingValue: '<none>',
    });
    // custom placeholder in token column, direction column, and correlation group key
    assert.ok(markdown.includes('`AuthService:start:<none>`'));
    assert.ok(markdown.includes('| 1 | AuthService | <none> |'));
    assert.ok(markdown.includes('`<none>`'));
    // default placeholder must NOT appear
    assert.ok(!markdown.includes('`-`'));
  });

  it('falls back to "-" when missingValue is an empty string', () => {
    const rows = [
      { traceId: 't1', step: '1', actor: 'AuthService', action: 'start' },
    ];
    const { markdown } = mineSequences(rows, {
      ...profile,
      excludeMissingTokens: false,
      missingValue: '',
    });
    assert.ok(markdown.includes('`AuthService:start:-`'));
  });


  describe('caps', () => {
    it('maxInputRows down-samples deterministically and reports truncated', () => {
      const rows = Array.from({ length: 100 }, (_, i) => row(`t${i}`, '1', 'A', 'x', 'ok'));
      const capped = { ...profile, maxInputRows: 10 };
      const a = mineSequences(rows, capped);
      const b = mineSequences(rows, capped);
      assert.equal(a.stats.truncated, true);
      assert.equal(a.stats.truncatedRows, 90);
      assert.equal(a.stats.inputRows, 100);
      assert.equal(a.stats.eligibleRows, 10);
      // deterministic: identical markdown across runs
      assert.equal(a.markdown, b.markdown);
      assert.ok(a.markdown.includes('**Truncated**: yes — 90 input rows'));
      // uncapped run uses all rows and reports truncated=false
      const uncapped = mineSequences(rows, profile);
      assert.equal(uncapped.stats.truncated, false);
      assert.equal(uncapped.stats.truncatedRows, 0);
      assert.equal(uncapped.stats.eligibleRows, 100);
    });

    it('maxInputRows: 0 means unlimited', () => {
      const rows = Array.from({ length: 50 }, (_, i) => row(`t${i}`, '1', 'A', 'x', 'ok'));
      const { stats } = mineSequences(rows, { ...profile, maxInputRows: 0 });
      assert.equal(stats.truncated, false);
      assert.equal(stats.eligibleRows, 50);
    });

    it('maxSignatures folds overflow into one trailing section', () => {
      // 5 distinct signatures (different actors per trace)
      const rows = ['A', 'B', 'C', 'D', 'E'].flatMap((actor, i) => [
        row(`t${i}`, '1', actor, 'x', 'ok'),
      ]);
      const capped = { ...profile, maxSignatures: 2, sortOrder: 'signature-asc' };
      const { markdown, stats } = mineSequences(rows, capped);
      assert.equal(stats.sequenceCount, 3); // 2 kept + 1 overflow
      assert.equal(stats.overflowSignatures, 3);
      assert.ok(markdown.includes('…+3 more signatures'));
      assert.ok(markdown.includes('**Overflow**: 3 signatures folded'));
      // kept sections are the first two by signature-asc
      assert.ok(markdown.includes('## `…+3 more signatures`')); // overflow heading has no number by default
    });

    it('maxSignatures default is 1000 and uncapped small inputs report no overflow', () => {
      const rows = [row('t1', '1', 'A', 'x', 'ok')];
      const { stats } = mineSequences(rows, profile);
      assert.equal(stats.overflowSignatures, 0);
      assert.equal(stats.sequenceCount, 1);
    });

    it('maxRowsPerGroup truncates rows per group after ordering and counts capped groups', () => {
      const rows = Array.from({ length: 10 }, (_, i) =>
        row('t1', String(i + 1), 'A', 'x', 'ok'));
      const capped = { ...profile, maxRowsPerGroup: 3 };
      const { stats, markdown } = mineSequences(rows, capped);
      assert.equal(stats.cappedGroups, 1);
      assert.equal(stats.eligibleRows, 10); // eligibility counted pre-cap
      assert.ok(markdown.includes('**Capped groups**: 1'));
      // only 3 steps in the rendered table
      const steps = markdown.match(/^\| \d+ \|/gm) || [];
      assert.equal(steps.length, 3);
    });

    it('rejects non-integer caps', () => {
      assert.throws(() => mineSequences([row('t1', '1', 'A', 'x', 'ok')], { ...profile, maxInputRows: 1.5 }), /maxInputRows must be a non-negative integer/);
      assert.throws(() => mineSequences([row('t1', '1', 'A', 'x', 'ok')], { ...profile, maxSignatures: -1 }), /maxSignatures must be a non-negative integer/);
      assert.throws(() => mineSequences([row('t1', '1', 'A', 'x', 'ok')], { ...profile, maxRowsPerGroup: 'x' }), /maxRowsPerGroup must be a non-negative integer/);
    });

    it('minSteps defaults to 2: single-step sequences are dropped', () => {
      const rows = [
        row('t1', '1', 'A', 'x', 'ok'),                                    // 1-step group
        row('t2', '1', 'B', 'y', 'ok'), row('t2', '2', 'B', 'z', 'ok'),      // 2-step group
      ];
      const { markdown, stats } = mineSequences(rows, { ...profile, minSteps: undefined });
      assert.equal(stats.sequenceCount, 1);
      assert.ok(!markdown.includes('A:x:ok'));
      assert.ok(markdown.includes('B:y:ok') && markdown.includes('B:z:ok'));
      assert.ok(markdown.includes('**Min steps**: 2'));
    });

    it('minSteps: 1 keeps single-step sequences; invalid values rejected', () => {
      const rows = [row('t1', '1', 'A', 'x', 'ok')];
      const { stats, markdown } = mineSequences(rows, { ...profile, minSteps: 1 });
      assert.equal(stats.sequenceCount, 1);
      assert.ok(!markdown.includes('**Min steps**'));
      assert.throws(() => mineSequences(rows, { ...profile, minSteps: 0 }), /minSteps must be at least 1/);
      assert.throws(() => mineSequences(rows, { ...profile, minSteps: 1.5 }), /minSteps must be a non-negative integer/);
    });

    it('outputFormat defaults to steps; graph merges observed flows into disconnected component tables', () => {
      // Three correlation groups, two of which share the AuthService -> DbService flow.
      const rows = [
        row('t1', '1', 'AuthService', 'start', 'ok', 'REQ'),
        row('t1', '2', 'DbService', 'lookup', 'ok', 'REQ'),
        row('t1', '3', 'AuthService', 'complete', 'ok', 'RES'),
        row('t2', '1', 'AuthService', 'start', 'ok', 'REQ'),
        row('t2', '2', 'DbService', 'lookup', 'ok', 'REQ'),
        row('t3', '1', 'AuthService', 'start', 'ok', 'REQ'),
        row('t3', '2', 'DbService', 'lookup', 'ok', 'REQ'),
      ];
      const graphProfile = { ...profile, separator: '$', outputFormat: 'graph' };

      // Default: step table, no graph header.
      const steps = mineSequences(rows, profile);
      assert.ok(steps.markdown.includes('| Step | Entity | Direction | Token |'));
      assert.ok(!steps.markdown.includes('| From | To | Type | Label | Support |'));

      const graph = mineSequences(rows, graphProfile);
      assert.ok(!graph.markdown.includes('| Step | Entity | Direction | Token |'));
      assert.ok(graph.markdown.includes('| From | To | Type | Label | Support | Actor | Action | Status |'));
      // All flows share nodes -> ONE component table, not one per group/signature.
      assert.ok(graph.markdown.includes('## 2 nodes, 2 edges'));
      assert.ok(!graph.markdown.includes('## Graph'));
      // Per component: a nodes table AND an edges table.
      assert.ok(graph.markdown.includes('| Node |'));
      assert.ok(graph.markdown.includes('| AuthService |'));
      assert.ok(graph.markdown.includes('| DbService |'));
      assert.equal(graph.stats.sequenceCount, 1);
      assert.equal(graph.stats.graphCount, 1);
      assert.equal(graph.stats.edgeCount, 2);
      // Shared edge appears once, support = 3 raw observations; Traces column dropped,
      // token fields have their own columns instead.
      const edgeRows = graph.markdown.split('\n').filter((l) => l.startsWith('| AuthService | DbService'));
      assert.equal(edgeRows.length, 1);
      assert.ok(edgeRows[0].includes('| REQ | `AuthService:start:ok` | 3 | AuthService | start | ok |'));
      assert.ok(!graph.markdown.includes('Traces'));
    });

    it('outputFormat graph splits into multiple tables only when components are disconnected', () => {
      const rows = [
        row('t1', '1', 'A', 'x', 'ok'),
        row('t1', '2', 'B', 'y', 'ok'),
        row('t2', '1', 'C', 'p', 'ok'),
        row('t2', '2', 'D', 'q', 'ok'),
      ];
      const { markdown, stats } = mineSequences(rows, { ...profile, outputFormat: 'graph', separator: '$' });
      assert.equal(stats.graphCount, 2);
      assert.equal(stats.edgeCount, 2);
      // {A,B} and {C,D} share no nodes -> two component tables, no overlapping rows.
      assert.ok(markdown.includes('## 2 nodes, 1 edge'));
      assert.ok(markdown.includes('| A | B | REQ | `A:x:ok` | 1 | A | x | ok |'));
      assert.ok(markdown.includes('| C | D | REQ | `C:p:ok` | 1 | C | p | ok |'));
      assert.ok(!markdown.includes('| A | D'));
    });

    it('outputFormat graph still applies minSteps to drop flowless groups', () => {
      const rows = [
        row('t1', '1', 'A', 'x', 'ok'),                                    // 1-step group, dropped
        row('t2', '1', 'B', 'y', 'ok'), row('t2', '2', 'C', 'z', 'ok'),      // 2-step group
      ];
      const { markdown, stats } = mineSequences(rows, { ...profile, outputFormat: 'graph' });
      assert.equal(stats.sequenceCount, 1);
      assert.ok(markdown.includes('| B | C |'));
      assert.ok(!markdown.includes('| A |'));
    });

    it('outputFormat rejects unknown values', () => {
      assert.throws(() => mineSequences([row('t1', '1', 'A', 'x', 'ok')], { ...profile, outputFormat: 'diagram' }), /outputFormat must be one of: steps, graph/);
    });

    it('sequence headings get a descriptive entity-flow name; repeats collapse and long flows cap at 6 hops', () => {
      const rows = [
        // A -> A -> B -> C : repeated entity collapses to "A → B → C"
        row('t1', '1', 'A', 'x', 'ok'),
        row('t1', '2', 'A', 'y', 'ok'),
        row('t1', '3', 'B', 'z', 'ok'),
        row('t1', '4', 'C', 'w', 'ok'),
        // 8 distinct entities: capped at 6 hops + ellipsis
        row('t2', '1', 'N1', 'a', 'ok'),
        row('t2', '2', 'N2', 'b', 'ok'),
        row('t2', '3', 'N3', 'c', 'ok'),
        row('t2', '4', 'N4', 'd', 'ok'),
        row('t2', '5', 'N5', 'e', 'ok'),
        row('t2', '6', 'N6', 'f', 'ok'),
        row('t2', '7', 'N7', 'g', 'ok'),
        row('t2', '8', 'N8', 'h', 'ok'),
      ];
      const { markdown } = mineSequences(rows, { ...profile, minSteps: 1 });
      assert.ok(markdown.includes('## A → B → C'));
      assert.ok(markdown.includes('## N1 → N2 → N3 → N4 → N5 → N6 → …'));
    });

    it('includeSequenceNumbers: true keeps the "Sequence N —"/"Graph N —" ordinal prefix', () => {
      const rows = [
        row('t1', '1', 'A', 'x', 'ok'),
        row('t1', '2', 'B', 'y', 'ok'),
      ];
      const numbered = mineSequences(rows, { ...profile, includeSequenceNumbers: true });
      assert.ok(numbered.markdown.includes('## Sequence 1 — A → B'));

      const graph = mineSequences(rows, { ...profile, outputFormat: 'graph', includeSequenceNumbers: true });
      assert.ok(graph.markdown.includes('## Graph 1 — 2 nodes, 1 edge'));

      // Default stays unnumbered.
      const plain = mineSequences(rows, profile);
      assert.ok(!plain.markdown.includes('## Sequence'));
    });
  });
});
