import { compileExpression } from '../../../shared/expression';
import { parseExpression } from '../../../shared/expression/parser';

/**
 * Filter / expect conditions share the scalar expression grammar
 * (see shared/expression); empty conditions keep every row.
 */
export function compileFilterConditionExpression(condition: string): string {
  if (!condition || condition.trim() === '') return 'TRUE';
  return compileExpression(condition);
}

/** True when the condition contains a window value (`… over (…)`). */
export function expressionHasWindow(condition: string): boolean {
  let found = false;
  const visit = (value: unknown): void => {
    if (found || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.k === 'call' && node.over) {
      found = true;
      return;
    }
    Object.values(node).forEach(visit);
  };
  try {
    visit(parseExpression(condition));
  } catch {
    return false;
  }
  return found;
}
