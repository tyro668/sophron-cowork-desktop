import { compileExpression } from '../../../shared/expression';

/**
 * Filter / expect conditions share the scalar expression grammar
 * (see shared/expression); empty conditions keep every row.
 */
export function compileFilterConditionExpression(condition: string): string {
  if (!condition || condition.trim() === '') return 'TRUE';
  return compileExpression(condition);
}
