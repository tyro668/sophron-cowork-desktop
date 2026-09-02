import type { JoinCondition } from '@/shared/operator-schemas';
import { insertRowAfter, removeRowAt } from '../shared/rowListOperations';

export type ConditionEntry = JoinCondition;

export const DEFAULT_CONDITION: ConditionEntry = { left: '', operator: '=', right: '' };

export function insertCondition(conditions: ConditionEntry[], index: number): ConditionEntry[] {
  return insertRowAfter(conditions, index, { ...DEFAULT_CONDITION });
}

export function removeCondition(conditions: ConditionEntry[], index: number): ConditionEntry[] {
  return removeRowAt(conditions, index);
}
