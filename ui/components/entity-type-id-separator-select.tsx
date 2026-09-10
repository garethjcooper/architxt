'use client';

export const ID_SEPARATOR_OPTIONS: { value: 'none' | '-'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: '-', label: '-' },
];

interface Props {
  id?: string;
  value: 'none' | '-';
  onChange: (value: 'none' | '-') => void;
  disabled?: boolean;
  compact?: boolean;
}

export function EntityTypeIdSeparatorSelect({ id, value, onChange, disabled, compact }: Props) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as 'none' | '-')}
      disabled={disabled}
      className={`w-full rounded-md border border-border-default bg-surface-card text-foreground-muted focus:border-accent-primary-bd focus:ring-2 focus:ring-focus-ring-subtle outline-none ${
        compact ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm'
      } disabled:opacity-50`}
    >
      {ID_SEPARATOR_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}
