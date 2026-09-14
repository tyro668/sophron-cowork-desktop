import {
  ExpressionTokenizeError,
  tokenizeExpression,
  type ExprToken,
} from '../../../shared/expression-tokenizer';
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
  | 'Is'
  | 'Distinct'
  | 'From'
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
  is: 'Is',
  distinct: 'Distinct',
  from: 'From',
  true: 'BooleanTrue',
  false: 'BooleanFalse',
  null: 'Null',
};

function tokenize(input: string): Token[] {
  let expressionTokens: ExprToken[];
  try {
    expressionTokens = tokenizeExpression(input);
  } catch (error) {
    if (error instanceof ExpressionTokenizeError) {
      throw new Error(`${error.message} in filter condition at position ${error.position}`);
    }
    throw error;
  }

  return expressionTokens.flatMap((token): Token[] => {
    switch (token.type) {
      case 'EOF':
        return [];
      case 'FieldRef':
        return [{ type: 'FieldRef', raw: token.value }];
      case 'StringLiteral':
        return [{ type: 'StringLiteral', raw: unquoteFilterString(token.value) }];
      case 'Number':
      case 'Operator':
      case 'Comma':
      case 'ParenOpen':
      case 'ParenClose':
        return [{ type: token.type, raw: token.value }];
      case 'Ident': {
        const keyword = KEYWORDS[token.value.toLowerCase()];
        return [{ type: keyword ?? 'Ident', raw: token.value }];
      }
      case 'Dot':
        throw new Error(`Unexpected character '.' in filter condition at position ${token.start}`);
    }
  });
}

function unquoteFilterString(value: string): string {
  const quote = value[0];
  const inner = value.slice(1, -1);
  return quote === "'"
    ? inner.replace(/''/g, "'").replace(/\\'/g, "'")
    : inner.replace(/\\"/g, '"');
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
    let notCount = 0;
    while (this.match('Not')) notCount++;
    const inner = this.compileComparison();
    return `${'NOT '.repeat(notCount)}${inner}`;
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

    if (this.match('Is')) {
      const negated = this.match('Not');
      if (this.match('Null')) {
        return `${left} IS ${negated ? 'NOT ' : ''}NULL`;
      }
      // `IS [NOT] DISTINCT FROM <expr>` — a multi-word SQL operator.
      if (this.match('Distinct')) {
        if (!this.match('From')) {
          throw new Error('Expected FROM after IS DISTINCT');
        }
        const right = this.compileTerm();
        return `${left} IS ${negated ? 'NOT ' : ''}DISTINCT FROM ${right}`;
      }
      throw new Error('Expected NULL or DISTINCT after IS');
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
        if (right === 'NULL' && (token.raw === '=' || token.raw === '!=' || token.raw === '<>')) {
          // Normalize `= null` / `!= null` / `<> null` to proper IS NULL /
          // IS NOT NULL semantics (`= NULL` is never true in SQL).
          left = token.raw === '=' ? `${left} IS NULL` : `${left} IS NOT NULL`;
        } else {
          left = `${left} ${token.raw} ${right}`;
        }

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
    const prefixes: string[] = [];
    while (this.match('Not')) prefixes.push('NOT ');
    while (this.check('Operator')) {
      const op = this.peek()!;
      if (op.raw === '-' || op.raw === '+') {
        this.advance();
        prefixes.push(op.raw);
      } else {
        break;
      }
    }
    return prefixes.join('') + this.compilePrimary();
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
        return quoteValueIdentifier(unwrapFieldToken(token.raw));
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
