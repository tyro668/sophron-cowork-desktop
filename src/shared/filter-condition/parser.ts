import { tokenizeExpression, type ExprToken } from '../expression-tokenizer';
import {
  nextNodeId,
  resetNodeIdCounter,
  type FilterConditionBranch,
  type FilterConditionConnective,
  type FilterConditionLeaf,
} from './model';
import { createEmptyLeaf } from './tree';
import { isFilterExpressionValue, unwrapQuotedValue } from './values';

export interface EditableFilterCondition {
  tree: FilterConditionBranch;
  error: string | null;
}

export function parseEditableFilterCondition(
  condition: string | undefined
): EditableFilterCondition {
  resetNodeIdCounter();
  try {
    const tree = parseConditionTree(condition);
    if (tree.items.length === 0) tree.items.push(createEmptyLeaf());
    return { tree, error: null };
  } catch (error) {
    const tree = parseConditionTree(undefined);
    tree.items.push(createEmptyLeaf());
    return {
      tree,
      error: error instanceof Error ? error.message : 'Invalid filter condition',
    };
  }
}

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
          // Validate the trailing word boundary. The delimiter starts with a space,
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
    // `[销售额] > avg([销售额]) over (by: [区域])` — the right side is an expression.
    const rest = valueToken ? trimmed.slice(valueToken.start) : '';
    if (isFilterExpressionValue(rest)) return leaf(field, op, rest.trim());
    const value = parseSignedValue(cursor);
    if (value === undefined || !cursor.eof) return null;
    // Normalize `= null` / `!= null` to the unary `is null` / `is not null`
    // operators so the graphical UI shows the dedicated null filter. Only
    // bare (unquoted) `null` is treated as SQL NULL; a quoted string
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
