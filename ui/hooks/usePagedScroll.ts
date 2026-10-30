'use client';

import { useRef, useEffect, useCallback, type RefObject } from 'react';

export interface UsePagedScrollReturn {
  ref: RefObject<HTMLDivElement | null>;
  tabIndex: number;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Hook that enables PageUp/PageDown keyboard scrolling on a scrollable container.
 *
 * Attach the returned props to the scrollable element. When the element is focused,
 * PageUp/PageDown scroll by roughly one viewport minus a small overlap, matching
 * standard document reader behaviour.
 *
 * The element is given tabIndex={0}. When dependencies change (e.g. the active tab
 * switches to this pane) the hook auto-focuses the container so keyboard scrolling
 * works immediately without an extra mouse click, unless focus is already inside a
 * focusable control within the dialog.
 */
export function usePagedScroll(deps: React.DependencyList = []): UsePagedScrollReturn {
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
    e.preventDefault();

    const el = ref.current;
    if (!el) return;

    const viewport = el.clientHeight;
    const overlap = 40;
    const delta = viewport - overlap;
    const direction = e.key === 'PageUp' ? -1 : 1;

    el.scrollBy({ top: direction * delta, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Don't steal focus from an active input/textarea/button inside the dialog.
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      const tag = active.tagName.toLowerCase();
      const isFocusableControl =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        tag === 'button' ||
        active.isContentEditable ||
        active.getAttribute('role') === 'textbox';
      if (isFocusableControl) return;
    }

    el.focus({ preventScroll: true });
  }, deps);

  return { ref, tabIndex: 0, onKeyDown };
}
