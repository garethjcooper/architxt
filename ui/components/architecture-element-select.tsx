'use client';

import { C4_ELEMENTS, ARCHIMATE_ELEMENTS } from '@/lib/types';
import type { C4Element, ArchiMateElement } from '@/lib/types';

interface C4ElementSelectProps {
  value: C4Element | null;
  onChange: (value: C4Element | null) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}

export function C4ElementSelect({
  value,
  onChange,
  placeholder = 'None',
  disabled,
  compact,
}: C4ElementSelectProps) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value as C4Element) || null)}
      disabled={disabled}
      className={`
        w-full rounded-lg border border-border-strong bg-surface-card text-foreground-default
        focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle
        disabled:opacity-50 disabled:pointer-events-none
        ${compact ? 'h-6 text-xs px-1.5 py-0' : 'h-8 text-sm px-2.5 py-1'}
      `}
    >
      <option value="">{placeholder}</option>
      {C4_ELEMENTS.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

interface ArchiMateElementSelectProps {
  value: ArchiMateElement | null;
  onChange: (value: ArchiMateElement | null) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}

export function ArchiMateElementSelect({
  value,
  onChange,
  placeholder = 'None',
  disabled,
  compact,
}: ArchiMateElementSelectProps) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value as ArchiMateElement) || null)}
      disabled={disabled}
      className={`
        w-full rounded-lg border border-border-strong bg-surface-card text-foreground-default
        focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle
        disabled:opacity-50 disabled:pointer-events-none
        ${compact ? 'h-6 text-xs px-1.5 py-0' : 'h-8 text-sm px-2.5 py-1'}
      `}
    >
      <option value="">{placeholder}</option>
      {ARCHIMATE_ELEMENTS.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

/** Convenience prop-driven wrapper used where the caller doesn't need strict kinds. */
interface ArchitectureElementSelectProps {
  kind: 'c4' | 'archimate';
  value: C4Element | ArchiMateElement | null;
  onChange: (value: C4Element | ArchiMateElement | null) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}

export function ArchitectureElementSelect(props: ArchitectureElementSelectProps) {
  if (props.kind === 'c4') {
    return (
      <C4ElementSelect
        value={props.value as C4Element | null}
        onChange={props.onChange as (v: C4Element | null) => void}
        placeholder={props.placeholder}
        disabled={props.disabled}
        compact={props.compact}
      />
    );
  }
  return (
    <ArchiMateElementSelect
      value={props.value as ArchiMateElement | null}
      onChange={props.onChange as (v: ArchiMateElement | null) => void}
      placeholder={props.placeholder}
      disabled={props.disabled}
      compact={props.compact}
    />
  );
}
