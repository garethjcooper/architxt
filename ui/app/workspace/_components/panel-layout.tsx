'use client';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function PanelHeader({ title, count, actions }: { title: string; count?: number; actions?: React.ReactNode }) {
  return (
    <div className="h-10 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0 overflow-hidden">
      <div className="text-xs font-medium truncate">{title}</div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {count !== undefined && (
          <span className="text-xs font-mono text-accent-primary-fg bg-surface-inset border border-accent-primary-bd px-2 py-0.5 rounded">
            {count}
          </span>
        )}
      </div>
    </div>
  );
}


function Panel({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Card
      className={cn(
        'min-h-0 border-border-default bg-surface-card flex flex-col overflow-hidden pt-0',
        className
      )}
      style={style}
    >
      {children}
    </Card>
  );
}


function PanelContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <CardContent className={cn('flex-1 min-h-0 p-0 relative', className)}>
      {children}
    </CardContent>
  );
}


function ResizeHandle({
  direction,
  onMouseDown,
  onDoubleClick,
  title,
}: {
  direction: 'vertical' | 'horizontal';
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  title?: string;
}) {
  const isHorizontal = direction === 'horizontal';
  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
      aria-label={title || `Resize ${direction} pane`}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        'shrink-0 flex items-center justify-center group',
        isHorizontal
          ? 'h-3 cursor-row-resize flex-row'
          : 'w-3 cursor-col-resize flex-col'
      )}
      title={title}
    >
      <div
        className={cn(
          'rounded-full bg-surface-strong group-hover:bg-accent-primary-bd-hover transition-colors',
          isHorizontal ? 'w-16 h-1' : 'w-1 h-16'
        )}
      />
    </div>
  );
}


export { PanelHeader, Panel, PanelContent, ResizeHandle };
