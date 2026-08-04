import type { PrepAsofJoinConfig, PrepFieldRef, PrepJoinCondition } from '../ast';
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

function validateJoinFieldRef(
  ref: PrepFieldRef | null,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1],
  context: string
): boolean {
  if (!ref) return false;
  if (ref.source === undefined && ref.name.includes('.')) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'invalidJoinFieldRef',
        `${context} field "${ref.name}" must use the [table].[field] form in a join`
      ),
      line: command.line,
    });
    return false;
  }
  return true;
}

function validateConditionSides(
  left: PrepFieldRef | null,
  right: PrepFieldRef | null,
  rightAlias: string | undefined,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1],
  context: string
): void {
  if (!rightAlias) return;
  const rightLower = rightAlias.toLowerCase();
  const isRightAlias = (source?: string) => Boolean(source) && source!.toLowerCase() === rightLower;
  const leftSource = left?.source;
  const rightSource = right?.source;
  if (rightSource && !isRightAlias(rightSource)) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'joinConditionSideMismatch',
        `${context} right side references "${rightSource}" but the right input is "${rightAlias}"; right side must reference the right input`
      ),
      line: command.line,
    });
  }
  if (isRightAlias(leftSource) && rightSource && !isRightAlias(rightSource)) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'joinConditionSideMismatch',
        `${context} left side references the right input "${rightAlias}"; left side must reference the left table`
      ),
      line: command.line,
    });
  }
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
    ['on', 'keep', 'suffix', 'right_prefix'],
    command,
    diagnostics
  );
  const joinType = match[1];
  if (joinType === 'semi' || joinType === 'anti') {
    const invalidClauses = clauses.filter((c) =>
      ['keep', 'suffix', 'right_prefix'].includes(c.name)
    );
    if (invalidClauses.length > 0) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'invalidSemiAntiClause',
          `${joinType} join only supports an "on" condition and outputs all left columns. Remove: ${invalidClauses
            .map((c) => c.name)
            .join(', ')}`
        ),
        line: command.line,
      });
    }
  }
  const rightAlias = match[3] ?? match[2];
  const conditions = parseConditions(
    findClause(clauses, 'on') ?? '',
    rightAlias,
    command,
    diagnostics
  );
  if (match[1] !== 'cross' && conditions.length === 0) {
    diagnostics.push({
      ...createPrepDiagnostic('joinMissingCondition', 'Non-cross join requires an on condition'),
      line: command.line,
    });
  }
  const isSemiAnti = joinType === 'semi' || joinType === 'anti';
  return createOperator('join', command.text, {
    joinType: match[1],
    rightInput: match[2],
    rightAlias,
    conditions,
    keep: isSemiAnti
      ? undefined
      : parseKeep(findClause(clauses, 'keep') ?? '', command, diagnostics),
    conflict: isSemiAnti ? undefined : parseConflict(clauses, command, diagnostics),
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
    ['on', 'by', 'direction', 'tolerance', 'keep', 'suffix', 'right_prefix'],
    command,
    diagnostics
  );
  const rightAlias = match[2] ?? match[1];
  return createOperator('join', command.text, {
    joinType: 'asof',
    rightInput: match[1],
    rightAlias,
    asof: parseAsofClause(
      findClause(clauses, 'on') ?? '',
      findClause(clauses, 'by') ?? '',
      findClause(clauses, 'direction'),
      findClause(clauses, 'tolerance'),
      rightAlias,
      command,
      diagnostics
    ),
    keep: parseKeep(findClause(clauses, 'keep') ?? '', command, diagnostics),
    conflict: parseConflict(clauses, command, diagnostics),
  });
}

function parseAsofClause(
  onClause: string,
  byClause: string,
  direction?: string,
  tolerance?: string,
  rightAlias?: string,
  command?: OperatorCommand,
  diagnostics?: Parameters<OperatorDslCodec['parse']>[1]
): PrepAsofJoinConfig | undefined {
  const match = /^(.+?)\s*(>=|<=|nearest)\s*(.+)$/.exec(onClause.trim());
  const left = match ? parseFieldRefExact(match[1]) : null;
  const right = match ? parseFieldRefExact(match[3]) : null;
  const leftOk = validateJoinFieldRef(
    left,
    command as OperatorCommand,
    diagnostics ?? [],
    'ASOF on'
  );
  const rightOk = validateJoinFieldRef(
    right,
    command as OperatorCommand,
    diagnostics ?? [],
    'ASOF on'
  );
  if (!match || !left || !right || !leftOk || !rightOk) {
    if (diagnostics) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidAsofCondition', 'ASOF join requires a valid on condition'),
        line: command?.line,
      });
    }
    return undefined;
  }
  if (command && diagnostics) {
    validateConditionSides(left, right, rightAlias, command, diagnostics, 'ASOF on');
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
        ? parseEquiConditions(byClause, rightAlias, command, diagnostics)
        : undefined,
  };
}

function parseEquiConditions(
  value: string,
  rightAlias: string | undefined,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
): PrepJoinCondition[] {
  if (!value) return [];
  return splitTopLevelKeyword(value, 'and').flatMap((part) => {
    const match = /^(.+?)\s*(>=|<=|!=|<>|>|=|<)\s*(.+)$/.exec(part.trim());
    const operator = match?.[2] === '<>' ? '!=' : (match?.[2] ?? '=');
    if (operator !== '=') {
      diagnostics.push({
        ...createPrepDiagnostic(
          'invalidAsofByOperator',
          `ASOF by conditions must be equi-joins using "=", got "${operator}"`
        ),
        line: command.line,
      });
      return [];
    }
    const left = match ? parseFieldRefExact(match[1]) : null;
    const right = match ? parseFieldRefExact(match[3]) : null;
    const leftOk = validateJoinFieldRef(left, command, diagnostics, 'ASOF by');
    const rightOk = validateJoinFieldRef(right, command, diagnostics, 'ASOF by');
    if (!left || !right) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidJoinCondition', `Cannot parse join condition: ${part}`),
        line: command.line,
      });
      return [];
    }
    if (!leftOk || !rightOk) return [];
    validateConditionSides(left, right, rightAlias, command, diagnostics, 'ASOF by');
    return [{ left: toQualifiedName(left), operator: '=', right: toQualifiedName(right) }];
  });
}

function parseConditions(
  value: string,
  rightAlias: string | undefined,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
): PrepJoinCondition[] {
  if (!value) return [];
  return splitTopLevelKeyword(value, 'and').flatMap((part) => {
    const match = /^(.+?)\s*(>=|<=|!=|<>|>|=|<)\s*(.+)$/.exec(part.trim());
    const operator = match?.[2] === '<>' ? '!=' : (match?.[2] ?? '=');
    if (operator === '!=') {
      diagnostics.push({
        ...createPrepDiagnostic(
          'invalidJoinOperator',
          `Join condition operator "!=" is not supported. Use "=" for equi-joins or other operators (<, >, <=, >=) for range joins.`
        ),
        line: command.line,
      });
      return [];
    }
    const left = match ? parseFieldRefExact(match[1]) : null;
    const right = match ? parseFieldRefExact(match[3]) : null;
    const leftOk = validateJoinFieldRef(left, command, diagnostics, 'Join on');
    const rightOk = validateJoinFieldRef(right, command, diagnostics, 'Join on');
    if (!left || !right) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidJoinCondition', `Cannot parse join condition: ${part}`),
        line: command.line,
      });
    }
    if (!left || !right || !leftOk || !rightOk) return [];
    validateConditionSides(left, right, rightAlias, command, diagnostics, 'Join on');
    return [
      {
        left: toQualifiedName(left),
        operator,
        right: toQualifiedName(right),
      },
    ];
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
    const sourceOk = validateJoinFieldRef(source, command, diagnostics, 'Join keep');
    if (!source || (match?.[2] && !alias)) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidJoinKeep', `Cannot parse join keep item: ${item}`),
        line: command.line,
      });
    }
    return source && sourceOk
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

function formatJoin(config: Record<string, unknown> | undefined): string {
  const joinType = String(config?.joinType ?? 'left');
  const rightInput = String(config?.rightInput ?? 'right_source');
  const rightAlias =
    typeof config?.rightAlias === 'string' && config.rightAlias.trim()
      ? config.rightAlias
      : rightInput;
  const asClause = rightAlias !== rightInput ? ` as ${rightAlias}` : '';
  if (joinType === 'asof') {
    const asof = objectValue(config?.asof);
    const parts = [
      `join asof ${rightInput}${asClause} on ${formatFieldRef(
        String(asof?.leftTime ?? 'left.time')
      )} ${String(asof?.operator ?? '>=')} ${formatFieldRef(
        String(asof?.rightTime ?? `${rightAlias}.time`)
      )}`,
    ];
    const by = formatConditions(asof?.by);
    if (by) parts.push(`by ${by}`);
    if (typeof asof?.tolerance === 'string') parts.push(`tolerance ${asof.tolerance}`);
    appendCommonParts(parts, config);
    return parts.join(' ');
  }
  const parts = [`join ${joinType} ${rightInput}${asClause}`];
  const conditions = formatConditions(config?.conditions);
  if (joinType !== 'cross') {
    parts.push(
      `on ${conditions || `${formatFieldRef('left.id')} = ${formatFieldRef(`${rightAlias}.id`)}`}`
    );
  }
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
