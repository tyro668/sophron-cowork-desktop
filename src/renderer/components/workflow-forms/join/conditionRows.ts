import type { JoinCondition } from '@/shared/operator-schemas';
import { createStableRowId, insertRowAfter, removeRowAt } from '../shared/rowListOperations';

export type ConditionEntry = JoinCondition;

export const DEFAULT_CONDITION: ConditionEntry = { left: '', operator: '=', right: '' };

export function createCondition(): ConditionEntry {
  return { ...DEFAULT_CONDITION, id: createStableRowId() };
}

export function insertCondition(conditions: ConditionEntry[], index: number): ConditionEntry[] {
  return insertRowAfter(conditions, index, createCondition());
}

export function removeCondition(conditions: ConditionEntry[], index: number): ConditionEntry[] {
  return removeRowAt(conditions, index);
}
