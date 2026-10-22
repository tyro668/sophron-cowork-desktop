export type { Expr } from './ast';
export { ExpressionError, parseExpression, parseExpressionList } from './parser';
export { exprToSql, type ToSqlOptions } from './to-sql';
export { inferType, type InferenceResult, type TypeIssue } from './infer';
export {
  EXPRESSION_FUNCTIONS,
  lookupExpressionFunction,
  type ExpressionFunction,
} from './functions';
export { exprTypeOf, type ExprType } from './types';

import { parseExpression, parseExpressionList } from './parser';
import { exprToSql, type ToSqlOptions } from './to-sql';
import { inferType, type InferenceResult } from './infer';

/** Parse + whitelist-check + compile an expression to DuckDB SQL ('' stays ''). */
export function compileExpression(text: string, options: ToSqlOptions = {}): string {
  if (!text.trim()) return '';
  return exprToSql(parseExpression(text), options);
}

/** Compile a metric argument list such as `[name], '-'` for string_agg. */
export function compileExpressionList(text: string, options: ToSqlOptions = {}): string {
  if (!text.trim()) return '';
  return parseExpressionList(text)
    .map((item) => exprToSql(item, options))
    .join(', ');
}

export interface ExpressionAnalysis extends Partial<InferenceResult> {
  ok: boolean;
  error?: { message: string; code: string; position?: number };
}

/** Editor/AI helper: never throws; returns the result type or the first error. */
export function analyzeExpression(
  text: string,
  columnTypes: Record<string, string> = {}
): ExpressionAnalysis {
  try {
    const ast = parseExpression(text);
    exprToSql(ast);
    return { ok: true, ...inferType(ast, columnTypes) };
  } catch (error) {
    const e = error as { message: string; code?: string; position?: number };
    return {
      ok: false,
      error: { message: e.message, code: e.code ?? 'syntax', position: e.position },
    };
  }
}
