'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useVirtualizer, type VirtualizerOptions } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';

export interface VirtualListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateSize?: number;
  overscan?: number;
  className?: string;
  itemClassName?: string;
  scrollPaddingStart?: number;
  scrollPaddingEnd?: number;
  getItemKey?: (index: number, item: T) => string | number;
  empty?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

export function VirtualList<T>({
  items,
  renderItem,
  estimateSize = 48,
  overscan = 8,
  className,
  itemClassName,
  scrollPaddingStart,
  scrollPaddingEnd,
  getItemKey,
  empty,
  header,
  footer,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback(() => estimateSize, [estimateSize]),
    overscan,
    getItemKey: getItemKey
      ? (index: number) => getItemKey(index, items[index])
      : (index: number) => index,
    scrollPaddingStart,
    scrollPaddingEnd,
  });

  const vItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={containerRef}
      className={cn('h-full overflow-y-auto min-h-0', className)}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {header}
        {items.length === 0 ? (
          empty ?? null
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${vItems[0]?.start ?? 0}px)`,
            }}
          >
            {vItems.map((virtualItem) => (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className={itemClassName}
              >
                {renderItem(items[virtualItem.index], virtualItem.index)}
              </div>
            ))}
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}

export function useVirtualContainer<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  return { ref, height };
}
