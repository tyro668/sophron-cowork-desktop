export type ExprTokenType =
  | 'FieldRef'
  | 'StringLiteral'
  | 'Number'
  | 'Ident'
  | 'Operator'
  | 'Dot'
  | 'Comma'
  | 'ParenOpen'
  | 'ParenClose'
  | 'EOF';

export interface ExprToken {
  type: ExprTokenType;
  value: string;
  start: number;
  end: number;
}

export class ExpressionTokenizeError extends Error {
  constructor(
    message: string,
    public readonly position: number
  ) {
    super(message);
    this.name = 'ExpressionTokenizeError';
  }
}

const MAX_EXPRESSION_LENGTH = 10_000;
const MAX_EXPRESSION_TOKENS = 2_048;
const MAX_EXPRESSION_NESTING = 64;

export function tokenizeExpression(input: string): ExprToken[] {
  if (input.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionTokenizeError(
      `Expression exceeds ${MAX_EXPRESSION_LENGTH} characters`,
      MAX_EXPRESSION_LENGTH
    );
  }
  const tokens: ExprToken[] = [];
  let i = 0;
  let nesting = 0;

  const pushToken = (token: ExprToken): void => {
    if (tokens.length >= MAX_EXPRESSION_TOKENS) {
      throw new ExpressionTokenizeError(`Expression exceeds ${MAX_EXPRESSION_TOKENS} tokens`, i);
    }
    tokens.push(token);
  };

  while (i < input.length) {
    const ch = input[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      const quote = ch;
      i++;
      let closed = false;
      while (i < input.length) {
        if (input[i] === quote) {
          if (quote === "'" && input[i + 1] === "'") {
            // SQL '' escape: keep the string open.
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        if (input[i] === '\\') {
          i += 2;
        } else {
          i++;
        }
      }
      if (!closed) {
        throw new ExpressionTokenizeError('Unterminated string literal', start);
      }
      pushToken({ type: 'StringLiteral', value: input.slice(start, i), start, end: i });
      continue;
    }

    if (ch === '[') {
      const start = i;
      i++;
      const isBacktickQuoted = i < input.length && input[i] === '`';
      if (isBacktickQuoted) {
        i++;
        while (i < input.length && input[i] !== '`') {
          if (input[i] === '\\') i++;
          i++;
        }
        if (i >= input.length) {
          throw new ExpressionTokenizeError('Unterminated backtick field reference', start);
        }
        i++;
      } else {
        while (i < input.length && input[i] !== ']') {
          i++;
        }
      }
      if (i >= input.length) {
        throw new ExpressionTokenizeError('Unterminated field reference', start);
      }
      i++;
      pushToken({ type: 'FieldRef', value: input.slice(start, i), start, end: i });
      continue;
    }

    if (isDigit(ch) || (ch === '.' && i + 1 < input.length && isDigit(input[i + 1]))) {
      const start = i;
      while (i < input.length && isDigit(input[i])) i++;
      if (i < input.length && input[i] === '.') {
        i++;
        while (i < input.length && isDigit(input[i])) i++;
      }
      if (i < input.length && (input[i] === 'e' || input[i] === 'E')) {
        i++;
        if (i < input.length && (input[i] === '+' || input[i] === '-')) i++;
        if (i < input.length && isDigit(input[i])) {
          while (i < input.length && isDigit(input[i])) i++;
        } else {
          throw new ExpressionTokenizeError('Invalid number literal', start);
        }
      }
      if (i < input.length && input[i] === '.') {
        throw new ExpressionTokenizeError('Invalid number literal', start);
      }
      pushToken({ type: 'Number', value: input.slice(start, i), start, end: i });
      continue;
    }

    if (i + 1 < input.length) {
      const twoChar = input.slice(i, i + 2);
      if (
        twoChar === '!=' ||
        twoChar === '<>' ||
        twoChar === '>=' ||
        twoChar === '<=' ||
        twoChar === '||'
      ) {
        pushToken({ type: 'Operator', value: twoChar, start: i, end: i + 2 });
        i += 2;
        continue;
      }
    }

    if (
      ch === '+' ||
      ch === '-' ||
      ch === '*' ||
      ch === '/' ||
      ch === '%' ||
      ch === '=' ||
      ch === '<' ||
      ch === '>' ||
      ch === '!' ||
      ch === '|'
    ) {
      pushToken({ type: 'Operator', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      while (i < input.length && isIdentPart(input[i])) i++;
      pushToken({ type: 'Ident', value: input.slice(start, i), start, end: i });
      continue;
    }

    if (ch === '(') {
      nesting++;
      if (nesting > MAX_EXPRESSION_NESTING) {
        throw new ExpressionTokenizeError(
          `Expression exceeds nesting depth ${MAX_EXPRESSION_NESTING}`,
          i
        );
      }
      pushToken({ type: 'ParenOpen', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ')') {
      nesting--;
      if (nesting < 0) {
        throw new ExpressionTokenizeError('Unexpected closing parenthesis', i);
      }
      pushToken({ type: 'ParenClose', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ',') {
      pushToken({ type: 'Comma', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === '.') {
      pushToken({ type: 'Dot', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    throw new ExpressionTokenizeError(`Unexpected character '${ch}'`, i);
  }

  if (nesting !== 0) {
    throw new ExpressionTokenizeError('Missing closing parenthesis', i);
  }
  pushToken({ type: 'EOF', value: '', start: i, end: i });
  return tokens;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  // CJK letters allow Chinese function aliases such as 四舍五入(...).
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    ch === '_' ||
    (ch >= '\u4e00' && ch <= '\u9fff')
  );
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}
