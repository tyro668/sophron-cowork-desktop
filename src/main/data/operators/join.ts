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
  const asof = parsed.asof ?? {
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
    .flatMap((condition) => {
      const left = condition.left;
      const right = condition.right;
      return left && right
        ? [
            `r.${quoteIdentifier(extractFieldName(right))} = l.${quoteIdentifier(extractFieldName(left))}`,
          ]
        : [];
    })
    .join(' AND ');
  const tolerance = asof.tolerance ?? '';
  const toleranceMs = tolerance ? durationToMilliseconds(tolerance) : 0;
  const absDiff = `ABS(EPOCH_MS(r.${quoteIdentifier(rightTime)}) - EPOCH_MS(l.${quoteIdentifier(leftTime)}))`;
  const conditions: string[] = [];
  if (isBidirectional) {
    if (toleranceMs > 0) {
      conditions.push(`${absDiff} <= ${toleranceMs}`);
    } else {
      conditions.push(`r.${quoteIdentifier(rightTime)} <= l.${quoteIdentifier(leftTime)}`);
    }
  } else {
    conditions.push(`r.${quoteIdentifier(rightTime)} ${operator} l.${quoteIdentifier(leftTime)}`);
    if (toleranceMs > 0) {
      conditions.push(`${absDiff} <= ${toleranceMs}`);
    }
  }
  if (byConditions) conditions.push(byConditions);
  const orderClause = isBidirectional
    ? `${absDiff} ASC`
    : `r.${quoteIdentifier(rightTime)} ${operator === '>=' ? 'ASC' : 'DESC'}`;
  const projection = compileJoinProjection(
    parsed.keep,
    leftColumns,
    rightColumns,
    parsed.conflict,
    parsed.rightAlias
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
