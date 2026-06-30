export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Build a scoped query by appending selected entity labels to the user's
 * intent. Hindsight only accepts a plain query string, so this is the minimal
 * way to carry entity focus into a recall call.
 */
export function buildScopedQuery(intentText, selections) {
  if (!selections || selections.length === 0) return intentText;

  const labels = selections
    .filter((s) => s && Array.isArray(s.ids) && s.ids.length > 0)
    .map((s) => s.context || s.ids.join(', '))
    .filter(Boolean);

  if (labels.length === 0) return intentText;

  return `${intentText}\n\nRelevant entities: ${labels.join(', ')}`;
}
