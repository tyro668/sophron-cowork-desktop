import { SetOpConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileSetOpSql(
  output: string,
  left: string,
  right: string,
  config: Record<string, unknown>,
  leftColumns?: string[],
  rightColumns?: string[]
): string {
  const parsed = parseOperatorConfig(SetOpConfigSchema, config);
  const operation = parsed.operation.toUpperCase();
  const mode = parsed.mode === 'all' ? ' ALL' : '';
  const match = parsed.operation === 'union' ? parsed.match : 'by_position';

  if (operation === 'UNION' && match === 'by_name') {
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${left} ${operation}${mode} BY NAME SELECT * FROM ${right}`;
  }

  if (leftColumns && rightColumns && leftColumns.length !== rightColumns.length) {
    throw new Error(
      `${operation} by position requires the same number of columns on both sides (left: ${leftColumns.length}, right: ${rightColumns.length})`
    );
  }

  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${left} ${operation}${mode} SELECT * FROM ${right}`;
}
