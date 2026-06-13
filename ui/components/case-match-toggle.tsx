'use client';

import { cn } from "@/lib/utils";

interface CaseMatchToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

/**
 * Emerald-styled toggle switch for case_match setting.
 * OFF = insensitive (dim track, dark knob)
 * ON  = sensitive (emerald track, dark knob on right)
 */
export function CaseMatchToggle({ checked, onChange, className }: CaseMatchToggleProps) {
  return (
    <label
      className={cn(
        "relative inline-flex items-center cursor-pointer select-none",
        className
      )}
    >
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div
        className={cn(
          "relative w-10 h-5 rounded-full transition-colors duration-200",
          "bg-white/10 peer-checked:bg-emerald-500"
        )}
      >
        <div
          className={cn(
            "absolute top-[2px] left-[2px] w-4 h-4 rounded-full",
            "bg-zinc-800 transition-all duration-200",
            checked && "translate-x-5 bg-zinc-900"
          )}
        />
      </div>
    </label>
  );
}
