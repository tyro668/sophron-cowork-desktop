import {
  isNumericDataFieldType,
  normalizeDataFieldType,
} from '../../../../shared/data-field-types';
import { tokenizeExpression, type ExprToken } from '../../../../shared/expression-tokenizer';

export type FilterConditionConnective = 'and' | 'or';

// ── Legacy flat types (backward compatible) ───────────────────────────

export interface FilterConditionRow {
  field: string;
  op: string;
  val1: string;
  val2: string;
  connective: FilterConditionConnective;
}

// ── Tree types for nested conditions ──────────────────────────────────

export interface FilterConditionLeaf {
  kind: 'leaf';
  id: string;
  field: string;
  op: string;
  val1: string;
  val2: string;
  /** Structured value list for `in` / `not in`. Authoritative source for
   *  building DSL and rendering the multi-value UI; falls back to
   *  `splitInValues(val1)` for pre-existing leaves. */
  values?: string[];
}

export interface FilterConditionBranch {
  kind: 'branch';
  id: string;
  connective: FilterConditionConnective;
  items: FilterConditionNode[];
}

export type FilterConditionNode = FilterConditionLeaf | FilterConditionBranch;

let _nodeIdCounter = 0;
export function resetNodeIdCounter(): void {
  _nodeIdCounter = 0;
}
export function nextNodeId(): string {
  return `fc_${++_nodeIdCounter}`;
}

export function isLeaf(node: FilterConditionNode): node is FilterConditionLeaf {
  return node.kind === 'leaf';
}

export function isBranch(node: FilterConditionNode): node is FilterConditionBranch {
  return node.kind === 'branch';
}

// ── Legacy flat builder (backward compatible) ─────────────────────────

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

// ── Tree builder ──────────────────────────────────────────────────────

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
  // Root level (depth 0) — no wrapping parentheses
  if (depth === 0) return joined;
  // Nested — wrap in parentheses
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

// ── Tree parser ───────────────────────────────────────────────────────

export function parseConditionTree(
  condition: string | undefined,
  depth: number = 0
): FilterConditionBranch {
  const root: FilterConditionBranch = {
    kind: 'branch',
    id: nextNodeId(),
    connective: 'and',
    items: [],
  };
  if (!condition || !condition.trim()) return root;
  if (condition.length > 16_384) {
    throw new Error('Filter condition exceeds 16384 characters');
  }
  return parseBranchFromDsl(condition.trim(), depth) ?? root;
}

/**
 * Parse a DSL string into a branch, detecting the dominant connective
 * and extracting nested parenthesized groups.
 */
function parseBranchFromDsl(dsl: string, depth: number): FilterConditionBranch | null {
  if (depth > 64) {
    throw new Error('Filter condition exceeds nesting depth 64');
  }
  // Protect between ... and ... patterns from connective splitting
  const betweenPlaceholders: string[] = [];
  const protectedDsl = dsl.replace(
    /\b(between\s+.+?\s+)and(\s+.+?)(?=\s*(?:$|\)|\band\b|\bor\b))/gi,
    (_m, prefix: string, suffix: string) => {
      const idx = betweenPlaceholders.length;
      betweenPlaceholders.push(` ${prefix}and${suffix}`);
      return ` __BTW_${idx}__`;
    }
  );

  // Split by top-level connectives that are OUTSIDE of parentheses
  // 'or' has lower precedence, so split by 'or' first
  const orSegments = splitByTopLevelConnective(protectedDsl, 'or');

  let connective: FilterConditionConnective;
  let segments: string[];

  if (orSegments.length > 1) {
    connective = 'or';
    segments = orSegments;
  } else {
    const andSegments = splitByTopLevelConnective(protectedDsl, 'and');
    connective = 'and';
    segments = andSegments;
  }

  const branch: FilterConditionBranch = {
    kind: 'branch',
    id: nextNodeId(),
    connective,
    items: [],
  };

  for (const seg of segments) {
    let trimmed = seg.trim();
    if (!trimmed) continue;

    // Restore between placeholders
    trimmed = trimmed.replace(/__BTW_(\d+)__/g, (_m, idx) => {
      return betweenPlaceholders[Number(idx)] ?? _m;
    });

    // Check if this segment is a parenthesized group
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) {
        throw new Error(`Invalid filter condition segment: ${trimmed}`);
      }
      const nested = parseBranchFromDsl(inner, depth + 1);
      if (!nested || nested.items.length === 0) {
        throw new Error(`Invalid filter condition segment: ${trimmed}`);
      }
      branch.items.push(nested);
      continue;
    }

    // If the segment still contains a connective not part of `between`,
    // recursively parse it as a sub-branch
    const withoutBetween = trimmed.replace(
      /\bbetween\s+.+?\s+and\s+.+?(?=\s*(?:$|\)|\band\b|\bor\b))/gi,
      '__BETWEEN__'
    );
    if (/\s+(?:and|or)\s+/i.test(withoutBetween)) {
      const nested = parseBranchFromDsl(trimmed, depth + 1);
      if (!nested || nested.items.length === 0) {
        throw new Error(`Invalid filter condition segment: ${trimmed}`);
      }
      branch.items.push(nested);
      continue;
    }

    // Parse as a leaf condition
    const leaf = parseLeafCondition(trimmed);
    if (leaf) {
      branch.items.push(leaf);
    } else {
      throw new Error(`Invalid filter condition segment: ${trimmed}`);
    }
  }

  return branch;
}

/**
 * Split a DSL string by a top-level connective (outside of parentheses and
 * quoted strings).
 */
function splitByTopLevelConnective(dsl: string, connective: 'and' | 'or'): string[] {
  const parts: string[] = [];
  let current = '';
  let parenDepth = 0;
  let inString = false;
  let stringChar = '';

  const delim = ` ${connective} `;
  const delimLower = delim.toLowerCase();

  let i = 0;
  while (i < dsl.length) {
    const ch = dsl[i];

    if (!inString) {
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        current += ch;
        i++;
        continue;
      }
      if (ch === '(') {
        parenDepth++;
        current += ch;
        i++;
        continue;
      }
      if (ch === ')') {
        parenDepth--;
        current += ch;
        i++;
        continue;
      }

      // Check for connective at top level (parenDepth === 0)
      if (parenDepth === 0) {
        const remaining = dsl.slice(i, i + delim.length);
        if (remaining.toLowerCase() === delimLower) {
          // Validate trailing word boundary — delimiter starts with space,
          // so only need to ensure "after" is word/non-word boundary
          const afterIdx = i + delim.length;
          const afterOk = afterIdx >= dsl.length || !/[a-zA-Z0-9_]/.test(dsl[afterIdx]);
          if (afterOk) {
            parts.push(current);
            current = '';
            i += delim.length;
            continue;
          }
        }
      }

      current += ch;
      i++;
    } else {
      current += ch;
      if (ch === stringChar && dsl[i - 1] !== '\\') {
        inString = false;
      }
      i++;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function leaf(
  field: string,
  op: string,
  val1: string,
  val2 = '',
  values?: string[]
): FilterConditionLeaf {
  return { kind: 'leaf', id: nextNodeId(), field, op, val1, val2, values };
}

function parseLeafCondition(expr: string): FilterConditionLeaf | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;

  let tokens: ExprToken[];
  try {
    tokens = tokenizeExpression(trimmed);
  } catch {
    return null;
  }
  // Drop the trailing EOF sentinel.
  if (tokens[tokens.length - 1]?.type === 'EOF') tokens = tokens.slice(0, -1);

  const cursor = new ExprCursor(tokens);

  const fieldToken = cursor.next();
  if (!fieldToken || fieldToken.type !== 'FieldRef') return null;
  const field = fieldToken.value.slice(1, -1);

  const opToken = cursor.next();
  if (!opToken) return null;

  // Compound operator: not like / not matches / not in.
  if (opToken.type === 'Ident' && opToken.value.toLowerCase() === 'not') {
    const kw = cursor.next();
    if (!kw || kw.type !== 'Ident') return null;
    const op = `not ${kw.value.toLowerCase()}`;
    if (op === 'not in') {
      const values = parseInTokens(cursor);
      if (!values) return null;
      return leaf(field, op, values.join(', '), '', values);
    }
    if (op === 'not like' || op === 'not matches') {
      const value = parseSignedValue(cursor);
      if (value === undefined || !cursor.eof) return null;
      return leaf(field, op, value);
    }
    return null;
  }

  if (opToken.type === 'Ident') {
    const op = opToken.value.toLowerCase();
    if (op === 'between') {
      const v1 = parseSignedValue(cursor);
      const andToken = cursor.next();
      if (
        v1 === undefined ||
        !andToken ||
        andToken.type !== 'Ident' ||
        andToken.value.toLowerCase() !== 'and'
      ) {
        return null;
      }
      const v2 = parseSignedValue(cursor);
      if (v2 === undefined || !cursor.eof) return null;
      return leaf(field, 'between', v1, v2);
    }
    if (op === 'in') {
      const values = parseInTokens(cursor);
      if (!values) return null;
      return leaf(field, 'in', values.join(', '), '', values);
    }
    if (op === 'like' || op === 'matches' || op === 'begin' || op === 'end') {
      const value = parseSignedValue(cursor);
      if (value === undefined || !cursor.eof) return null;
      return leaf(field, op, value);
    }
    if (op === 'is') {
      const next = cursor.next();
      if (!next) return null;
      if (next.type === 'Ident' && next.value.toLowerCase() === 'null' && cursor.eof) {
        return leaf(field, 'is null', '');
      }
      if (next.type === 'Ident' && next.value.toLowerCase() === 'not') {
        const after = cursor.next();
        if (after?.type === 'Ident' && after.value.toLowerCase() === 'null' && cursor.eof) {
          return leaf(field, 'is not null', '');
        }
      }
      return null;
    }
    return null;
  }

  if (opToken.type === 'Operator') {
    const op = opToken.value === '<>' ? '!=' : opToken.value;
    const valueToken = cursor.peek();
    const value = parseSignedValue(cursor);
    if (value === undefined || !cursor.eof) return null;
    // Normalize `= null` / `!= null` to the unary `is null` / `is not null`
    // operators so the graphical UI shows the dedicated null filter. Only
    // bare (unquoted) `null` is treated as SQL NULL — a quoted string
    // `"null"` stays a string value.
    if (!isQuotedToken(valueToken) && value.toLowerCase() === 'null') {
      if (op === '=') return leaf(field, 'is null', '');
      if (op === '!=' || op === '<>') return leaf(field, 'is not null', '');
    }
    return leaf(field, op, value);
  }

  return null;
}

class ExprCursor {
  private pos = 0;

  constructor(private readonly tokens: ExprToken[]) {}

  next(): ExprToken | undefined {
    const token = this.tokens[this.pos];
    if (token) this.pos += 1;
    return token;
  }

  peek(): ExprToken | undefined {
    return this.tokens[this.pos];
  }

  get eof(): boolean {
    return this.pos >= this.tokens.length;
  }
}

function parseValueToken(token: ExprToken | undefined): string | undefined {
  if (!token) return undefined;
  switch (token.type) {
    case 'StringLiteral':
      return unwrapQuotedValue(token.value);
    case 'Number':
      return token.value;
    case 'FieldRef':
      return token.value;
    case 'Ident': {
      const lower = token.value.toLowerCase();
      if (lower !== 'true' && lower !== 'false' && lower !== 'null') return undefined;
      return token.value;
    }
    default:
      return undefined;
  }
}

/** True when the token is a quoted string literal (not a bare keyword). */
function isQuotedToken(token: ExprToken | undefined): boolean {
  return token?.type === 'StringLiteral';
}

// Reads one value token, merging a leading +/- sign onto a following Number
// so that negative literals survive (the tokenizer emits -5 as
// Operator('-') + Number('5')).
function parseSignedValue(cursor: ExprCursor): string | undefined {
  const token = cursor.next();
  if (!token) return undefined;
  if (token.type === 'Operator' && (token.value === '-' || token.value === '+')) {
    const next = cursor.next();
    if (next?.type === 'Number') return token.value + next.value;
    return undefined;
  }
  if (token.type !== 'Number') return parseValueToken(token);
  // Accept date-like literals such as `2024-01-01` or `2024/01/01`,
  // which tokenize into Number {-,/} Number {-,/} Number.
  let raw = token.value;
  while (cursor.peek()?.type === 'Operator') {
    const op = cursor.peek()!;
    if (op.value !== '-' && op.value !== '/') break;
    cursor.next();
    const next = cursor.next();
    if (!next || next.type !== 'Number') return undefined;
    raw += op.value + next.value;
  }
  return raw;
}

function parseInTokens(cursor: ExprCursor): string[] | null {
  const open = cursor.next();
  if (!open || open.type !== 'ParenOpen') return null;
  if (cursor.peek()?.type === 'ParenClose') return null; // empty list
  const values: string[] = [];
  let expectValue = true;
  while (!cursor.eof) {
    const token = cursor.next();
    if (!token) return null;
    if (token.type === 'ParenClose') {
      if (expectValue) return null; // trailing comma before close
      if (!cursor.eof) return null; // trailing tokens after close
      return values;
    }
    if (token.type === 'Comma') {
      if (expectValue) return null; // leading or consecutive comma
      expectValue = true;
      continue;
    }
    if (!expectValue) {
      return null; // missing comma between values
    }
    if (token.type === 'Operator' && (token.value === '-' || token.value === '+')) {
      const next = cursor.next();
      if (next?.type === 'Number') {
        values.push(token.value + next.value);
        expectValue = false;
        continue;
      }
      return null;
    }
    const value = parseValueToken(token);
    if (value === undefined) return null;
    values.push(value);
    expectValue = false;
  }
  return null;
}

function unquoteValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (first !== last) return trimmed;
  if (first === '"' || first === "'") {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// ── Value splitting for in/not in ─────────────────────────────────────

// Splits a comma-separated value list, respecting quoted strings so that a
// comma inside "..." or '...' is preserved. Each element is unquoted;
// empty values (including a quoted "" ) are preserved.
export function splitInValues(val1: string): string[] {
  if (val1.trim() === '') return [];
  const values: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < val1.length; i++) {
    const ch = val1[i];
    if (inString) {
      current += ch;
      if (ch === stringChar && val1[i - 1] !== '\\') inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      values.push(unwrapQuotedValue(current.trim()));
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(unwrapQuotedValue(current.trim()));
  return values;
}

// Joins values into a comma-separated list, quoting any value that contains
// a comma, a quote, or is empty so that the result round-trips losslessly
// through splitInValues.
export function joinInValues(values: string[]): string {
  return values
    .map((v) => {
      const t = v.trim();
      if (t === '') return '""';
      if (/[,"']/.test(t)) return quoteDslString(unquoteValue(t));
      return t;
    })
    .join(', ');
}

// ── Value formatting ──────────────────────────────────────────────────

export function formatFilterConditionValue(value: string, colType: string | undefined): string {
  const trimmed = value.trim();
  if (!trimmed) return '""';
  if (isDslFieldReference(trimmed)) return trimmed;

  const unquoted = unwrapQuotedValue(trimmed);
  const normalizedType = colType ? normalizeDataFieldType(colType) : undefined;
  const lower = unquoted.toLowerCase();

  const isBoolLike = /^(true|false)$/i.test(unquoted);
  const isNumLike = isNumberLiteral(unquoted);

  if (normalizedType === 'boolean' && isBoolLike) return lower;
  if (isNumericDataFieldType(normalizedType) && isNumLike) return unquoted;
  if (!normalizedType && (isBoolLike || isNumLike)) return unquoted;

  return quoteDslString(unquoted);
}

function isDslFieldReference(value: string): boolean {
  try {
    const tokens = tokenizeExpression(value);
    const first = tokens[0];
    if (!first || first.type !== 'FieldRef') return false;
    // Simple: [field]
    if (tokens[1]?.type === 'EOF' || tokens[1]?.type === undefined) return true;
    // Qualified: [source].[field]
    if (tokens[1]?.type === 'Dot' && tokens[2]?.type === 'FieldRef') {
      return tokens[3]?.type === 'EOF' || tokens[3]?.type === undefined;
    }
    return false;
  } catch {
    return false;
  }
}

function unwrapQuotedValue(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (first !== last || (first !== '"' && first !== "'")) return value;
  if (first === '"') {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function isNumberLiteral(value: string): boolean {
  return /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value);
}

function quoteDslString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ── Tree helpers ──────────────────────────────────────────────────────

export function createEmptyLeaf(): FilterConditionLeaf {
  return {
    kind: 'leaf',
    id: nextNodeId(),
    field: '',
    op: '=',
    val1: '',
    val2: '',
  };
}

export function createEmptyBranch(
  connective: FilterConditionConnective = 'and'
): FilterConditionBranch {
  return {
    kind: 'branch',
    id: nextNodeId(),
    connective,
    items: [createEmptyLeaf()],
  };
}

/**
 * Walk a tree and compute the depth of each node.
 * Root branch has depth 0. Its direct children have depth 1, etc.
 */
export function getNodeDepth(node: FilterConditionNode, root: FilterConditionBranch): number {
  function findDepth(
    target: FilterConditionNode,
    branch: FilterConditionBranch,
    depth: number
  ): number {
    for (const item of branch.items) {
      if (item.id === target.id) return depth;
      if (isBranch(item)) {
        const found = findDepth(target, item, depth + 1);
        if (found >= 0) return found;
      }
    }
    return -1;
  }
  return findDepth(node, root, 0);
}

export function getBranchDepth(branch: FilterConditionBranch, root: FilterConditionBranch): number {
  return getNodeDepth(branch, root);
}

/** Maximum allowed nesting depth (3 levels of nesting + root = 4) */
export const MAX_NESTING_DEPTH = 3;

/**
 * Check if a branch can be nested further (i.e., create/wrap into a new
 * nested group at the given branch's level).
 */
export function canNestFurther(
  branch: FilterConditionBranch,
  root: FilterConditionBranch
): boolean {
  const depth = getBranchDepth(branch, root);
  return depth < MAX_NESTING_DEPTH;
}

// ── Tree mutation helpers ─────────────────────────────────────────────

export function addLeafToBranch(
  branch: FilterConditionBranch,
  afterIndex: number
): FilterConditionBranch {
  const items = [...branch.items];
  items.splice(afterIndex + 1, 0, createEmptyLeaf());
  return { ...branch, items };
}

export function removeNodeFromBranch(
  branch: FilterConditionBranch,
  nodeId: string
): FilterConditionBranch {
  const items = branch.items
    .filter((item) => item.id !== nodeId)
    .map((item) => {
      if (isBranch(item)) {
        const cleaned = removeNodeFromBranch(item, nodeId);
        return cleaned.items.length > 0 ? cleaned : null;
      }
      return item;
    })
    .filter((item): item is FilterConditionNode => item !== null);
  return { ...branch, items };
}

export function updateLeafInBranch(
  branch: FilterConditionBranch,
  leafId: string,
  patch: Partial<FilterConditionLeaf>
): FilterConditionBranch {
  const items = branch.items.map((item) => {
    if (isLeaf(item) && item.id === leafId) {
      return { ...item, ...patch };
    }
    if (isBranch(item)) {
      return updateLeafInBranch(item, leafId, patch);
    }
    return item;
  });
  return { ...branch, items };
}

export function updateBranchConnective(
  branch: FilterConditionBranch,
  branchId: string,
  connective: FilterConditionConnective
): FilterConditionBranch {
  if (branch.id === branchId) {
    return { ...branch, connective };
  }
  const items = branch.items.map((item) => {
    if (isBranch(item)) {
      return updateBranchConnective(item, branchId, connective);
    }
    return item;
  });
  return { ...branch, items };
}

/**
 * Wrap a subset of items in a branch into a new nested group.
 * Returns the updated branch with the wrapped items replaced by a new branch.
 */
export function wrapItemsInGroup(
  branch: FilterConditionBranch,
  itemIds: string[],
  groupConnective: FilterConditionConnective = 'and'
): FilterConditionBranch | null {
  if (itemIds.length < 2) return null;

  const wrappedItems: FilterConditionNode[] = [];
  const remainingItems: FilterConditionNode[] = [];
  let foundFirst = false;
  let collecting = false;

  for (const item of branch.items) {
    if (itemIds.includes(item.id)) {
      if (!foundFirst) {
        foundFirst = true;
        collecting = true;
      }
      if (collecting) {
        wrappedItems.push(item);
      } else {
        remainingItems.push(item);
      }
    } else {
      if (collecting) {
        collecting = false;
      }
      remainingItems.push(item);
    }
  }

  if (wrappedItems.length < 2) return null;

  const newGroup: FilterConditionBranch = {
    kind: 'branch',
    id: nextNodeId(),
    connective: groupConnective,
    items: wrappedItems,
  };

  // Insert the new group at the position of the first wrapped item
  const firstIdx = branch.items.findIndex((item) => item.id === itemIds[0]);
  const newItems = [...branch.items];
  newItems.splice(firstIdx, wrappedItems.length, newGroup);

  return { ...branch, items: newItems };
}

/**
 * Unwrap a nested group, moving its items to the parent branch.
 */
export function unwrapGroup(branch: FilterConditionBranch, groupId: string): FilterConditionBranch {
  const newItems: FilterConditionNode[] = [];
  for (const item of branch.items) {
    if (isBranch(item) && item.id === groupId) {
      newItems.push(...item.items);
    } else {
      newItems.push(item);
    }
  }
  return { ...branch, items: newItems };
}
