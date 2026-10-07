'use client';

import { toast } from 'sonner';
import type { Node, Edge } from '@xyflow/react';
import type { ViewNode } from '@/lib/types';

export interface ViewExportOptions {
  /** React Flow wrapper element used to read final node positions. */
  container: HTMLElement;
  /** Current React Flow nodes (with `data.node` ViewNode and display flags). */
  nodes: Node[];
  /** Current React Flow edges. */
  edges: Edge[];
  /** Optional background color for the exported image. */
  backgroundColor?: string;
  /** Padding around the graph content in px (default: 16). */
  padding?: number;
  /** Pixel ratio for PNG export (default: 2). */
  pixelRatio?: number;
}

type DiffStatus = 'added' | 'removed' | 'updated' | null;
type TextAlign = 'left' | 'center' | 'right';
type VerticalAlign = 'top' | 'center' | 'bottom';

interface NodeStyle {
  backgroundColor: string;
  borderColor: string;
  borderRadius: string;
  color: string;
  fontFamily: string;
  fontSize: string;
  sideBarColor?: string;
}

interface NodeLayout extends NodeStyle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  idText?: string;
  labelText?: string;
  noteText?: string;
  showNodeColorBar?: boolean;
}

interface EdgeElement {
  path: SVGPathElement;
  label: SVGTextElement | null;
  labelTransform?: string | null;
  labelBg?: SVGRectElement | null;
}

interface ResolvedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const FONT_FAMILY = 'Geist, ui-sans-serif, system-ui, sans-serif';

function escapeXmlAttribute(text: string): string {
  return text
    .replace(/\u0026/g, '&amp;')
    .replace(/\u003c/g, '&lt;')
    .replace(/\u003e/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeFontFamily(font: string): string {
  // React Flow reports a font stack that can include unquoted fallback names
  // (e.g. "Geist Fallback"). For a double-quoted SVG attribute, wrap each
  // family name in single quotes if it contains spaces; otherwise leave it bare.
  const names = font.split(',').map((n) => n.trim()).filter(Boolean);
  const normalized = names.map((n) => {
    // Strip any existing surrounding quotes.
    const bare = n.replace(/^['"]/, '').replace(/['"]$/, '');
    if (/\s/.test(bare) || /[^\w\- ]/.test(bare)) {
      return `'${bare.replace(/'/g, "\\'")}'`;
    }
    return bare;
  });
  return normalized.join(', ');
}

function isTransparent(value: string): boolean {
  return !value || value === 'none' || value === 'transparent' || value === 'rgba(0, 0, 0, 0)';
}

function pxValue(value: string): number {
  const num = parseFloat(value);
  return Number.isNaN(num) ? 0 : num;
}

function readTextAlign(value: string): TextAlign {
  if (value === 'center') return 'center';
  if (value === 'right') return 'right';
  return 'left';
}

function readVerticalAlign(value: string): VerticalAlign {
  if (value === 'flex-start') return 'top';
  if (value === 'flex-end') return 'bottom';
  return 'center';
}

function readNodeLayouts(container: HTMLElement, nodes: Node[]): NodeLayout[] {
  const viewport = container.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!viewport) return [];

  const nodeDataMap = new Map(nodes.map((n) => [String(n.id), n.data as { node?: ViewNode; showNodeColorBar?: boolean } | undefined]));

  return Array.from(viewport.querySelectorAll('.react-flow__node')).map((el) => {
    const wrapper = el as HTMLElement;
    const nodeData = nodeDataMap.get(wrapper.getAttribute('data-id') || '');
    const transform = wrapper.style.transform || window.getComputedStyle(wrapper).transform;
    const match = /translate\(([^,]+)[, ]+([^)]+)\)/.exec(transform);
    const x = match ? parseFloat(match[1]) : 0;
    const y = match ? parseFloat(match[2]) : 0;

    // The visual styles live on the inner custom node root, not on the wrapper.
    const contentRoot = (wrapper.querySelector(':scope > div') as HTMLElement) || wrapper;
    const style = window.getComputedStyle(contentRoot);
    const bgColor = style.backgroundColor;

    // Find the coloured left bar inside the actual node content, but only if the
    // view has colour bars enabled for this node.
    let sideBarColor: string | undefined;
    if (nodeData?.showNodeColorBar !== false) {
      for (const child of contentRoot.children) {
        const childEl = child as HTMLElement;
        const childStyle = window.getComputedStyle(childEl);
        if (
          childEl.classList.contains('hidden') ||
          childEl.offsetWidth === 0 ||
          child.tagName.toLowerCase() !== 'div' ||
          child.getAttribute('aria-hidden') !== 'true' ||
          childStyle.position !== 'absolute' ||
          childStyle.left !== '0px' ||
          childStyle.top !== '0px' ||
          childStyle.bottom !== '0px' ||
          isTransparent(childStyle.backgroundColor) ||
          childStyle.backgroundColor === bgColor
        ) {
          continue;
        }
        sideBarColor = childStyle.backgroundColor;
        break;
      }
    }

    // Extract visible text divs, ignoring handles and the side bar.
    const textDivs = Array.from(contentRoot.querySelectorAll(':scope > div')).filter((child) => {
      const div = child as HTMLElement;
      if (div.classList.contains('react-flow__handle')) return false;
      if (div.getAttribute('aria-hidden') === 'true') return false;
      return (div.textContent || '').trim().length > 0;
    });

    const nodeType = (wrapper.getAttribute('data-type') || nodeDataMap.get(wrapper.getAttribute('data-id') || '')?.node?.type || 'entity') as string;

    let idText: string | undefined;
    let labelText: string | undefined;
    let noteText: string | undefined;

    if (nodeType === 'entity') {
      // EntityNode renders [side bar, handles, optional id div, label div].
      if (textDivs.length >= 2) {
        idText = textDivs[0].textContent || undefined;
        labelText = textDivs[textDivs.length - 1].textContent || undefined;
      } else if (textDivs.length === 1) {
        labelText = textDivs[0].textContent || undefined;
      }
    } else if (nodeType === 'note') {
      noteText = textDivs[0]?.textContent || undefined;
    } else {
      labelText = textDivs[0]?.textContent || undefined;
    }

    return {
      id: wrapper.getAttribute('data-id') || wrapper.getAttribute('id') || '',
      x,
      y,
      width: wrapper.offsetWidth,
      height: wrapper.offsetHeight,
      type: nodeType,
      textAlign: readTextAlign(style.textAlign),
      verticalAlign: readVerticalAlign(style.justifyContent),
      idText,
      labelText,
      noteText,
      showNodeColorBar: nodeData?.showNodeColorBar,
      backgroundColor: bgColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      color: style.color,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      sideBarColor,
    };
  });
}

function findCanvasBackground(container: HTMLElement): string | undefined {
  let el: HTMLElement | null = container;
  while (el) {
    const bg = window.getComputedStyle(el).backgroundColor;
    if (!isTransparent(bg)) {
      return bg;
    }
    el = el.parentElement;
  }
  return undefined;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveColor(value: string, fallback: string, container?: HTMLElement): string {
  if (isTransparent(value)) return fallback;
  if (!value.startsWith('var(')) return value;
  if (typeof document === 'undefined') return fallback;

  // Resolve CSS variables using a scratch element so we pick up values defined
  // anywhere in the document (not just :root).
  const scratch = document.createElement('div');
  scratch.style.position = 'absolute';
  scratch.style.visibility = 'hidden';
  scratch.style.color = value;
  const host = container || document.body;
  host.appendChild(scratch);
  const resolved = window.getComputedStyle(scratch).color;
  host.removeChild(scratch);

  if (isTransparent(resolved)) return fallback;
  return resolved;
}

function statusColor(status: DiffStatus): string | undefined {
  if (status === 'added') return resolveColor('var(--badge-success-fg)', '#16a34a');
  if (status === 'updated') return resolveColor('var(--badge-warning-fg)', '#d97706');
  if (status === 'removed') return resolveColor('var(--badge-danger-fg)', '#dc2626');
  return undefined;
}

function nodeStatus(node: ViewNode): DiffStatus {
  return (node.status as DiffStatus) ?? null;
}

function entityTypeForNode(node: ViewNode): string | undefined {
  return node.entity_type;
}

function wrapLines(text: string, maxLineLength = 28): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > maxLineLength && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current.length === 0 ? word : `${current} ${word}`;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length === 0 ? [text] : lines;
}

function computeBounds(layouts: NodeLayout[], padding: number): ResolvedBounds | null {
  if (layouts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of layouts) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}

function readEdgeElements(viewport: HTMLElement): EdgeElement[] {
  const result: EdgeElement[] = [];
  const edgeGroups = viewport.querySelectorAll('.react-flow__edge');
  for (const group of edgeGroups) {
    const path = group.querySelector('.react-flow__edge-path') as SVGPathElement | null;
    const label = group.querySelector('.react-flow__edge-text') as SVGTextElement | null;
    if (!path) continue;
    const labelWrapper = label?.closest('.react-flow__edge-textwrapper') as SVGGElement | null;
    const labelBg = labelWrapper?.querySelector('.react-flow__edge-textbg') as SVGRectElement | null;
    result.push({ path, label, labelTransform: labelWrapper?.getAttribute('transform') || null, labelBg });
  }
  return result;
}

function textAnchor(align: TextAlign): string {
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  return 'start';
}

function textX(layout: NodeLayout, padding: number): number {
  if (layout.textAlign === 'center') return layout.x + layout.width / 2;
  if (layout.textAlign === 'right') return layout.x + layout.width - padding;
  return layout.x + padding;
}

function renderEntityNode(node: ViewNode, layout: NodeLayout): string {
  const status = nodeStatus(node);
  const typeName = entityTypeForNode(node);
  const fontFamily = safeFontFamily(layout.fontFamily || FONT_FAMILY);
  const borderColor = statusColor(status) || layout.borderColor || resolveColor('var(--border-default)', '#e2e8f0', undefined);
  const bgColor = layout.backgroundColor || resolveColor('var(--surface-card)', '#ffffff', undefined);
  const fgColor = layout.color || resolveColor('var(--foreground-default)', '#0f172a', undefined);
  const rx = pxValue(layout.borderRadius) || 4;
  const hPad = 12;

  const label = layout.labelText ?? node.label ?? node.id;
  const idText = layout.idText;

  // Only render the side colour bar when it is enabled for this node.
  const sideBar =
    layout.showNodeColorBar !== false && layout.sideBarColor
      ? `<rect x="${layout.x}" y="${layout.y}" width="4" height="${layout.height}" rx="${rx}" fill="${layout.sideBarColor}"/>`
      : '';

  const idFontSize = 10;
  const labelFontSize = Math.max(11, pxValue(layout.fontSize) || 12);
  const idLineHeight = idFontSize + 3;
  const labelLineHeight = labelFontSize + 3;

  const idLines = idText ? wrapLines(idText, 34) : [];
  const labelLines = wrapLines(label, 28);

  const idBlockHeight = idLines.length * idLineHeight;
  const labelBlockHeight = labelLines.length * labelLineHeight;
  const gap = idLines.length > 0 ? 4 : 0;
  const totalBlockHeight = idBlockHeight + gap + labelBlockHeight;

  let startY: number;
  if (layout.verticalAlign === 'top') startY = layout.y + hPad + idLineHeight;
  else if (layout.verticalAlign === 'bottom') startY = layout.y + layout.height - hPad - totalBlockHeight + idLineHeight;
  else startY = layout.y + (layout.height - totalBlockHeight) / 2 + idLineHeight;

  let textContent = '';
  idLines.forEach((line, i) => {
    textContent += `<text x="${textX(layout, hPad)}" y="${startY + i * idLineHeight}" text-anchor="${textAnchor(layout.textAlign)}" font-family="${fontFamily}" font-size="${idFontSize}" fill="${resolveColor('var(--foreground-subtle)', '#64748b', undefined)}" font-weight="500">${escapeXml(line)}</text>`;
  });

  const labelStartY = startY + idBlockHeight + gap;
  labelLines.forEach((line, i) => {
    textContent += `<text x="${textX(layout, hPad)}" y="${labelStartY + i * labelLineHeight}" text-anchor="${textAnchor(layout.textAlign)}" font-family="${fontFamily}" font-size="${labelFontSize}" fill="${fgColor}" font-weight="500">${escapeXml(line)}</text>`;
  });

  return `
    <g class="react-flow__node-entity">
      <rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="${rx}" fill="${bgColor}" stroke="${borderColor}" stroke-width="1"/>
      ${sideBar}
      ${textContent}
    </g>
  `;
}

function renderGroupNode(node: ViewNode, layout: NodeLayout): string {
  const status = nodeStatus(node);
  const fontFamily = safeFontFamily(layout.fontFamily || FONT_FAMILY);
  const borderColor = statusColor(status) || layout.borderColor || resolveColor('var(--border-default)', '#e2e8f0', undefined);
  const bgColor = layout.backgroundColor || resolveColor('var(--surface-inset)', '#f8fafc', undefined);
  const fgColor = layout.color || resolveColor('var(--foreground-subtle)', '#64748b', undefined);
  const label = layout.labelText ?? node.label ?? 'Group';

  return `
    <g class="react-flow__node-group">
      <rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="6" fill="${bgColor}" stroke="${borderColor}" stroke-width="2" stroke-dasharray="6,4"/>
      <text x="${layout.x + 10}" y="${layout.y + 16}" font-family="${fontFamily}" font-size="10" fill="${fgColor}" font-weight="500">${escapeXml(label)}</text>
    </g>
  `;
}

function renderNoteNode(node: ViewNode, layout: NodeLayout): string {
  const status = nodeStatus(node);
  const fontFamily = safeFontFamily(layout.fontFamily || FONT_FAMILY);
  const borderColor = statusColor(status) || layout.borderColor || resolveColor('var(--border-default)', '#e2e8f0', undefined);
  const bgColor = layout.backgroundColor || resolveColor('var(--surface-panel)', '#ffffff', undefined);
  const fgColor = layout.color || resolveColor('var(--foreground-default)', '#0f172a', undefined);
  const text = layout.noteText ?? node.text ?? node.label ?? 'Note';
  const lines = wrapLines(text, 26);

  let textContent = '';
  lines.forEach((line, i) => {
    textContent += `<text x="${layout.x + 8}" y="${layout.y + 16 + i * 15}" font-family="${fontFamily}" font-size="11" fill="${fgColor}">${escapeXml(line)}</text>`;
  });

  return `
    <g class="react-flow__node-note">
      <rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="4" fill="${bgColor}" stroke="${borderColor}" stroke-width="1"/>
      ${textContent}
    </g>
  `;
}

function renderShapeNode(node: ViewNode, layout: NodeLayout): string {
  const shape = node.shape || 'rectangle';
  const status = nodeStatus(node);
  const fontFamily = safeFontFamily(layout.fontFamily || FONT_FAMILY);
  const borderColor = statusColor(status) || layout.borderColor || resolveColor('var(--border-default)', '#e2e8f0', undefined);
  const bgColor = node.style?.backgroundColor || layout.backgroundColor || resolveColor('var(--surface-card)', '#ffffff', undefined);
  const fgColor = layout.color || resolveColor('var(--foreground-default)', '#0f172a', undefined);
  const label = layout.labelText ?? node.label ?? 'Shape';

  let shapeEl: string;
  if (shape === 'circle') {
    const r = Math.min(layout.width, layout.height) / 2;
    const cx = layout.x + layout.width / 2;
    const cy = layout.y + layout.height / 2;
    shapeEl = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${bgColor}" stroke="${borderColor}" stroke-width="2"/>`;
  } else {
    shapeEl = `<rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="4" fill="${bgColor}" stroke="${borderColor}" stroke-width="2"/>`;
  }

  return `
    <g class="react-flow__node-shape">
      ${shapeEl}
      <text x="${layout.x + layout.width / 2}" y="${layout.y + layout.height / 2 + 4}" text-anchor="middle" font-family="${fontFamily}" font-size="10" fill="${fgColor}" font-weight="500">${escapeXml(label)}</text>
    </g>
  `;
}

function renderEdge(el: EdgeElement, colorId: string): string {
  const { path } = el;
  const style = window.getComputedStyle(path);
  const stroke = style.stroke || path.getAttribute('stroke') || resolveColor('var(--color-border-subtle)', '#94a3b8', undefined);
  const strokeWidth = style.strokeWidth || path.getAttribute('stroke-width') || '1.5';
  const fill = style.fill || path.getAttribute('fill') || 'none';
  const d = path.getAttribute('d') || '';
  const markerEnd = sanitizeMarkerEnd(path.getAttribute('marker-end') || '', colorId);
  const markerStart = sanitizeMarkerEnd(path.getAttribute('marker-start') || '', colorId);

  return `
    <g class="react-flow__edge">
      <path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${markerEnd ? ` marker-end="${markerEnd}"` : ''}${markerStart ? ` marker-start="${markerStart}"` : ''}/>
    </g>
  `;
}

function markerDefsForColors(colorIds: Map<string, string>): string {
  if (colorIds.size === 0) return '';
  const markers = Array.from(colorIds.entries())
    .map(([color, id]) =>
      `  <marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${escapeXmlAttribute(color)}"/></marker>`
    )
    .join('\n');
  return `<defs>\n${markers}\n</defs>`;
}

function sanitizeMarkerId(color: string): string {
  return 'arrow-' + color.replace(/[^a-zA-Z0-9]/g, '_');
}

function sanitizeMarkerEnd(value: string, colorId: string): string {
  if (!value) return '';
  return ` url(#${colorId})`;
}

function renderEdgeLabel({ label, labelTransform, labelBg }: EdgeElement): string {
  if (!label) return '';

  const text = label.textContent || '';
  const bbox = label.getBBox();
  const bgStyle = labelBg ? window.getComputedStyle(labelBg) : null;
  const pathStyle = window.getComputedStyle(label);
  const bg = bgStyle?.fill && !isTransparent(bgStyle.fill)
    ? bgStyle.fill
    : resolveColor('var(--surface-panel)', '#ffffff', undefined);
  const fg = pathStyle.color && !isTransparent(pathStyle.color)
    ? pathStyle.color
    : resolveColor('var(--foreground-subtle)', '#64748b', undefined);

  const fontFamily = safeFontFamily(FONT_FAMILY);
  const content = `
    <rect x="${bbox.x - 2}" y="${bbox.y - 2}" width="${bbox.width + 4}" height="${bbox.height + 4}" fill="${bg}" rx="2"/>
    <text x="${bbox.x + bbox.width / 2}" y="${bbox.y + bbox.height / 2 + 3}" text-anchor="middle" font-family="${fontFamily}" font-size="9" fill="${fg}">${escapeXml(text)}</text>
  `;

  return labelTransform
    ? `<g transform="${escapeXmlAttribute(labelTransform)}">${content}</g>`
    : content;
}

function renderNode(node: ViewNode, layout: NodeLayout | undefined): string {
  if (!layout) return '';
  switch (node.type) {
    case 'entity':
      return renderEntityNode(node, layout);
    case 'group':
      return renderGroupNode(node, layout);
    case 'note':
      return renderNoteNode(node, layout);
    case 'shape':
      return renderShapeNode(node, layout);
    default:
      return renderEntityNode(node, layout);
  }
}

function buildSvg(options: Required<Pick<ViewExportOptions, 'nodes' | 'edges' | 'container' | 'padding' | 'backgroundColor'>>): string {
  const viewport = options.container.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!viewport) {
    throw new Error('React Flow viewport not found');
  }

  const viewNodeMap = new Map(options.nodes.map((n) => [String(n.id), (n.data as { node?: ViewNode }).node]));

  const layouts = readNodeLayouts(options.container, options.nodes);
  if (layouts.length === 0) {
    throw new Error('Could not read any node layouts from the canvas');
  }

  const edgeElements = readEdgeElements(viewport);
  const layoutMap = new Map(layouts.map((l) => [l.id, l]));
  const bounds = computeBounds(layouts, options.padding);
  if (!bounds) {
    throw new Error('Could not compute graph bounds');
  }

  const { minX, minY, maxX, maxY } = bounds;
  const width = Math.ceil(maxX - minX);
  const height = Math.ceil(maxY - minY);

  // Read the React Flow container background so the export matches the canvas.
  const canvasBg = options.backgroundColor || findCanvasBackground(options.container);

  let background = '';
  if (canvasBg && !isTransparent(canvasBg)) {
    background = `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${escapeXml(canvasBg)}"/>`;
  }

  const colorIds = new Map<string, string>();
  const edgesSvg = edgeElements.map((el) => {
    const style = window.getComputedStyle(el.path);
    const stroke = style.stroke || el.path.getAttribute('stroke') || resolveColor('var(--color-border-subtle)', '#94a3b8', undefined);
    const color = isTransparent(stroke) ? resolveColor('var(--color-border-subtle)', '#94a3b8', undefined) : stroke;
    if (!colorIds.has(color)) {
      colorIds.set(color, sanitizeMarkerId(color));
    }
    const colorId = colorIds.get(color)!;
    const edge = renderEdge(el, colorId);
    const label = el.label && el.labelTransform ? renderEdgeLabel(el) : '';
    return { edge, label };
  });
  const nodesSvg = options.nodes.map((n) => renderNode(viewNodeMap.get(String(n.id)) || (n.data as { node: ViewNode }).node, layoutMap.get(String(n.id)))).join('');
  const defs = markerDefsForColors(colorIds);

  // Render edge paths first, then nodes, then edge labels on top so labels remain readable.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">
  ${defs}
  ${background}
  ${edgesSvg.map((e) => e.edge).join('')}
  ${nodesSvg}
  ${edgesSvg.map((e) => e.label).join('')}
</svg>`;
}

function svgToPngBlob(svg: string, pixelRatio: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const normalized = svg.includes('xmlns') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const vbMatch = normalized.match(/viewBox="([^"]+)"/);
    let svgWidth = 0;
    let svgHeight = 0;
    if (vbMatch) {
      const parts = vbMatch[1].split(/\s+/);
      if (parts.length === 4) {
        svgWidth = parseFloat(parts[2]);
        svgHeight = parseFloat(parts[3]);
      }
    }
    svgWidth = Math.max(1, svgWidth);
    svgHeight = Math.max(1, svgHeight);

    const targetMinWidth = 3200;
    const scale = Math.max(pixelRatio, targetMinWidth / svgWidth);
    const newWidth = Math.floor(svgWidth * scale);
    const newHeight = Math.floor(svgHeight * scale);

    const sizedSvg = normalized
      .replace(/width="[^"]+"/, `width="${newWidth}px"`)
      .replace(/height="[^"]+"/, `height="${newHeight}px"`);

    const encoded = typeof window !== 'undefined' ? window.btoa(unescape(encodeURIComponent(sizedSvg))) : '';
    const url = `data:image/svg+xml;base64,${encoded}`;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG export failed'));
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Failed to load SVG for PNG export'));
    img.src = url;
  });
}

export async function copyReactFlowSvg(options: ViewExportOptions): Promise<void> {
  const svg = buildSvg({
    ...options,
    padding: options.padding ?? 16,
    backgroundColor: options.backgroundColor ?? '',
  });
  await navigator.clipboard.writeText(svg);
  toast.success('SVG copied to clipboard');
}

export async function copyReactFlowPng(options: ViewExportOptions): Promise<void> {
  const svg = buildSvg({
    ...options,
    padding: options.padding ?? 16,
    backgroundColor: options.backgroundColor ?? '',
  });
  const blob = await svgToPngBlob(svg, options.pixelRatio ?? 2);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  toast.success('PNG copied to clipboard');
}

export async function downloadReactFlowSvg(options: ViewExportOptions): Promise<void> {
  const svg = buildSvg({
    ...options,
    padding: options.padding ?? 16,
    backgroundColor: options.backgroundColor ?? '',
  });
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const date = new Date().toISOString().split('T')[0];
  downloadBlob(blob, `view-${date}.svg`);
}

export async function downloadReactFlowPng(options: ViewExportOptions): Promise<void> {
  const svg = buildSvg({
    ...options,
    padding: options.padding ?? 16,
    backgroundColor: options.backgroundColor ?? '',
  });
  const blob = await svgToPngBlob(svg, options.pixelRatio ?? 2);
  const date = new Date().toISOString().split('T')[0];
  downloadBlob(blob, `view-${date}.png`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Downloaded as ${filename}`);
}
