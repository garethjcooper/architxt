/**
 * Sort flat trace records according to a profile-configured order.
 *
 * Sorting is controlled by `standardLog.sortBy`. If the option is absent or
 * empty, records are left in source (row) order. Each entry is either a field
 * name string (default ascending) or an object `{ field, direction }` where
 * direction is 'asc' or 'desc'.
 *
 * The sort is stable: equal keys keep their original source order.
 *
 * @param {object[]} records
 * @param {Array<string|{field:string,direction?:'asc'|'desc'}>} [sortBy]
 * @returns {object[]}
 */
export function sortTraceRecords(records, sortBy) {
  if (!Array.isArray(records)) return [];
  if (!Array.isArray(sortBy) || sortBy.length === 0) {
    return records.slice();
  }

  const normalized = sortBy
    .filter((entry) => entry != null && entry !== '')
    .map((entry) => {
      if (typeof entry === 'string') {
        return { field: entry.trim(), direction: 'asc' };
      }
      if (typeof entry === 'object') {
        const field = String(entry.field || '').trim();
        const direction = String(entry.direction || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
        return { field, direction };
      }
      return null;
    })
    .filter((entry) => entry && entry.field);

  if (normalized.length === 0) {
    return records.slice();
  }

  return records.slice().map((record, index) => ({ record, index })).sort((a, b) => {
    for (const { field, direction } of normalized) {
      const aVal = String(a.record[field] ?? '');
      const bVal = String(b.record[field] ?? '');
      if (aVal === bVal) continue;
      const cmp = aVal.localeCompare(bVal);
      return direction === 'desc' ? -cmp : cmp;
    }
    return a.index - b.index;
  }).map(({ record }) => record);
}
