import type {
  FilterConditionBranch,
  FilterConditionConnective,
  FilterConditionLeaf,
  FilterConditionNode,
  FilterConditionRow,
} from './model';
import { isLeaf } from './model';
import { formatFilterConditionValue, splitInValues } from './values';

export function buildFilterCondition(
  rows: FilterConditionRow[],
  columnTypes: Record<string, string> = {}
): string | undefined {
  const parts: { expr: string; connective: FilterConditionConnective }[] = [];

  for (const row of rows) {
    const field = row.field.trim();
    const op = row.op;
    const firstRawValue = row.val1.trim();
    const secondRawValue = row.val2.trim();
    if (!field || !op || !firstRawValue) continue;
    if (op === 'between' && !secondRawValue) continue;

    const colType = columnTypes[field];
    const firstValue = formatFilterConditionValue(row.val1, colType);
    const secondValue = formatFilterConditionValue(row.val2, colType);
    const expr =
      op === 'between'
        ? `[${field}] between ${firstValue} and ${secondValue}`
        : `[${field}] ${op} ${firstValue}`;
    parts.push({ expr, connective: row.connective });
  }

  if (parts.length === 0) return undefined;

  let out = parts[0].expr;
  for (let i = 1; i < parts.length; i++) {
    out += ` ${parts[i].connective} ${parts[i].expr}`;
  }
  return out;
}

export function buildFilterConditionTree(
  root: FilterConditionBranch,
  columnTypes: Record<string, string> = {}
): string | undefined {
  const dsl = buildBranchDsl(root, columnTypes);
  return dsl || undefined;
}

function buildBranchDsl(
  branch: FilterConditionBranch,
  columnTypes: Record<string, string>,
  depth: number = 0
): string {
  const parts: string[] = [];
  for (const item of branch.items) {
    const expr = buildNodeDsl(item, columnTypes, depth + 1);
    if (expr) parts.push(expr);
  }
  if (parts.length === 0) return '';
  const joined = parts.join(` ${branch.connective} `);
  // The root level does not need wrapping parentheses.
  if (depth === 0) return joined;
  // Nested branches must be wrapped in parentheses.
  return `(${joined})`;
}

function buildNodeDsl(
  node: FilterConditionNode,
  columnTypes: Record<string, string>,
  depth: number
): string {
  if (isLeaf(node)) {
    return buildLeafDsl(node, columnTypes);
  }
  return buildBranchDsl(node, columnTypes, depth);
}

function buildLeafDsl(leaf: FilterConditionLeaf, columnTypes: Record<string, string>): string {
  const field = leaf.field.trim();
  const op = leaf.op;
  const val1 = leaf.val1.trim();
  const val2 = leaf.val2.trim();
  if (!field || !op) return '';

  const colType = columnTypes[field];

  if (op === 'between') {
    if (!val1 || !val2) return '';
    const v1 = formatFilterConditionValue(leaf.val1, colType);
    const v2 = formatFilterConditionValue(leaf.val2, colType);
    return `[${field}] between ${v1} and ${v2}`;
  }

  if (op === 'in' || op === 'not in') {
    const values = leaf.values ?? (val1 !== '' ? splitInValues(val1) : []);
    if (values.length === 0) return '';
    const formatted = values.map((v) => formatFilterConditionValue(v, colType)).join(', ');
    return `[${field}] ${op} (${formatted})`;
  }

  if (op === 'is null') return `[${field}] is null`;
  if (op === 'is not null') return `[${field}] is not null`;

  if (!val1) return '';
  const v1 = formatFilterConditionValue(leaf.val1, colType);
  return `[${field}] ${op} ${v1}`;
}
