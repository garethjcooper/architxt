/**
 * Centralised semantic status-badge styles.
 *
 * Maps operational statuses to the five semantic badge families defined in
 * globals.css. Prefer adding a new status here over inventing another
 * hard-coded colour map in a page.
 */

export type SemanticBadgeFamily = 'neutral' | 'success' | 'danger' | 'caution' | 'info';

export const statusBadgeClass: Record<string, SemanticBadgeFamily> = {
  // Document pipeline
  uploaded: 'info',
  ready_to_extract: 'info',
  processing_extract: 'caution',
  request_release: 'caution',
  processed_extract_success: 'success',
  processed_extract_failed: 'danger',

  // Hindsight publishing pipeline
  publishing: 'caution',
  published: 'success',

  // Sync jobs
  pending: 'caution',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export const statusLabel: Record<string, string> = {
  uploaded: 'uploaded',
  ready_to_extract: 'ready to extract',
  processing_extract: 'extracting',
  request_release: 'releasing',
  processed_extract_success: 'extracted',
  processed_extract_failed: 'extracted - failed',
  publishing: 'publishing',
  published: 'published',
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export const familyClass: Record<SemanticBadgeFamily, string> = {
  neutral:
    'inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd border',
  success:
    'inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-badge-success-bg text-badge-success-fg border-badge-success-bd border',
  danger:
    'inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-badge-danger-bg text-badge-danger-fg border-badge-danger-bd border',
  caution:
    'inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-badge-caution-bg text-badge-caution-fg border-badge-caution-bd border',
  info:
    'inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-badge-info-bg text-badge-info-fg border-badge-info-bd border',
};

export function getStatusBadge(status?: string | null): {
  family: SemanticBadgeFamily;
  className: string;
  label: string;
} {
  const family = status && statusBadgeClass[status] ? statusBadgeClass[status] : 'neutral';
  return {
    family,
    className: familyClass[family],
    label: (status && statusLabel[status]) || status || 'unknown',
  };
}
