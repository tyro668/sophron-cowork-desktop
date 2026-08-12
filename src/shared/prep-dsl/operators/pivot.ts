import { createPrepDiagnostic } from '../diagnostics';
import type { PrepDiagnostic } from '../ast';
import {
  ExpressionTokenizeError,
  tokenizeExpression,
  type ExprToken,
} from '../../expression-tokenizer';
import { formatFieldRef } from '../syntax/fields';
import { isCompletePivotAxis, isCompletePivotMetric } from '../../operator-completeness';
import { formatLiteral } from '../syntax/literals';
import { createOperator, objectArray, type OperatorDslCodec } from './codec';
import { formatMetric, parseMetrics } from './metrics';

interface PivotAxisEntry {
  field: string;
  values: unknown[];
}

export const pivotCodec: OperatorDslCodec = {
  type: 'pivot',
  matches: (text) => text.startsWith('pivot '),
  parse: (command, diagnostics) => {
    const tokens = tokenizeWithDiagnostics(command, diagnostics);
    if (!tokens) return null;

    // Expect: pivot on <axes> using <metrics> [group by <fields>]
    const cursor = new PivotTokenCursor(tokens, command.text);
    if (!cursor.matchIdentifier('pivot')) {
      invalidPivot(command, diagnostics);
      return null;
    }
    if (!cursor.matchIdentifier('on')) {
      invalidPivot(command, diagnostics);
      return null;
    }

    const on = parsePivotAxes(cursor, command.line, diagnostics);
    if (on.length === 0) {
      invalidPivot(command, diagnostics);
      return null;
    }
    if (!cursor.matchIdentifier('using')) {
      invalidPivot(command, diagnostics);
      return null;
    }

    const { usingTokens, hasGroupBy } = cursor.readUsingBody();
    const usingText = sliceText(cursor.text, usingTokens);

    let groupBy: string[] = [];
    if (hasGroupBy) {
      cursor.matchIdentifier('group');
      cursor.matchIdentifier('by');
      const groupTokens = cursor.readUntilEof();
      if (groupTokens.length === 0) {
        diagnostics.push({
          ...createPrepDiagnostic(
            'invalidPivotGroupField',
            'Pivot group by must list at least one field'
          ),
          line: command.line,
        });
        return null;
      }
      groupBy = parseGroupFields(groupTokens, command.line, diagnostics);
    } else if (!cursor.eof) {
      invalidPivot(command, diagnostics);
      return null;
    }

    const using = parseMetrics(usingText, { requireAlias: false }, command.line, diagnostics);
    if (using.length === 0) {
      invalidPivot(command, diagnostics);
      return null;
    }

    return createOperator('pivot', command.text, {
      on,
      using,
      groupBy,
    });
  },
  format: (config) => {
    const on = (Array.isArray(config?.on) ? config.on : []).filter(isCompletePivotAxis);
    const onSegments: string[] = [];
    for (const axis of on) {
      const field = String((axis as Record<string, unknown>)?.field ?? '').trim();
      const rawValues = (axis as Record<string, unknown>)?.values;
      // A missing values key means dynamic all-values; a present-but-
      // non-array value is an invalid axis and must fail the export.
      const values = rawValues === undefined ? [] : Array.isArray(rawValues) ? rawValues : null;
      if (values === null) return null;
      if (!values.every(isPivotLiteral)) return null;
      const inClause = values.length > 0 ? ` in (${values.map(formatLiteral).join(', ')})` : '';
      onSegments.push(`${formatFieldRef(field)}${inClause}`);
    }
    const onDsl = onSegments.join(', ');
    if (!onDsl) return null;
    const using = objectArray(config?.using).filter(isCompletePivotMetric);
    if (using.length === 0) return null;
    const usingDsl = using.map(formatMetric).join(', ');
    const groupBy = Array.isArray(config?.groupBy) ? config.groupBy : [];
    const groupSql =
      groupBy.length > 0 ? ` group by ${groupBy.map(formatFieldRef).join(', ')}` : '';
    return `pivot on ${onDsl} using ${usingDsl}${groupSql}`;
  },
};

function isPivotLiteral(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function pushInvalidValueList(
  field: string,
  value: unknown,
  line: number,
  diagnostics: PrepDiagnostic[]
): boolean {
  diagnostics.push({
    ...createPrepDiagnostic(
      'invalidPivotValueList',
      `Pivot field '${field}' must declare a strictly parenthesized value list after 'in'; use 'on [field]' for all values and separate axes with commas`,
      { value: value === null || value === undefined ? '' : String(value) }
    ),
    line,
  });
  return false;
}

function parsePivotAxes(
  cursor: PivotTokenCursor,
  line: number,
  diagnostics: PrepDiagnostic[]
): PivotAxisEntry[] {
  const on: PivotAxisEntry[] = [];
  const seen = new Set<string>();
  while (!cursor.eof) {
    // Stop before a top-level `using` keyword.
    if (cursor.isTopLevelKeyword('using')) break;
    const axis = parsePivotAxisItem(cursor, line, diagnostics);
    if (!axis) {
      // Consume up to the next top-level comma or `using` to avoid infinite loop.
      cursor.skipUntilTopLevelCommaOrKeyword('using');
      continue;
    }
    const key = axis.field.trim().toLowerCase();
    if (seen.has(key)) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidPivotField', `Duplicate pivot field: ${axis.field}`, {
          value: axis.field,
        }),
        line,
      });
    } else {
      seen.add(key);
      on.push(axis);
    }
    if (cursor.peekType() === 'Comma') {
      // A comma is only valid between two axes. If the next token is not a
      // field reference (the start of another axis), it is a trailing comma
      // after the value list (e.g. `in (...), using`) and must be rejected.
      const next = cursor.peek(1);
      const isNextAxis =
        next !== undefined &&
        (next.type === 'FieldRef' || (next.type === 'Ident' && !isClauseKeyword(next.value)));
      if (!isNextAxis) {
        pushInvalidValueList('', cursor.text, line, diagnostics);
        return on;
      }
      cursor.consume();
      continue;
    }
    break;
  }
  return on;
}

const CLAUSE_KEYWORDS = new Set(['using', 'group']);

function isClauseKeyword(value: string): boolean {
  return CLAUSE_KEYWORDS.has(value.toLowerCase());
}

function parsePivotAxisItem(
  cursor: PivotTokenCursor,
  line: number,
  diagnostics: PrepDiagnostic[]
): PivotAxisEntry | null {
  const fieldToken = readFieldToken(cursor, line, diagnostics);
  if (!fieldToken) return null;
  const field =
    fieldToken.type === 'FieldRef' ? unwrapFieldRef(fieldToken.value) : fieldToken.value;

  if (cursor.isTopLevelKeyword('using') || cursor.eof || cursor.peekType() === 'Comma') {
    return { field, values: [] };
  }

  if (!cursor.matchIdentifier('in')) {
    pushInvalidAxis(field, cursor.text, line, diagnostics);
    return null;
  }
  if (cursor.eof || cursor.peekType() !== 'ParenOpen') {
    pushInvalidValueList(field, cursor.text, line, diagnostics);
    return null;
  }
  cursor.consume(); // consume (
  const values = parseValueList(cursor, field, line, diagnostics);
  if (values === null) return null;
  // After a value list, only a top-level comma, `using`, or EOF may follow.
  if (!cursor.eof && !cursor.isTopLevelKeyword('using') && cursor.peekType() !== 'Comma') {
    pushInvalidValueList(field, cursor.text, line, diagnostics);
    return null;
  }
  return { field, values };
}

function parseValueList(
  cursor: PivotTokenCursor,
  field: string,
  line: number,
  diagnostics: PrepDiagnostic[]
): unknown[] | null {
  if (cursor.eof || cursor.peekType() === 'ParenClose') {
    pushInvalidValueList(field, [], line, diagnostics);
    return null;
  }
  const values: unknown[] = [];
  let expectValue = true;
  while (!cursor.eof) {
    const type = cursor.peekType();
    if (type === 'ParenClose') {
      cursor.consume();
      if (expectValue) {
        pushInvalidValueList(field, [], line, diagnostics);
        return null;
      }
      return values;
    }
    if (type === 'Comma') {
      if (expectValue) {
        pushInvalidValueList(field, [], line, diagnostics);
        return null;
      }
      cursor.consume();
      expectValue = true;
      continue;
    }
    if (expectValue) {
      const literal = parseValueLiteral(cursor);
      if (literal === undefined) {
        pushInvalidValueList(field, [], line, diagnostics);
        return null;
      }
      values.push(literal);
      expectValue = false;
      continue;
    }
    // Two values without a separating comma.
    pushInvalidValueList(field, [], line, diagnostics);
    return null;
  }
  // Unterminated list (no closing paren).
  pushInvalidValueList(field, [], line, diagnostics);
  return null;
}

function parseValueLiteral(cursor: PivotTokenCursor): unknown | undefined {
  const type = cursor.peekType();
  if (type === 'StringLiteral') {
    const token = cursor.consume()!;
    return parseStringLiteral(token.value);
  }
  if (type === 'Number') {
    const token = cursor.consume()!;
    return Number(token.value);
  }
  if (type === 'Operator' && (cursor.peek()!.value === '-' || cursor.peek()!.value === '+')) {
    const sign = cursor.consume()!.value;
    const number = cursor.peek();
    if (number?.type === 'Number') {
      cursor.consume();
      return Number(`${sign}${number.value}`);
    }
    return undefined;
  }
  if (type === 'Ident') {
    const token = cursor.consume()!;
    const lower = token.value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (lower === 'null') return null;
    // Unquoted bare literal: treat as a string (matches prior parseLiteral fallback).
    return token.value;
  }
  if (type === 'FieldRef') {
    // Bracketed field reference inside a value list is treated as a literal string.
    const token = cursor.consume()!;
    return unwrapFieldRef(token.value);
  }
  return undefined;
}

function tokenizeWithDiagnostics(
  command: { text: string; line: number },
  diagnostics: PrepDiagnostic[]
): ExprToken[] | null {
  try {
    return tokenizeExpression(command.text);
  } catch (error) {
    if (error instanceof ExpressionTokenizeError) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidPivot', `Cannot parse pivot: ${command.text}`, {
          value: command.text,
        }),
        line: command.line,
      });
      return null;
    }
    throw error;
  }
}

function invalidPivot(
  command: { text: string; line: number },
  diagnostics: PrepDiagnostic[]
): void {
  diagnostics.push({
    ...createPrepDiagnostic('invalidPivot', `Cannot parse pivot: ${command.text}`, {
      value: command.text,
    }),
    line: command.line,
  });
}

function pushInvalidAxis(
  field: string,
  _text: string,
  line: number,
  diagnostics: PrepDiagnostic[]
): void {
  diagnostics.push({
    ...createPrepDiagnostic('invalidPivotField', `Invalid pivot axis: ${field}`, {
      value: field,
    }),
    line,
  });
}

function readFieldToken(
  cursor: PivotTokenCursor,
  line: number,
  diagnostics: PrepDiagnostic[]
): ExprToken | null {
  const token = cursor.peek();
  if (token?.type === 'FieldRef') {
    cursor.consume();
    return token;
  }
  // Allow a bare identifier as a field (e.g. `on [a]` formatted fields are bracketed,
  // but a user may write an unqualified name).
  if (token?.type === 'Ident') {
    cursor.consume();
    return token;
  }
  diagnostics.push({
    ...createPrepDiagnostic('invalidPivotField', 'Invalid pivot field reference', {
      value: token?.value ?? '',
    }),
    line,
  });
  return null;
}

function parseGroupFields(
  tokens: ExprToken[],
  line: number,
  diagnostics: PrepDiagnostic[]
): string[] {
  const fields: string[] = [];
  for (const part of splitTopLevelTokens(tokens)) {
    const token = part[0];
    if (part.length !== 1 || !token || (token.type !== 'FieldRef' && token.type !== 'Ident')) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidPivotGroupField', 'Invalid group by field reference'),
        line,
      });
      continue;
    }
    const field = token.type === 'FieldRef' ? unwrapFieldRef(token.value) : token.value;
    fields.push(field);
  }
  return fields;
}

/**
 * Split a token array into top-level segments separated by commas that are
 * not inside parentheses. Used to separate multiple pivot axes and group-by
 * fields while keeping commas inside value lists intact.
 */
function splitTopLevelTokens(tokens: ExprToken[]): ExprToken[][] {
  const segments: ExprToken[][] = [];
  let current: ExprToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.type === 'ParenOpen') depth += 1;
    else if (token.type === 'ParenClose') depth -= 1;
    if (token.type === 'Comma' && depth === 0) {
      segments.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function sliceText(source: string, segment: ExprToken[]): string {
  if (segment.length === 0) return '';
  const start = segment[0].start;
  const end = segment[segment.length - 1].end;
  return source.slice(start, end);
}

class PivotTokenCursor {
  private readonly tokens: ExprToken[];
  private position = 0;

  constructor(
    tokens: ExprToken[],
    readonly text: string
  ) {
    this.tokens = tokens;
  }

  get eof(): boolean {
    return this.position >= this.tokens.length;
  }

  peek(offset = 0): ExprToken | undefined {
    return this.tokens[this.position + offset];
  }

  peekType(offset = 0): string | undefined {
    return this.peek(offset)?.type;
  }

  consume(): ExprToken | undefined {
    const token = this.peek();
    if (token) this.position += 1;
    return token;
  }

  matchIdentifier(keyword: string): boolean {
    const token = this.peek();
    if (token?.type !== 'Ident' || token.value.toLowerCase() !== keyword) return false;
    this.consume();
    return true;
  }

  /**
   * Whether the current token is a top-level (paren-depth 0) keyword.
   * Scans forward tracking paren depth without consuming.
   */
  isTopLevelKeyword(keyword: string): boolean {
    let depth = 0;
    for (let i = this.position; i < this.tokens.length; i += 1) {
      const token = this.tokens[i];
      if (token.type === 'ParenOpen') depth += 1;
      else if (token.type === 'ParenClose') depth -= 1;
      if (depth < 0) return false;
      if (depth === 0 && token.type === 'Ident' && token.value.toLowerCase() === keyword) {
        return this.position === i;
      }
    }
    return false;
  }

  /**
   * Skip tokens until a top-level comma or the given keyword, used to recover
   * from a malformed axis without looping forever. Guarantees forward progress:
   * a top-level comma is consumed before returning.
   */
  skipUntilTopLevelCommaOrKeyword(keyword: string): void {
    let depth = 0;
    while (!this.eof) {
      const token = this.peek()!;
      if (token.type === 'ParenOpen') depth += 1;
      else if (token.type === 'ParenClose') depth -= 1;
      if (depth === 0 && token.type === 'Comma') {
        this.consume();
        return;
      }
      if (depth === 0 && token.type === 'Ident' && token.value.toLowerCase() === keyword) {
        return;
      }
      this.consume();
    }
  }

  /**
   * Read the rest of the `using` body (after the `using` keyword), stopping at
   * a top-level `group by` if present. Returns the metrics tokens plus whether
   * a `group by` was encountered.
   */
  readUsingBody(): { usingTokens: ExprToken[]; hasGroupBy: boolean } {
    let depth = 0;
    const start = this.position;
    while (!this.eof) {
      const token = this.peek()!;
      if (token.type === 'ParenOpen') depth += 1;
      else if (token.type === 'ParenClose') depth -= 1;
      if (depth === 0 && token.type === 'Ident' && token.value.toLowerCase() === 'group') {
        const next = this.peek(1);
        if (next?.type === 'Ident' && next.value.toLowerCase() === 'by') {
          return { usingTokens: this.tokens.slice(start, this.position), hasGroupBy: true };
        }
      }
      this.consume();
    }
    return { usingTokens: this.tokens.slice(start), hasGroupBy: false };
  }

  readUntilEof(): ExprToken[] {
    const start = this.position;
    let end = this.tokens.length;
    // Exclude the trailing EOF sentinel produced by the tokenizer.
    if (end > start && this.tokens[end - 1]?.type === 'EOF') end -= 1;
    this.position = end;
    return this.tokens.slice(start, end);
  }
}

function parseStringLiteral(value: string): string {
  const quote = value[0];
  const body = value.slice(1, -1);
  if (quote === '"') {
    return body.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  // Single-quoted with SQL '' escaping.
  return body.replace(/''/g, "'").replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function unwrapFieldRef(value: string): string {
  const inner = value.slice(1, -1);
  return inner.startsWith('`') && inner.endsWith('`')
    ? inner.slice(1, -1).replace(/\\`/g, '`')
    : inner;
}
