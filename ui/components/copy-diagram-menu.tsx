'use client';

import { Copy } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { copyMermaidPng, copyMermaidSource, copyMermaidSvg } from '@/lib/clipboard-utils';

export interface CopyDiagramMenuProps {
  source: string;
}

export function CopyDiagramMenu({ source }: CopyDiagramMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <span
          role="button"
          className="p-1 rounded text-foreground-subtle hover:text-accent-primary-fg hover:bg-accent-secondary-bg/50 transition-colors"
          title="Copy diagram"
        >
          <Copy className="h-3.5 w-3.5" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => copyMermaidSource(source)}>Copy Mermaid</DropdownMenuItem>
        <DropdownMenuItem onClick={() => copyMermaidSvg(source)}>Copy as SVG</DropdownMenuItem>
        <DropdownMenuItem onClick={() => copyMermaidPng(source)}>Copy as PNG</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
