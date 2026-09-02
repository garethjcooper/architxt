'use client';

import { toast } from 'sonner';
import mermaid from 'mermaid';

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
    const { svg } = await mermaid.render(id, source.trim());
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
    const { svg } = await mermaid.render(id, source.trim());
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
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(img.naturalWidth));
      canvas.height = Math.max(1, Math.floor(img.naturalHeight));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Could not get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG export failed'));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG for PNG export'));
    };
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
