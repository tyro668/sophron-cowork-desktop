import { tokenizeExpression, type ExprToken } from '../../expression-tokenizer';

export interface DomainParseOptions {
  allowBareIdentifiers?: boolean;
  allowLegacySql?: boolean;
}

export function tokenizeDomainExpression(expression: string): ExprToken[] {
  return tokenizeExpression(expression);
}

export class DomainTokenCursor {
  readonly tokens: ExprToken[];
  private position = 0;

  constructor(expression: string) {
    this.tokens = tokenizeDomainExpression(expression);
  }

  get eof(): boolean {
    return this.position >= this.tokens.length;
  }

  peek(offset = 0): ExprToken | undefined {
    return this.tokens[this.position + offset];
  }

  consume(): ExprToken | undefined {
    const token = this.peek();
    if (token) this.position += 1;
    return token;
  }

  matchIdentifier(keyword: string): boolean {
    const token = this.peek();
    if (!token || token.type !== 'Ident' || token.value.toLowerCase() !== keyword) return false;
    this.position += 1;
    return true;
  }
}

export function findMatchingParenToken(
  tokens: ExprToken[],
  openIndex: number
): ExprToken | undefined {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'ParenOpen') depth += 1;
    else if (token.type === 'ParenClose') {
      depth -= 1;
      if (depth === 0) return token;
    }
  }
  return undefined;
}
