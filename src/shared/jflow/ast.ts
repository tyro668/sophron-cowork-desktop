/**
 * jflow/1 AST (DSL redesign v4). The text is a view of the operator graph: parse → bind →
 * validate → compile to existing operator configs; the exporter goes the other way.
 */

export interface Span {
  start: number;
  end: number;
}

export type Lit =
  | { k: 'lit'; t: 'str'; v: string }
  | { k: 'lit'; t: 'num'; v: string }
  | { k: 'lit'; t: 'dur'; v: string }
  | { k: 'lit'; t: 'bool'; v: boolean }
  | { k: 'lit'; t: 'null' };

export interface TypeRef {
  name: string;
  p?: number;
  s?: number;
}

export interface OverSpec {
  partition: Expr[];
  order: Array<{ e: Expr; dir: 'asc' | 'desc' | null; nulls: 'first' | 'last' | null }>;
  frame: {
    unit: string;
    bounds: Array<
      { k: 'unbounded'; side: string } | { k: 'current' } | { k: 'offset'; e: Expr; side: string }
    >;
    exclude: string | null;
  } | null;
}

export type Expr =
  | { k: 'field'; q?: string; name: string; span?: Span }
  | Lit
  | { k: 'param'; v: string }
  | { k: 'enum'; v: string }
  | { k: 'paren'; e: Expr }
  | { k: 'list'; items: Expr[] }
  | { k: 'typed'; type: string; v: string }
  | { k: 'not'; e: Expr }
  | { k: 'neg'; e: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'isnull'; e: Expr; not: boolean }
  | { k: 'isdistinct'; l: Expr; r: Expr; not: boolean }
  | { k: 'in'; e: Expr; not: boolean; list: Expr }
  | { k: 'between'; e: Expr; not: boolean; lo: Expr; hi: Expr }
  | { k: 'like'; op: string; not: boolean; l: Expr; r: Expr }
  | { k: 'cast'; try: boolean; e: Expr; type: TypeRef }
  | { k: 'if'; branches: Array<[Expr, Expr]>; else: Expr | null }
  | {
      k: 'call';
      name: string;
      args: Expr[];
      named: Record<string, Expr>;
      distinct: boolean;
      star: boolean;
      over: OverSpec | null;
    };

export type FieldExpr = Extract<Expr, { k: 'field' }>;

export interface SortKey {
  desc: boolean;
  field: FieldExpr;
  nulls: 'first' | 'last' | null;
}

export type KeepItem =
  { k: 'star'; q: string } | { k: 'col'; e: FieldExpr } | { k: 'alias'; name: string; e: Expr };

/** Raw named-argument value as parsed; args.ts normalizes it by the verb's argument table. */
export type NamedValue =
  | { k: 'items'; items: NamedItem[] }
  | { k: 'fields'; v: string[] }
  | { k: 'sortlist'; keys: SortKey[] }
  | { k: 'keep'; items: KeepItem[] };

export type NamedItem =
  | { k: 'expr'; e: Expr; nulls: 'first' | 'last' | null }
  | { k: 'star'; q: string }
  | { k: 'alias'; name: string; e: Expr };

export interface NamedArg {
  key: string;
  value: NamedValue;
  span: Span;
}

export interface ResourceRef {
  form: '@id' | '@name' | '@path' | '@new';
  arg: string;
  snap: string | null;
  opts: Record<string, Expr>;
  span?: Span;
}

export type Head =
  | { k: 'name'; v: string; span?: Span }
  | { k: 'ref'; ref: ResourceRef }
  | { k: 'chain'; chain: Chain }
  | { k: 'setop'; step: Step };

export interface TableExp {
  src: Head;
  as: string | null;
}

export interface SelectItem {
  k: 'col' | 'calc' | 'cols' | 'star';
  e?: FieldExpr;
  name?: string;
  calc?: Expr;
  kv?: Record<string, Expr>;
  q?: string;
}

/** One `| verb …` step. Verb-specific fields are optional and set by the parser. */
export interface Step {
  op: string;
  named: Record<string, NamedValue>;
  norder: string[];
  namedSpans: Record<string, Span>;
  span: Span;
  /** `#! id: …` pragma: the stable step id (node key). */
  id?: string;
  pragmas?: Record<string, string>;
  doc?: string[];
  // verb payloads
  cond?: Expr;
  items?: SelectItem[];
  derives?: Array<{ name: string; e: Expr; replace: boolean }>;
  keys?: SortKey[];
  n?: string;
  pct?: boolean;
  groupKeys?: Array<{ name: string; e: Expr | null; grain: string | null }>;
  aggs?: Array<{ name: string; e: Expr }>;
  kind?: string;
  table?: TableExp;
  on?: { k: 'keys'; keys: string[] } | { k: 'expr'; e: Expr } | null;
  lookupOn?: string[];
  get?: string[];
  tables?: TableExp[];
  branches?: Array<{ name: string; cond: Expr }>;
  else?: string | null;
  check?:
    | { kind: 'unique'; fields: string[] }
    | { kind: 'not_null'; fields: string[] }
    | { kind: 'rows'; cmp: string; n: number }
    | { kind: 'expr'; e: Expr };
  sql?: string;
  ref?: ResourceRef;
  casts?: Array<{ name: string; type: TypeRef; named: Record<string, Expr> }>;
  fills?: Array<{ name: string; with: string | Expr }>;
  fields?: string[];
  values?: Expr;
  which?: string;
  renames?: Array<
    { k: 'as'; from: string; to: string } | { k: 'prefix' | 'suffix'; v: string; fields: string[] }
  >;
  json?: boolean;
  field?: string;
  as?: string | null;
  axes?: Array<{ name: string; in: Expr | null }>;
  pivotValues?: Array<{ call: Expr; as: string | null }>;
  exclude?: boolean;
  into?: [string, string];
}

export interface Chain {
  head: Head;
  steps: Step[];
  span: Span;
}

export interface Source {
  alias: string;
  ref: ResourceRef;
  read: Record<string, Expr>;
  incr: { field: string; lookback: string | null } | null;
  span: Span;
  id?: string;
  pragmas?: Record<string, string>;
  doc?: string[];
}

export interface Flow {
  let: string | null;
  chain: Chain;
  span: Span;
  doc?: string[];
}

export interface Param {
  name: string;
  type: TypeRef;
  default: Expr | null;
}

export interface JflowFile {
  header: { name: string; meta: Record<string, Expr> } | null;
  params: Param[];
  sources: Source[];
  flows: Flow[];
}

export type JflowSeverity = 'error' | 'warning';

export interface JflowDiagnostic {
  code: string;
  severity: JflowSeverity;
  message: string;
  span?: Span;
  hint?: string;
  /** Auxiliary-node role when the diagnostic comes from a composite step. */
  role?: string;
  stepId?: string;
  /** One-click rewrite: replace `span` (a whole `| verb …` step) with `text`. */
  fix?: JflowFix;
}

export interface JflowFix {
  title: string;
  span: Span;
  /** Replacement steps, each starting with `| ` (drop the first pipe when the doc has none). */
  text: string;
}

export class JflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly span?: Span,
    readonly hint?: string,
    readonly fix?: JflowFix
  ) {
    super(`${code}: ${message}${hint ? `（建议：${hint}）` : ''}`);
    this.detail = message;
  }
  /** Message without code/hint decoration (diagnostics carry those separately). */
  readonly detail: string;
}
