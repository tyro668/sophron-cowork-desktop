import { duckDbTypeForDataFieldType } from '../data-field-types';
import type { Expr, FrameBound, WindowSpec } from './ast';
import { ExpressionError } from './parser';

export interface ToSqlOptions {
  /** Allow `[source].[field]` (join conditions); otherwise rejected. */
  allowQualified?: boolean;
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Binding strength used to decide where parentheses are required. */
function precedence(expr: Expr): number {
  switch (expr.k) {
    case 'bin':
      switch (expr.op) {
        case 'OR':
          return 1;
        case 'AND':
          return 2;
        case '||':
          return 5;
        case '+':
        case '-':
          return 6;
        case '*':
        case '/':
        case '%':
          return 7;
        default:
          return 4; // comparisons / LIKE
      }
    case 'unary':
      return expr.op === 'NOT' ? 3 : 8;
    case 'isnull':
    case 'distinct':
    case 'in':
    case 'between':
    case 'textop':
      return 4;
    default:
      return 9;
  }
}

/** Compile an AST to DuckDB SQL. Field refs become quoted identifiers. */
export function exprToSql(expr: Expr, options: ToSqlOptions = {}): string {
  const sql = (e: Expr): string => exprToSql(e, options);
  const at = (e: Expr, min: number): string => (precedence(e) < min ? `(${sql(e)})` : sql(e));
  const asText = (e: Expr): string => `CAST(${sql(e)} AS VARCHAR)`;

  switch (expr.k) {
    case 'field':
      if (expr.qualifier !== undefined) {
        if (!options.allowQualified) {
          throw new ExpressionError(
            `Qualified field [${expr.qualifier}].[${expr.name}] is only valid in join conditions`,
            'qualifiedField'
          );
        }
        return `${quoteIdentifier(expr.qualifier)}.${quoteIdentifier(expr.name)}`;
      }
      return quoteIdentifier(expr.name);
    case 'str':
      return quoteLiteral(expr.value);
    case 'num':
      return expr.raw;
    case 'bool':
      return expr.value ? 'TRUE' : 'FALSE';
    case 'null':
      return 'NULL';
    case 'star':
      return '*';
    case 'paren':
      return `(${sql(expr.e)})`;
    case 'unary':
      return expr.op === 'NOT' ? `NOT ${at(expr.e, 3)}` : `${expr.op}${at(expr.e, 8)}`;
    case 'bin': {
      const p = precedence(expr);
      // Left-associative: the right operand must bind tighter to keep the tree.
      return `${at(expr.l, p)} ${expr.op} ${at(expr.r, p + 1)}`;
    }
    case 'isnull':
      return `${at(expr.e, 5)} IS ${expr.not ? 'NOT ' : ''}NULL`;
    case 'distinct':
      return `${at(expr.l, 5)} IS ${expr.not ? 'NOT ' : ''}DISTINCT FROM ${at(expr.r, 5)}`;
    case 'in':
      return `${at(expr.e, 5)} ${expr.not ? 'NOT IN' : 'IN'} (${expr.list.map(sql).join(', ')})`;
    case 'between':
      return `${at(expr.e, 5)} ${expr.not ? 'NOT BETWEEN' : 'BETWEEN'} ${at(expr.lo, 5)} AND ${at(expr.hi, 5)}`;
    case 'textop': {
      const fn = { matches: 'regexp_matches', begin: 'starts_with', end: 'ends_with' }[expr.op];
      return `${expr.not ? 'NOT ' : ''}${fn}(${asText(expr.l)}, ${asText(expr.r)})`;
    }
    case 'call': {
      if (expr.bare) return expr.name.toUpperCase();
      const args = expr.args.map(sql).join(', ');
      const call = `${expr.name}(${expr.distinct ? 'DISTINCT ' : ''}${args})`;
      return expr.over ? `${call} OVER (${windowToSql(expr.over, sql)})` : call;
    }
    case 'case': {
      const parts = ['CASE'];
      if (expr.operand) parts.push(sql(expr.operand));
      for (const [when, then] of expr.whens) parts.push(`WHEN ${sql(when)} THEN ${sql(then)}`);
      if (expr.else) parts.push(`ELSE ${sql(expr.else)}`);
      parts.push('END');
      return parts.join(' ');
    }
    case 'cast':
      return `${expr.try ? 'TRY_CAST' : 'CAST'}(${sql(expr.e)} AS ${castTargetSql(expr.type)})`;
    case 'extract':
      return `extract(${quoteLiteral(expr.part)} FROM ${sql(expr.e)})`;
    case 'interval':
      return `INTERVAL ${at(expr.value, 9)}${expr.unit ? ` ${expr.unit}` : ''}`;
    case 'typed':
      return `${expr.type} ${quoteLiteral(expr.value)}`;
  }
}

/** Field-type name → DuckDB type; decimal(p,s) keeps its parameters. */
function castTargetSql(type: string): string {
  const params = /^decimal\s*\(([^)]*)\)$/i.exec(type);
  if (params) return `DECIMAL(${params[1]})`;
  return duckDbTypeForDataFieldType(type);
}

function boundToSql(bound: FrameBound, sql: (e: Expr) => string): string {
  if (bound.kind === 'current') return 'CURRENT ROW';
  if (bound.kind === 'unbounded') return `UNBOUNDED ${bound.side}`;
  return `${sql(bound.offset)} ${bound.side}`;
}

function windowToSql(spec: WindowSpec, sql: (e: Expr) => string): string {
  const parts: string[] = [];
  if (spec.partitionBy.length) parts.push(`PARTITION BY ${spec.partitionBy.map(sql).join(', ')}`);
  if (spec.orderBy.length) {
    parts.push(
      `ORDER BY ${spec.orderBy
        .map(
          (o) =>
            `${sql(o.expr)}${o.direction ? ` ${o.direction}` : ''}${o.nulls ? ` NULLS ${o.nulls}` : ''}`
        )
        .join(', ')}`
    );
  }
  if (spec.frame) {
    const { unit, start, end, exclude } = spec.frame;
    parts.push(
      end
        ? `${unit} BETWEEN ${boundToSql(start, sql)} AND ${boundToSql(end, sql)}`
        : `${unit} ${boundToSql(start, sql)}`
    );
    if (exclude) parts.push(`EXCLUDE ${exclude}`);
  }
  return parts.join(' ');
}
