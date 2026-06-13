// Status mapping for Process tab filtering
export const PROCESS_STATUSES = [
  { value: 'uploaded', label: 'Uploaded', dbStatus: 'uploaded' },
  { value: 'processing', label: 'Processing', dbStatus: 'processing_extract' },
  { value: 'extracted_unpublished', label: 'Extracted - Unpublished', dbStatus: 'processed_extract_success' },
  { value: 'extracted_published', label: 'Extracted - Published', dbStatus: 'processed_extract_success' },
  { value: 'extracted_failed', label: 'Extracted - Failed', dbStatus: 'processed_extract_failed' },
];

export const getProcessStatusLabel = (status: string): string => {
  const mapping: Record<string, string> = {
    'uploaded': 'Uploaded',
    'processing_extract': 'Extracting',
    'processed_extract_success': 'Extracted',
    'processed_extract_failed': 'Extracted - Failed',
  };
  return mapping[status] || status;
};

export const getActionButtonLabel = (filterValue: string | null, selectedCount: number): string => {
  if (!filterValue) return 'Select Documents';

  const labels: Record<string, string> = {
    'uploaded': 'Process',
    'extracting': 'Cancel',
    'extracted_unpublished': 'Re-process',
    'extracted_published': 'Re-process',
    'extracted_failed': 'Retry',
  };

  return `${labels[filterValue] || 'Process'} (${selectedCount})`;
};

export const getDbStatusFromFilter = (filterValue: string | null): string | string[] | null => {
  if (!filterValue) return null;

  // Note: "Processing" maps to both ready_to_extract and processing_extract
  // The API will need to handle filtering by multiple statuses
  const mapping: Record<string, string | string[]> = {
    'uploaded': 'uploaded',
    'processing': ['ready_to_extract', 'processing_extract'],
    'extracted_unpublished': 'processed_extract_success',
    'extracted_published': 'processed_extract_success',
    'extracted_failed': 'processed_extract_failed',
  };

  return mapping[filterValue] || null;
};

/** Returns the set of published_status values to match for a given filter.
    Kept for backward compat - no actual filtering anymore since published_status removed. */
export const getPublishedStatusFilter = (filterValue: string | null): string[] | null => {
  return null;
};

export const getActionEndpoint = (filterValue: string | null, docId: number): string | null => {
  if (!filterValue) return null;

  const endpoints: Record<string, string> = {
    'uploaded': `/documents/${docId}/process`,
    'processing': `/documents/${docId}/cancel`,
    'extracted_unpublished': `/documents/${docId}/process`,
    'extracted_published': `/documents/${docId}/process`,
    'extracted_failed': `/documents/${docId}/process`,
  };

  return endpoints[filterValue] || null;
};
