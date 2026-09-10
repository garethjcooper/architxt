'use client';

import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';

const themes = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  return (
    <div className="flex items-center rounded-md border border-border-default overflow-hidden">
      {themes.map(({ value, icon: Icon, label }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            title={label}
            className={`flex items-center justify-center h-7 w-7 transition-colors ${
              active
                ? 'bg-surface-inset text-foreground-default'
                : 'text-foreground-faint hover:text-foreground-default hover:bg-surface-hover'
            }`}
            aria-pressed={active}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
