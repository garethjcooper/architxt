export type DerivationScope = 'node' | 'edge' | 'seed' | 'graph';

interface ScopeRule {
  extIdTail: string;
  nameTail: string;
  extIdRegex: RegExp;
  nameRegex: RegExp;
  requiredQueryPlaceholders: string[];
}

const SCOPE_RULES: Record<string, ScopeRule> = {
  node: {
    extIdTail: '-{id}',
    nameTail: ' {entity-name}',
    extIdRegex: /^(.+)-\{id\}$/,
    nameRegex: /^(.+) \{entity-name\}$/,
    requiredQueryPlaceholders: ['{entity-name}', '{id}'],
  },
  edge: {
    extIdTail: '-{source-id}|{target-id}',
    nameTail: ' {source-name} <-> {target-name}',
    extIdRegex: /^(.+)-\{source-id\}\|\{target-id\}$/,
    nameRegex: /^(.+) \{source-name\} <-> \{target-name\}$/,
    requiredQueryPlaceholders: ['{source-name}', '{source-id}', '{target-name}', '{target-id}'],
  },
  seed: {
    extIdTail: '-{seed-id}',
    nameTail: ' {seed-name}',
    extIdRegex: /^(.+)-\{seed-id\}$/,
    nameRegex: /^(.+) \{seed-name\}$/,
    requiredQueryPlaceholders: ['{seed-id}', '{seed-name}'],
  },
};

export function getRoleTemplateRule(scope: string | undefined | null): ScopeRule | null {
  return scope ? SCOPE_RULES[scope] ?? null : null;
}

export function getRoleTemplateInstructions(scope: string | undefined | null): string | null {
  const rule = getRoleTemplateRule(scope);
  if (!rule) return null;
  return `External ID must be "<prefix>${rule.extIdTail}" and Name must be "<prefix>${rule.nameTail}". Source query must include: ${rule.requiredQueryPlaceholders.join(', ')}.`;
}

export function extractRoleTemplatePrefix(
  scope: string,
  field: 'extId' | 'name',
  value: string | undefined | null
): string | null {
  const rule = SCOPE_RULES[scope];
  if (!rule) return null;
  const regex = field === 'name' ? rule.nameRegex : rule.extIdRegex;
  const match = regex.exec(value ?? '');
  return match ? match[1] : null;
}

export function buildRoleTemplateValue(
  scope: string,
  field: 'extId' | 'name',
  prefix: string | undefined | null
): string | null {
  const rule = SCOPE_RULES[scope];
  if (!rule) return null;
  const tail = field === 'name' ? rule.nameTail : rule.extIdTail;
  if (!prefix) return tail;
  return `${prefix}${tail}`;
}

export function validateRoleBasedTemplate(
  scope: string | undefined | null,
  {
    extId,
    name,
    sourceQuery,
  }: {
    extId: string | undefined | null;
    name: string | undefined | null;
    sourceQuery: string | undefined | null;
  }
): { valid: boolean; errors: string[]; missingQueryPlaceholders: string[] } {
  const rule = getRoleTemplateRule(scope);
  if (!rule) {
    return { valid: scope === 'graph' || !scope, errors: [], missingQueryPlaceholders: [] };
  }

  const errors: string[] = [];

  if (!rule.extIdRegex.test(extId ?? '')) {
    errors.push(`External ID must end with "${rule.extIdTail}".`);
  }

  if (!rule.nameRegex.test(name ?? '')) {
    errors.push(`Name must end with "${rule.nameTail}".`);
  }

  const missingQueryPlaceholders: string[] = [];
  const query = sourceQuery ?? '';
  for (const placeholder of rule.requiredQueryPlaceholders) {
    if (!query.includes(placeholder)) {
      missingQueryPlaceholders.push(placeholder);
    }
  }

  if (missingQueryPlaceholders.length > 0) {
    errors.push(`Source query is missing: ${missingQueryPlaceholders.join(', ')}.`);
  }

  return { valid: errors.length === 0, errors, missingQueryPlaceholders };
}
