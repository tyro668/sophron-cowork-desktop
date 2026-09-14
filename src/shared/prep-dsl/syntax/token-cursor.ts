import type { IToken } from 'chevrotain';
import type { PrepDiagnostic, PrepFieldRef } from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { prepDslLexer } from '../tokens';
import { parseFieldRefExact } from './fields';

export class PrepTokenCursor {
  readonly tokens: IToken[];
  private position = 0;

  constructor(
    readonly text: string,
    private readonly line: number,
    private readonly diagnostics: PrepDiagnostic[]
  ) {
    const result = prepDslLexer.tokenize(text);
    this.tokens = result.tokens;
  }

  get index(): number {
    return this.position;
  }

  get eof(): boolean {
    return this.position >= this.tokens.length;
  }

  peek(offset = 0): IToken | undefined {
    return this.tokens[this.position + offset];
  }

  image(offset = 0): string | undefined {
    return this.peek(offset)?.image.toLowerCase();
  }

  tokenType(offset = 0): string | undefined {
    return this.peek(offset)?.tokenType.name;
  }

  consume(): IToken | undefined {
    const token = this.peek();
    if (token) this.position += 1;
    return token;
  }

  match(keyword: string): boolean {
    if (this.image() !== keyword.toLowerCase()) return false;
    this.consume();
    return true;
  }

  matchType(tokenType: string): IToken | null {
    if (this.tokenType() !== tokenType) return null;
    return this.consume() ?? null;
  }

  expectType(tokenType: string, code = 'expectedToken'): IToken | null {
    const token = this.matchType(tokenType);
    if (token) return token;
    this.report(code, `Expected ${tokenType} but found ${this.describeCurrent()}`);
    return null;
  }

  expect(keyword: string, code = 'expectedToken'): IToken | null {
    if (this.image() === keyword.toLowerCase()) return this.consume() ?? null;
    this.report(code, `Expected "${keyword}" but found ${this.describeCurrent()}`);
    return null;
  }

  expectOneOf(values: readonly string[], code = 'expectedToken'): string | null {
    const image = this.image();
    const value = image && values.find((candidate) => candidate.toLowerCase() === image);
    if (value) {
      this.consume();
      return value;
    }
    this.report(code, `Expected one of ${values.join(', ')} but found ${this.describeCurrent()}`);
    return null;
  }

  expectOneOfIfPresent(values: readonly string[]): string | null {
    const image = this.image();
    const value = image && values.find((candidate) => candidate.toLowerCase() === image);
    if (!value) return null;
    this.consume();
    return value;
  }

  expectNonNegativeInteger(code = 'expectedInteger'): number | null {
    const token = this.peek();
    if (token?.tokenType.name === 'NumberLiteral') {
      const value = Number(token.image);
      if (Number.isSafeInteger(value) && value >= 0) {
        this.consume();
        return value;
      }
    }
    this.report(code, `Expected a non-negative integer but found ${this.describeCurrent()}`);
    return null;
  }

  expectPositiveInteger(code = 'expectedInteger'): number | null {
    const token = this.peek();
    if (token?.tokenType.name === 'NumberLiteral') {
      const value = Number(token.image);
      this.consume();
      if (Number.isSafeInteger(value) && value >= 1) {
        return value;
      }
      this.report(code, `Expected a positive integer but found ${token.image}`);
      return null;
    }
    this.report(code, `Expected a positive integer but found ${this.describeCurrent()}`);
    return null;
  }

  expectIdentifier(code = 'expectedIdentifier'): string | null {
    const token = this.matchType('Identifier');
    if (token) return token.image;
    this.report(code, `Expected an identifier but found ${this.describeCurrent()}`);
    return null;
  }

  expectStringLiteral(code = 'expectedString'): string | null {
    const token = this.matchType('StringLiteral');
    if (token) return token.image;
    this.report(code, `Expected a quoted string but found ${this.describeCurrent()}`);
    return null;
  }

  expectFieldRef(code = 'expectedField', invalidCode = code): PrepFieldRef | null {
    const startIndex = this.position;
    if (!this.consumeBracketedName()) {
      this.report(code, `Expected a field reference but found ${this.describeCurrent()}`);
      return null;
    }
    if (this.peek()?.tokenType.name === 'Dot') {
      this.consume();
      if (!this.consumeBracketedName()) {
        this.report(code, 'Expected a field reference after "."');
        return null;
      }
    }

    const field = parseFieldRefExact(this.slice(startIndex));
    if (field?.name.trim() && (!field.source || field.source.trim())) return field;
    this.report(invalidCode, `Invalid field reference "${this.slice(startIndex)}"`);
    return null;
  }

  expectEof(code = 'unexpectedToken'): boolean {
    if (this.eof) return true;
    this.report(code, `Unexpected token "${this.peek()?.image ?? ''}"`);
    return false;
  }

  slice(startIndex: number, endIndex = this.position): string {
    const start = this.tokens[startIndex]?.startOffset;
    const endToken = this.tokens[endIndex - 1];
    if (start === undefined || !endToken) return '';
    const end = (endToken.endOffset ?? endToken.startOffset) + 1;
    return this.text.slice(start, end);
  }

  consumeUntilTopLevelKeyword(keywords: readonly string[]): string {
    const startIndex = this.position;
    let bracketDepth = 0;
    let parenthesisDepth = 0;
    while (!this.eof) {
      const type = this.tokenType();
      if (
        bracketDepth === 0 &&
        parenthesisDepth === 0 &&
        type === 'Identifier' &&
        keywords.some((keyword) => keyword.toLowerCase() === this.image())
      ) {
        break;
      }
      if (type === 'LSquare') bracketDepth += 1;
      else if (type === 'RSquare') bracketDepth = Math.max(0, bracketDepth - 1);
      else if (type === 'LParen') parenthesisDepth += 1;
      else if (type === 'RParen') parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      this.consume();
    }
    return this.slice(startIndex).trim();
  }

  report(code: string, message: string, token = this.peek()): void {
    this.diagnostics.push({
      ...createPrepDiagnostic(code, message),
      line: this.line,
      column: token?.startColumn,
    });
  }

  private describeCurrent(): string {
    return this.eof ? 'end of input' : `"${this.peek()?.image ?? ''}"`;
  }

  private consumeBracketedName(): boolean {
    if (this.peek()?.tokenType.name !== 'LSquare') return false;
    this.consume();
    while (!this.eof && this.peek()?.tokenType.name !== 'RSquare') this.consume();
    if (this.peek()?.tokenType.name !== 'RSquare') return false;
    this.consume();
    return true;
  }
}
