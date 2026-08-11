import {
  ExpressionTokenizeError,
  tokenizeExpression,
  type ExprToken,
} from '../../expression-tokenizer';
import type { PrepDiagnostic } from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { quoteString } from '../syntax/literals';
import { createOperator, type OperatorDslCodec } from './codec';

const COMPARISON_OPERATORS = new Set(['=', '!=', '<>', '>', '<', '>=', '<=']);

export const filterCodec: OperatorDslCodec = {
  type: 'filter',
  matches: (text) => text.startsWith('filter '),
  parse: (command, diagnostics) => {
    const condition = command.text.slice(7).trim();
    validateFilterCondition(condition, diagnostics);
    return createOperator('filter', command.text, { condition });
  },
  format: (config) => {
    const condition = String(config?.condition ?? '').trim();
    if (!condition) return null;
    return `filter ${normalizeBareLiterals(condition)}`;
  },
};

/**
 * Validate the structural shape of a filter condition DSL so illegal
 * statements are rejected at parse time (surfaced live in the DSL editor)
 * rather than silently accepted or dropped.
 */
function validateFilterCondition(condition: string, diagnostics: PrepDiagnostic[]): void {
  const fail = (): void => {
    diagnostics.push(
      createPrepDiagnostic(
        'invalidFilterCondition',
        'Invalid filter condition, please check the DSL'
      )
    );
  };
  if (!condition) return;

  let tokens: ExprToken[];
  try {
    tokens = tokenizeExpression(condition);
  } catch (error) {
    if (error instanceof ExpressionTokenizeError) fail();
    return;
  }
  // Drop the trailing EOF sentinel.
  if (tokens[tokens.length - 1]?.type === 'EOF') tokens = tokens.slice(0, -1);

  const cursor = new ConditionCursor(tokens);
  if (!parseLeafConditionTokens(cursor)) {
    fail();
    return;
  }
  if (!cursor.eof) fail();
}

class ConditionCursor {
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

  matchValue(value: string): ExprToken | undefined {
    const token = this.tokens[this.pos];
    if (
      token &&
      (token.type === 'Ident' || token.type === 'Operator') &&
      token.value.toLowerCase() === value.toLowerCase()
    ) {
      this.pos += 1;
      return token;
    }
    return undefined;
  }

  get eof(): boolean {
    return this.pos >= this.tokens.length;
  }
}

/** Parse a full condition: `or` over `and` over primaries (paren groups / leaves). */
function parseLeafConditionTokens(cursor: ConditionCursor): boolean {
  return parseOr(cursor);
}

function parseOr(cursor: ConditionCursor): boolean {
  if (!parseAnd(cursor)) return false;
  while (cursor.matchValue('or')) {
    if (!parseAnd(cursor)) return false;
  }
  return true;
}

function parseAnd(cursor: ConditionCursor): boolean {
  if (!parsePrimary(cursor)) return false;
  while (cursor.matchValue('and')) {
    if (!parsePrimary(cursor)) return false;
  }
  return true;
}

function parsePrimary(cursor: ConditionCursor): boolean {
  if (cursor.peek()?.type === 'ParenOpen') {
    cursor.next();
    if (!parseOr(cursor)) return false;
    return cursor.next()?.type === 'ParenClose';
  }
  return parseLeaf(cursor);
}

function parseLeaf(cursor: ConditionCursor): boolean {
  const field = cursor.next();
  if (!field || field.type !== 'FieldRef') return false;

  const opToken = cursor.next();
  if (!opToken) return false;

  // Compound operator: not like / not matches / not in.
  if (opToken.type === 'Ident' && opToken.value.toLowerCase() === 'not') {
    const kw = cursor.next();
    if (!kw || kw.type !== 'Ident') return false;
    const op = `not ${kw.value.toLowerCase()}`;
    if (op === 'not in') return parseInList(cursor);
    if (op === 'not like' || op === 'not matches') {
      return parseValue(cursor);
    }
    return false;
  }

  if (opToken.type === 'Ident') {
    const op = opToken.value.toLowerCase();
    if (op === 'between') {
      if (!parseValue(cursor)) return false;
      if (!cursor.matchValue('and')) return false;
      return parseValue(cursor);
    }
    if (op === 'in') return parseInList(cursor);
    if (op === 'like' || op === 'matches' || op === 'begin' || op === 'end') {
      return parseValue(cursor);
    }
    if (op === 'is') {
      if (cursor.matchValue('not')) {
        return Boolean(cursor.matchValue('null'));
      }
      return Boolean(cursor.matchValue('null'));
    }
    return false;
  }

  if (opToken.type === 'Operator') {
    if (!COMPARISON_OPERATORS.has(opToken.value)) return false;
    return parseValue(cursor);
  }

  return false;
}

function parseValue(cursor: ConditionCursor): boolean {
  const token = cursor.next();
  if (!token) return false;
  if (token.type === 'Operator' && (token.value === '-' || token.value === '+')) {
    return cursor.next()?.type === 'Number';
  }
  if (token.type === 'Ident') {
    const lower = token.value.toLowerCase();
    if (lower !== 'true' && lower !== 'false' && lower !== 'null') return false;
    return true;
  }
  const isAtomic =
    token.type === 'StringLiteral' || token.type === 'Number' || token.type === 'FieldRef';
  if (!isAtomic || token.type !== 'Number') return isAtomic;
  // Accept date-like literals such as `2024-01-01` or `2024/01/01`,
  // which tokenize into Number {-,/} Number {-,/} Number.
  while (cursor.peek()?.type === 'Operator') {
    const op = cursor.peek()!;
    if (op.value !== '-' && op.value !== '/') break;
    cursor.next();
    if (cursor.peek()?.type !== 'Number') return false;
    cursor.next();
  }
  return true;
}

function parseInList(cursor: ConditionCursor): boolean {
  if (cursor.next()?.type !== 'ParenOpen') return false;
  if (cursor.peek()?.type === 'ParenClose') return false; // empty list
  let expectValue = true;
  while (!cursor.eof) {
    const token = cursor.peek();
    if (token?.type === 'ParenClose') {
      cursor.next();
      if (expectValue) return false; // trailing comma before close
      return true;
    }
    if (token?.type === 'Comma') {
      if (expectValue) return false; // leading / consecutive comma
      cursor.next();
      expectValue = true;
      continue;
    }
    if (!expectValue) return false; // missing comma between values
    if (!parseValue(cursor)) return false;
    expectValue = false;
  }
  return false; // unterminated list
}

function normalizeBareLiterals(condition: string): string {
  return condition.replace(
    /((?:=|!=|>=|<=|>|<)\s*)([\p{L}_][\p{L}\p{N}_ -]*?)(?=\s*(?:$|\)|\band\b|\bor\b))/giu,
    (_match, operator: string, value: string) => {
      const trimmed = value.trim();
      if (
        !trimmed ||
        /^(true|false|null)$/i.test(trimmed) ||
        /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)
      ) {
        return `${operator}${value}`;
      }
      return `${operator}${quoteString(trimmed)}`;
    }
  );
}
