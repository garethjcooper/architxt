'use client';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface CaseMatchToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

/**
 * Toggle switch backed by the shared Switch primitive so entity-type
 * and entity forms render case/word toggles identically to other switches.
 */
export function CaseMatchToggle({ checked, onChange, className }: CaseMatchToggleProps) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      className={cn(className)}
    />
  );
}
