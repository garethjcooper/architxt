import type { Entity, EntityType } from './types';

export interface ConformityResult {
  conforms: boolean;
  message?: string;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the expected pattern for an entity id based on the entity type settings.
 * Returns null if the type does not require a pattern.
 */
export function buildEntityIdPattern(type: EntityType): RegExp | null {
  if (!type.uses_entity_id_pattern) return null;

  const prefix = (type.id_format_prefix || '').trim();
  const separator = type.id_separator === '-' ? '-' : '';
  const digits = Math.max(1, Math.min(10, type.min_id_digits ?? 3));

  const prefixPart = prefix ? escapeRegex(prefix) : '';
  const sepPart = separator ? escapeRegex(separator) : '';
  return new RegExp(`^${prefixPart}${sepPart}\\d{${digits},}$`);
}

/**
 * Render a human-readable preview of the entity id pattern for a type.
 * e.g. { prefix: 'COM', separator: '-', digits: 3 } → 'COM-000'
 */
export function formatEntityIdPattern(type: EntityType): string {
  if (!type.uses_entity_id_pattern) return '';
  const prefix = (type.id_format_prefix || '').trim();
  const separator = type.id_separator === '-' ? '-' : '';
  const digits = Math.max(1, Math.min(10, type.min_id_digits ?? 3));
  return `${prefix}${separator}${'0'.repeat(digits)}`;
}

/**
 * Check whether an entity id conforms to its type's formatted id pattern.
 */
export function checkEntityIdConformity(entityId: string, type: EntityType): ConformityResult {
  if (!type.uses_entity_id_pattern) {
    return { conforms: true };
  }

  const id = entityId?.trim() ?? '';
  if (!id) {
    return { conforms: false, message: 'Entity ID is required' };
  }

  const pattern = buildEntityIdPattern(type);
  if (!pattern) {
    return { conforms: false, message: 'Pattern is not configured' };
  }

  if (pattern.test(id)) {
    return { conforms: true };
  }

  const example = formatEntityIdPattern(type);
  const digits = Math.max(1, Math.min(10, type.min_id_digits ?? 3));
  return {
    conforms: false,
    message: `Expected format: ${example} (prefix + ${digits}+ digit numeric suffix)`,
  };
}

/**
 * Extract the numeric suffix from an entity id, if it matches the type pattern.
 */
function extractNumericSuffix(entityId: string, type: EntityType): number | null {
  const pattern = buildEntityIdPattern(type);
  if (!pattern || !pattern.test(entityId)) return null;
  const match = entityId.match(/(\d+)$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Return the next entity id for a type based on the maximum existing numeric suffix.
 * Skips ids that already exist (including non-conforming ids).
 */
export function getNextEntityId(type: EntityType, existingEntities: Entity[]): string | null {
  if (!type.uses_entity_id_pattern) return null;

  const prefix = (type.id_format_prefix || '').trim();
  const separator = type.id_separator === '-' ? '-' : '';
  const digits = Math.max(1, Math.min(10, type.min_id_digits ?? 3));
  const typeId = type.id;

  const sameType = existingEntities.filter((e) => e.type_id === typeId);
  const existingIds = new Set(sameType.map((e) => e.entity_id));

  let max = 0;
  for (const ent of sameType) {
    const suffix = extractNumericSuffix(ent.entity_id, type);
    if (suffix !== null && suffix > max) {
      max = suffix;
    }
  }

  let next = max + 1;
  let candidate = `${prefix}${separator}${String(next).padStart(digits, '0')}`;
  // Defensive: skip collisions even with non-conforming ids
  while (existingIds.has(candidate) && next < Number.MAX_SAFE_INTEGER) {
    next += 1;
    candidate = `${prefix}${separator}${String(next).padStart(digits, '0')}`;
  }

  return candidate;
}
