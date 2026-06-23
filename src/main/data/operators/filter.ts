import { quoteValueIdentifier, literalToSql, unwrapFieldToken } from './utils';

type TokenType =
  | 'FieldRef'
  | 'StringLiteral'
  | 'Number'
  | 'BooleanTrue'
  | 'BooleanFalse'
  | 'Null'
  | 'And'
  | 'Or'
  | 'Not'
  | 'Matches'
  | 'Begin'
  | 'End'
  | 'In'
  | 'Operator'
  | 'Comma'
  | 'ParenOpen'
  | 'ParenClose'
  | 'Ident';

interface Token {
  type: TokenType;
  raw: string;
}

const KEYWORDS: Record<string, TokenType> = {
  and: 'And',
  or: 'Or',
  not: 'Not',
  matches: 'Matches',
  begin: 'Begin',
  end: 'End',
  in: 'In',
  true: 'BooleanTrue',
  false: 'BooleanFalse',
  null: 'Null',
};

const MULTI_CHAR_OPS = ['!=', '<>', '>=', '<='];
const SINGLE_CHAR_OPS = ['=', '>', '<', '+', '-', '*', '/'];

function isWordStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isWordPart(ch: string): boolean {
  return isWordStart(ch) || (ch >= '0' && ch <= '9');
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if (ch === '"') {
      let value = '';
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\') {
          i++;
          if (i < input.length) {
            if (input[i] === '"') {
              value += '"';
            } else {
              value += '\\' + input[i];
            }
          }
        } else {
          value += input[i];
        }
        i++;
      }
      if (i >= input.length) {
        throw new Error('Unterminated string literal in filter condition');
      }
      i++;
      tokens.push({ type: 'StringLiteral', raw: value });
      continue;
    }

    if (ch === '[') {
      i++;
      let name = '';
      if (i < input.length && input[i] === '`') {
        name += '`';
        i++;
        while (i < input.length && input[i] !== '`') {
          if (input[i] === '\\') {
            i++;
            if (i < input.length) name += input[i];
          } else {
            name += input[i];
          }
          i++;
        }
        name += '`';
        if (i >= input.length) {
          throw new Error('Unterminated backtick field reference in filter condition');
        }
        i++;
      } else {
        while (i < input.length && input[i] !== ']') {
          name += input[i];
          i++;
        }
        if (i >= input.length) {
          throw new Error('Unterminated field reference in filter condition');
        }
      }
      i++;
      tokens.push({ type: 'FieldRef', raw: name });
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'ParenOpen', raw: '(' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'ParenClose', raw: ')' });
      i++;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'Comma', raw: ',' });
      i++;
      continue;
    }

    let matched = false;
    for (const op of MULTI_CHAR_OPS) {
      if (input.startsWith(op, i)) {
        tokens.push({ type: 'Operator', raw: op });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    for (const op of SINGLE_CHAR_OPS) {
      if (ch === op) {
        tokens.push({ type: 'Operator', raw: op });
        i++;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (/[\d.]/.test(ch) && (ch !== '.' || (i + 1 < input.length && /\d/.test(input[i + 1])))) {
      let num = '';
      let dotCount = 0;
      let seenE = false;
      while (i < input.length && /[\d.eE]/.test(input[i])) {
        if (input[i] === '.') {
          if (seenE) {
            throw new Error(`Invalid number literal: ${num}${input[i]}`);
          }
          dotCount++;
        }
        if (input[i] === 'e' || input[i] === 'E') seenE = true;
        num += input[i];
        i++;
      }
      if (dotCount > 1) {
        throw new Error(`Invalid number literal: ${num}`);
      }
      if (num.endsWith('e') || num.endsWith('E')) {
        if (i < input.length && (input[i] === '+' || input[i] === '-')) {
          num += input[i];
          i++;
        }
        if (!(i < input.length && /\d/.test(input[i]))) {
          throw new Error(`Invalid number literal: ${num}`);
        }
        while (i < input.length && /\d/.test(input[i])) {
          num += input[i];
          i++;
        }
      }
      tokens.push({ type: 'Number', raw: num });
      continue;
    }

    if (isWordStart(ch)) {
      let word = '';
      while (i < input.length && isWordPart(input[i])) {
        word += input[i];
        i++;
      }
      const lower = word.toLowerCase();
      const kw = KEYWORDS[lower];
      tokens.push({ type: kw ?? 'Ident', raw: word });
      continue;
    }

    throw new Error(`Unexpected character '${ch}' in filter condition at position ${i}`);
  }

  return tokens;
}

export function compileFilterConditionExpression(condition: string): string {
  if (!condition || condition.trim() === '') return 'TRUE';
  const tokens = tokenize(condition);
  if (tokens.length === 0) return 'TRUE';
  const compiler = new Compiler(tokens);
  const result = compiler.compileOr();
  const remaining = compiler.remainingTokens();
  if (remaining.length > 0) {
    const rest = remaining.map((t) => t.raw).join(' ');
    throw new Error(`Unexpected tokens in filter condition: ${rest}`);
  }
  return result;
}

class Compiler {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  private match(...types: TokenType[]): Token | undefined {
    const token = this.peek();
    if (token && types.includes(token.type)) {
      return this.advance();
    }
    return undefined;
  }

  private check(...types: TokenType[]): boolean {
    const token = this.peek();
    return token !== undefined && types.includes(token.type);
  }

  private wrapCast(expr: string): string {
    return `CAST(${expr} AS VARCHAR)`;
  }

  remainingTokens(): Token[] {
    return this.tokens.slice(this.pos);
  }

  compileOr(): string {
    let left = this.compileAnd();
    while (this.match('Or')) {
      const right = this.compileAnd();
      left = `${left} OR ${right}`;
    }
    return left;
  }

  compileAnd(): string {
    let left = this.compileNot();
    while (this.match('And')) {
      const right = this.compileNot();
      left = `${left} AND ${right}`;
    }
    return left;
  }

  compileNot(): string {
    if (this.match('Not')) {
      const inner = this.compileNot();
      return `NOT ${inner}`;
    }
    return this.compileComparison();
  }

  compileComparison(): string {
    let left = this.compileTerm();

    if (this.match('Matches', 'Begin', 'End')) {
      const operator = this.tokens[this.pos - 1];
      const right = this.compileTerm();
      switch (operator.type) {
        case 'Matches':
          return `regexp_matches(${this.wrapCast(left)}, ${this.wrapCast(right)})`;
        case 'Begin':
          return `starts_with(${this.wrapCast(left)}, ${this.wrapCast(right)})`;
        case 'End':
          return `ends_with(${this.wrapCast(left)}, ${this.wrapCast(right)})`;
      }
    }

    if (this.match('In')) {
      return `${left} IN ${this.compileInList()}`;
    }

    while (this.check('Operator') || this.check('Ident') || this.check('Not')) {
      const token = this.advance();
      let right: string;

      if (token.type === 'Not') {
        if (this.check('Matches')) {
          this.advance();
          right = this.compileTerm();
          left = `NOT regexp_matches(${this.wrapCast(left)}, ${this.wrapCast(right)})`;
        } else if (this.match('Begin')) {
          right = this.compileTerm();
          left = `NOT starts_with(${this.wrapCast(left)}, ${this.wrapCast(right)})`;
        } else if (this.match('End')) {
          right = this.compileTerm();
          left = `NOT ends_with(${this.wrapCast(left)}, ${this.wrapCast(right)})`;
        } else if (this.match('In')) {
          left = `${left} NOT IN ${this.compileInList()}`;
        } else {
          const nextToken = this.advance();
          right = this.compileTerm();
          left = `${left} NOT ${nextToken.raw.toUpperCase()} ${right}`;
        }
      } else {
        right = this.compileTerm();
        left = `${left} ${token.raw} ${right}`;

        if (this.match('Matches', 'Begin', 'End')) {
          const specialOp = this.tokens[this.pos - 1];
          const extraRight = this.compileTerm();
          switch (specialOp.type) {
            case 'Matches':
              left = `regexp_matches(${this.wrapCast(left)}, ${this.wrapCast(extraRight)})`;
              break;
            case 'Begin':
              left = `starts_with(${this.wrapCast(left)}, ${this.wrapCast(extraRight)})`;
              break;
            case 'End':
              left = `ends_with(${this.wrapCast(left)}, ${this.wrapCast(extraRight)})`;
              break;
          }
        } else if (this.match('In')) {
          left = `${left} IN ${this.compileInList()}`;
        }
      }
    }

    return left;
  }

  private compileBinaryOp(nextLevel: () => string, allowedOps: string[]): string {
    let left = nextLevel();
    while (this.check('Operator')) {
      const op = this.peek()!;
      if (allowedOps.includes(op.raw)) {
        this.advance();
        const right = nextLevel();
        left = `${left} ${op.raw} ${right}`;
      } else {
        break;
      }
    }
    return left;
  }

  compileTerm(): string {
    return this.compileBinaryOp(() => this.compileFactor(), ['+', '-']);
  }

  compileFactor(): string {
    return this.compileBinaryOp(() => this.compileUnary(), ['*', '/']);
  }

  compileUnary(): string {
    if (this.match('Not')) {
      const inner = this.compileUnary();
      return `NOT ${inner}`;
    }
    if (this.check('Operator')) {
      const op = this.peek()!;
      if (op.raw === '-' || op.raw === '+') {
        this.advance();
        const inner = this.compileUnary();
        return `${op.raw}${inner}`;
      }
    }
    return this.compilePrimary();
  }

  compileInList(): string {
    if (!this.match('ParenOpen')) {
      throw new Error('Expected ( after IN');
    }
    const items: string[] = [];
    while (!this.check('ParenClose')) {
      if (this.match('Comma')) continue;
      items.push(this.compileOr());
    }
    this.advance();
    if (items.length === 0) {
      throw new Error('IN list must not be empty');
    }
    return `(${items.join(', ')})`;
  }

  compilePrimary(): string {
    if (this.match('ParenOpen')) {
      const inner = this.compileOr();
      if (!this.match('ParenClose')) {
        throw new Error('Missing closing parenthesis in filter condition');
      }
      return `(${inner})`;
    }

    const token = this.advance();

    switch (token.type) {
      case 'FieldRef':
        return quoteValueIdentifier(unwrapFieldToken(`[${token.raw}]`));
      case 'StringLiteral':
        return literalToSql(token.raw);
      case 'Number':
        return token.raw;
      case 'BooleanTrue':
        return 'TRUE';
      case 'BooleanFalse':
        return 'FALSE';
      case 'Null':
        return 'NULL';
      case 'Ident':
        return token.raw.toUpperCase();
      default:
        throw new Error(`Unexpected token in filter condition: ${token.raw}`);
    }
  }
}
