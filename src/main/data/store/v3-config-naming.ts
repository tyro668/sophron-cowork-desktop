/**
 * One-time prep-dsl/v3 naming migration for saved node configs.
 *
 * v3 conventions:
 * - ordering lists are always `orderBy` (sort.keys → orderBy);
 * - multi-field lists are `fields`, single field refs are `field`
 *   (columns/column → fields/field);
 * - no bare `mode` except output's write mode: select/unpivot `selection`,
 *   limit `sampling`, set_op `quantifier`.
 *
 * Only used by metadata migration v16; runtime code reads v3 names only.
 */
type Config = Record<string, unknown>;

function rename(config: Config, from: string, to: string): boolean {
  if (!(from in config)) return false;
  if (!(to in config)) config[to] = config[from];
  delete config[from];
  return true;
}

function renameInRows(config: Config, listKey: string, from: string, to: string): boolean {
  const rows = config[listKey];
  if (!Array.isArray(rows)) return false;
  let changed = false;
  for (const row of rows) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      changed = rename(row as Config, from, to) || changed;
    }
  }
  return changed;
}

/** Returns the migrated config, or null when nothing changed. */
export function migrateConfigToV3Naming(type: string, input: Config): Config | null {
  const config: Config = structuredClone(input);
  let changed = false;
  switch (type) {
    case 'sort':
      changed = rename(config, 'keys', 'orderBy');
      break;
    case 'select':
    case 'unpivot':
      changed = rename(config, 'columns', 'fields');
      changed = rename(config, 'mode', 'selection') || changed;
      break;
    case 'deduplicate':
    case 'expect':
      changed = rename(config, 'columns', 'fields');
      break;
    case 'missing_value':
      changed = rename(config, 'columns', 'fields');
      changed = renameInRows(config, 'rules', 'column', 'field') || changed;
      break;
    case 'unnest':
      changed = rename(config, 'column', 'field');
      break;
    case 'cast':
      changed = renameInRows(config, 'conversions', 'column', 'field');
      break;
    case 'limit':
      changed = rename(config, 'mode', 'sampling');
      break;
    case 'set_op':
      changed = rename(config, 'mode', 'quantifier');
      break;
    default:
      break;
  }
  return changed ? config : null;
}
