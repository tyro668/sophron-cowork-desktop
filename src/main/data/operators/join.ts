import { quoteIdentifier, durationToMilliseconds } from './utils';
import { compileJoinProjection } from './set-op';
import { parseFieldRef } from '../../../shared/prep-dsl/parser';
import { JoinConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

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
  const parsed = parseOperatorConfig(JoinConfigSchema, config);
  const rawAsof = parsed.asof as Record<string, unknown> | undefined;
  const asof = rawAsof ?? {};
  const leftTime = extractFieldName(String(asof.leftTime ?? ''));
  const rightTime = extractFieldName(String(asof.rightTime ?? ''));
  const operator =
    asof.operator === 'nearest' ? (asof.direction === 'forward' ? '>=' : '<=') : asof.operator;
  const orderDirection = operator === '>=' ? 'ASC' : 'DESC';
  const byConditions = Array.isArray(asof.by)
    ? asof.by
        .flatMap((condition: Record<string, unknown>) => {
          const left = String(condition.left ?? '');
          const right = String(condition.right ?? '');
          return left && right
            ? [
                `r.${quoteIdentifier(extractFieldName(right))} = l.${quoteIdentifier(extractFieldName(left))}`,
              ]
            : [];
        })
        .join(' AND ')
    : '';
  const tolerance = typeof asof.tolerance === 'string' ? asof.tolerance : '';
  const toleranceClause = tolerance
    ? ` AND ABS(EPOCH_MS(r.${quoteIdentifier(rightTime)}) - EPOCH_MS(l.${quoteIdentifier(leftTime)})) <= ${durationToMilliseconds(tolerance)}`
    : '';
  const projection = compileJoinProjection(
    parsed.keep,
    leftColumns,
    rightColumns,
    parsed.conflict,
    parsed.rightAlias
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
