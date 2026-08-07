import {
  quoteIdentifier,
  objectArray,
  isRecord,
  getRightPrefix,
  getConflictAlias,
  lastQualifiedPart,
  durationToMilliseconds,
} from './utils';
import { parseFieldRef } from '../../../shared/prep-dsl/parser';
import { JoinConfigSchema } from '../../../shared/operator-schemas';
import { z } from 'zod';

const JOIN_CONDITION_OPERATORS = new Set(['=', '<', '<=', '>', '>=']);

function extractFieldName(value: string): string {
  const ref = parseFieldRef(value);
  if (ref) return ref.name;
  const stripped = value.replace(/^\[|\]$/g, '');
  return stripped.includes('.') ? (stripped.split('.').pop() ?? stripped) : stripped;
}

export function compileJoinConditionList(value: unknown): string {
  const conditions = objectArray(value);
  return conditions
    .map((condition) => {
      if (typeof condition.left !== 'string' || typeof condition.right !== 'string') {
        throw new Error('Non-cross join requires at least one valid condition');
      }
      const left = condition.left.trim();
      const right = condition.right.trim();
      const leftRef = parseFieldRef(left);
      const rightRef = parseFieldRef(right);
      const leftName = leftRef?.name ?? lastQualifiedPart(left);
      const rightName = rightRef?.name ?? lastQualifiedPart(right);
      if (!left || !right || !leftName || !rightName) {
        throw new Error('Non-cross join requires at least one valid condition');
      }
      const operator = typeof condition.operator === 'string' ? condition.operator : '=';
      if (!JOIN_CONDITION_OPERATORS.has(operator)) {
        throw new Error(`Unsupported join condition operator: ${operator}`);
      }
      return `l.${quoteIdentifier(leftName)} ${operator} r.${quoteIdentifier(rightName)}`;
    })
    .join(' AND ');
}

interface JoinProjectionEntry {
  outputName: string;
  sourceField: string;
  sql: string;
}

export function compileJoinProjection(
  keep: unknown,
  leftColumns: string[],
  rightColumns: string[],
  conflict: unknown,
  rightAlias?: string
): string {
  const items = objectArray(keep);
  const lowerRight = new Set(rightColumns.map((c) => c.toLowerCase()));
  const conflictCols = new Set(
    leftColumns.filter((c) => lowerRight.has(c.toLowerCase())).map((c) => c.toLowerCase())
  );
  const isSuffix = isRecord(conflict) && conflict.strategy === 'suffix';
  const rightPrefix = getRightPrefix(conflict);
  const isConflictColumn = (col: string) => conflictCols.has(col.toLowerCase());

  const projections: JoinProjectionEntry[] = [];
  const push = (side: 'l' | 'r', col: string, outputName: string, sourceField: string) => {
    const sql =
      col.toLowerCase() === outputName.toLowerCase()
        ? `${side}.${quoteIdentifier(col)}`
        : `${side}.${quoteIdentifier(col)} AS ${quoteIdentifier(outputName)}`;
    projections.push({ outputName, sourceField, sql });
  };

  const pushLeftColumn = (col: string) =>
    push(
      'l',
      col,
      isConflictColumn(col) ? getConflictAlias(conflict, 'left', col) : col,
      `left.${col}`
    );
  const pushRightColumn = (col: string) => {
    const outputName = isConflictColumn(col)
      ? isSuffix
        ? getConflictAlias(conflict, 'right', col)
        : `${rightPrefix}${col}`
      : col;
    push('r', col, outputName, `right.${col}`);
  };

  if (items.length === 0) {
    leftColumns.forEach(pushLeftColumn);
    rightColumns.forEach(pushRightColumn);
  } else {
    for (const item of items) {
      if (item.side === 'left' && item.wildcard) {
        leftColumns.forEach(pushLeftColumn);
        continue;
      }
      if (item.side === 'right' && item.wildcard) {
        rightColumns.forEach(pushRightColumn);
        continue;
      }
      if (typeof item.source !== 'string') continue;
      const ref = parseFieldRef(item.source);
      const fieldName = ref?.name ?? lastQualifiedPart(item.source);
      const side =
        item.side === 'right'
          ? 'r'
          : item.side === 'left'
            ? 'l'
            : ref?.source && rightAlias && ref.source.toLowerCase() === rightAlias.toLowerCase()
              ? 'r'
              : ref?.source
                ? 'l'
                : leftColumns.some((c) => c.toLowerCase() === fieldName.toLowerCase())
                  ? 'l'
                  : 'r';
      const conflictSide = side === 'r' ? 'right' : 'left';
      const isConflict = isConflictColumn(fieldName);
      const alias =
        typeof item.alias === 'string'
          ? (parseFieldRef(item.alias)?.name ?? item.alias)
          : isConflict
            ? getConflictAlias(conflict, conflictSide, fieldName)
            : fieldName;
      push(side, fieldName, alias, item.source);
    }
  }

  const usedNames = new Map<string, JoinProjectionEntry>();
  for (const entry of projections) {
    const normalized = entry.outputName.toLowerCase();
    const previous = usedNames.get(normalized);
    if (previous) {
      throw new Error(
        `Join output field "${entry.outputName}" conflicts with ` +
          `"${previous.sourceField}" after applying aliases`
      );
    }
    usedNames.set(normalized, entry);
  }

  return projections.map((p) => p.sql).join(', ');
}

export function compileAsofJoinSql(
  output: string,
  left: string,
  right: string,
  leftColumns: string[],
  rightColumns: string[],
  config: z.infer<typeof JoinConfigSchema>
): string {
  const asof = config.asof ?? {
    leftTime: '',
    rightTime: '',
    operator: undefined,
    tolerance: undefined,
    by: undefined,
  };
  const leftTime = extractFieldName(asof.leftTime ?? '');
  const rightTime = extractFieldName(asof.rightTime ?? '');
  const operator = asof.operator ?? '>=';
  const isBidirectional = operator === 'nearest';
  const byConditions = (asof.by ?? [])
    .map((condition) => {
      const left = condition.left;
      const right = condition.right;
      const leftName = extractFieldName(left);
      const rightName = extractFieldName(right);
      if (!left || !right || !leftName || !rightName) {
        throw new Error('ASOF by condition requires both left and right fields');
      }
      return `r.${quoteIdentifier(rightName)} = l.${quoteIdentifier(leftName)}`;
    })
    .join(' AND ');
  const tolerance = (asof.tolerance ?? '').trim();
  const hasTolerance = Boolean(tolerance);
  const toleranceMs = hasTolerance ? durationToMilliseconds(tolerance) : 0;
  const absDiff = `ABS(EPOCH_MS(r.${quoteIdentifier(rightTime)}) - EPOCH_MS(l.${quoteIdentifier(leftTime)}))`;
  const conditions: string[] = [];
  if (isBidirectional) {
    conditions.push(`${absDiff} <= ${toleranceMs}`);
  } else {
    const rightTimeOperator = operator === '>=' ? '<=' : '>=';
    conditions.push(
      `r.${quoteIdentifier(rightTime)} ${rightTimeOperator} l.${quoteIdentifier(leftTime)}`
    );
    if (hasTolerance) {
      conditions.push(`${absDiff} <= ${toleranceMs}`);
    }
  }
  if (byConditions) conditions.push(byConditions);
  const orderClause = isBidirectional
    ? `${absDiff} ASC`
    : `r.${quoteIdentifier(rightTime)} ${operator === '>=' ? 'DESC' : 'ASC'}`;
  const projection = compileJoinProjection(
    config.keep,
    leftColumns,
    rightColumns,
    config.conflict,
    config.rightAlias
  );
  const whereClause = conditions.join(' AND ');
  return `
    CREATE TEMP TABLE ${output} AS
    SELECT ${projection}
    FROM ${left} l
    LEFT JOIN LATERAL (
      SELECT *
      FROM ${right} r
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      LIMIT 1
    ) r ON true
  `;
}
