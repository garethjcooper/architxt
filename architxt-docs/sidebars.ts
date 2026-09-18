import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/prerequisites',
        'getting-started/installation',
        'getting-started/configuration',
        'getting-started/quick-start',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      collapsed: false,
      items: ['core-concepts/entities', 'core-concepts/documents', 'core-concepts/mental-models', 'core-concepts/aql', 'core-concepts/contexts', 'core-concepts/metadata', 'core-concepts/tags', 'core-concepts/bank-settings', 'core-concepts/directives'],
    },
    {
      type: 'category',
      label: 'Context Patches',
      collapsed: false,
      items: ['context-patches/overview', 'context-patches/graph', 'context-patches/candidates', 'context-patches/mental-models', 'context-patches/sync-jobs'],
    },
    {
      type: 'category',
      label: 'Workspace',
      collapsed: false,
      items: ['workspace/overview', 'workspace/contextual-data', 'workspace/reflect-queries-and-session-items'],
    },
    {
      type: 'category',
      label: 'Hindsight Sync',
      collapsed: false,
      items: ['hindsight-sync/overview', 'hindsight-sync/documents', 'hindsight-sync/entities', 'hindsight-sync/mental-models', 'hindsight-sync/directives', 'hindsight-sync/bank-settings'],
    },
  ],
};

export default sidebars;
