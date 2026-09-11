import mermaid from 'mermaid';

let lastRenderer: 'dagre' | 'elk' | undefined;
let lastTheme: 'default' | 'dark' | undefined;

export function getMermaidTheme(): 'default' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  const root = document.documentElement;
  const isDark = root.classList.contains('dark');
  return isDark ? 'dark' : 'default';
}

export function initializeMermaid(renderer?: 'dagre' | 'elk', theme: 'default' | 'dark' = getMermaidTheme()) {
  const config: any = {
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    suppressErrorRendering: true,
  };
  if (renderer) {
    config.flowchart = { defaultRenderer: renderer };
  }
  mermaid.initialize(config);
  lastRenderer = renderer;
  lastTheme = theme;
}

/**
 * Ensure Mermaid is initialized with the desired default config before each render.
 * We always re-initialize rather than only on renderer changes, because the app theme
 * can change and other imports or auto-initialization may have left stale config.
 */
export function ensureMermaidInitialized(renderer?: 'dagre' | 'elk') {
  initializeMermaid(renderer, getMermaidTheme());
}

/** @deprecated Use ensureMermaidInitialized, which always re-applies config. */
export function maybeInitializeMermaid(renderer?: 'dagre' | 'elk') {
  ensureMermaidInitialized(renderer);
}

export function useMermaidThemeSync() {
  if (typeof document === 'undefined') return;
  const theme = getMermaidTheme();
  if (theme !== lastTheme) {
    ensureMermaidInitialized(lastRenderer);
  }
}
