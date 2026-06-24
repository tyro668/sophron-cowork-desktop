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

export function tokenizeExpression(input: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let i = 0;

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
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\') i++;
        i++;
      }
      if (i >= input.length) {
        throw new ExpressionTokenizeError('Unterminated string literal', start);
      }
      i++;
      tokens.push({ type: 'StringLiteral', value: input.slice(start, i), start, end: i });
      continue;
    }

    if (ch === '[') {
      const start = i;
      i++;
      if (i < input.length && input[i] === '`') {
        i++;
        while (i < input.length && input[i] !== '`') {
          if (input[i] === '\\') i++;
          i++;
        }
        if (i >= input.length) {
          throw new ExpressionTokenizeError('Unterminated field reference', start);
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
      tokens.push({ type: 'FieldRef', value: input.slice(start, i), start, end: i });
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
        const beforeE = i;
        i++;
        if (i < input.length && (input[i] === '+' || input[i] === '-')) i++;
        if (i < input.length && isDigit(input[i])) {
          while (i < input.length && isDigit(input[i])) i++;
        } else {
          i = beforeE;
        }
      }
      tokens.push({ type: 'Number', value: input.slice(start, i), start, end: i });
      continue;
    }

    if (i + 1 < input.length) {
      const twoChar = input.slice(i, i + 2);
      if (twoChar === '!=' || twoChar === '<>' || twoChar === '>=' || twoChar === '<=') {
        tokens.push({ type: 'Operator', value: twoChar, start: i, end: i + 2 });
        i += 2;
        continue;
      }
    }

    if (
      ch === '+' ||
      ch === '-' ||
      ch === '*' ||
      ch === '/' ||
      ch === '=' ||
      ch === '<' ||
      ch === '>' ||
      ch === '!'
    ) {
      tokens.push({ type: 'Operator', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      while (i < input.length && isIdentPart(input[i])) i++;
      tokens.push({ type: 'Ident', value: input.slice(start, i), start, end: i });
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'ParenOpen', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'ParenClose', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'Comma', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === '.') {
      tokens.push({ type: 'Dot', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    throw new ExpressionTokenizeError(`Unexpected character '${ch}'`, i);
  }

  tokens.push({ type: 'EOF', value: '', start: i, end: i });
  return tokens;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}
