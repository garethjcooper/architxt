/**
 * Main Layout Shell with Collapsible Navigation
 * Following Hindsight patterns - icons-only collapsed, text+icon expanded
 * Edge-to-edge cyan separator
 */

'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArchitxtIcon } from '@/components/icons/architxt-icon';
import { usePathname } from 'next/navigation';
import {
  FileText,
  FolderOpen,
  Tags,
  Server,
  Settings,
  ChevronLeft,
  ChevronRight,
  Users,
  Layers,
  Microscope,
} from "lucide-react";
import { HindsightIcon } from '@/components/icons/hindsight-icon';
import { MetadataIcon } from '@/components/icons/metadata-icon';
import { DirectiveIcon } from '@/components/icons/directive-icon';
import { DaemonStatus } from '@/components/daemon-status';
import { HindsightStatus } from '@/components/hindsight-status';
import { useVersion } from '@/lib/use-version';
import { useServerEnv } from '@/lib/use-server-env';

const navItems = [
  { href: '/research', label: 'Research', icon: Microscope },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/contexts', label: 'Contexts', icon: FolderOpen },
  { href: '/tags', label: 'Tags', icon: Tags },
  { href: '/entities', label: 'Entities', icon: Users },
  { href: '/metadata', label: 'Metadata', icon: MetadataIcon },
  { href: '/hindsight', label: 'Hindsight', icon: HindsightIcon },
  { href: '/models', label: 'Models', icon: Layers },
  { href: '/directives', label: 'Directives', icon: DirectiveIcon },
  { href: '/servers', label: 'Servers', icon: Server },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const version = useVersion();
  const serverEnv = useServerEnv();

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top Row - Header + Top Bar */}
      <div className="flex">
        {/* Sidebar Header - aligned with top bar */}
        <aside className={`bg-[oklch(0.22_0_0)] flex flex-col transition-all duration-200 ${collapsed ? 'w-16' : 'w-64'}`}>
          <div className="h-[56px] flex items-center px-4 py-4">
            <div className={`flex items-center gap-2 ${collapsed ? 'justify-center' : ''}`}>
              <ArchitxtIcon className="h-8 w-8 text-[#BABABA] shrink-0" />
              {!collapsed && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xl tracking-tight leading-none">architxt</span>
                  {version ? (
                    <span className="text-[10px] text-white/40 font-mono tabular-nums leading-tight whitespace-nowrap" title={`commit ${version.commit}`}>
                      v{version.version} · {version.commit}
                    </span>
                  ) : (
                    <span className="text-[10px] text-white/20 font-mono tabular-nums leading-tight whitespace-nowrap">
                      v… · …
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Main Top Bar */}
        <header className="flex-1 h-[56px] bg-[oklch(0.22_0_0)] px-6 flex items-center justify-end">
          <div className="flex items-center gap-4">
            <DaemonStatus />
            <HindsightStatus />

            <a
              href="https://github.com/garethjcooper/architxt"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              <span>GitHub</span>
            </a>
            <span
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border bg-green-800/15 text-green-400 border-green-700/20"
              title="Server environment"
            >
              {serverEnv}
            </span>
          </div>
        </header>
      </div>

      {/* Edge-to-edge green gradient separator */}
      <div className="h-[3px] w-full bg-gradient-to-r from-emerald-700 via-green-500 to-green-400"></div>

      <div className="flex flex-1 min-h-0">
        {/* Bottom Row - Navigation + Content */}
        {/* Sidebar Navigation */}
        <aside className={`border-r border-white/10 bg-[oklch(0.22_0_0)] flex flex-col transition-all duration-200 ${collapsed ? 'w-16' : 'w-64'}`}>
          <div className="h-px bg-white/10" />
          
          <nav className="p-2 space-y-1 flex-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors mx-1 ${
                    isActive 
                      ? 'bg-gradient-to-r from-emerald-700 to-green-400 text-white' 
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  } ${collapsed ? 'justify-center px-2' : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </nav>
          
          <div className="border-t border-white/10 p-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors w-full mx-1 ${collapsed ? 'justify-center px-2' : ''}`}
            >
              {collapsed ? (
                <ChevronRight className="h-5 w-5" />
              ) : (
                <>
                  <ChevronLeft className="h-5 w-5" />
                  <span>Collapse</span>
                </>
              )}
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 px-6 py-2.5 bg-[oklch(0.17_0_0)] min-w-0 flex flex-col min-h-0 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
