import { compileScalarExpression } from './compute';

const SQL_QUOTED_IDENTIFIER_PATTERN = '"(?:[^"]|"")*"';
const SQL_STRING_LITERAL_PATTERN = "'(?:[^']|'')*'";
const SQL_FILTER_SPECIAL_OPERATOR_PATTERN = new RegExp(
  `(${SQL_QUOTED_IDENTIFIER_PATTERN})\\s+(not\\s+matches|matches|begin|end)\\s+(${SQL_QUOTED_IDENTIFIER_PATTERN}|${SQL_STRING_LITERAL_PATTERN}|-?(?:\\d+(?:\\.\\d+)?)|TRUE|FALSE|NULL)`,
  'giu'
);

export function compileFilterConditionExpression(condition: string): string {
  const scalarSql = compileScalarExpression(condition);
  return scalarSql.replace(
    SQL_FILTER_SPECIAL_OPERATOR_PATTERN,
    (_match, left: string, operator: string, right: string) => {
      const leftSql = `CAST(${left} AS VARCHAR)`;
      const rightSql = `CAST(${right} AS VARCHAR)`;

      switch (operator.toLowerCase()) {
        case 'matches':
          return `regexp_matches(${leftSql}, ${rightSql})`;
        case 'not matches':
          return `NOT regexp_matches(${leftSql}, ${rightSql})`;
        case 'begin':
          return `starts_with(${leftSql}, ${rightSql})`;
        case 'end':
          return `ends_with(${leftSql}, ${rightSql})`;
        default:
          return _match;
      }
    }
  );
}
