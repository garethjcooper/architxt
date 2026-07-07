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
      className={`w-full rounded-md border border-white/10 bg-[oklch(0.23_0_0)] text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none ${
        compact ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm'
      } disabled:opacity-50`}
    >
      {ID_SEPARATOR_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}
