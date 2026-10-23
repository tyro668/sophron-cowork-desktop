/**
 * jflow/1 parser (Chevrotain EmbeddedActionsParser → AST with source spans).
 *
 * Entry rules: `file` (whole pipeline), `steps` (one or more `| step`), `expr` (one expression).
 * The Lark grammar in the design doc is the reference; this file is the implementation.
 */
import { EmbeddedActionsParser, type IToken, type TokenType } from 'chevrotain';
import type {
  Chain,
  Expr,
  FieldExpr,
  Flow,
  Head,
  JflowFile,
  NamedItem,
  NamedValue,
  OverSpec,
  ResourceRef,
  SelectItem,
  SortKey,
  Source,
  Span,
  Step,
  TableExp,
  TypeRef,
} from './ast';
import {
  ALL_TOKENS,
  Cmp,
  Colon,
  Comma,
  Concat,
  Dot,
  DoubleQuoted,
  Duration,
  Eq,
  Field,
  FieldOpen,
  Ident,
  KW,
  LParen,
  Minus,
  NumberLit,
  Param,
  Percent,
  Pipe,
  Plus,
  RawString,
  RefKind,
  RParen,
  Slash,
  Star,
  StringLit,
} from './lexer';

export function unfield(image: string): string {
  return image.slice(1, -1).replace(/\]\]/g, ']');
}
export function unstr(image: string): string {
  return image.slice(1, -1).replace(/''/g, "'");
}

/** Named-argument keys whose value is one expression (never an alias/projection list). */
const EXPR_KEYS = new Set(['match', 'fill', 'message', 'tolerance']);
/** Keys whose value is a comma list (fields / sort keys / projection / names). */
const LIST_KEYS = new Set(['per', 'sort', 'by', 'keep', 'keys', 'fields', 'index', 'inputs']);

const k = (word: string): TokenType => KW[word];

class JflowParser extends EmbeddedActionsParser {
  /** Key of the named argument being parsed (drives list-vs-single value parsing). */
  private curKey = '';
  /** `case … end` sites seen in the last parse (case is removed: reported with an if/elseif fix). */
  caseSites: Array<{ start: number; end: number; expr: Expr }> = [];

  constructor() {
    super(ALL_TOKENS, { maxLookahead: 4, recoveryEnabled: false, skipValidations: true });
    this.performSelfAnalysis();
  }

  private span(start: IToken): Span {
    return this.ACTION(() => ({
      start: start.startOffset,
      end: (this.LA(0).endOffset ?? start.endOffset ?? 0) + 1,
    }));
  }

  // ---------------------------------------------------------------- file
  public file = this.RULE('file', (): JflowFile => {
    const out: JflowFile = { header: null, params: [], sources: [], flows: [] };
    this.OPTION(() => {
      const h = this.SUBRULE(this.header);
      this.ACTION(() => (out.header = h));
    });
    this.MANY(() => {
      this.OR([
        {
          ALT: () => {
            const p = this.SUBRULE(this.param);
            this.ACTION(() => out.params.push(p));
          },
        },
        {
          ALT: () => {
            const s = this.SUBRULE(this.source);
            this.ACTION(() => out.sources.push(s));
          },
        },
        {
          ALT: () => {
            const f = this.SUBRULE(this.flow);
            this.ACTION(() => out.flows.push(f));
          },
        },
      ]);
    });
    return out;
  });

  public steps = this.RULE('steps', (): Step[] => {
    const out: Step[] = [];
    this.AT_LEAST_ONE(() => {
      const s = this.SUBRULE(this.pipedStep);
      this.ACTION(() => out.push(s));
    });
    return out;
  });

  private header = this.RULE('header', () => {
    this.CONSUME(k('pipeline'));
    const name = this.SUBRULE(this.name);
    let meta: Record<string, Expr> = {};
    this.OPTION(() => {
      this.CONSUME(LParen);
      meta = this.SUBRULE(this.kvList);
      this.CONSUME(RParen);
    });
    return { name, meta };
  });

  private kvList = this.RULE('kvList', (): Record<string, Expr> => {
    const out: Record<string, Expr> = {};
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const key = this.SUBRULE(this.name);
        this.CONSUME(Colon);
        const v = this.SUBRULE(this.kvValue);
        this.ACTION(() => (out[key] = v));
      },
    });
    return out;
  });

  private kvValue = this.RULE('kvValue', (): Expr =>
    this.OR([
      { ALT: () => this.SUBRULE(this.literal) },
      {
        ALT: () => {
          const t = this.CONSUME(Ident);
          return this.ACTION(() => ({ k: 'enum', v: t.image }) as Expr);
        },
      },
      { ALT: () => this.SUBRULE(this.listish) },
    ])
  );

  private name = this.RULE('name', (): string => this.CONSUME(Ident).image);

  private param = this.RULE('param', () => {
    this.CONSUME(k('param'));
    const p = this.CONSUME(Param);
    this.CONSUME(Colon);
    const type = this.SUBRULE(this.typeRef);
    let def: Expr | null = null;
    this.OPTION(() => {
      this.CONSUME(Eq);
      def = this.SUBRULE(this.expr);
    });
    return this.ACTION(() => ({ name: p.image.slice(1), type, default: def }));
  });

  private source = this.RULE('source', (): Source => {
    const start = this.CONSUME(k('source'));
    const alias = this.SUBRULE(this.name);
    this.CONSUME(Eq);
    const ref = this.SUBRULE(this.ref);
    let read: Record<string, Expr> = {};
    let incr: Source['incr'] = null;
    this.OPTION(() => {
      this.CONSUME(k('with'));
      this.CONSUME(LParen);
      read = this.SUBRULE(this.kvList);
      this.CONSUME(RParen);
    });
    this.OPTION2(() => {
      this.CONSUME(k('incremental'));
      this.CONSUME(Colon);
      const f = this.SUBRULE(this.field);
      let lookback: string | null = null;
      this.OPTION3(() => {
        this.CONSUME(k('lookback'));
        this.CONSUME2(Colon);
        lookback = this.CONSUME(Duration).image;
      });
      this.ACTION(() => (incr = { field: f.name, lookback }));
    });
    const span = this.span(start);
    return { alias, ref, read, incr, span };
  });

  private ref = this.RULE('ref', (): ResourceRef => {
    const kind = this.CONSUME(RefKind);
    this.CONSUME(LParen);
    const arg = this.CONSUME(StringLit);
    const out = this.ACTION(
      () =>
        ({
          form: kind.image as ResourceRef['form'],
          arg: unstr(arg.image),
          snap: null,
          opts: {},
        }) as ResourceRef
    );
    this.MANY(() => {
      this.CONSUME(Comma);
      this.OR([
        {
          ALT: () => {
            const s = this.CONSUME2(StringLit);
            this.ACTION(() => (out.snap = unstr(s.image)));
          },
        },
        {
          ALT: () => {
            const key = this.SUBRULE(this.name);
            this.CONSUME(Colon);
            const v = this.SUBRULE(this.kvValue);
            this.ACTION(() => (out.opts[key] = v));
          },
        },
      ]);
    });
    this.CONSUME(RParen);
    this.ACTION(() => (out.span = { start: kind.startOffset, end: this.LA(0).endOffset! + 1 }));
    return out;
  });

  private flow = this.RULE('flow', (): Flow => {
    const first = this.LA(1);
    let letName: string | null = null;
    this.OPTION(() => {
      this.CONSUME(k('let'));
      letName = this.SUBRULE(this.name);
      this.CONSUME(Eq);
    });
    const chain = this.SUBRULE(this.chain);
    const span = this.span(first);
    return { let: letName, chain, span };
  });

  private chain = this.RULE('chain', (): Chain => {
    const first = this.LA(1);
    const head = this.SUBRULE(this.head);
    const steps: Step[] = [];
    this.MANY(() => {
      const s = this.SUBRULE(this.pipedStep);
      this.ACTION(() => steps.push(s));
    });
    const span = this.span(first);
    return { head, steps, span };
  });

  private head = this.RULE('head', (): Head =>
    this.OR([
      {
        ALT: () => {
          const t = this.CONSUME(Ident);
          return this.ACTION(
            () =>
              ({
                k: 'name',
                v: t.image,
                span: { start: t.startOffset, end: t.endOffset! + 1 },
              }) as Head
          );
        },
        GATE: () => !SETOP_TOKENS.has(this.LA(1).tokenType),
      },
      {
        ALT: () => {
          const r = this.SUBRULE(this.ref);
          return this.ACTION(() => ({ k: 'ref', ref: r }) as Head);
        },
      },
      {
        ALT: () => {
          this.CONSUME(LParen);
          const c = this.SUBRULE(this.chain);
          this.CONSUME(RParen);
          return this.ACTION(() => ({ k: 'chain', chain: c }) as Head);
        },
      },
      {
        ALT: () => {
          const s = this.SUBRULE(this.setopStep);
          return this.ACTION(() => ({ k: 'setop', step: s }) as Head);
        },
      },
    ])
  );

  private tableExp = this.RULE('tableExp', (): TableExp => {
    const src = this.OR([
      {
        ALT: () => {
          const t = this.CONSUME(Ident);
          return this.ACTION(
            () =>
              ({
                k: 'name',
                v: t.image,
                span: { start: t.startOffset, end: t.endOffset! + 1 },
              }) as Head
          );
        },
      },
      {
        ALT: () => {
          const r = this.SUBRULE(this.ref);
          return this.ACTION(() => ({ k: 'ref', ref: r }) as Head);
        },
      },
      {
        ALT: () => {
          this.CONSUME(LParen);
          const c = this.SUBRULE(this.chain);
          this.CONSUME(RParen);
          return this.ACTION(() => ({ k: 'chain', chain: c }) as Head);
        },
      },
    ]);
    let as: string | null = null;
    this.OPTION(() => {
      this.CONSUME(k('as'));
      as = this.SUBRULE(this.name);
    });
    return { src, as };
  });

  // ---------------------------------------------------------------- steps
  private pipedStep = this.RULE('pipedStep', (): Step => {
    const pipe = this.CONSUME(Pipe);
    const s = this.SUBRULE(this.step);
    this.ACTION(() => (s.span = { start: pipe.startOffset, end: this.LA(0).endOffset! + 1 }));
    return s;
  });

  private newStep(op: string): Step {
    return { op, named: {}, norder: [], namedSpans: {}, span: { start: 0, end: 0 } };
  }

  private namedArgs = this.RULE('namedArgs', (s: Step) => {
    this.MANY({
      GATE: () => this.LA(2).tokenType === Colon,
      DEF: () => {
        const keyTok = this.CONSUME(Ident);
        this.ACTION(() => (this.curKey = keyTok.image));
        this.CONSUME(Colon);
        const v = this.SUBRULE(this.namedValue);
        this.ACTION(() => {
          if (s.named[keyTok.image] !== undefined) {
            throw Object.assign(new Error(`duplicate named argument ${keyTok.image}:`), {
              jflowCode: 'E_ARG_DUP',
              token: keyTok,
            });
          }
          s.named[keyTok.image] = v;
          s.norder.push(keyTok.image);
          s.namedSpans[keyTok.image] = {
            start: keyTok.startOffset,
            end: this.LA(0).endOffset! + 1,
          };
        });
      },
    });
  });

  private namedValue = this.RULE('namedValue', (): NamedValue => {
    const items: NamedItem[] = [];
    const first = this.SUBRULE(this.namedItem);
    this.ACTION(() => items.push(first));
    this.MANY({
      GATE: () =>
        LIST_KEYS.has(this.curKey) &&
        !(this.LA(3).tokenType === Colon && this.LA(2).tokenType !== Field),
      DEF: () => {
        this.CONSUME(Comma);
        const it = this.SUBRULE2(this.namedItem);
        this.ACTION(() => items.push(it));
      },
    });
    return { k: 'items', items };
  });

  private namedItem = this.RULE('namedItem', (): NamedItem =>
    this.OR([
      {
        GATE: () => this.LA(2).tokenType === Dot && this.LA(3).tokenType === Star,
        ALT: () => {
          const q = this.CONSUME(Field);
          this.CONSUME(Dot);
          this.CONSUME(Star);
          return this.ACTION(() => ({ k: 'star', q: unfield(q.image) }) as NamedItem);
        },
      },
      {
        GATE: () => !EXPR_KEYS.has(this.curKey) && this.LA(2).tokenType === Eq,
        ALT: () => {
          const f = this.CONSUME2(Field);
          this.CONSUME(Eq);
          const e = this.SUBRULE(this.expr);
          return this.ACTION(() => ({ k: 'alias', name: unfield(f.image), e }) as NamedItem);
        },
      },
      {
        ALT: () => {
          const e = this.OR2([
            {
              GATE: () => this.LA(2).tokenType !== LParen,
              ALT: () => {
                const t = this.CONSUME(Ident);
                return this.ACTION(() => ({ k: 'enum', v: t.image }) as Expr);
              },
            },
            { ALT: () => this.SUBRULE2(this.expr) },
          ]);
          let nulls: 'first' | 'last' | null = null;
          this.OPTION(() => {
            this.CONSUME(k('nulls'));
            this.CONSUME(Colon);
            nulls = this.OR3([
              { ALT: () => this.CONSUME(k('first')).image as 'first' },
              { ALT: () => this.CONSUME(k('last')).image as 'last' },
            ]);
          });
          return this.ACTION(() => ({ k: 'expr', e, nulls }) as NamedItem);
        },
      },
    ])
  );

  private step = this.RULE('step', (): Step =>
    this.OR([
      { ALT: () => this.SUBRULE(this.whereStep) },
      { ALT: () => this.SUBRULE(this.selectStep) },
      { ALT: () => this.SUBRULE(this.dropStep) },
      { ALT: () => this.SUBRULE(this.deriveStep) },
      { ALT: () => this.SUBRULE(this.renameStep) },
      { ALT: () => this.SUBRULE(this.castStep) },
      { ALT: () => this.SUBRULE(this.fillStep) },
      { ALT: () => this.SUBRULE(this.nullifyStep) },
      { ALT: () => this.SUBRULE(this.dropEmptyStep) },
      { ALT: () => this.SUBRULE(this.sortStep) },
      { ALT: () => this.SUBRULE(this.takeStep) },
      { ALT: () => this.SUBRULE(this.distinctStep) },
      { ALT: () => this.SUBRULE(this.groupStep) },
      { ALT: () => this.SUBRULE(this.pivotStep) },
      { ALT: () => this.SUBRULE(this.unpivotStep) },
      { ALT: () => this.SUBRULE(this.unnestStep) },
      { ALT: () => this.SUBRULE(this.joinStep) },
      { ALT: () => this.SUBRULE(this.lookupStep) },
      { ALT: () => this.SUBRULE(this.setopStep) },
      { ALT: () => this.SUBRULE(this.splitStep) },
      { ALT: () => this.SUBRULE(this.checkStep) },
      { ALT: () => this.SUBRULE(this.sqlStep) },
      { ALT: () => this.SUBRULE(this.passStep) },
      { ALT: () => this.SUBRULE(this.writeStep) },
    ])
  );

  private whereStep = this.RULE('whereStep', () => {
    this.CONSUME(k('where'));
    const s = this.ACTION(() => this.newStep('where'));
    const cond = this.SUBRULE(this.expr);
    this.ACTION(() => (s.cond = cond));
    return s;
  });

  private selectItem = this.RULE('selectItem', (): SelectItem =>
    this.OR([
      {
        ALT: () => {
          const c = this.SUBRULE(this.colsel);
          return this.ACTION(() => ({ k: 'cols', kv: c }) as SelectItem);
        },
      },
      {
        GATE: () => this.LA(2).tokenType === Dot && this.LA(3).tokenType === Star,
        ALT: () => {
          const q = this.CONSUME(Field);
          this.CONSUME(Dot);
          this.CONSUME(Star);
          return this.ACTION(() => ({ k: 'star', q: unfield(q.image) }) as SelectItem);
        },
      },
      {
        GATE: () => this.LA(2).tokenType === Eq,
        ALT: () => {
          const f = this.CONSUME2(Field);
          this.CONSUME(Eq);
          const e = this.SUBRULE(this.expr);
          return this.ACTION(() => ({ k: 'calc', name: unfield(f.image), calc: e }) as SelectItem);
        },
      },
      {
        ALT: () => {
          const f = this.SUBRULE(this.field);
          return this.ACTION(() => ({ k: 'col', e: f }) as SelectItem);
        },
      },
    ])
  );

  private colsel = this.RULE('colsel', () => {
    this.CONSUME(k('cols'));
    this.CONSUME(LParen);
    const kv = this.SUBRULE(this.kvList);
    this.CONSUME(RParen);
    return kv;
  });

  private selectStep = this.RULE('selectStep', () => {
    this.CONSUME(k('select'));
    const s = this.ACTION(() => this.newStep('select'));
    const items: SelectItem[] = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const it = this.SUBRULE(this.selectItem);
        this.ACTION(() => items.push(it));
      },
    });
    this.ACTION(() => (s.items = items));
    return s;
  });

  private dropStep = this.RULE('dropStep', () => {
    this.CONSUME(k('drop'));
    const s = this.ACTION(() => this.newStep('drop'));
    const items: SelectItem[] = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const it = this.OR([
          {
            ALT: () => {
              const c = this.SUBRULE(this.colsel);
              return this.ACTION(() => ({ k: 'cols', kv: c }) as SelectItem);
            },
          },
          {
            ALT: () => {
              const f = this.SUBRULE(this.field);
              return this.ACTION(() => ({ k: 'col', e: f }) as SelectItem);
            },
          },
        ]);
        this.ACTION(() => items.push(it));
      },
    });
    this.ACTION(() => (s.items = items));
    return s;
  });

  private deriveStep = this.RULE('deriveStep', () => {
    this.CONSUME(k('derive'));
    const s = this.ACTION(() => this.newStep('derive'));
    const items: NonNullable<Step['derives']> = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        let replace = false;
        this.OPTION(() => {
          this.CONSUME(k('replace'));
          replace = true;
        });
        const f = this.CONSUME(Field);
        this.CONSUME(Eq);
        const e = this.SUBRULE(this.expr);
        this.ACTION(() => items.push({ name: unfield(f.image), e, replace }));
      },
    });
    this.ACTION(() => (s.derives = items));
    return s;
  });

  private renameStep = this.RULE('renameStep', () => {
    this.CONSUME(k('rename'));
    const s = this.ACTION(() => this.newStep('rename'));
    const items: NonNullable<Step['renames']> = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        this.OR([
          {
            ALT: () => {
              const a = this.CONSUME(Field);
              this.CONSUME(k('as'));
              const b = this.CONSUME2(Field);
              this.ACTION(() =>
                items.push({ k: 'as', from: unfield(a.image), to: unfield(b.image) })
              );
            },
          },
          {
            ALT: () => {
              const affix = this.OR2([
                { ALT: () => this.CONSUME(k('prefix')).image },
                { ALT: () => this.CONSUME(k('suffix')).image },
              ]);
              const v = this.CONSUME(StringLit);
              this.CONSUME(LParen);
              const fields: string[] = [];
              this.AT_LEAST_ONE_SEP2({
                SEP: Comma,
                DEF: () => {
                  const f = this.CONSUME3(Field);
                  this.ACTION(() => fields.push(unfield(f.image)));
                },
              });
              this.CONSUME(RParen);
              this.ACTION(() =>
                items.push({ k: affix as 'prefix' | 'suffix', v: unstr(v.image), fields })
              );
            },
          },
        ]);
      },
    });
    this.ACTION(() => (s.renames = items));
    return s;
  });

  private castStep = this.RULE('castStep', () => {
    this.CONSUME(k('cast'));
    const s = this.ACTION(() => this.newStep('cast'));
    const items: NonNullable<Step['casts']> = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const f = this.CONSUME(Field);
        this.CONSUME(k('as'));
        const type = this.SUBRULE(this.typeRef);
        const holder = this.ACTION(() => this.newStep('cast-item'));
        this.SUBRULE(this.namedArgs, { ARGS: [holder] });
        this.ACTION(() => {
          const named: Record<string, Expr> = {};
          for (const key of holder.norder) {
            const v = holder.named[key];
            if (v.k === 'items' && v.items[0]?.k === 'expr') named[key] = v.items[0].e;
          }
          items.push({ name: unfield(f.image), type, named });
          (s as Step & { castNamed?: Step[] }).castNamed = [
            ...((s as Step & { castNamed?: Step[] }).castNamed ?? []),
            holder,
          ];
        });
      },
    });
    this.ACTION(() => (s.casts = items));
    return s;
  });

  private fillStep = this.RULE('fillStep', () => {
    this.CONSUME(k('fill'));
    const s = this.ACTION(() => this.newStep('fill'));
    const items: NonNullable<Step['fills']> = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const f = this.CONSUME(Field);
        this.CONSUME(k('with'));
        const w = this.OR([
          { ALT: () => this.CONSUME(k('mean')).image as string | Expr },
          { ALT: () => this.CONSUME(k('median')).image as string | Expr },
          {
            GATE: () => this.LA(2).tokenType !== LParen,
            ALT: () => this.CONSUME(k('mode')).image as string | Expr,
          },
          { ALT: () => this.CONSUME(k('forward')).image as string | Expr },
          { ALT: () => this.CONSUME(k('backward')).image as string | Expr },
          { ALT: () => this.SUBRULE(this.expr) as string | Expr },
        ]);
        this.ACTION(() => items.push({ name: unfield(f.image), with: w }));
      },
    });
    this.ACTION(() => (s.fills = items));
    return s;
  });

  private nullifyStep = this.RULE('nullifyStep', () => {
    this.CONSUME(k('nullify'));
    const s = this.ACTION(() => this.newStep('nullify'));
    const fields: string[] = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const f = this.CONSUME(Field);
        this.ACTION(() => fields.push(unfield(f.image)));
      },
    });
    this.CONSUME(k('values'));
    const lst = this.SUBRULE(this.listish);
    this.ACTION(() => {
      s.fields = fields;
      s.values = lst.k === 'paren' ? { k: 'list', items: [lst.e] } : lst;
    });
    return s;
  });

  private dropEmptyStep = this.RULE('dropEmptyStep', () => {
    this.CONSUME(k('drop_empty'));
    const s = this.ACTION(() => this.newStep('drop_empty'));
    const which = this.OR([
      { ALT: () => this.CONSUME(k('all')).image },
      { ALT: () => this.CONSUME(k('any')).image },
    ]);
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => (s.which = which));
    return s;
  });

  private sortKey = this.RULE('sortKey', (): SortKey => {
    let desc = false;
    this.OPTION(() => {
      this.CONSUME(Minus);
      desc = true;
    });
    const f = this.SUBRULE(this.field);
    let nulls: 'first' | 'last' | null = null;
    this.OPTION2(() => {
      this.CONSUME(k('nulls'));
      this.CONSUME(Colon);
      nulls = this.OR([
        { ALT: () => this.CONSUME(k('first')).image as 'first' },
        { ALT: () => this.CONSUME(k('last')).image as 'last' },
      ]);
    });
    return { desc, field: f, nulls };
  });

  private sortStep = this.RULE('sortStep', () => {
    this.CONSUME(k('sort'));
    const s = this.ACTION(() => this.newStep('sort'));
    const keys: SortKey[] = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const key = this.SUBRULE(this.sortKey);
        this.ACTION(() => keys.push(key));
      },
    });
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => (s.keys = keys));
    return s;
  });

  private takeStep = this.RULE('takeStep', () => {
    const op = this.OR([
      { ALT: () => this.CONSUME(k('take')).image },
      { ALT: () => this.CONSUME(k('sample')).image },
    ]);
    const s = this.ACTION(() => this.newStep(op));
    const n = this.CONSUME(NumberLit);
    let pct = false;
    this.OPTION(() => {
      this.CONSUME(Percent);
      pct = true;
    });
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => {
      s.n = n.image.replace(/_/g, '');
      s.pct = pct;
    });
    return s;
  });

  private distinctStep = this.RULE('distinctStep', () => {
    this.CONSUME(k('distinct'));
    const s = this.ACTION(() => this.newStep('distinct'));
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    return s;
  });

  private groupStep = this.RULE('groupStep', () => {
    this.CONSUME(k('group'));
    const s = this.ACTION(() => this.newStep('group'));
    const keys: NonNullable<Step['groupKeys']> = [];
    const aggs: NonNullable<Step['aggs']> = [];
    this.MANY_SEP({
      SEP: Comma,
      DEF: () => {
        const f = this.CONSUME(Field);
        let e: Expr | null = null;
        let grain: string | null = null;
        this.OPTION(() => {
          this.CONSUME(Eq);
          e = this.SUBRULE(this.expr);
        });
        this.OPTION2(() => {
          this.CONSUME(k('grain'));
          this.CONSUME(Colon);
          grain = this.SUBRULE(this.name);
        });
        this.ACTION(() => keys.push({ name: unfield(f.image), e, grain }));
      },
    });
    this.CONSUME(LParen);
    this.CONSUME(k('agg'));
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const f = this.CONSUME2(Field);
        this.CONSUME2(Eq);
        const e = this.SUBRULE2(this.expr);
        this.ACTION(() => aggs.push({ name: unfield(f.image), e }));
      },
    });
    this.CONSUME(RParen);
    this.ACTION(() => {
      s.groupKeys = keys;
      s.aggs = aggs;
    });
    return s;
  });

  private pivotStep = this.RULE('pivotStep', () => {
    this.CONSUME(k('pivot'));
    const s = this.ACTION(() => this.newStep('pivot'));
    const axes: NonNullable<Step['axes']> = [];
    const values: NonNullable<Step['pivotValues']> = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const f = this.CONSUME(Field);
        let inList: Expr | null = null;
        this.OPTION(() => {
          this.CONSUME(k('in'));
          const l = this.SUBRULE(this.listish);
          inList = this.ACTION(() =>
            l.k === 'list' ? l : ({ k: 'list', items: [(l as { e: Expr }).e] } as Expr)
          );
        });
        this.ACTION(() => axes.push({ name: unfield(f.image), in: inList }));
      },
    });
    this.CONSUME(k('values'));
    this.CONSUME(Colon);
    this.AT_LEAST_ONE_SEP2({
      SEP: Comma,
      DEF: () => {
        const call = this.SUBRULE(this.expr);
        let as: string | null = null;
        this.OPTION2(() => {
          this.CONSUME(k('as'));
          as = unfield(this.CONSUME2(Field).image);
        });
        this.ACTION(() => values.push({ call, as }));
      },
    });
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => {
      s.axes = axes;
      s.pivotValues = values;
    });
    return s;
  });

  private unpivotStep = this.RULE('unpivotStep', () => {
    this.CONSUME(k('unpivot'));
    const s = this.ACTION(() => this.newStep('unpivot'));
    let exclude = false;
    this.OPTION(() => {
      this.CONSUME(k('exclude'));
      exclude = true;
    });
    const fields: string[] = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const f = this.CONSUME(Field);
        this.ACTION(() => fields.push(unfield(f.image)));
      },
    });
    this.CONSUME(k('into'));
    this.CONSUME(Colon);
    this.CONSUME(LParen);
    const a = this.CONSUME2(Field);
    this.CONSUME2(Comma);
    const b = this.CONSUME3(Field);
    this.CONSUME(RParen);
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => {
      s.exclude = exclude;
      s.fields = fields;
      s.into = [unfield(a.image), unfield(b.image)];
    });
    return s;
  });

  private unnestStep = this.RULE('unnestStep', () => {
    this.CONSUME(k('unnest'));
    const s = this.ACTION(() => this.newStep('unnest'));
    let json = false;
    this.OPTION(() => {
      this.CONSUME(k('json'));
      json = true;
    });
    const f = this.CONSUME(Field);
    let as: string | null = null;
    this.OPTION2(() => {
      this.CONSUME(k('as'));
      as = unfield(this.CONSUME2(Field).image);
    });
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => {
      s.json = json;
      s.field = unfield(f.image);
      s.as = as;
    });
    return s;
  });

  private joinStep = this.RULE('joinStep', () => {
    this.CONSUME(k('join'));
    const kind = this.OR([
      { ALT: () => this.CONSUME(k('inner')).image },
      { ALT: () => this.CONSUME(k('left')).image },
      { ALT: () => this.CONSUME(k('right')).image },
      { ALT: () => this.CONSUME(k('full')).image },
      { ALT: () => this.CONSUME(k('cross')).image },
      { ALT: () => this.CONSUME(k('semi')).image },
      { ALT: () => this.CONSUME(k('anti')).image },
      { ALT: () => this.CONSUME(k('asof')).image },
    ]);
    const s = this.ACTION(() => this.newStep('join'));
    const table = this.SUBRULE(this.tableExp);
    const conds: Expr[] = [];
    this.OPTION(() => {
      this.CONSUME(k('on'));
      this.AT_LEAST_ONE_SEP({
        SEP: Comma,
        DEF: () => {
          const e = this.SUBRULE(this.expr);
          this.ACTION(() => conds.push(e));
        },
      });
    });
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => {
      s.kind = kind;
      s.table = table;
      s.on = conds.length === 0 ? null : joinCondition(conds);
    });
    return s;
  });

  private lookupStep = this.RULE('lookupStep', () => {
    this.CONSUME(k('lookup'));
    const s = this.ACTION(() => this.newStep('lookup'));
    const table = this.SUBRULE(this.tableExp);
    this.CONSUME(k('on'));
    const on: string[] = [];
    const get: string[] = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const f = this.CONSUME(Field);
        this.ACTION(() => on.push(unfield(f.image)));
      },
    });
    this.CONSUME(k('get'));
    this.AT_LEAST_ONE_SEP2({
      SEP: Comma,
      DEF: () => {
        const f = this.CONSUME2(Field);
        this.ACTION(() => get.push(unfield(f.image)));
      },
    });
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => {
      s.table = table;
      s.lookupOn = on;
      s.get = get;
    });
    return s;
  });

  private setopStep = this.RULE('setopStep', () => {
    const op = this.OR([
      { ALT: () => this.CONSUME(k('union')).image },
      { ALT: () => this.CONSUME(k('intersect')).image },
      { ALT: () => this.CONSUME(k('except')).image },
    ]);
    const s = this.ACTION(() => this.newStep(op));
    const tables: TableExp[] = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const t = this.SUBRULE(this.tableExp);
        this.ACTION(() => tables.push(t));
      },
    });
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => (s.tables = tables));
    return s;
  });

  private splitStep = this.RULE('splitStep', () => {
    this.CONSUME(k('split'));
    const s = this.ACTION(() => this.newStep('split'));
    const branches: NonNullable<Step['branches']> = [];
    let elseName: string | null = null;
    const b = () => {
      const n = this.SUBRULE(this.name);
      this.CONSUME(k('when'));
      const cond = this.SUBRULE(this.expr);
      this.ACTION(() => branches.push({ name: n, cond }));
    };
    b();
    this.MANY(() => {
      this.CONSUME(Comma);
      this.OR([
        {
          ALT: () => {
            this.CONSUME(k('else'));
            elseName = this.SUBRULE2(this.name);
          },
        },
        {
          ALT: () => {
            const n = this.SUBRULE3(this.name);
            this.CONSUME2(k('when'));
            const cond = this.SUBRULE2(this.expr);
            this.ACTION(() => branches.push({ name: n, cond }));
          },
        },
      ]);
    });
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => {
      s.branches = branches;
      s.else = elseName;
    });
    return s;
  });

  private checkStep = this.RULE('checkStep', () => {
    this.CONSUME(k('check'));
    const s = this.ACTION(() => this.newStep('check'));
    const fieldList = (): string[] => {
      const out: string[] = [];
      this.AT_LEAST_ONE_SEP({
        SEP: Comma,
        DEF: () => {
          const f = this.CONSUME(Field);
          this.ACTION(() => out.push(unfield(f.image)));
        },
      });
      return out;
    };
    this.OR([
      {
        ALT: () => {
          this.CONSUME(k('unique'));
          const fields = fieldList();
          this.ACTION(() => (s.check = { kind: 'unique', fields }));
        },
      },
      {
        ALT: () => {
          this.CONSUME(k('not_null'));
          const out: string[] = [];
          this.AT_LEAST_ONE_SEP2({
            SEP: Comma,
            DEF: () => {
              const f = this.CONSUME2(Field);
              this.ACTION(() => out.push(unfield(f.image)));
            },
          });
          this.ACTION(() => (s.check = { kind: 'not_null', fields: out }));
        },
      },
      {
        ALT: () => {
          this.CONSUME(k('rows'));
          const cmp = this.CONSUME(Cmp);
          const n = this.CONSUME(NumberLit);
          this.ACTION(() => (s.check = { kind: 'rows', cmp: cmp.image, n: Number(n.image) }));
        },
      },
      {
        ALT: () => {
          const e = this.SUBRULE(this.expr);
          this.ACTION(() => (s.check = { kind: 'expr', e }));
        },
      },
    ]);
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    return s;
  });

  private sqlStep = this.RULE('sqlStep', () => {
    this.CONSUME(k('sql'));
    const s = this.ACTION(() => this.newStep('sql'));
    const body = this.CONSUME(RawString);
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => (s.sql = body.image.slice(3, -3)));
    return s;
  });

  private passStep = this.RULE('passStep', () => {
    this.CONSUME(k('pass'));
    return this.ACTION(() => this.newStep('pass'));
  });

  private writeStep = this.RULE('writeStep', () => {
    this.CONSUME(k('write'));
    const s = this.ACTION(() => this.newStep('write'));
    const ref = this.SUBRULE(this.ref);
    this.SUBRULE(this.namedArgs, { ARGS: [s] });
    this.ACTION(() => (s.ref = ref));
    return s;
  });

  // ---------------------------------------------------------------- expressions
  public expr = this.RULE('expr', (): Expr => this.SUBRULE(this.orExpr));

  private orExpr = this.RULE('orExpr', (): Expr => {
    let acc = this.SUBRULE(this.andExpr);
    this.MANY(() => {
      this.CONSUME(k('or'));
      const r = this.SUBRULE2(this.andExpr);
      acc = this.ACTION(() => ({ k: 'bin', op: 'or', l: acc, r }) as Expr);
    });
    return acc;
  });

  private andExpr = this.RULE('andExpr', (): Expr => {
    let acc = this.SUBRULE(this.notExpr);
    this.MANY(() => {
      this.CONSUME(k('and'));
      const r = this.SUBRULE2(this.notExpr);
      acc = this.ACTION(() => ({ k: 'bin', op: 'and', l: acc, r }) as Expr);
    });
    return acc;
  });

  private notExpr = this.RULE('notExpr', (): Expr =>
    this.OR([
      {
        ALT: () => {
          this.CONSUME(k('not'));
          const e = this.SUBRULE(this.notExpr);
          return this.ACTION(() => ({ k: 'not', e }) as Expr);
        },
      },
      { ALT: () => this.SUBRULE(this.predicate) },
    ])
  );

  private predicate = this.RULE('predicate', (): Expr => {
    let acc = this.SUBRULE(this.concatExpr);
    this.MANY(() => {
      this.OR([
        {
          ALT: () => {
            const op = this.CONSUME(Cmp);
            const r = this.SUBRULE2(this.concatExpr);
            acc = this.ACTION(() => {
              const o = op.image === '!=' ? '<>' : op.image;
              if (r.k === 'lit' && r.t === 'null' && (o === '=' || o === '<>')) {
                return { k: 'isnull', e: acc, not: o !== '=' } as Expr;
              }
              return { k: 'bin', op: o, l: acc, r } as Expr;
            });
          },
        },
        {
          ALT: () => {
            this.CONSUME(k('is'));
            let not = false;
            this.OPTION(() => {
              this.CONSUME(k('not'));
              not = true;
            });
            this.OR2([
              {
                ALT: () => {
                  this.CONSUME(k('null'));
                  acc = this.ACTION(() => ({ k: 'isnull', e: acc, not }) as Expr);
                },
              },
              {
                ALT: () => {
                  this.CONSUME(k('distinct'));
                  this.CONSUME(Ident); // from
                  const r = this.SUBRULE3(this.concatExpr);
                  acc = this.ACTION(() => ({ k: 'isdistinct', l: acc, r, not }) as Expr);
                },
              },
            ]);
          },
        },
        {
          ALT: () => {
            let not = false;
            this.OPTION2(() => {
              this.CONSUME2(k('not'));
              not = true;
            });
            this.OR3([
              {
                ALT: () => {
                  this.CONSUME(k('in'));
                  const list = this.OR4([
                    {
                      ALT: () => {
                        const p = this.CONSUME(Param);
                        return this.ACTION(() => ({ k: 'param', v: p.image.slice(1) }) as Expr);
                      },
                    },
                    {
                      ALT: () => {
                        const l = this.SUBRULE(this.listish);
                        return this.ACTION(() =>
                          l.k === 'paren' ? ({ k: 'list', items: [l.e] } as Expr) : l
                        );
                      },
                    },
                  ]);
                  acc = this.ACTION(() => ({ k: 'in', e: acc, not, list }) as Expr);
                },
              },
              {
                ALT: () => {
                  this.CONSUME(k('between'));
                  const lo = this.SUBRULE4(this.concatExpr);
                  this.CONSUME2(k('and'));
                  const hi = this.SUBRULE5(this.concatExpr);
                  acc = this.ACTION(() => ({ k: 'between', e: acc, not, lo, hi }) as Expr);
                },
              },
              {
                ALT: () => {
                  const op = this.OR5([
                    { ALT: () => this.CONSUME(k('like')).image },
                    { ALT: () => this.CONSUME(k('ilike')).image },
                    { ALT: () => this.CONSUME(k('matches')).image },
                  ]);
                  const r = this.SUBRULE6(this.concatExpr);
                  acc = this.ACTION(() => ({ k: 'like', op, not, l: acc, r }) as Expr);
                },
              },
            ]);
          },
        },
      ]);
    });
    return acc;
  });

  private concatExpr = this.RULE('concatExpr', (): Expr => {
    let acc = this.SUBRULE(this.addExpr);
    this.MANY(() => {
      this.CONSUME(Concat);
      const r = this.SUBRULE2(this.addExpr);
      acc = this.ACTION(() => ({ k: 'bin', op: '||', l: acc, r }) as Expr);
    });
    return acc;
  });

  private addExpr = this.RULE('addExpr', (): Expr => {
    let acc = this.SUBRULE(this.mulExpr);
    this.MANY(() => {
      const op = this.OR([{ ALT: () => this.CONSUME(Plus) }, { ALT: () => this.CONSUME(Minus) }]);
      const r = this.SUBRULE2(this.mulExpr);
      acc = this.ACTION(() => ({ k: 'bin', op: op.image, l: acc, r }) as Expr);
    });
    return acc;
  });

  private mulExpr = this.RULE('mulExpr', (): Expr => {
    let acc = this.SUBRULE(this.unary);
    this.MANY(() => {
      const op = this.OR([
        { ALT: () => this.CONSUME(Star) },
        { ALT: () => this.CONSUME(Slash) },
        { ALT: () => this.CONSUME(Percent) },
      ]);
      const r = this.SUBRULE2(this.unary);
      acc = this.ACTION(() => ({ k: 'bin', op: op.image, l: acc, r }) as Expr);
    });
    return acc;
  });

  private unary = this.RULE('unary', (): Expr =>
    this.OR([
      {
        ALT: () => {
          this.CONSUME(Minus);
          const e = this.SUBRULE(this.unary);
          return this.ACTION(() => ({ k: 'neg', e }) as Expr);
        },
      },
      {
        ALT: () => {
          this.CONSUME(Plus);
          return this.SUBRULE2(this.unary);
        },
      },
      {
        ALT: () => {
          this.CONSUME(k('not'));
          const e = this.SUBRULE3(this.unary);
          return this.ACTION(() => ({ k: 'not', e }) as Expr);
        },
      },
      { ALT: () => this.SUBRULE(this.primary) },
    ])
  );

  private primary = this.RULE('primary', (): Expr =>
    this.OR([
      { ALT: () => this.SUBRULE(this.field) as Expr },
      { ALT: () => this.SUBRULE(this.literal) },
      {
        ALT: () => {
          const p = this.CONSUME(Param);
          return this.ACTION(() => ({ k: 'param', v: p.image.slice(1) }) as Expr);
        },
      },
      { ALT: () => this.SUBRULE(this.ifExpr) },
      { ALT: () => this.SUBRULE(this.caseExpr) },
      {
        GATE: () => this.LA(2).tokenType === LParen,
        ALT: () => this.SUBRULE(this.castExpr),
      },
      {
        GATE: () => this.LA(2).tokenType === StringLit,
        ALT: () => {
          const t = this.OR2([
            { ALT: () => this.CONSUME(k('date')) },
            { ALT: () => this.CONSUME(k('datetime')) },
          ]);
          const v = this.CONSUME(StringLit);
          return this.ACTION(() => ({ k: 'typed', type: t.image, v: unstr(v.image) }) as Expr);
        },
      },
      { ALT: () => this.SUBRULE(this.call) },
      {
        ALT: () => {
          const t = this.CONSUME(DoubleQuoted);
          return this.ACTION(() => {
            throw Object.assign(new Error('jflow does not use double quotes'), {
              jflowCode: 'E_LEX_DOUBLE_QUOTE',
              token: t,
            });
          });
        },
      },
      { ALT: () => this.SUBRULE(this.listish) },
    ])
  );

  private listish = this.RULE('listish', (): Expr => {
    this.CONSUME(LParen);
    const items: Expr[] = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const e = this.SUBRULE(this.expr);
        this.ACTION(() => items.push(e));
      },
    });
    this.CONSUME(RParen);
    return this.ACTION(() =>
      items.length === 1 ? ({ k: 'paren', e: items[0] } as Expr) : ({ k: 'list', items } as Expr)
    );
  });

  public field = this.RULE('field', (): FieldExpr => {
    const a = this.CONSUME(Field);
    let b: IToken | null = null;
    this.OPTION({
      GATE: () => this.LA(2).tokenType === Field,
      DEF: () => {
        this.CONSUME(Dot);
        b = this.CONSUME2(Field);
      },
    });
    return this.ACTION(() => {
      const span = { start: a.startOffset, end: (b ?? a).endOffset! + 1 };
      return b
        ? { k: 'field', q: unfield(a.image), name: unfield((b as IToken).image), span }
        : { k: 'field', name: unfield(a.image), span };
    });
  });

  private literal = this.RULE('literal', (): Expr =>
    this.OR([
      {
        ALT: () => {
          const t = this.CONSUME(StringLit);
          return this.ACTION(() => ({ k: 'lit', t: 'str', v: unstr(t.image) }) as Expr);
        },
      },
      {
        ALT: () => {
          const t = this.CONSUME(NumberLit);
          return this.ACTION(() => ({ k: 'lit', t: 'num', v: t.image.replace(/_/g, '') }) as Expr);
        },
      },
      {
        ALT: () => {
          const t = this.CONSUME(Duration);
          return this.ACTION(() => ({ k: 'lit', t: 'dur', v: t.image }) as Expr);
        },
      },
      {
        ALT: () => {
          this.CONSUME(k('true'));
          return { k: 'lit', t: 'bool', v: true } as Expr;
        },
      },
      {
        ALT: () => {
          this.CONSUME(k('false'));
          return { k: 'lit', t: 'bool', v: false } as Expr;
        },
      },
      {
        ALT: () => {
          this.CONSUME(k('null'));
          return { k: 'lit', t: 'null' } as Expr;
        },
      },
    ])
  );

  private ifExpr = this.RULE('ifExpr', (): Expr => {
    this.CONSUME(k('if'));
    const c = this.SUBRULE(this.expr);
    this.CONSUME(k('then'));
    const v = this.SUBRULE2(this.expr);
    const branches: Array<[Expr, Expr]> = [];
    this.ACTION(() => branches.push([c, v]));
    let els: Expr | null = null;
    this.MANY(() => {
      this.CONSUME(k('elseif'));
      const c2 = this.SUBRULE3(this.expr);
      this.CONSUME2(k('then'));
      const v2 = this.SUBRULE4(this.expr);
      this.ACTION(() => branches.push([c2, v2]));
    });
    this.OPTION(() => {
      this.CONSUME(k('else'));
      els = this.SUBRULE5(this.expr);
    });
    this.CONSUME(k('end'));
    return this.ACTION(() => ({ k: 'if', branches, else: els }) as Expr);
  });

  /**
   * `case` is no longer part of the language: it is parsed only so it can be reported
   * (E_CASE_REMOVED) with a one-click rewrite to the equivalent if/elseif (simple case → [x] = v).
   */
  private caseExpr = this.RULE('caseExpr', (): Expr => {
    const caseTok = this.CONSUME(k('case'));
    let operand: Expr | null = null;
    this.OPTION(() => {
      operand = this.SUBRULE(this.expr);
    });
    const branches: Array<[Expr, Expr]> = [];
    this.AT_LEAST_ONE(() => {
      this.CONSUME(k('when'));
      const c = this.SUBRULE2(this.expr);
      this.CONSUME(k('then'));
      const v = this.SUBRULE3(this.expr);
      this.ACTION(() =>
        branches.push([operand ? ({ k: 'bin', op: '=', l: operand, r: c } as Expr) : c, v])
      );
    });
    let els: Expr | null = null;
    this.OPTION2(() => {
      this.CONSUME(k('else'));
      els = this.SUBRULE4(this.expr);
    });
    const endTok = this.CONSUME(k('end'));
    return this.ACTION(() => {
      const expr = { k: 'if', branches, else: els } as Expr;
      this.caseSites.push({
        start: caseTok.startOffset,
        end: (endTok.endOffset ?? endTok.startOffset) + 1,
        expr,
      });
      return expr;
    });
  });

  private castExpr = this.RULE('castExpr', (): Expr => {
    const kw = this.OR([
      { ALT: () => this.CONSUME(k('cast')) },
      { ALT: () => this.CONSUME(k('try_cast')) },
    ]);
    this.CONSUME(LParen);
    const e = this.SUBRULE(this.expr);
    this.CONSUME(k('as'));
    const type = this.SUBRULE(this.typeRef);
    this.CONSUME(RParen);
    return this.ACTION(() => ({ k: 'cast', try: kw.image === 'try_cast', e, type }) as Expr);
  });

  public typeRef = this.RULE('typeRef', (): TypeRef => {
    const t = this.CONSUME(Ident);
    let p: number | undefined;
    let s: number | undefined;
    this.OPTION(() => {
      this.CONSUME(LParen);
      p = Number(this.CONSUME(NumberLit).image);
      this.CONSUME(Comma);
      s = Number(this.CONSUME2(NumberLit).image);
      this.CONSUME(RParen);
    });
    return this.ACTION(() => (p === undefined ? { name: t.image } : { name: t.image, p, s }));
  });

  private call = this.RULE('call', (): Expr => {
    const nameTok = this.CONSUME(Ident);
    this.CONSUME(LParen);
    const out = this.ACTION(
      () =>
        ({
          k: 'call',
          name: /^[A-Za-z0-9_]+$/.test(nameTok.image) ? nameTok.image.toLowerCase() : nameTok.image,
          args: [],
          named: {},
          distinct: false,
          star: false,
          over: null,
        }) as Extract<Expr, { k: 'call' }>
    );
    this.MANY_SEP({
      SEP: Comma,
      DEF: () => {
        this.OR([
          {
            ALT: () => {
              this.CONSUME(Star);
              this.ACTION(() => (out.star = true));
            },
          },
          {
            ALT: () => {
              this.CONSUME(k('distinct'));
              const e = this.SUBRULE(this.expr);
              this.ACTION(() => {
                out.distinct = true;
                out.args.push(e);
              });
            },
          },
          {
            GATE: () => this.LA(2).tokenType === Colon,
            ALT: () => {
              const key = this.CONSUME2(Ident);
              this.CONSUME(Colon);
              const v = this.OR2([
                {
                  GATE: () => this.LA(2).tokenType !== LParen,
                  ALT: () => {
                    const t = this.CONSUME3(Ident);
                    return this.ACTION(() => ({ k: 'enum', v: t.image }) as Expr);
                  },
                },
                { ALT: () => this.SUBRULE2(this.expr) },
              ]);
              this.ACTION(() => (out.named[key.image] = v));
            },
          },
          {
            ALT: () => {
              const e = this.SUBRULE3(this.expr);
              this.ACTION(() => out.args.push(e));
            },
          },
        ]);
      },
    });
    this.CONSUME(RParen);
    this.OPTION(() => {
      const over = this.SUBRULE(this.over);
      this.ACTION(() => (out.over = over));
    });
    return out;
  });

  private over = this.RULE('over', (): OverSpec => {
    this.CONSUME(k('over'));
    this.CONSUME(LParen);
    const o: OverSpec = { partition: [], order: [], frame: null };
    this.OPTION(() => {
      this.CONSUME(k('partition'));
      this.CONSUME(k('by'));
      this.AT_LEAST_ONE_SEP({
        SEP: Comma,
        DEF: () => {
          const e = this.SUBRULE(this.expr);
          this.ACTION(() => o.partition.push(e));
        },
      });
    });
    this.OPTION2(() => {
      this.CONSUME(k('order'));
      this.CONSUME2(k('by'));
      this.AT_LEAST_ONE_SEP2({
        SEP: Comma,
        DEF: () => {
          const e = this.SUBRULE2(this.expr);
          let dir: 'asc' | 'desc' | null = null;
          let nulls: 'first' | 'last' | null = null;
          this.OPTION3(() => {
            dir = this.OR([
              { ALT: () => this.CONSUME(k('asc')).image as 'asc' },
              { ALT: () => this.CONSUME(k('desc')).image as 'desc' },
            ]);
          });
          this.OPTION4(() => {
            this.CONSUME(k('nulls'));
            nulls = this.OR2([
              { ALT: () => this.CONSUME(k('first')).image as 'first' },
              { ALT: () => this.CONSUME(k('last')).image as 'last' },
            ]);
          });
          this.ACTION(() => o.order.push({ e, dir, nulls }));
        },
      });
    });
    // Named form (same vocabulary as take): `over (by: [区域] sort: -[销售额])`.
    this.OPTION6(() => {
      this.CONSUME3(k('by'));
      this.CONSUME(Colon);
      this.AT_LEAST_ONE_SEP3({
        SEP: Comma,
        DEF: () => {
          const e = this.SUBRULE3(this.expr);
          this.ACTION(() => o.partition.push(e));
        },
      });
    });
    this.OPTION7(() => {
      this.CONSUME(k('sort'));
      this.CONSUME2(Colon);
      this.AT_LEAST_ONE_SEP4({
        SEP: Comma,
        DEF: () => {
          const key = this.SUBRULE(this.sortKey);
          this.ACTION(() =>
            o.order.push({ e: key.field, dir: key.desc ? 'desc' : null, nulls: key.nulls })
          );
        },
      });
    });
    this.OPTION5(() => {
      const unit = this.OR3([
        { ALT: () => this.CONSUME(k('rows')).image },
        { ALT: () => this.CONSUME(k('range')).image },
        { ALT: () => this.CONSUME(k('groups')).image },
      ]);
      const frame: NonNullable<OverSpec['frame']> = { unit, bounds: [], exclude: null };
      this.OR4([
        {
          ALT: () => {
            this.CONSUME(k('between'));
            const a = this.SUBRULE(this.bound);
            this.CONSUME(k('and'));
            const b = this.SUBRULE2(this.bound);
            this.ACTION(() => frame.bounds.push(a, b));
          },
        },
        {
          ALT: () => {
            const a = this.SUBRULE3(this.bound);
            this.ACTION(() => frame.bounds.push(a));
          },
        },
      ]);
      this.ACTION(() => (o.frame = frame));
    });
    this.CONSUME(RParen);
    return o;
  });

  private bound = this.RULE('bound', () =>
    this.OR([
      {
        ALT: () => {
          this.CONSUME(k('unbounded'));
          const side = this.OR2([
            { ALT: () => this.CONSUME(k('preceding')).image },
            { ALT: () => this.CONSUME(k('following')).image },
          ]);
          return { k: 'unbounded', side } as NonNullable<OverSpec['frame']>['bounds'][number];
        },
      },
      {
        ALT: () => {
          this.CONSUME(k('current'));
          this.CONSUME(k('row'));
          return { k: 'current' } as NonNullable<OverSpec['frame']>['bounds'][number];
        },
      },
      {
        ALT: () => {
          const e = this.SUBRULE(this.concatExpr);
          const side = this.OR3([
            { ALT: () => this.CONSUME2(k('preceding')).image },
            { ALT: () => this.CONSUME2(k('following')).image },
          ]);
          return this.ACTION(
            () => ({ k: 'offset', e, side }) as NonNullable<OverSpec['frame']>['bounds'][number]
          );
        },
      },
    ])
  );
}

const SETOP_TOKENS = new Set<TokenType>([KW.union, KW.intersect, KW.except]);

/** `on [a], [b]` (unqualified fields) → key list; anything else → one boolean expression. */
function joinCondition(conds: Expr[]): Step['on'] {
  if (conds.every((c) => c.k === 'field' && !c.q)) {
    return { k: 'keys', keys: conds.map((c) => (c as FieldExpr).name) };
  }
  if (conds.length !== 1) {
    throw Object.assign(new Error('join on: either key fields [a], [b] or one condition'), {
      jflowCode: 'E_JOIN_ON',
    });
  }
  return { k: 'expr', e: conds[0] };
}

let parserInstance: JflowParser | null = null;
export function getJflowParser(): JflowParser {
  if (!parserInstance) parserInstance = new JflowParser();
  return parserInstance;
}
export type { JflowParser };
export { FieldOpen };
