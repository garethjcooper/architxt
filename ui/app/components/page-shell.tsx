/**
 * PageShell - Consistent page layout following Hindsight patterns
 * 
 * Usage:
 * <PageShell
 *   title="Documents"
 *   subtitle="Manage documents and retain new memories."
 *   count={documents.length}
 *   countLabel="document"
 *   tabs={[
 *     { value: 'all', label: 'All' },
 *     { value: 'active', label: 'Active' },
 *   ]}
 *   activeTab={statusFilter}
 *   onTabChange={setStatusFilter}
 *   loading={loading}
 * >
 *   {tableContent}
 * </PageShell>
 */

import { ReactNode } from 'react';

interface Tab {
  value: string;
  label: string;
}

interface PageShellProps {
  title: string;
  subtitle?: string;
  count?: number;
  countLabel?: string;
  tabs?: Tab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  loading?: boolean;
  children: ReactNode;
}

export function PageShell({
  title,
  subtitle,
  count,
  countLabel = 'item',
  tabs,
  activeTab,
  onTabChange,
  loading = false,
  children,
}: PageShellProps) {
  const countText = loading
    ? 'Loading...'
    : `${count ?? 0} ${countLabel}${(count ?? 0) !== 1 ? 's' : ''}`;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Page Header */}
      <div className="pt-1 pb-1">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="text-white/70 mt-2">{subtitle}</p>}
      </div>

      <div className="mt-4 flex flex-col flex-1 min-h-0">
        {/* Tabs */}
        {tabs && tabs.length > 0 && activeTab && onTabChange && (
          <div className="border-b border-white/15">
            <div className="flex">
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => onTabChange(tab.value)}
                  className={`py-3 w-[120px] text-sm transition-colors text-center border-b-2 ${
                    activeTab === tab.value
                      ? 'text-emerald-500 border-emerald-500 font-bold'
                      : 'text-white/70 hover:text-white border-transparent font-medium'
                  }`}
                >
                  <span className="inline-block">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Row count */}
        {(count !== undefined || loading) && (
          <p className="text-sm text-white/70 mt-2">{countText}</p>
        )}

        {/* Content */}
        <div className="mt-2 flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
