import type { Expr } from './ast';
import { lookupExpressionFunction } from './functions';
import { exprTypeOf, NUMERIC_TYPES, TEMPORAL_TYPES, widen, type ExprType } from './types';

export interface TypeIssue {
  code: 'textArithmetic' | 'compareMismatch' | 'temporalArgument' | 'unknownField';
  message: string;
}

export interface InferenceResult {
  type: ExprType;
  issues: TypeIssue[];
  /** Fields referenced by the expression (for lint / rename tracking). */
  fields: string[];
}

/** Infer the result type of an AST given upstream column types. */
export function inferType(expr: Expr, columnTypes: Record<string, string> = {}): InferenceResult {
  const issues: TypeIssue[] = [];
  const fields: string[] = [];
  const known = Object.keys(columnTypes).length > 0;

  const visit = (e: Expr): ExprType => {
    switch (e.k) {
      case 'field': {
        fields.push(e.name);
        if (!(e.name in columnTypes)) {
          if (known && e.qualifier === undefined) {
            issues.push({ code: 'unknownField', message: `Unknown field [${e.name}]` });
          }
          return 'unknown';
        }
        return exprTypeOf(columnTypes[e.name]);
      }
      case 'str':
        return 'text';
      case 'num':
        return /[.eE]/.test(e.raw) ? 'decimal' : 'integer';
      case 'bool':
        return 'boolean';
      case 'null':
        return 'null';
      case 'star':
        return 'unknown';
      case 'paren':
        return visit(e.e);
      case 'unary':
        return e.op === 'NOT' ? (visit(e.e), 'boolean') : visit(e.e);
      case 'bin': {
        const l = visit(e.l);
        const r = visit(e.r);
        if (e.op === '||') return 'text';
        if (['+', '-', '*', '/', '%'].includes(e.op)) {
          if (l === 'text' || r === 'text') {
            issues.push({
              code: 'textArithmetic',
              message: `Arithmetic '${e.op}' on a text value; convert it with cast(... as decimal) first`,
            });
            return 'unknown';
          }
          if (TEMPORAL_TYPES.has(l) && TEMPORAL_TYPES.has(r) && e.op === '-') return 'integer';
          if (TEMPORAL_TYPES.has(l)) return l;
          if (e.op === '/' && l === 'integer' && r === 'integer') return 'float';
          return widen(l, r);
        }
        if (['=', '!=', '<>', '<', '<=', '>', '>='].includes(e.op)) {
          const mismatch =
            (l === 'text' && NUMERIC_TYPES.has(r)) || (r === 'text' && NUMERIC_TYPES.has(l));
          if (mismatch) {
            issues.push({
              code: 'compareMismatch',
              message: `Comparing text with a number ('${e.op}'); quote the value or cast the field`,
            });
          }
        }
        return 'boolean';
      }
      case 'isnull':
      case 'in':
      case 'between':
      case 'distinct':
      case 'textop':
        for (const child of childExprs(e)) visit(child);
        return 'boolean';
      case 'case': {
        if (e.operand) visit(e.operand);
        let result: ExprType = 'null';
        for (const [when, then] of e.whens) {
          visit(when);
          result = widen(result, visit(then));
        }
        if (e.else) result = widen(result, visit(e.else));
        return result;
      }
      case 'cast':
        visit(e.e);
        return exprTypeOf(e.type);
      case 'extract':
        visit(e.e);
        return 'integer';
      case 'interval':
        visit(e.value);
        return 'unknown';
      case 'typed':
        return e.type === 'DATE' ? 'date' : 'datetime';
      case 'call': {
        const args = e.args.map(visit);
        if (e.over) {
          for (const p of e.over.partitionBy) visit(p);
          for (const o of e.over.orderBy) visit(o.expr);
        }
        const definition = lookupExpressionFunction(e.name);
        if (!definition) return 'unknown';
        if (definition.category === 'date' && definition.minArgs === 1) {
          const arg = args[0];
          if (arg === 'text' || NUMERIC_TYPES.has(arg)) {
            issues.push({
              code: 'temporalArgument',
              message: `${e.name}() expects a date; convert text with strptime() or cast(... as date)`,
            });
          }
        }
        const rule = definition.returns;
        switch (rule) {
          case 'arg0':
            return args[0] ?? 'unknown';
          case 'arg1':
            return args[1] ?? 'unknown';
          case 'widen':
            return args.reduce<ExprType>((acc, t) => widen(acc, t), 'null');
          case 'avg':
            return args[0] === 'decimal' ? 'decimal' : 'float';
          case 'sum':
            return args[0] === 'integer' ? 'integer' : args[0] === 'decimal' ? 'decimal' : 'float';
          default:
            return rule;
        }
      }
    }
  };

  const type = visit(expr);
  return { type: type === 'null' ? 'unknown' : type, issues, fields };
}

function childExprs(e: Expr): Expr[] {
  switch (e.k) {
    case 'isnull':
      return [e.e];
    case 'in':
      return [e.e, ...e.list];
    case 'between':
      return [e.e, e.lo, e.hi];
    case 'distinct':
    case 'textop':
      return [e.l, e.r];
    default:
      return [];
  }
}
