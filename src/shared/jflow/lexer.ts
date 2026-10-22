/**
 * jflow/1 lexer (Chevrotain). Reserved words cannot be names; soft keywords (verbs, option
 * words, type names) are their own token types but also belong to the Ident category, so they
 * still work as names and function names where the grammar expects an identifier.
 */
import { createToken, Lexer, type TokenType } from 'chevrotain';

const IDENT_PATTERN = /[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*/;

export const WhiteSpace = createToken({ name: 'WhiteSpace', pattern: /\s+/, group: Lexer.SKIPPED });
/** `#! key: value` pragma (stable step id, disabled flag). Kept out of the parse stream. */
export const Pragma = createToken({ name: 'Pragma', pattern: /#![^\n]*/, group: 'pragmas' });
/** `## …` doc comment and `# …` comment. */
export const Comment = createToken({ name: 'Comment', pattern: /#[^\n]*/, group: 'comments' });

export const RawString = createToken({ name: 'RawString', pattern: /'''[\s\S]*?'''/ });
export const StringLit = createToken({ name: 'StringLit', pattern: /'(?:[^']|'')*'/ });
/** Double quotes are not part of jflow (E_LEX_DOUBLE_QUOTE); lexed so the parser can explain. */
export const DoubleQuoted = createToken({ name: 'DoubleQuoted', pattern: /"[^"\n]*"?/ });
export const Field = createToken({ name: 'Field', pattern: /\[(?:[^\]\n]|\]\])*\]/ });
/** Unclosed `[` up to end of line — incremental-friendly for field completion. */
export const FieldOpen = createToken({ name: 'FieldOpen', pattern: /\[(?:[^\]\n])*/ });
export const Duration = createToken({
  name: 'Duration',
  pattern: /\d+(?:\.\d+)?(?:ms|mo|[smhdwqy])(?![A-Za-z0-9_\u4e00-\u9fff])/,
});
export const NumberLit = createToken({ name: 'NumberLit', pattern: /\d[\d_]*(?:\.\d+)?/ });
export const Param = createToken({
  name: 'Param',
  pattern: /\$[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*/,
});
export const RefKind = createToken({ name: 'RefKind', pattern: /@(?:name|id|path|new)\b/ });

export const Ident = createToken({ name: 'Ident', pattern: IDENT_PATTERN });

export const Concat = createToken({ name: 'Concat', pattern: /\|\|/ });
export const Pipe = createToken({ name: 'Pipe', pattern: /\|/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Cmp = createToken({ name: 'Cmp', pattern: Lexer.NA });
export const Neq = createToken({ name: 'Neq', pattern: /!=|<>/, categories: [Cmp] });
export const Le = createToken({ name: 'Le', pattern: /<=/, categories: [Cmp] });
export const Ge = createToken({ name: 'Ge', pattern: />=/, categories: [Cmp] });
export const Lt = createToken({ name: 'Lt', pattern: /</, categories: [Cmp] });
export const Gt = createToken({ name: 'Gt', pattern: />/, categories: [Cmp] });
export const Eq = createToken({ name: 'Eq', pattern: /=/, categories: [Cmp] });
export const Plus = createToken({ name: 'Plus', pattern: /\+/ });
export const Minus = createToken({ name: 'Minus', pattern: /-/ });
export const Star = createToken({ name: 'Star', pattern: /\*/ });
export const Slash = createToken({ name: 'Slash', pattern: /\// });
export const Percent = createToken({ name: 'Percent', pattern: /%/ });

/** Words that can never be a name (pipeline/let/source names, aliases). */
export const RESERVED_WORDS = [
  'as',
  'is',
  'not',
  'null',
  'and',
  'or',
  'in',
  'on',
  'get',
  'let',
  'source',
  'with',
  'when',
  'then',
  'else',
  'elseif',
  'end',
  'between',
  'like',
  'ilike',
  'matches',
  'distinct',
  'over',
  'true',
  'false',
  'if',
  'case',
  'pipeline',
  'param',
] as const;

/** Context words: own token type, still usable as identifiers. */
export const SOFT_WORDS = [
  // verbs
  'where',
  'select',
  'drop',
  'derive',
  'rename',
  'cast',
  'try_cast',
  'fill',
  'nullify',
  'drop_empty',
  'sort',
  'take',
  'sample',
  'group',
  'pivot',
  'unpivot',
  'unnest',
  'join',
  'lookup',
  'union',
  'intersect',
  'except',
  'split',
  'check',
  'sql',
  'pass',
  'write',
  // step words
  'agg',
  'values',
  'exclude',
  'into',
  'json',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'semi',
  'anti',
  'asof',
  'unique',
  'rows',
  'not_null',
  'cols',
  'replace',
  'prefix',
  'suffix',
  'nulls',
  'first',
  'last',
  'grain',
  'incremental',
  'lookback',
  'mean',
  'median',
  'mode',
  'forward',
  'backward',
  'all',
  'any',
  // window
  'partition',
  'by',
  'order',
  'asc',
  'desc',
  'range',
  'groups',
  'unbounded',
  'preceding',
  'following',
  'current',
  'row',
  'ties',
  'others',
  'no',
  // types and typed literals
  'text',
  'integer',
  'float',
  'decimal',
  'date',
  'datetime',
  'boolean',
] as const;

function keywordToken(word: string, soft: boolean): TokenType {
  return createToken({
    name: `K_${word}`,
    pattern: new RegExp(`${word}(?![A-Za-z0-9_\\u4e00-\\u9fff])`),
    longer_alt: Ident,
    categories: soft ? [Ident] : [],
  });
}

export const KW: Record<string, TokenType> = {};
for (const word of RESERVED_WORDS) KW[word] = keywordToken(word, false);
for (const word of SOFT_WORDS) KW[word] = keywordToken(word, true);

/** Order matters: longer / more specific patterns first. */
export const ALL_TOKENS: TokenType[] = [
  WhiteSpace,
  Pragma,
  Comment,
  RawString,
  StringLit,
  DoubleQuoted,
  Field,
  FieldOpen,
  Duration,
  NumberLit,
  Param,
  RefKind,
  // keywords before Ident; longest words first so `drop_empty` beats `drop`
  ...[...RESERVED_WORDS, ...SOFT_WORDS]
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((word) => KW[word]),
  Ident,
  Concat,
  Pipe,
  Comma,
  LParen,
  RParen,
  Dot,
  Colon,
  Neq,
  Le,
  Ge,
  Lt,
  Gt,
  Eq,
  Cmp,
  Plus,
  Minus,
  Star,
  Slash,
  Percent,
];

export const JflowLexer = new Lexer(ALL_TOKENS, {
  ensureOptimizations: false,
  positionTracking: 'full',
});

export const VERB_WORDS = new Set([
  'where',
  'select',
  'drop',
  'derive',
  'rename',
  'cast',
  'fill',
  'nullify',
  'drop_empty',
  'sort',
  'take',
  'sample',
  'distinct',
  'group',
  'pivot',
  'unpivot',
  'unnest',
  'join',
  'lookup',
  'union',
  'intersect',
  'except',
  'split',
  'check',
  'sql',
  'pass',
  'write',
]);
