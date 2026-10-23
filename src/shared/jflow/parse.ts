/** Public parse API: lexing, parsing, error mapping (E_LEX_* / E_PARSE_*), pragma + doc attachment. */
import type { IToken } from 'chevrotain';
import type { Expr, JflowDiagnostic, JflowFile, Span, Step } from './ast';
import { DoubleQuoted, FieldOpen, JflowLexer, Pipe, VERB_WORDS } from './lexer';
import { getJflowParser } from './parser';
import { fmtExpr } from './format';

export interface JflowParseResult<T> {
  ast: T | null;
  diagnostics: JflowDiagnostic[];
  tokens: IToken[];
}

const VERB_SUGGESTIONS: Record<string, string> = {
  filter: 'where',
  limit: 'take',
  head: 'take',
  output: 'write',
  calculate: 'derive',
  calc: 'derive',
  mutate: 'derive',
  aggregate: 'group',
  agg: 'group',
  groupby: 'group',
  dedupe: 'distinct',
  deduplicate: 'distinct',
  order: 'sort',
  orderby: 'sort',
  convert: 'cast',
  map: 'rename',
  expect: 'check',
  assert: 'check',
  merge: 'join',
};

export function lex(text: string): {
  tokens: IToken[];
  groups: Record<string, IToken[]>;
  diagnostics: JflowDiagnostic[];
} {
  const result = JflowLexer.tokenize(text);
  const diagnostics: JflowDiagnostic[] = [];
  for (const error of result.errors) {
    const ch = text[error.offset];
    diagnostics.push({
      code: ch === "'" ? 'E_LEX_UNCLOSED' : 'E_LEX_CHAR',
      severity: 'error',
      message: ch === "'" ? '字符串没有闭合' : `无法识别的字符 ${JSON.stringify(ch)}`,
      span: { start: error.offset, end: error.offset + error.length },
    });
  }
  const tokens: IToken[] = [];
  for (const token of result.tokens) {
    if (token.tokenType === DoubleQuoted) {
      diagnostics.push({
        code: 'E_LEX_DOUBLE_QUOTE',
        severity: 'error',
        message: `jflow 不使用双引号：字段写 [${token.image.replace(/"/g, '')}]，文本写 '${token.image.replace(/"/g, '')}'`,
        span: { start: token.startOffset, end: token.endOffset! + 1 },
      });
    } else if (token.tokenType === FieldOpen) {
      diagnostics.push({
        code: 'E_LEX_UNCLOSED',
        severity: 'error',
        message: '方括号字段没有闭合',
        span: { start: token.startOffset, end: token.endOffset! + 1 },
      });
    }
    tokens.push(token);
  }
  return { tokens, groups: result.groups as Record<string, IToken[]>, diagnostics };
}

function tokenSpan(token: IToken | undefined, textLength: number): Span {
  if (!token || Number.isNaN(token.startOffset)) return { start: textLength, end: textLength };
  return { start: token.startOffset, end: (token.endOffset ?? token.startOffset) + 1 };
}

function mapParserErrors(
  errors: ReturnType<typeof getJflowParser>['errors'],
  tokens: IToken[],
  textLength: number
): JflowDiagnostic[] {
  return errors.map((error) => {
    const token = error.token;
    const index = tokens.indexOf(token);
    const prev = index > 0 ? tokens[index - 1] : undefined;
    if (prev?.tokenType === Pipe && token && !VERB_WORDS.has(token.image)) {
      const suggestion = VERB_SUGGESTIONS[token.image.toLowerCase()];
      return {
        code: 'E_PARSE_UNKNOWN_VERB',
        severity: 'error' as const,
        message: `未知动词 ${token.image}`,
        span: tokenSpan(token, textLength),
        hint: suggestion,
      };
    }
    const eof = !token || Number.isNaN(token.startOffset);
    return {
      code: eof ? 'E_PARSE_EOF' : 'E_PARSE_UNEXPECTED',
      severity: 'error' as const,
      message: eof
        ? '文本意外结束'
        : `此处不能出现 ${token.image}（${error.message.split('\n')[0]}）`,
      span: tokenSpan(token, textLength),
    };
  });
}

function runRule<T>(
  text: string,
  rule: 'file' | 'steps' | 'expr'
): JflowParseResult<T> & {
  groups: Record<string, IToken[]>;
} {
  const { tokens, groups, diagnostics } = lex(text);
  if (diagnostics.length > 0) return { ast: null, diagnostics, tokens, groups };
  const parser = getJflowParser();
  parser.caseSites = [];
  parser.input = tokens;
  let ast: T | null = null;
  try {
    ast = (parser[rule] as () => T)();
  } catch (error) {
    const e = error as Error & { jflowCode?: string; token?: IToken };
    if (!e.jflowCode) throw error;
    return {
      ast: null,
      diagnostics: [
        {
          code: e.jflowCode,
          severity: 'error',
          message: e.message,
          span: e.token ? tokenSpan(e.token, text.length) : undefined,
        },
      ],
      tokens,
      groups,
    };
  }
  if (parser.errors.length > 0) {
    return {
      ast: null,
      diagnostics: mapParserErrors(parser.errors, tokens, text.length),
      tokens,
      groups,
    };
  }
  const caseDiagnostics = parser.caseSites
    // nested case inside case: report only the outermost (its fix rewrites both)
    .filter(
      (site, _i, all) => !all.some((o) => o !== site && o.start <= site.start && o.end >= site.end)
    )
    .map((site): JflowDiagnostic => ({
      code: 'E_CASE_REMOVED',
      severity: 'error',
      message: 'jflow 不再支持 case when，请改用 if … then … elseif … else … end',
      hint: '简单 case [x] when v 写成 if [x] = v then …；多个取值用 [x] in (v1, v2)',
      span: { start: site.start, end: site.end },
      fix: {
        title: '改写为 if … elseif',
        span: { start: site.start, end: site.end },
        text: fmtExpr(site.expr),
      },
    }));
  if (caseDiagnostics.length > 0)
    return { ast: null, diagnostics: caseDiagnostics, tokens, groups };
  return { ast, diagnostics: [], tokens, groups };
}

/** Attach `#! key: value` pragmas and `##` doc comments to the next source / step / flow. */
function attachTrivia(
  targets: Array<{ span: Span; pragmas?: Record<string, string>; id?: string; doc?: string[] }>,
  groups: Record<string, IToken[]>
): void {
  const ordered = [...targets].sort((a, b) => a.span.start - b.span.start);
  const attach = (token: IToken, apply: (t: (typeof ordered)[number]) => void) => {
    const target = ordered.find((t) => t.span.start >= token.startOffset);
    if (target) apply(target);
  };
  for (const token of groups.pragmas ?? []) {
    const m = /^#!\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/.exec(token.image);
    if (!m) continue;
    attach(token, (t) => {
      t.pragmas = { ...(t.pragmas ?? {}), [m[1]]: m[2] };
      if (m[1] === 'id') t.id = m[2];
    });
  }
  for (const token of groups.comments ?? []) {
    if (!token.image.startsWith('##')) continue;
    attach(token, (t) => (t.doc = [...(t.doc ?? []), token.image.replace(/^##\s?/, '')]));
  }
}

function collectSteps(file: JflowFile): Step[] {
  const out: Step[] = [];
  const walkChain = (chain: { head: unknown; steps: Step[] }) => {
    const head = chain.head as { k: string; chain?: { head: unknown; steps: Step[] }; step?: Step };
    if (head.k === 'chain' && head.chain) walkChain(head.chain);
    if (head.k === 'setop' && head.step) {
      out.push(head.step);
      walkTables(head.step);
    }
    for (const s of chain.steps) {
      out.push(s);
      walkTables(s);
    }
  };
  const walkTables = (s: Step) => {
    for (const t of [...(s.tables ?? []), ...(s.table ? [s.table] : [])]) {
      if (t.src.k === 'chain') walkChain(t.src.chain);
    }
  };
  for (const flow of file.flows) walkChain(flow.chain);
  return out;
}

export function parseJflow(text: string): JflowParseResult<JflowFile> {
  const r = runRule<JflowFile>(text, 'file');
  if (r.ast) {
    const steps = collectSteps(r.ast);
    // pragmas go to sources and steps; doc comments to flows (statement level) and steps
    attachTrivia([...r.ast.sources, ...steps], { pragmas: r.groups.pragmas ?? [] });
    attachTrivia([...r.ast.sources, ...r.ast.flows], { comments: r.groups.comments ?? [] });
  }
  return { ast: r.ast, diagnostics: r.diagnostics, tokens: r.tokens };
}

export function parseJflowSteps(text: string): JflowParseResult<Step[]> {
  const r = runRule<Step[]>(text, 'steps');
  if (r.ast) attachTrivia(r.ast, r.groups);
  return { ast: r.ast, diagnostics: r.diagnostics, tokens: r.tokens };
}

export function parseJflowExpr(text: string): JflowParseResult<Expr> {
  const r = runRule<Expr>(text, 'expr');
  return { ast: r.ast, diagnostics: r.diagnostics, tokens: r.tokens };
}

/**
 * Field completion: when the cursor sits right after `[` (or inside an unclosed `[ab`), return
 * the typed prefix and whether the grammar accepts a field here (Chevrotain content assist).
 */
export function fieldCompletionContext(
  text: string,
  offset: number
): { prefix: string; from: number; expectsField: boolean } | null {
  const before = text.slice(0, offset);
  const m = /\[([^\]\n]*)$/.exec(before);
  if (!m) return null;
  const from = offset - m[0].length;
  const { tokens } = lex(before.slice(0, from));
  const parser = getJflowParser();
  const startRule =
    /^\s*\|/.test(before) && !/^\s*(pipeline|source|let)\b/m.test(before) ? 'steps' : 'file';
  let expectsField = true;
  try {
    const suggestions = (
      parser as unknown as {
        computeContentAssist(
          rule: string,
          t: unknown[]
        ): Array<{ nextTokenType: { name: string } }>;
      }
    ).computeContentAssist(startRule, tokens);
    expectsField = suggestions.some((s) => s.nextTokenType.name === 'Field');
  } catch {
    expectsField = true;
  }
  return { prefix: m[1], from, expectsField };
}
