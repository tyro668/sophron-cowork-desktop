import type { DataColumnTypeInfo } from '../data-field-types';

const NUMERIC_TYPES = new Set(['integer', 'float', 'decimal']);
const TEMPORAL_TYPES = new Set(['date', 'datetime']);

export type SetOpCompatibilityIssue =
  | { kind: 'column-count'; leftCount: number; rightCount: number }
  | {
      kind: 'column-names';
      mismatches: Array<{ index: number; left: string; right: string }>;
    }
  | {
      kind: 'column-type';
      index: number | string;
      column: string;
      leftType: string;
      rightType: string;
      severity: 'coercible' | 'incompatible';
    };

function areCompatibleTypes(leftType: string, rightType: string): boolean {
  if (leftType === rightType) return true;
  if (NUMERIC_TYPES.has(leftType) && NUMERIC_TYPES.has(rightType)) return true;
  return TEMPORAL_TYPES.has(leftType) && TEMPORAL_TYPES.has(rightType);
}

function createTypeIssue(
  index: number | string,
  column: string,
  leftType: string,
  rightType: string
): SetOpCompatibilityIssue | undefined {
  if (areCompatibleTypes(leftType, rightType)) return undefined;
  return {
    kind: 'column-type',
    index,
    column,
    leftType,
    rightType,
    severity: leftType === 'text' || rightType === 'text' ? 'coercible' : 'incompatible',
  };
}

export function analyzeSetOpCompatibility(
  leftTypes: readonly DataColumnTypeInfo[],
  rightTypes: readonly DataColumnTypeInfo[],
  operation: string,
  match: string
): SetOpCompatibilityIssue[] {
  const issues: SetOpCompatibilityIssue[] = [];
  const effectiveMatch = operation === 'union' ? match : 'by_position';

  if (effectiveMatch !== 'by_name' && leftTypes.length !== rightTypes.length) {
    issues.push({
      kind: 'column-count',
      leftCount: leftTypes.length,
      rightCount: rightTypes.length,
    });
  }

  if (effectiveMatch !== 'by_name') {
    const mismatches = leftTypes
      .slice(0, Math.min(leftTypes.length, rightTypes.length))
      .flatMap((leftType, index) =>
        leftType.name === rightTypes[index].name
          ? []
          : [{ index: index + 1, left: leftType.name, right: rightTypes[index].name }]
      );
    if (mismatches.length > 0) issues.push({ kind: 'column-names', mismatches });
  }

  if (effectiveMatch === 'by_name') {
    const rightByName = new Map(rightTypes.map((type) => [type.name.toLowerCase(), type]));
    for (const leftType of leftTypes) {
      const rightType = rightByName.get(leftType.name.toLowerCase());
      if (!rightType) continue;
      const issue = createTypeIssue(leftType.name, leftType.name, leftType.type, rightType.type);
      if (issue) issues.push(issue);
    }
    return issues;
  }

  const comparableCount = Math.min(leftTypes.length, rightTypes.length);
  for (let index = 0; index < comparableCount; index++) {
    const issue = createTypeIssue(
      index + 1,
      leftTypes[index].name,
      leftTypes[index].type,
      rightTypes[index].type
    );
    if (issue) issues.push(issue);
  }
  return issues;
}
