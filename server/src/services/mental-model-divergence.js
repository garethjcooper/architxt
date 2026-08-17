/**
 * Shared mental-model divergence detector.
 *
 * Compares a locally composed/architxt mental-model candidate against a fetched
 * Hindsight mental model and reports which fields differ. Used by the
 * /hindsight/diff route and by contextual-graph deployment to avoid re-pushing
 * unchanged system models.
 */

export function normalizeCsv(value) {
  if (value == null || value === '') return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

export function arraySetEqual(a, b) {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

/**
 * Compare an architxt mental-model candidate with a Hindsight mental model.
 *
 * @param {object} arch - Local candidate. Expected fields:
 *   name, composed_query, max_tokens, refresh_mode, refresh_after_consolidation,
 *   exclude_all_mental_models, exclude_mental_model_list, tags_match_mode, tags.
 * @param {object} hind - Hindsight model. Expected fields:
 *   name, source_query, max_tokens, refresh_mode, refresh_after_consolidation,
 *   exclude_all_mental_models, exclude_mental_model_ids, tags_match_mode, tags.
 * @returns {object} divergence flags.
 */
function canonicalJson(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function schemaDiffers(a, b) {
  return canonicalJson(a) !== canonicalJson(b);
}

export function buildMentalModelDivergence(arch, hind) {
  const nameDiffers = arch.name !== (hind.name ?? null);
  const sourceQueryDiffers = arch.composed_query !== (hind.source_query ?? null);
  const maxTokensDiffers = Number(arch.max_tokens) !== Number(hind.max_tokens);
  const refreshModeDiffers = arch.refresh_mode !== hind.refresh_mode;
  const refreshAfterConsolidationDiffers = !!arch.refresh_after_consolidation !== !!hind.refresh_after_consolidation;
  const excludeAllDiffers = !!arch.exclude_all_mental_models !== !!hind.exclude_all_mental_models;
  const excludeListDiffers = !arraySetEqual(
    normalizeCsv(arch.exclude_mental_model_list),
    hind.exclude_mental_model_ids || []
  );
  const tagsMatchModeDiffers = arch.tags_match_mode !== hind.tags_match_mode;
  const tagsDiffers = !arraySetEqual(
    (arch.tags || []).slice().sort(),
    (hind.tags || []).slice().sort()
  );
  const responseSchemaDiffers = schemaDiffers(arch.response_schema, hind.response_schema);

  return {
    name_differs: nameDiffers,
    source_query_differs: sourceQueryDiffers,
    tags_differs: tagsDiffers,
    max_tokens_differs: maxTokensDiffers,
    refresh_mode_differs: refreshModeDiffers,
    refresh_after_consolidation_differs: refreshAfterConsolidationDiffers,
    exclude_all_mental_models_differs: excludeAllDiffers,
    exclude_mental_model_list_differs: excludeListDiffers,
    tags_match_mode_differs: tagsMatchModeDiffers,
    response_schema_differs: responseSchemaDiffers,
  };
}

/**
 * True if any divergence flag is true.
 *
 * @param {object} divergence - result from buildMentalModelDivergence.
 * @returns {boolean}
 */
export function hasDivergence(divergence) {
  return Object.values(divergence).some(Boolean);
}
