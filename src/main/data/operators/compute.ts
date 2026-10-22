import { compileExpression, compileExpressionList } from '../../../shared/expression';

/**
 * Scalar expressions (derive / aggregate / pivot metrics) compile through the
 * shared typed expression layer: one grammar, a function whitelist and
 * Chinese aliases — there is no raw SQL passthrough.
 */
export function compileScalarExpression(expression: string): string {
  return compileExpression(expression);
}

/** Aggregate / pivot metric arguments: one expression or an argument list. */
export function compileMetricArguments(expression: string): string {
  return compileExpressionList(expression);
}
