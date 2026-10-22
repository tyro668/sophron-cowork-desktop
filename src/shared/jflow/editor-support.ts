/**
 * Editor support for jflow, framework-neutral (the CodeMirror 6 adapter lives in the renderer):
 * - highlight tokens straight from the Chevrotain lexer,
 * - lint diagnostics from parse → bind → validate (spans clamped to the document),
 * - completion: `[` → field list (bound schema), `@id(` / `@name(` → tables, `|` → verbs,
 *   `name:` params per verb (from the strict VERB_ARGS table).
 */
import type { IToken } from 'chevrotain';
import type { JflowDiagnostic } from './ast';
import { VERB_ARGS } from './args';
import { RESERVED_WORDS, SOFT_WORDS, VERB_WORDS } from './lexer';
import { fieldCompletionContext, lex } from './parse';
import { compileWorkflowJflow, type JflowCatalog } from './workflow';

export type JflowTokenClass =
  | 'keyword'
  | 'verb'
  | 'field'
  | 'string'
  | 'number'
  | 'comment'
  | 'pragma'
  | 'ref'
  | 'param'
  | 'operator'
  | 'name'
  | 'type'
  | 'invalid';

export interface JflowHighlightToken {
  from: number;
  to: number;
  cls: JflowTokenClass;
}

const TYPE_WORDS = new Set(['text', 'integer', 'float', 'decimal', 'date', 'datetime', 'boolean']);
const RESERVED = new Set<string>(RESERVED_WORDS);
const SOFT = new Set<string>(SOFT_WORDS);

function classify(t: IToken): JflowTokenClass {
  const name = t.tokenType.name;
  if (name === 'Comment') return 'comment';
  if (name === 'Pragma') return 'pragma';
  if (name === 'Field') return 'field';
  if (name === 'FieldOpen' || name === 'DoubleQuoted') return 'invalid';
  if (name === 'StringLit' || name === 'RawString') return 'string';
  if (name === 'NumberLit' || name === 'Duration') return 'number';
  if (name === 'RefKind') return 'ref';
  if (name === 'Param') return 'param';
  if (name.startsWith('K_')) {
    const w = name.slice(2);
    if (VERB_WORDS.has(w)) return 'verb';
    if (TYPE_WORDS.has(w)) return 'type';
    if (RESERVED.has(w) || SOFT.has(w)) return 'keyword';
  }
  if (name === 'Ident') return 'name';
  return 'operator';
}

export function jflowHighlightTokens(text: string): JflowHighlightToken[] {
  const { tokens, groups } = lex(text);
  const all = [...tokens, ...(groups.comments ?? []), ...(groups.pragmas ?? [])];
  return all
    .map((t) => ({ from: t.startOffset, to: (t.endOffset ?? t.startOffset) + 1, cls: classify(t) }))
    .sort((a, b) => a.from - b.from);
}

export interface JflowLintDiagnostic {
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  code: string;
}

/** Map parse/bind/validate diagnostics to editor ranges (never outside the doc, never empty). */
export function mapDiagnosticsToLint(
  text: string,
  diagnostics: JflowDiagnostic[]
): JflowLintDiagnostic[] {
  const len = text.length;
  return diagnostics.map((d) => {
    let from = Math.max(0, Math.min(d.span?.start ?? 0, len));
    let to = Math.max(from, Math.min(d.span?.end ?? from, len));
    if (to === from) {
      if (to < len) to = from + 1;
      else if (from > 0) from -= 1;
    }
    return {
      from,
      to,
      severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info',
      message: d.hint ? `${d.code}: ${d.message}（${d.hint}）` : `${d.code}: ${d.message}`,
      code: d.code,
    };
  });
}

export function jflowLintDiagnostics(text: string, catalog: JflowCatalog): JflowLintDiagnostic[] {
  return mapDiagnosticsToLint(text, compileWorkflowJflow(text, catalog).diagnostics);
}

export interface JflowCompletionOption {
  label: string;
  type: 'field' | 'table' | 'verb' | 'param' | 'keyword';
  apply?: string;
  detail?: string;
}

export interface JflowCompletionResult {
  from: number;
  options: JflowCompletionOption[];
}

/**
 * Fields in scope at `pos`, tracked step by step: the document is compiled up to the start of the
 * current step (the last top-level `|` before the cursor), and the resulting relation's columns
 * are the step's input. A `join`/`lookup`/`union` step also sees the named right table. Falls back
 * to document-wide names when the prefix does not bind (e.g. unknown source schema).
 */
export function fieldsAt(text: string, pos: number, catalog: JflowCatalog): string[] {
  const before = text.slice(0, pos);
  const pipe = lastStepPipe(before);
  if (pipe >= 0) {
    const compiled = compileWorkflowJflow(text.slice(0, pipe), catalog);
    if (compiled.lastColumns) {
      const out = [...compiled.lastColumns];
      const stepText = before.slice(pipe + 1);
      const right =
        /^\s*(?:join\s+(?:inner|left|right|full|cross|semi|anti|asof)?\s*|lookup\s+|union\s+|intersect\s+|except\s+)([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*)/.exec(
          stepText
        );
      const rightCols = right ? compiled.relationColumns?.[right[1]] : null;
      for (const c of rightCols ?? []) if (!out.includes(c)) out.push(c);
      return out;
    }
  }
  return visibleFields(text, catalog);
}

/** Offset of the last step-separating `|` (not `||`, not inside strings/fields/comments). */
function lastStepPipe(text: string): number {
  let last = -1;
  const { tokens } = lex(text);
  for (const t of tokens) if (t.tokenType.name === 'Pipe') last = t.startOffset;
  return last;
}

/** Field names visible in the document: columns of referenced sources + names defined with `[x] =`. */
function visibleFields(text: string, catalog: JflowCatalog): string[] {
  const out = new Set<string>();
  const idRe = /@(id|name)\('((?:[^']|'')*)'/g;
  for (const m of text.matchAll(idRe)) {
    const arg = m[2].replace(/''/g, "'");
    const t =
      m[1] === 'id'
        ? catalog.tables.find((x) => `local:${x.kind}/${x.id}` === arg)
        : catalog.tables.find((x) => x.name === arg);
    for (const c of t?.columns ?? []) out.add(c.name);
  }
  for (const m of text.matchAll(/\[((?:[^\]\n]|\]\])+)\]\s*=(?!=)/g))
    out.add(m[1].replace(/\]\]/g, ']'));
  for (const m of text.matchAll(
    /\binto\s+\[((?:[^\]\n]|\]\])+)\]\s*,\s*\[((?:[^\]\n]|\]\])+)\]/g
  )) {
    out.add(m[1]);
    out.add(m[2]);
  }
  return [...out];
}

export function jflowCompletions(
  text: string,
  pos: number,
  catalog: JflowCatalog
): JflowCompletionResult | null {
  const before = text.slice(0, pos);
  // `[` → fields
  const field = fieldCompletionContext(text, pos);
  if (field) {
    if (!field.expectsField) return null;
    const closing = text[pos] === ']' ? '' : ']';
    return {
      from: field.from,
      options: fieldsAt(text, field.from, catalog)
        .filter((f) => f.includes(field.prefix))
        .map((f) => ({
          label: `[${f}]`,
          type: 'field',
          apply: `[${f.replace(/\]/g, ']]')}${closing}`,
        })),
    };
  }
  // @id(' / @name(' → tables
  const ref = /@(id|name)\('([^'\n]*)$/.exec(before);
  if (ref) {
    const from = pos - ref[2].length;
    return {
      from,
      options: catalog.tables
        .filter((t) => t.name.includes(ref[2]) || t.id.includes(ref[2]))
        .map((t) =>
          ref[1] === 'id'
            ? {
                label: t.name,
                type: 'table',
                apply: `local:${t.kind}/${t.id}', '${t.name.replace(/'/g, "''")}`,
                detail: t.kind,
              }
            : { label: t.name, type: 'table', apply: t.name.replace(/'/g, "''"), detail: t.kind }
        ),
    };
  }
  // after `|` → verbs
  const verb = /\|\s*([A-Za-z_]*)$/.exec(before);
  if (verb && !/\|\|\s*[A-Za-z_]*$/.test(before)) {
    return {
      from: pos - verb[1].length,
      options: [...VERB_WORDS]
        .filter((v) => v.startsWith(verb[1]))
        .map((v) => ({ label: v, type: 'verb' })),
    };
  }
  // word inside a step → named params of the current verb
  const word = /([A-Za-z_]*)$/.exec(before)![1];
  const lastPipe = before.lastIndexOf('|');
  if (lastPipe >= 0) {
    const stepText = before.slice(lastPipe + 1);
    const v = /^\s*([A-Za-z_]+)/.exec(stepText)?.[1];
    if (v && VERB_ARGS[v] && stepText.trim() !== v && /\s$|\s[A-Za-z_]+$/.test(stepText)) {
      const used = new Set([...stepText.matchAll(/\b([A-Za-z_]+):/g)].map((m) => m[1]));
      const opts = Object.keys(VERB_ARGS[v])
        .filter((k) => !used.has(k) && k.startsWith(word))
        .map((k) => ({ label: `${k}:`, type: 'param' as const, apply: `${k}: ` }));
      if (opts.length) return { from: pos - word.length, options: opts };
    }
  }
  if (!word) return null;
  const kws = ['pipeline', 'source', 'let', 'param', '@id', '@name', '@new', '@path'];
  return {
    from: pos - word.length,
    options: kws.filter((k) => k.startsWith(word)).map((k) => ({ label: k, type: 'keyword' })),
  };
}
