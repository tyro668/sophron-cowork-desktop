import type { PrepAsofJoinConfig, PrepJoinCondition } from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRef, toFieldName, toQualifiedName } from '../syntax/fields';
import { quoteString, unquoteString } from '../syntax/literals';
import { findFirstTopLevelKeyword, splitTopLevel, splitTopLevelKeyword } from '../syntax/scanner';
import { createOperator, objectArray, type OperatorCommand, type OperatorDslCodec } from './codec';

interface Clause {
  name: string;
  value: string;
}

export const joinCodec: OperatorDslCodec = {
  type: 'join',
  matches: (text) => text.startsWith('join '),
  parse: (command, diagnostics) =>
    command.text.startsWith('join asof ')
      ? parseAsofJoin(command, diagnostics)
      : parseRegularJoin(command, diagnostics),
  format: (config) => formatJoin(config),
};

function parseRegularJoin(
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
) {
  const match =
    /^join\s+(inner|left|right|full|cross|semi|anti)\s+(\S+)(?:\s+as\s+(\S+))?(.*)$/s.exec(
      command.text
    );
  if (!match) {
    diagnostics.push({
      ...createPrepDiagnostic('invalidJoin', `Cannot parse join: ${command.text}`, {
        value: command.text,
      }),
      line: command.line,
    });
    return null;
  }
  const clauses = parseClauses(match[4] ?? '', ['on', 'keep', 'suffix', 'right_prefix']);
  return createOperator('join', command.text, {
    joinType: match[1],
    rightInput: match[2],
    rightAlias: match[3] ?? match[2],
    conditions: parseConditions(findClause(clauses, 'on') ?? ''),
    keep: parseKeep(findClause(clauses, 'keep') ?? ''),
    conflict: parseConflict(clauses),
  });
}

function parseAsofJoin(
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
) {
  const match = /^join\s+asof\s+(\S+)(?:\s+as\s+(\S+))?(.*)$/s.exec(command.text);
  if (!match) {
    diagnostics.push({
      ...createPrepDiagnostic('invalidAsofJoin', `Cannot parse asof join: ${command.text}`, {
        value: command.text,
      }),
      line: command.line,
    });
    return null;
  }
  const clauses = parseClauses(match[3] ?? '', [
    'on',
    'by',
    'direction',
    'tolerance',
    'keep',
    'suffix',
    'right_prefix',
  ]);
  return createOperator('join', command.text, {
    joinType: 'asof',
    rightInput: match[1],
    rightAlias: match[2] ?? match[1],
    asof: parseAsofClause(
      findClause(clauses, 'on') ?? '',
      findClause(clauses, 'by') ?? '',
      findClause(clauses, 'direction'),
      findClause(clauses, 'tolerance')
    ),
    keep: parseKeep(findClause(clauses, 'keep') ?? ''),
    conflict: parseConflict(clauses),
  });
}

function parseAsofClause(
  onClause: string,
  byClause: string,
  direction?: string,
  tolerance?: string
): PrepAsofJoinConfig | undefined {
  const match = /^(.+?)\s*(>=|<=|nearest)\s*(.+)$/.exec(onClause.trim());
  const left = match ? parseFieldRef(match[1]) : null;
  const right = match ? parseFieldRef(match[3]) : null;
  if (!match || !left || !right) return undefined;
  const operator = match[2] as PrepAsofJoinConfig['operator'];
  const expected = operator === '>=' ? 'backward' : operator === '<=' ? 'forward' : 'nearest';
  if (direction && direction !== expected) {
    throw new Error(
      `ASOF direction '${direction}' conflicts with operator '${operator}'; expected '${expected}'`
    );
  }
  return {
    leftTime: toQualifiedName(left),
    operator,
    rightTime: toQualifiedName(right),
    tolerance,
    by: byClause ? parseConditions(byClause) : undefined,
  };
}

function parseConditions(value: string): PrepJoinCondition[] {
  if (!value) return [];
  return splitTopLevelKeyword(value, 'and').flatMap((part) => {
    const match = /^(.+?)\s*(>=|<=|!=|<>|>|=|<)\s*(.+)$/.exec(part.trim());
    const left = match ? parseFieldRef(match[1]) : null;
    const right = match ? parseFieldRef(match[3]) : null;
    return left && right
      ? [
          {
            left: toQualifiedName(left),
            operator: match?.[2] === '<>' ? '!=' : (match?.[2] ?? '='),
            right: toQualifiedName(right),
          },
        ]
      : [];
  });
}

function parseKeep(value: string): unknown[] | undefined {
  if (!value) return undefined;
  return splitTopLevel(value).flatMap((item): unknown[] => {
    const trimmed = item.trim();
    if (trimmed === 'left *') return [{ side: 'left', wildcard: true }];
    if (trimmed === 'right *') return [{ side: 'right', wildcard: true }];
    const match = /^(.+?)(?:\s+as\s+(.+))?$/.exec(trimmed);
    const source = match ? parseFieldRef(match[1]) : null;
    const alias = match?.[2] ? parseFieldRef(match[2]) : null;
    return source
      ? [{ source: toQualifiedName(source), alias: alias ? toFieldName(alias) : undefined }]
      : [];
  });
}

function parseConflict(clauses: Clause[]): Record<string, string> {
  const rightPrefix = findClause(clauses, 'right_prefix');
  const suffix = findClause(clauses, 'suffix');
  if (rightPrefix) return { strategy: 'right_prefix', rightPrefix: unquoteMaybe(rightPrefix) };
  if (suffix) {
    const parts = suffix.split(/\s+/);
    return {
      strategy: 'suffix',
      leftSuffix: unquoteMaybe(parts[0] ?? '_left'),
      rightSuffix: unquoteMaybe(parts[1] ?? '_right'),
    };
  }
  return { strategy: 'suffix', leftSuffix: '_left', rightSuffix: '_right' };
}

function parseClauses(text: string, names: string[]): Clause[] {
  const clauses: Clause[] = [];
  let remaining = text.trim();
  while (remaining) {
    const clause = findFirstTopLevelKeyword(remaining, names);
    if (!clause) break;
    const afterName = remaining.slice(clause.index + clause.keyword.length).trimStart();
    const nextClause = findFirstTopLevelKeyword(afterName, names);
    clauses.push({
      name: clause.keyword,
      value: afterName.slice(0, nextClause?.index ?? afterName.length).trim(),
    });
    remaining = nextClause ? afterName.slice(nextClause.index) : '';
  }
  return clauses;
}

function findClause(clauses: Clause[], name: string): string | undefined {
  return clauses.find((clause) => clause.name === name)?.value;
}

function unquoteMaybe(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? unquoteString(trimmed) : trimmed;
}

function formatJoin(config: Record<string, unknown> | undefined): string {
  const joinType = String(config?.joinType ?? 'left');
  const rightInput = String(config?.rightInput ?? 'right_source');
  if (joinType === 'asof') {
    const asof = objectValue(config?.asof);
    const parts = [
      `join asof ${rightInput} on ${formatFieldRef(String(asof?.leftTime ?? 'left.time'))} ${String(
        asof?.operator ?? '>='
      )} ${formatFieldRef(String(asof?.rightTime ?? `${rightInput}.time`))}`,
    ];
    const by = formatConditions(asof?.by);
    if (by) parts.push(`by ${by}`);
    if (typeof asof?.tolerance === 'string') parts.push(`tolerance ${asof.tolerance}`);
    appendCommonParts(parts, config);
    return parts.join(' ');
  }
  const parts = [`join ${joinType} ${rightInput}`];
  const conditions = formatConditions(config?.conditions);
  if (joinType !== 'cross') parts.push(`on ${conditions || '[left].[id] = [right_source].[id]'}`);
  appendCommonParts(parts, config);
  return parts.join(' ');
}

function appendCommonParts(parts: string[], config: Record<string, unknown> | undefined): void {
  const keep = formatKeep(config?.keep);
  if (keep) parts.push(`keep ${keep}`);
  const conflict = formatConflict(config?.conflict);
  if (conflict) parts.push(conflict);
}

function formatConflict(value: unknown): string | null {
  const conflict = objectValue(value);
  if (!conflict) return null;
  if (conflict.strategy === 'right_prefix' && typeof conflict.rightPrefix === 'string') {
    return `right_prefix ${quoteString(conflict.rightPrefix)}`;
  }
  if (conflict.strategy !== 'suffix') return null;
  return `suffix ${String(conflict.leftSuffix ?? '_left')} ${String(
    conflict.rightSuffix ?? '_right'
  )}`;
}

function formatConditions(value: unknown): string {
  return objectArray(value)
    .map(
      (condition) =>
        `${formatFieldRef(String(condition.left ?? 'left.id'))} ${String(
          condition.operator || '='
        )} ${formatFieldRef(String(condition.right ?? 'right.id'))}`
    )
    .join(' and ');
}

function formatKeep(value: unknown): string {
  return objectArray(value)
    .map((item) => {
      if (item.wildcard) return `${String(item.side ?? 'left')} *`;
      const alias = typeof item.alias === 'string' ? ` as ${formatFieldRef(item.alias)}` : '';
      return `${formatFieldRef(String(item.source ?? 'right.field'))}${alias}`;
    })
    .join(', ');
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
