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
    // Mermaid v12 defaults to ELK; align the app default with upstream so the
    // upgraded renderer is actually used unless a surface explicitly asks for dagre.
    layout: renderer ?? 'elk',
    flowchart: {
      // Render to fixed pixel dimensions so pan/zoom fit-to-page centers on the
      // actual diagram rather than the surrounding container.
      useMaxWidth: false,
    },
  };
  mermaid.initialize(config);
  lastRenderer = renderer;
  lastTheme = theme;
}

/**
 * Ensure Mermaid is initialized with the desired default config before a render.
 * Skips re-initialization if the renderer/theme haven't changed, because calling
 * mermaid.initialize() during active ELK renders can trigger a second layout pass.
 */
export function ensureMermaidInitialized(renderer?: 'dagre' | 'elk') {
  const theme = getMermaidTheme();
  if (renderer === lastRenderer && theme === lastTheme) return;
  initializeMermaid(renderer, theme);
}

/** @deprecated Use ensureMermaidInitialized, which guards against redundant re-init. */
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

let hiddenRenderContainer: HTMLDivElement | null = null;

function getHiddenRenderContainer(): HTMLDivElement | undefined {
  if (typeof document === 'undefined') return undefined;
  if (!hiddenRenderContainer || !document.body.contains(hiddenRenderContainer)) {
    const hidden = document.createElement('div');
    hidden.style.position = 'fixed';
    hidden.style.visibility = 'hidden';
    hidden.style.pointerEvents = 'none';
    hidden.style.left = '-9999px';
    hidden.style.top = '-9999px';
    hidden.style.width = '0';
    hidden.style.height = '0';
    hidden.setAttribute('aria-hidden', 'true');
    document.body.appendChild(hidden);
    hiddenRenderContainer = hidden;
  }
  return hiddenRenderContainer;
}

/**
 * Render a Mermaid diagram into a hidden off-screen container.
 *
 * Mermaid's `render()` appends a temporary div to `document.body` when no
 * container is supplied. During async ELK layout this temporary DOM can
 * flash at the bottom of the viewport. Passing a hidden container keeps the
 * intermediate render off-screen.
 */
export async function renderMermaid(id: string, source: string, renderer?: 'dagre' | 'elk') {
  ensureMermaidInitialized(renderer);
  const container = getHiddenRenderContainer();
  return mermaid.render(id, source.trim(), container);
}
