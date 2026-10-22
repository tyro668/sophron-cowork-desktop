import { quoteIdentifier, objectArray, lastQualifiedPart, durationToMilliseconds } from './utils';
import { parseFieldRefExact } from '../../../shared/expression-syntax/fields';
import { planJoinProjectionColumns } from '../../../shared/workflow-plan/join-projection';
import { JoinConfigSchema } from '../../../shared/operator-schemas';
import { z } from 'zod';
import { compileExpression } from '../../../shared/expression';

const JOIN_CONDITION_OPERATORS = new Set(['=', '<', '<=', '>', '>=']);

function extractFieldName(value: string): string {
  return parseFieldRefExact(value)?.name ?? value.trim();
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
      const leftRef = parseFieldRefExact(left);
      const rightRef = parseFieldRefExact(right);
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

/** Compiles the free `match` predicate: `[<rightAlias>].[x]` → r, any other qualifier → l. */
export function compileJoinMatchExpression(
  expression: string | undefined,
  rightAlias: string,
  leftColumns: readonly string[] = [],
  rightColumns: readonly string[] = []
): string {
  const text = (expression ?? '').trim();
  if (!text) return '';
  const right = rightAlias.trim().toLowerCase();
  return compileExpression(text, {
    resolveQualifier: (qualifier, name) => {
      if (qualifier === undefined) {
        // An unqualified field resolves to the one side that has it.
        const inLeft = leftColumns.includes(name);
        const inRight = rightColumns.includes(name);
        if (inLeft !== inRight) return inLeft ? 'l' : 'r';
        throw new Error(
          `Join match field [${name}] must be qualified: [left].[${name}] or [${rightAlias}].[${name}]`
        );
      }
      return qualifier.toLowerCase() === right ? 'r' : 'l';
    },
  });
}

/** Equality/comparison conditions plus the optional match expression, ANDed. */
export function compileJoinPredicate(
  config: {
    conditions?: unknown;
    expression?: string;
    rightAlias?: string;
    rightInput?: string;
  },
  leftColumns: readonly string[] = [],
  rightColumns: readonly string[] = []
): string {
  const parts: string[] = [];
  if (objectArray(config.conditions).length > 0) {
    parts.push(compileJoinConditionList(config.conditions));
  }
  const match = compileJoinMatchExpression(
    config.expression,
    config.rightAlias || config.rightInput || 'right',
    leftColumns,
    rightColumns
  );
  if (match) parts.push(`(${match})`);
  if (parts.length === 0) throw new Error('Non-cross join requires at least one valid condition');
  return parts.join(' AND ');
}

export function compileJoinProjection(
  keep: unknown,
  leftColumns: string[],
  rightColumns: string[],
  conflict: unknown,
  rightAlias?: string
): string {
  return planJoinProjectionColumns(keep, leftColumns, rightColumns, conflict, rightAlias)
    .map((entry) => {
      const side = entry.side === 'left' ? 'l' : 'r';
      return entry.sourceColumn.toLowerCase() === entry.outputName.toLowerCase()
        ? `${side}.${quoteIdentifier(entry.sourceColumn)}`
        : `${side}.${quoteIdentifier(entry.sourceColumn)} AS ${quoteIdentifier(entry.outputName)}`;
    })
    .join(', ');
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
  const direction =
    asof.direction ??
    (operator === 'nearest' ? 'nearest' : operator === '>=' ? 'backward' : 'forward');
  const isBidirectional = direction === 'nearest';
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
    const rightTimeOperator = direction === 'backward' ? '<=' : '>=';
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
    : `r.${quoteIdentifier(rightTime)} ${direction === 'backward' ? 'DESC' : 'ASC'}`;
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
