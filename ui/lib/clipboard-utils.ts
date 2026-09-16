'use client';

import { toast } from 'sonner';
import { renderMermaid } from '@/lib/mermaid-init';

export async function copyText(text: string, label = 'Text') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  } catch (err) {
    toast.error(`Failed to copy ${label.toLowerCase()}`);
    throw err;
  }
}

export async function copyMermaidSource(source: string) {
  return copyText(source, 'Mermaid source');
}

export async function copyMermaidSvg(source: string) {
  try {
    const id = `copy-svg-${Math.random().toString(36).slice(2, 11)}`;
    const { svg } = await renderMermaid(id, source);
    await navigator.clipboard.writeText(svg);
    toast.success('SVG copied to clipboard');
  } catch (err) {
    toast.error('Failed to copy SVG');
    throw err;
  }
}

export async function copyMermaidPng(source: string) {
  try {
    const id = `copy-png-${Math.random().toString(36).slice(2, 11)}`;
    const { svg } = await renderMermaid(id, source);
    const blob = await svgToPngBlob(svg);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast.success('PNG copied to clipboard');
  } catch (err) {
    toast.error('Failed to copy PNG');
    throw err;
  }
}

function svgToPngBlob(svg: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Normalize SVG so it can be drawn to a canvas without tainting.
    // Using a data URL and crossOrigin='anonymous' avoids blob-URL tainting issues.
    let normalized = svg.includes('xmlns') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    // Remove max-width constraints that could limit the intrinsic size.
    normalized = normalized.replace(/max-width:\s*[^;"]+;?/gi, '');

    // Extract current intrinsic size from viewBox as the source of truth,
    // falling back to width/height only if they are absolute px values.
    const targetMinWidth = 3200;
    const widthMatch = normalized.match(/width="([^"]+)"/);
    const heightMatch = normalized.match(/height="([^"]+)"/);
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
    if (!svgWidth || !svgHeight) {
      const w = widthMatch ? parseFloat(widthMatch[1]) : 0;
      const h = heightMatch ? parseFloat(heightMatch[1]) : 0;
      if (w > 0 && h > 0) {
        svgWidth = w;
        svgHeight = h;
      }
    }
    svgWidth = Math.max(1, svgWidth);
    svgHeight = Math.max(1, svgHeight);
    const scale = Math.max(1, targetMinWidth / svgWidth);
    const newWidth = Math.floor(svgWidth * scale);
    const newHeight = Math.floor(svgHeight * scale);

    // Update width/height attributes on the root SVG so the coordinate system scales up.
    normalized = normalized
      .replace(/width="[^"]+"/, `width="${newWidth}px"`)
      .replace(/height="[^"]+"/, `height="${newHeight}px"`);

    const encoded = typeof window !== 'undefined' ? window.btoa(unescape(encodeURIComponent(normalized))) : '';
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

export function tableToCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  return [columns.join(','), ...rows.map((row) => columns.map((c) => escape(row[c])).join(','))].join('\n');
}

export function tableToJson(table: { name: string; columns: string[]; rows: Record<string, unknown>[] }): string {
  return JSON.stringify(table, null, 2);
}
