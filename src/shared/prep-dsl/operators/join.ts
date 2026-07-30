import type { PrepAsofJoinConfig, PrepJoinCondition } from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRefExact, toFieldName, toQualifiedName } from '../syntax/fields';
import { quoteString, unquoteString } from '../syntax/literals';
import { findFirstTopLevelKeyword, splitTopLevel, splitTopLevelKeyword } from '../syntax/scanner';
import { PrepTokenCursor } from '../syntax/token-cursor';
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
  const clauses = parseClauses(
    match[4] ?? '',
    ['on', 'keep', 'suffix', 'right_prefix', 'expect'],
    command,
    diagnostics
  );
  const conditions = parseConditions(findClause(clauses, 'on') ?? '', command, diagnostics);
  if (match[1] !== 'cross' && conditions.length === 0) {
    diagnostics.push({
      ...createPrepDiagnostic('joinMissingCondition', 'Non-cross join requires an on condition'),
      line: command.line,
    });
  }
  return createOperator('join', command.text, {
    joinType: match[1],
    rightInput: match[2],
    rightAlias: match[3] ?? match[2],
    conditions,
    keep: parseKeep(findClause(clauses, 'keep') ?? '', command, diagnostics),
    conflict: parseConflict(clauses, command, diagnostics),
    expect: parseExpectation(findClause(clauses, 'expect'), command, diagnostics),
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
  const clauses = parseClauses(
    match[3] ?? '',
    ['on', 'by', 'direction', 'tolerance', 'keep', 'suffix', 'right_prefix', 'expect'],
    command,
    diagnostics
  );
  return createOperator('join', command.text, {
    joinType: 'asof',
    rightInput: match[1],
    rightAlias: match[2] ?? match[1],
    asof: parseAsofClause(
      findClause(clauses, 'on') ?? '',
      findClause(clauses, 'by') ?? '',
      findClause(clauses, 'direction'),
      findClause(clauses, 'tolerance'),
      command,
      diagnostics
    ),
    keep: parseKeep(findClause(clauses, 'keep') ?? '', command, diagnostics),
    conflict: parseConflict(clauses, command, diagnostics),
    expect: parseExpectation(findClause(clauses, 'expect'), command, diagnostics),
  });
}

function parseAsofClause(
  onClause: string,
  byClause: string,
  direction?: string,
  tolerance?: string,
  command?: OperatorCommand,
  diagnostics?: Parameters<OperatorDslCodec['parse']>[1]
): PrepAsofJoinConfig | undefined {
  const match = /^(.+?)\s*(>=|<=|nearest)\s*(.+)$/.exec(onClause.trim());
  const left = match ? parseFieldRefExact(match[1]) : null;
  const right = match ? parseFieldRefExact(match[3]) : null;
  if (!match || !left || !right) {
    if (diagnostics) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidAsofCondition', 'ASOF join requires a valid on condition'),
        line: command?.line,
      });
    }
    return undefined;
  }
  const operator = match[2] as PrepAsofJoinConfig['operator'];
  const expected = operator === '>=' ? 'backward' : operator === '<=' ? 'forward' : 'nearest';
  if (direction && direction !== expected) {
    diagnostics?.push({
      ...createPrepDiagnostic(
        'invalidAsofDirection',
        `ASOF direction '${direction}' conflicts with operator '${operator}'; expected '${expected}'`
      ),
      line: command?.line,
    });
  }
  if (tolerance && !/^(?:\d+(?:\.\d+)?(?:ms|[dhms]))+$/.test(tolerance)) {
    diagnostics?.push({
      ...createPrepDiagnostic('invalidAsofTolerance', `Invalid ASOF tolerance: ${tolerance}`),
      line: command?.line,
    });
  }
  return {
    leftTime: toQualifiedName(left),
    operator,
    rightTime: toQualifiedName(right),
    tolerance,
    by:
      byClause && command && diagnostics
        ? parseConditions(byClause, command, diagnostics)
        : undefined,
  };
}

function parseConditions(
  value: string,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
): PrepJoinCondition[] {
  if (!value) return [];
  return splitTopLevelKeyword(value, 'and').flatMap((part) => {
    const match = /^(.+?)\s*(>=|<=|!=|<>|>|=|<)\s*(.+)$/.exec(part.trim());
    const left = match ? parseFieldRefExact(match[1]) : null;
    const right = match ? parseFieldRefExact(match[3]) : null;
    if (!left || !right) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidJoinCondition', `Cannot parse join condition: ${part}`),
        line: command.line,
      });
    }
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

function parseKeep(
  value: string,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
): unknown[] | undefined {
  if (!value) return undefined;
  return splitTopLevel(value).flatMap((item): unknown[] => {
    const trimmed = item.trim();
    if (trimmed === 'left *') return [{ side: 'left', wildcard: true }];
    if (trimmed === 'right *') return [{ side: 'right', wildcard: true }];
    const match = /^(.+?)(?:\s+as\s+(.+))?$/.exec(trimmed);
    const source = match ? parseFieldRefExact(match[1]) : null;
    const alias = match?.[2] ? parseFieldRefExact(match[2]) : null;
    if (!source || (match?.[2] && !alias)) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidJoinKeep', `Cannot parse join keep item: ${item}`),
        line: command.line,
      });
    }
    return source
      ? [{ source: toQualifiedName(source), alias: alias ? toFieldName(alias) : undefined }]
      : [];
  });
}

function parseConflict(
  clauses: Clause[],
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
): Record<string, string> {
  const rightPrefix = findClause(clauses, 'right_prefix');
  const suffix = findClause(clauses, 'suffix');
  if (rightPrefix && suffix) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'conflictingJoinOptions',
        'Join cannot use suffix and right_prefix together'
      ),
      line: command.line,
    });
  }
  if (rightPrefix) {
    const cursor = new PrepTokenCursor(rightPrefix, command.line, diagnostics);
    const value = consumeJoinText(cursor);
    cursor.expectEof('unexpectedJoinPrefixToken');
    return { strategy: 'right_prefix', rightPrefix: value ?? '' };
  }
  if (suffix) {
    const cursor = new PrepTokenCursor(suffix, command.line, diagnostics);
    const leftSuffix = consumeJoinText(cursor);
    const rightSuffix = consumeJoinText(cursor);
    if (!leftSuffix || !rightSuffix) {
      cursor.report('invalidJoinSuffix', 'Join suffix requires left and right values');
    }
    cursor.expectEof('unexpectedJoinSuffixToken');
    return {
      strategy: 'suffix',
      leftSuffix: leftSuffix ?? '_left',
      rightSuffix: rightSuffix ?? '_right',
    };
  }
  return { strategy: 'suffix', leftSuffix: '_left', rightSuffix: '_right' };
}

function consumeJoinText(cursor: PrepTokenCursor): string | null {
  const stringToken = cursor.matchType('StringLiteral');
  if (stringToken) return unquoteString(stringToken.image);
  return cursor.expectIdentifier('invalidJoinText');
}

function parseClauses(
  text: string,
  names: string[],
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
): Clause[] {
  const clauses: Clause[] = [];
  let remaining = text.trim();
  while (remaining) {
    const clause = findFirstTopLevelKeyword(remaining, names);
    if (!clause || clause.index !== 0) {
      diagnostics.push({
        ...createPrepDiagnostic('unexpectedJoinToken', `Unexpected join syntax: ${remaining}`),
        line: command.line,
      });
      break;
    }
    const afterName = remaining.slice(clause.index + clause.keyword.length).trimStart();
    const nextClause = findFirstTopLevelKeyword(afterName, names);
    if (clauses.some((item) => item.name === clause.keyword)) {
      diagnostics.push({
        ...createPrepDiagnostic('duplicateJoinClause', `Duplicate join clause: ${clause.keyword}`),
        line: command.line,
      });
    }
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

function parseExpectation(
  value: string | undefined,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
): string | undefined {
  if (!value) return undefined;
  if (['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many'].includes(value)) return value;
  diagnostics.push({
    ...createPrepDiagnostic('invalidJoinExpectation', `Invalid join expectation: ${value}`),
    line: command.line,
  });
  return undefined;
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
  if (typeof config?.expect === 'string') parts.push(`expect ${config.expect}`);
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
