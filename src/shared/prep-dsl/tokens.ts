import { Lexer, createToken } from 'chevrotain';
import type { PrepDiagnostic } from './ast';

export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t\r\n]+/,
  group: Lexer.SKIPPED,
});

export const Comment = createToken({
  name: 'Comment',
  pattern: /#[^\n\r]*/,
  group: Lexer.SKIPPED,
});

export const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"(?:[^"\\]|\\.)*"/,
});

export const NumberLiteral = createToken({
  name: 'NumberLiteral',
  pattern: /-?(?:0|[1-9]\d*)(?:\.\d+)?/,
});

export const LSquare = createToken({ name: 'LSquare', pattern: /\[/ });
export const RSquare = createToken({ name: 'RSquare', pattern: /\]/ });
export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });
export const Pipe = createToken({ name: 'Pipe', pattern: /\|/ });
export const Gte = createToken({ name: 'Gte', pattern: />=/ });
export const Lte = createToken({ name: 'Lte', pattern: /<=/ });
export const NotEquals = createToken({ name: 'NotEquals', pattern: /!=/ });
export const Equals = createToken({ name: 'Equals', pattern: /=/ });
export const GreaterThan = createToken({ name: 'GreaterThan', pattern: />/ });
export const LessThan = createToken({ name: 'LessThan', pattern: /</ });
export const Plus = createToken({ name: 'Plus', pattern: /\+/ });
export const Minus = createToken({ name: 'Minus', pattern: /-/ });
export const Slash = createToken({ name: 'Slash', pattern: /\// });
export const Percent = createToken({ name: 'Percent', pattern: /%/ });
export const Star = createToken({ name: 'Star', pattern: /\*/ });
export const BacktickName = createToken({ name: 'BacktickName', pattern: /`(?:[^`\\]|\\.)*`/ });
export const Identifier = createToken({ name: 'Identifier', pattern: /[^\s#[\](),.|=!<>+\-/*%"]+/ });

export const prepDslTokens = [
  WhiteSpace,
  Comment,
  StringLiteral,
  NumberLiteral,
  Gte,
  Lte,
  NotEquals,
  LSquare,
  RSquare,
  LParen,
  RParen,
  Comma,
  Dot,
  Pipe,
  Equals,
  GreaterThan,
  LessThan,
  Plus,
  Minus,
  Slash,
  Percent,
  Star,
  BacktickName,
  Identifier,
];

export const prepDslLexer = new Lexer(prepDslTokens);

export function tokenizePrepDsl(input: string): { diagnostics: PrepDiagnostic[] } {
  const result = prepDslLexer.tokenize(input);
  return {
    diagnostics: result.errors.map((error) => ({
      severity: 'error',
      message: error.message,
      line: error.line,
      column: error.column,
    })),
  };
}
