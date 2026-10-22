import { tokenizeExpression, type ExprToken } from '../expression-tokenizer';
import type { BinaryOp, Expr, FrameBound, WindowSpec } from './ast';
import { lookupExpressionFunction } from './functions';
import { exprTypeOf } from './types';

export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly position?: number
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

const CAST_TYPE_WORDS = new Set([
  'text',
  'varchar',
  'string',
  'char',
  'integer',
  'int',
  'bigint',
  'smallint',
  'tinyint',
  'hugeint',
  'float',
  'double',
  'real',
  'decimal',
  'numeric',
  'boolean',
  'bool',
  'date',
  'datetime',
  'timestamp',
  'time',
  'interval',
  'precision',
  'with',
  'zone',
  'json',
  'uuid',
]);

/** Keywords that can never start an operand. */
const RESERVED_WORDS = new Set([
  'and',
  'or',
  'then',
  'else',
  'when',
  'end',
  'from',
  'as',
  'by',
  'over',
  'is',
  'in',
  'between',
  'like',
  'ilike',
  'matches',
  'begin',
  'asc',
  'desc',
]);

export function unquoteString(raw: string): string {
  const quote = raw[0];
  if (quote === "'") {
    return raw.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function unwrapField(token: string): string {
  const inner = token.slice(1, -1);
  if (!inner.startsWith('`') || !inner.endsWith('`')) return inner;
  return inner.slice(1, -1).replace(/\\([\\`])/g, '$1');
}

/** Parse a comma-separated argument list (aggregate metric arguments). */
export function parseExpressionList(input: string): Expr[] {
  let tokens: ExprToken[];
  try {
    tokens = tokenizeExpression(input);
  } catch (error) {
    const position = (error as { position?: number }).position;
    throw new ExpressionError((error as Error).message, 'syntax', position);
  }
  const parser = new Parser(tokens);
  const items = [parser.parseOr()];
  while (parser.acceptComma()) items.push(parser.parseOr());
  parser.expectEnd();
  return items;
}

/** Parse an expression into a typed AST. Throws ExpressionError. */
export function parseExpression(input: string): Expr {
  let tokens: ExprToken[];
  try {
    tokens = tokenizeExpression(input);
  } catch (error) {
    const position = (error as { position?: number }).position;
    throw new ExpressionError((error as Error).message, 'syntax', position);
  }
  const parser = new Parser(tokens);
  const expr = parser.parseOr();
  parser.expectEnd();
  return expr;
}

class Parser {
  private pos = 0;
  /** Inside if/case: `end` closes the block instead of meaning "ends with". */
  private blockDepth = 0;

  constructor(private readonly tokens: ExprToken[]) {}

  private peek(offset = 0): ExprToken {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }
  private next(): ExprToken {
    const token = this.peek();
    if (token.type !== 'EOF') this.pos++;
    return token;
  }
  private isWord(word: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.type === 'Ident' && token.value.toLowerCase() === word;
  }
  private acceptWord(word: string): boolean {
    if (!this.isWord(word)) return false;
    this.pos++;
    return true;
  }
  private expectWord(word: string): void {
    if (!this.acceptWord(word)) this.fail(`Expected ${word.toUpperCase()}`);
  }
  private isOp(op: string): boolean {
    const token = this.peek();
    return token.type === 'Operator' && token.value === op;
  }
  private accept(type: ExprToken['type']): boolean {
    if (this.peek().type !== type) return false;
    this.pos++;
    return true;
  }
  private expect(type: ExprToken['type'], what: string): void {
    if (!this.accept(type)) this.fail(`Expected ${what}`);
  }
  fail(message: string, code = 'syntax'): never {
    const token = this.peek();
    const near = token.type === 'EOF' ? 'end of expression' : `'${token.value}'`;
    throw new ExpressionError(`${message} near ${near}`, code, token.start);
  }
  acceptComma(): boolean {
    return this.accept('Comma');
  }
  expectEnd(): void {
    if (this.peek().type !== 'EOF') this.fail('Unexpected token');
  }

  parseOr(): Expr {
    let left = this.parseAnd();
    while (this.acceptWord('or')) left = { k: 'bin', op: 'OR', l: left, r: this.parseAnd() };
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.acceptWord('and')) left = { k: 'bin', op: 'AND', l: left, r: this.parseNot() };
    return left;
  }

  private parseNot(): Expr {
    if (this.acceptWord('not')) return { k: 'unary', op: 'NOT', e: this.parseNot() };
    return this.parsePredicate();
  }

  private parsePredicate(): Expr {
    let left = this.parseConcat();
    for (;;) {
      if (this.acceptWord('is')) {
        const not = this.acceptWord('not');
        if (this.acceptWord('null')) {
          left = { k: 'isnull', e: left, not };
          continue;
        }
        if (this.acceptWord('distinct')) {
          this.expectWord('from');
          left = { k: 'distinct', l: left, r: this.parseConcat(), not };
          continue;
        }
        this.fail('Expected NULL or DISTINCT FROM after IS');
      }
      const negated = this.isWord('not') && this.isPredicateWord(1);
      if (negated) this.pos++;
      if (this.acceptWord('in')) {
        left = { k: 'in', e: left, not: negated, list: this.parseInList() };
        continue;
      }
      if (this.acceptWord('between')) {
        const lo = this.parseConcat();
        this.expectWord('and');
        left = { k: 'between', e: left, not: negated, lo, hi: this.parseConcat() };
        continue;
      }
      if (this.isWord('like') || this.isWord('ilike')) {
        const word = this.next().value.toUpperCase() as 'LIKE' | 'ILIKE';
        const op = (negated ? `NOT ${word}` : word) as BinaryOp;
        left = { k: 'bin', op, l: left, r: this.parseConcat() };
        continue;
      }
      if (
        this.isWord('matches') ||
        this.isWord('begin') ||
        (this.isWord('end') && this.blockDepth === 0)
      ) {
        const op = this.next().value.toLowerCase() as 'matches' | 'begin' | 'end';
        left = { k: 'textop', op, not: negated, l: left, r: this.parseConcat() };
        continue;
      }
      if (negated) this.fail('Expected IN, BETWEEN, LIKE, MATCHES, BEGIN or END after NOT');
      const token = this.peek();
      if (
        token.type === 'Operator' &&
        ['=', '!=', '<>', '<', '<=', '>', '>='].includes(token.value)
      ) {
        this.pos++;
        const right = this.parseConcat();
        // `= null` / `!= null` never match in SQL; normalise to IS [NOT] NULL.
        if (
          right.k === 'null' &&
          (token.value === '=' || token.value === '!=' || token.value === '<>')
        ) {
          left = { k: 'isnull', e: left, not: token.value !== '=' };
        } else {
          left = { k: 'bin', op: token.value as BinaryOp, l: left, r: right };
        }
        continue;
      }
      return left;
    }
  }

  private isPredicateWord(offset: number): boolean {
    return ['in', 'between', 'like', 'ilike', 'matches', 'begin', 'end'].some((w) =>
      this.isWord(w, offset)
    );
  }

  private parseInList(): Expr[] {
    this.expect('ParenOpen', '( after IN');
    const items: Expr[] = [];
    if (this.peek().type !== 'ParenClose') {
      do items.push(this.parseOr());
      while (this.accept('Comma'));
    }
    this.expect('ParenClose', ') to close IN list');
    if (items.length === 0) this.fail('IN list must not be empty');
    return items;
  }

  private parseConcat(): Expr {
    let left = this.parseAdditive();
    while (this.isOp('||')) {
      this.pos++;
      left = { k: 'bin', op: '||', l: left, r: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value as BinaryOp;
      left = { k: 'bin', op, l: left, r: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = this.next().value as BinaryOp;
      left = { k: 'bin', op, l: left, r: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.isOp('-') || this.isOp('+')) {
      const op = this.next().value as '-' | '+';
      return { k: 'unary', op, e: this.parseUnary() };
    }
    if (this.acceptWord('not')) return { k: 'unary', op: 'NOT', e: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const token = this.peek();
    switch (token.type) {
      case 'ParenOpen': {
        this.pos++;
        const inner = this.parseOr();
        this.expect('ParenClose', ')');
        return { k: 'paren', e: inner };
      }
      case 'FieldRef': {
        this.pos++;
        const name = unwrapField(token.value);
        if (this.peek().type === 'Dot' && this.peek(1).type === 'FieldRef') {
          this.pos++;
          const field = unwrapField(this.next().value);
          return { k: 'field', name: field, qualifier: name };
        }
        return { k: 'field', name };
      }
      case 'StringLiteral':
        this.pos++;
        return { k: 'str', value: unquoteString(token.value) };
      case 'Number':
        this.pos++;
        return { k: 'num', raw: token.value };
      case 'Operator':
        if (token.value === '*') {
          this.pos++;
          return { k: 'star' };
        }
        return this.fail('Unexpected operator');
      case 'Ident':
        return this.parseWord();
      default:
        return this.fail('Unexpected token');
    }
  }

  private parseWord(): Expr {
    const token = this.next();
    const word = token.value.toLowerCase();
    if (RESERVED_WORDS.has(word)) {
      this.pos--;
      return this.fail('Unexpected token');
    }
    const callFollows = this.peek().type === 'ParenOpen';
    if (word === 'true' || word === 'false') return { k: 'bool', value: word === 'true' };
    if (word === 'null') return { k: 'null' };
    if (word === 'if') return this.parseIf();
    if (word === 'case') return this.parseCase();
    if ((word === 'cast' || word === 'try_cast') && callFollows)
      return this.parseCast(word === 'try_cast');
    if (word === 'extract' && callFollows) return this.parseExtract();
    if (word === 'interval') return this.parseInterval();
    if ((word === 'date' || word === 'timestamp') && this.peek().type === 'StringLiteral') {
      return {
        k: 'typed',
        type: word === 'date' ? 'DATE' : 'TIMESTAMP',
        value: unquoteString(this.next().value),
      };
    }
    const definition = lookupExpressionFunction(token.value);
    if (!definition) {
      this.pos--;
      return callFollows
        ? this.fail(`Unknown function '${token.value}'`, 'unknownFunction')
        : this.fail(
            `Unknown identifier '${token.value}' (write fields as [${token.value}])`,
            'unknownIdentifier'
          );
    }
    if (!callFollows) {
      if (definition.bare)
        return { k: 'call', name: definition.name, args: [], distinct: false, bare: true };
      this.pos--;
      return this.fail(`Function '${token.value}' needs parentheses`, 'syntax');
    }
    this.pos++; // (
    const distinct = this.acceptWord('distinct');
    const args: Expr[] = [];
    if (this.peek().type !== 'ParenClose') {
      do args.push(this.parseOr());
      while (this.accept('Comma'));
    }
    this.expect('ParenClose', `) to close ${definition.name}(`);
    const starOnly = args.length === 1 && args[0].k === 'star';
    if (args.some((arg) => arg.k === 'star') && !(definition.name === 'count' && starOnly)) {
      throw new ExpressionError(`'*' is only allowed in count(*)`, 'syntax', token.start);
    }
    const arity = starOnly ? 1 : args.length;
    if (arity < definition.minArgs || arity > definition.maxArgs) {
      const expected =
        definition.minArgs === definition.maxArgs
          ? `${definition.minArgs}`
          : `${definition.minArgs}-${definition.maxArgs}`;
      throw new ExpressionError(
        `Function '${definition.name}' expects ${expected} argument(s), got ${arity}`,
        'arity',
        token.start
      );
    }
    let over: WindowSpec | undefined;
    if (this.acceptWord('over')) over = this.parseWindow();
    if (definition.kind === 'window' && !over) {
      throw new ExpressionError(
        `Window function '${definition.name}' requires over(...)`,
        'windowRequired',
        token.start
      );
    }
    return { k: 'call', name: definition.name, args, distinct, over };
  }

  private parseIf(): Expr {
    this.blockDepth++;
    const condition = this.parseOr();
    this.expectWord('then');
    const then = this.parseOr();
    let otherwise: Expr | undefined;
    if (this.acceptWord('else')) otherwise = this.parseOr();
    this.blockDepth--;
    this.expectWord('end');
    return { k: 'case', whens: [[condition, then]], else: otherwise };
  }

  private parseCase(): Expr {
    this.blockDepth++;
    const operand = this.isWord('when') ? undefined : this.parseOr();
    const whens: Array<[Expr, Expr]> = [];
    while (this.acceptWord('when')) {
      const when = this.parseOr();
      this.expectWord('then');
      whens.push([when, this.parseOr()]);
    }
    if (whens.length === 0) this.fail('CASE needs at least one WHEN');
    let otherwise: Expr | undefined;
    if (this.acceptWord('else')) otherwise = this.parseOr();
    this.blockDepth--;
    this.expectWord('end');
    return { k: 'case', operand, whens, else: otherwise };
  }

  private parseCast(isTry: boolean): Expr {
    this.pos++; // (
    const value = this.parseOr();
    this.expectWord('as');
    const words: string[] = [];
    while (this.peek().type === 'Ident' && CAST_TYPE_WORDS.has(this.peek().value.toLowerCase())) {
      words.push(this.next().value);
    }
    if (words.length === 0) this.fail('Expected a type after AS', 'unknownType');
    let type = words.join(' ');
    if (this.accept('ParenOpen')) {
      const params: string[] = [];
      do {
        const token = this.next();
        if (token.type !== 'Number') this.fail('Expected a number in type parameters');
        params.push(token.value);
      } while (this.accept('Comma'));
      this.expect('ParenClose', ')');
      type += `(${params.join(',')})`;
    }
    if (exprTypeOf(type) === 'unknown' && !/^(time|interval)/i.test(type)) {
      this.fail(`Unknown type '${type}'`, 'unknownType');
    }
    this.expect('ParenClose', ') to close cast(');
    return { k: 'cast', e: value, type, try: isTry };
  }

  private parseExtract(): Expr {
    this.pos++; // (
    const token = this.next();
    if (token.type !== 'StringLiteral' && token.type !== 'Ident') this.fail('Expected a date part');
    const part = token.type === 'StringLiteral' ? unquoteString(token.value) : token.value;
    this.expectWord('from');
    const value = this.parseOr();
    this.expect('ParenClose', ') to close extract(');
    return { k: 'extract', part, e: value };
  }

  private parseInterval(): Expr {
    const value = this.parseUnary();
    const unitToken = this.peek();
    const units = [
      'microsecond',
      'millisecond',
      'second',
      'minute',
      'hour',
      'day',
      'week',
      'month',
      'quarter',
      'year',
    ];
    const unitWord =
      unitToken.type === 'Ident' ? unitToken.value.toLowerCase().replace(/s$/, '') : '';
    if (units.includes(unitWord)) {
      this.pos++;
      return { k: 'interval', value, unit: unitWord.toUpperCase() };
    }
    return { k: 'interval', value };
  }

  private parseWindow(): WindowSpec {
    this.expect('ParenOpen', '( after OVER');
    const spec: WindowSpec = { partitionBy: [], orderBy: [] };
    if (this.acceptWord('partition')) {
      this.expectWord('by');
      do spec.partitionBy.push(this.parseConcat());
      while (this.accept('Comma'));
    }
    if (this.acceptWord('order')) {
      this.expectWord('by');
      do {
        const expr = this.parseConcat();
        const entry: WindowSpec['orderBy'][number] = { expr };
        if (this.acceptWord('asc')) entry.direction = 'ASC';
        else if (this.acceptWord('desc')) entry.direction = 'DESC';
        if (this.acceptWord('nulls')) {
          if (this.acceptWord('first')) entry.nulls = 'FIRST';
          else {
            this.expectWord('last');
            entry.nulls = 'LAST';
          }
        }
        spec.orderBy.push(entry);
      } while (this.accept('Comma'));
    }
    const unitWord = ['rows', 'range', 'groups'].find((w) => this.isWord(w));
    if (unitWord) {
      this.pos++;
      const unit = unitWord.toUpperCase() as 'ROWS' | 'RANGE' | 'GROUPS';
      let start: FrameBound;
      let end: FrameBound | undefined;
      if (this.acceptWord('between')) {
        start = this.parseBound();
        this.expectWord('and');
        end = this.parseBound();
      } else {
        start = this.parseBound();
      }
      let exclude: string | undefined;
      if (this.acceptWord('exclude')) {
        if (this.acceptWord('current')) {
          this.expectWord('row');
          exclude = 'CURRENT ROW';
        } else if (this.acceptWord('group')) exclude = 'GROUP';
        else if (this.acceptWord('ties')) exclude = 'TIES';
        else {
          this.expectWord('no');
          this.expectWord('others');
          exclude = 'NO OTHERS';
        }
      }
      spec.frame = { unit, start, end, exclude };
    }
    this.expect('ParenClose', ') to close OVER(');
    return spec;
  }

  private parseBound(): FrameBound {
    if (this.acceptWord('unbounded')) {
      if (this.acceptWord('preceding')) return { kind: 'unbounded', side: 'PRECEDING' };
      this.expectWord('following');
      return { kind: 'unbounded', side: 'FOLLOWING' };
    }
    if (this.acceptWord('current')) {
      this.expectWord('row');
      return { kind: 'current' };
    }
    const offset = this.parseAdditive();
    if (this.acceptWord('preceding')) return { kind: 'offset', offset, side: 'PRECEDING' };
    this.expectWord('following');
    return { kind: 'offset', offset, side: 'FOLLOWING' };
  }
}
