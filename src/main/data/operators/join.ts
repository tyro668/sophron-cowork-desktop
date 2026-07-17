import { quoteIdentifier, objectArray, isRecord, durationToMilliseconds } from './utils';
import { compileJoinProjection } from './set-op';
import { parseFieldRef } from '../../../shared/prep-dsl/parser';

function extractFieldName(value: string): string {
  const ref = parseFieldRef(value);
  if (ref) return ref.name;
  const stripped = value.replace(/^\[|\]$/g, '');
  return stripped.includes('.') ? (stripped.split('.').pop() ?? stripped) : stripped;
}

export function compileAsofJoinSql(
  output: string,
  left: string,
  right: string,
  leftColumns: string[],
  rightColumns: string[],
  config: Record<string, unknown>
): string {
  const asof = isRecord(config.asof) ? config.asof : {};
  const leftTime = extractFieldName(String(asof.leftTime ?? ''));
  const rightTime = extractFieldName(String(asof.rightTime ?? ''));
  const operator =
    asof.operator === 'nearest' ? (asof.direction === 'forward' ? '>=' : '<=') : asof.operator;
  const orderDirection = operator === '>=' ? 'ASC' : 'DESC';
  const byConditions = objectArray(asof.by)
    .flatMap((condition) =>
      typeof condition.left === 'string' && typeof condition.right === 'string'
        ? [
            `r.${quoteIdentifier(extractFieldName(condition.right))} = l.${quoteIdentifier(extractFieldName(condition.left))}`,
          ]
        : []
    )
    .join(' AND ');
  const tolerance = typeof asof.tolerance === 'string' ? asof.tolerance : '';
  const toleranceClause = tolerance
    ? ` AND ABS(EPOCH_MS(r.${quoteIdentifier(rightTime)}) - EPOCH_MS(l.${quoteIdentifier(leftTime)})) <= ${durationToMilliseconds(tolerance)}`
    : '';
  const projection = compileJoinProjection(
    config.keep,
    leftColumns,
    rightColumns,
    config.conflict,
    typeof config.rightAlias === 'string' ? config.rightAlias : undefined
  );
  return `
    CREATE TEMP TABLE ${output} AS
    SELECT ${projection}
    FROM ${left} l
    LEFT JOIN LATERAL (
      SELECT *
      FROM ${right} r
      WHERE r.${quoteIdentifier(rightTime)} ${operator} l.${quoteIdentifier(leftTime)}
        ${byConditions ? `AND ${byConditions}` : ''}
        ${toleranceClause}
      ORDER BY r.${quoteIdentifier(rightTime)} ${orderDirection}
      LIMIT 1
    ) r ON true
  `;
}
