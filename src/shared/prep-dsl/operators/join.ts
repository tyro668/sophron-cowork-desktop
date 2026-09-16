import {
  ASOF_DIRECTIONS,
  JOIN_EXPECTATIONS,
  REGULAR_JOIN_TYPES,
  isValidAsofTolerance,
} from '../../operator-schemas/join';
import type { PrepAsofJoinConfig, PrepFieldRef, PrepJoinCondition } from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName, toQualifiedName } from '../syntax/fields';
import { quoteString, unquoteString } from '../syntax/literals';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, objectArray, type OperatorCommand, type OperatorDslCodec } from './codec';
import { isCompleteJoinCondition } from '../../operator-completeness';

const REGULAR_CLAUSE_ORDER = new Map([
  ['on', 0],
  ['keep', 1],
  ['suffix', 2],
  ['right_prefix', 2],
  ['expect', 3],
]);
const ASOF_CLAUSE_ORDER = new Map([
  ['on', 0],
  ['by', 1],
  ['direction', 2],
  ['tolerance', 3],
  ['keep', 4],
  ['suffix', 5],
  ['right_prefix', 5],
  ['expect', 6],
]);

function validateJoinFieldRef(
  ref: PrepFieldRef | null,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1],
  context: string
): boolean {
  if (!ref) return false;
  if (!ref.name) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'invalidJoinFieldRef',
        `${context} field must not be empty; use [table].[field] form in a join`
      ),
      line: command.line,
    });
    return false;
  }
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
  if (isRightAlias(leftSource)) {
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
  parse: (command, diagnostics) => parseJoin(command, diagnostics),
  format: (config) => formatJoin(config),
};

function parseJoin(
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
) {
  const cursor = new PrepTokenCursor(command.text, command.line, diagnostics);
  cursor.expect('join', 'invalidJoin');
  const joinKind = cursor.expectOneOf(['asof', ...REGULAR_JOIN_TYPES], 'invalidJoinType');
  const rightInput = cursor.expectIdentifier('invalidJoinRightInput');
  if (!joinKind || !rightInput) return null;
  const rightAlias = cursor.match('as')
    ? (cursor.expectIdentifier('invalidJoinAlias') ?? rightInput)
    : rightInput;
  return joinKind === 'asof'
    ? parseAsofJoin(cursor, rightInput, rightAlias, command, diagnostics)
    : parseRegularJoin(
        cursor,
        joinKind as (typeof REGULAR_JOIN_TYPES)[number],
        rightInput,
        rightAlias,
        command,
        diagnostics
      );
}

function parseRegularJoin(
  cursor: PrepTokenCursor,
  joinType: (typeof REGULAR_JOIN_TYPES)[number],
  rightInput: string,
  rightAlias: string,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
) {
  let conditions: PrepJoinCondition[] = [];
  let keep: unknown[] | undefined;
  let conflict: Record<string, string> = {
    strategy: 'suffix',
    leftSuffix: '_left',
    rightSuffix: '_right',
  };
  let expectation: (typeof JOIN_EXPECTATIONS)[number] | undefined;
  let conflictClause: string | undefined;
  const seen = new Set<string>();
  let lastOrder = -1;

  while (!cursor.eof) {
    const clause = consumeClauseName(cursor, REGULAR_CLAUSE_ORDER, seen, lastOrder);
    if (!clause) break;
    lastOrder = Math.max(lastOrder, REGULAR_CLAUSE_ORDER.get(clause) ?? lastOrder);
    switch (clause) {
      case 'on':
        conditions = parseConditionList(cursor, rightAlias, command, diagnostics, false);
        break;
      case 'keep':
        keep = parseKeep(cursor, REGULAR_CLAUSE_ORDER, command, diagnostics);
        break;
      case 'suffix':
      case 'right_prefix':
        if (conflictClause && conflictClause !== clause) {
          cursor.report(
            'conflictingJoinOptions',
            'Join cannot use suffix and right_prefix together'
          );
        }
        conflictClause = clause;
        conflict = parseConflict(cursor, clause, REGULAR_CLAUSE_ORDER);
        break;
      case 'expect':
        expectation =
          (cursor.expectOneOf(JOIN_EXPECTATIONS, 'invalidJoinExpectation') as
            | (typeof JOIN_EXPECTATIONS)[number]
            | null) ?? undefined;
        break;
    }
  }

  if (joinType !== 'cross' && conditions.length === 0) {
    cursor.report('joinMissingCondition', 'Non-cross join requires an on condition');
  }
  const isSemiAnti = joinType === 'semi' || joinType === 'anti';
  if (isSemiAnti && (keep || conflictClause)) {
    cursor.report(
      'invalidSemiAntiClause',
      `${joinType} join only supports an "on" condition and outputs all left columns`
    );
  }
  cursor.expectEof('unexpectedJoinToken');
  return createOperator('join', command.text, {
    joinType,
    rightInput,
    rightAlias,
    conditions,
    keep: isSemiAnti ? undefined : keep,
    conflict: isSemiAnti ? undefined : conflict,
    expect: expectation,
  });
}

function parseAsofJoin(
  cursor: PrepTokenCursor,
  rightInput: string,
  rightAlias: string,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
) {
  let on: PrepAsofJoinConfig | undefined;
  let keep: unknown[] | undefined;
  let conflict: Record<string, string> = {
    strategy: 'suffix',
    leftSuffix: '_left',
    rightSuffix: '_right',
  };
  let expectation: (typeof JOIN_EXPECTATIONS)[number] | undefined;
  let conflictClause: string | undefined;
  const seen = new Set<string>();
  let lastOrder = -1;

  while (!cursor.eof) {
    const clause = consumeClauseName(cursor, ASOF_CLAUSE_ORDER, seen, lastOrder);
    if (!clause) break;
    lastOrder = Math.max(lastOrder, ASOF_CLAUSE_ORDER.get(clause) ?? lastOrder);
    switch (clause) {
      case 'on':
        on = parseAsofOn(cursor, rightAlias, command, diagnostics);
        break;
      case 'by':
        if (!on) on = emptyAsofConfig();
        on.by = parseConditionList(cursor, rightAlias, command, diagnostics, true);
        break;
      case 'direction':
        if (!on) on = emptyAsofConfig();
        on.direction =
          (cursor.expectOneOf(ASOF_DIRECTIONS, 'invalidAsofDirection') as
            | (typeof ASOF_DIRECTIONS)[number]
            | null) ?? undefined;
        break;
      case 'tolerance': {
        if (!on) on = emptyAsofConfig();
        const start = cursor.index;
        while (!cursor.eof && !isClauseStart(cursor, ASOF_CLAUSE_ORDER)) cursor.consume();
        const tolerance = cursor.slice(start).trim();
        if (!tolerance || !isValidAsofTolerance(tolerance)) {
          cursor.report('invalidAsofTolerance', `Invalid ASOF tolerance: ${tolerance}`);
        }
        on.tolerance = tolerance || undefined;
        break;
      }
      case 'keep':
        keep = parseKeep(cursor, ASOF_CLAUSE_ORDER, command, diagnostics);
        break;
      case 'suffix':
      case 'right_prefix':
        if (conflictClause && conflictClause !== clause) {
          cursor.report(
            'conflictingJoinOptions',
            'Join cannot use suffix and right_prefix together'
          );
        }
        conflictClause = clause;
        conflict = parseConflict(cursor, clause, ASOF_CLAUSE_ORDER);
        break;
      case 'expect':
        expectation =
          (cursor.expectOneOf(JOIN_EXPECTATIONS, 'invalidJoinExpectation') as
            | (typeof JOIN_EXPECTATIONS)[number]
            | null) ?? undefined;
        break;
    }
  }

  if (!on?.leftTime || !on.rightTime) {
    cursor.report('invalidAsofCondition', 'ASOF join requires a valid on condition');
  }
  cursor.expectEof('unexpectedJoinToken');
  return createOperator('join', command.text, {
    joinType: 'asof',
    rightInput,
    rightAlias,
    asof: on,
    keep,
    conflict,
    expect: expectation,
  });
}

function emptyAsofConfig(): PrepAsofJoinConfig {
  return { leftTime: '', operator: '>=', rightTime: '' };
}

function parseAsofOn(
  cursor: PrepTokenCursor,
  rightAlias: string,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
): PrepAsofJoinConfig | undefined {
  const left = cursor.expectFieldRef('invalidAsofCondition', 'invalidJoinFieldRef');
  const operator = consumeJoinOperator(cursor, true);
  const right = cursor.expectFieldRef('invalidAsofCondition', 'invalidJoinFieldRef');
  const leftOk = validateJoinFieldRef(left, command, diagnostics, 'ASOF on');
  const rightOk = validateJoinFieldRef(right, command, diagnostics, 'ASOF on');
  if (!left || !right || !operator || !leftOk || !rightOk) return undefined;
  validateConditionSides(left, right, rightAlias, command, diagnostics, 'ASOF on');
  return {
    leftTime: toQualifiedName(left),
    operator: operator as PrepAsofJoinConfig['operator'],
    rightTime: toQualifiedName(right),
  };
}

function parseConditionList(
  cursor: PrepTokenCursor,
  rightAlias: string,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1],
  equiOnly: boolean
): PrepJoinCondition[] {
  const conditions: PrepJoinCondition[] = [];
  while (!cursor.eof) {
    const left = cursor.expectFieldRef('invalidJoinCondition', 'invalidJoinFieldRef');
    const operator = consumeJoinOperator(cursor, false);
    const right = cursor.expectFieldRef('invalidJoinCondition', 'invalidJoinFieldRef');
    if (!left || !operator || !right) break;
    const leftOk = validateJoinFieldRef(
      left,
      command,
      diagnostics,
      equiOnly ? 'ASOF by' : 'Join on'
    );
    const rightOk = validateJoinFieldRef(
      right,
      command,
      diagnostics,
      equiOnly ? 'ASOF by' : 'Join on'
    );
    if (operator === '!=') {
      cursor.report('invalidJoinOperator', 'Join condition operator "!=" is not supported');
    } else if (equiOnly && operator !== '=') {
      cursor.report(
        'invalidAsofByOperator',
        `ASOF by conditions must be equi-joins using "=", got "${operator}"`
      );
    } else if (leftOk && rightOk) {
      validateConditionSides(
        left,
        right,
        rightAlias,
        command,
        diagnostics,
        equiOnly ? 'ASOF by' : 'Join on'
      );
      conditions.push({ left: toQualifiedName(left), operator, right: toQualifiedName(right) });
    }
    if (!cursor.match('and')) break;
  }
  return conditions;
}

function consumeJoinOperator(cursor: PrepTokenCursor, allowNearest: boolean): string | null {
  const type = cursor.tokenType();
  const byType: Record<string, string> = {
    Equals: '=',
    Gte: '>=',
    Lte: '<=',
    GreaterThan: '>',
    LessThan: '<',
    NotEquals: '!=',
  };
  if (type && byType[type]) {
    cursor.consume();
    return byType[type];
  }
  if (allowNearest && cursor.match('nearest')) return 'nearest';
  cursor.report('invalidJoinOperator', 'Expected a valid join condition operator');
  return null;
}

function parseKeep(
  cursor: PrepTokenCursor,
  clauseOrder: ReadonlyMap<string, number>,
  command: OperatorCommand,
  diagnostics: Parameters<OperatorDslCodec['parse']>[1]
): unknown[] {
  const items: unknown[] = [];
  while (!cursor.eof && !isClauseStart(cursor, clauseOrder)) {
    const side = cursor.image();
    if ((side === 'left' || side === 'right') && cursor.tokenType(1) === 'Star') {
      cursor.consume();
      cursor.consume();
      items.push({ side, wildcard: true });
    } else {
      const source = cursor.expectFieldRef('invalidJoinKeep');
      if (!source) break;
      const sourceOk = validateJoinFieldRef(source, command, diagnostics, 'Join keep');
      const alias = cursor.match('as') ? cursor.expectFieldRef('invalidJoinKeepAlias') : null;
      if (sourceOk) {
        items.push({
          source: toQualifiedName(source),
          alias: alias ? toFieldName(alias) : undefined,
        });
      }
    }
    if (cursor.matchType('Comma')) continue;
    if (!cursor.eof && !isClauseStart(cursor, clauseOrder)) {
      cursor.report('invalidJoinKeep', 'Join keep items must be separated with commas');
    }
    break;
  }
  if (items.length === 0) cursor.report('invalidJoinKeep', 'Join keep requires at least one item');
  return items;
}

function parseConflict(
  cursor: PrepTokenCursor,
  clause: 'suffix' | 'right_prefix',
  clauseOrder: ReadonlyMap<string, number>
): Record<string, string> {
  if (clause === 'right_prefix') {
    return {
      strategy: 'right_prefix',
      rightPrefix: consumeJoinText(cursor, clauseOrder) ?? '',
    };
  }
  const leftSuffix = consumeJoinText(cursor, clauseOrder);
  const rightSuffix = consumeJoinText(cursor, clauseOrder);
  if (!leftSuffix || !rightSuffix) {
    cursor.report('invalidJoinSuffix', 'Join suffix requires left and right values');
  }
  return {
    strategy: 'suffix',
    leftSuffix: leftSuffix ?? '_left',
    rightSuffix: rightSuffix ?? '_right',
  };
}

function consumeJoinText(
  cursor: PrepTokenCursor,
  clauseOrder: ReadonlyMap<string, number>
): string | null {
  const stringToken = cursor.matchType('StringLiteral');
  if (stringToken) return unquoteString(stringToken.image);
  if (isClauseStart(cursor, clauseOrder)) return null;
  return cursor.expectIdentifier('invalidJoinText');
}

function consumeClauseName(
  cursor: PrepTokenCursor,
  order: ReadonlyMap<string, number>,
  seen: Set<string>,
  lastOrder: number
): string | null {
  const name = cursor.image();
  const rank = name === undefined ? undefined : order.get(name);
  if (name === undefined || rank === undefined) {
    cursor.report('unexpectedJoinToken', `Unexpected join token "${cursor.peek()?.image ?? ''}"`);
    return null;
  }
  cursor.consume();
  if (seen.has(name)) cursor.report('duplicateJoinClause', `Duplicate join clause: ${name}`);
  if (rank < lastOrder) {
    cursor.report('invalidJoinClauseOrder', `Join clause "${name}" is out of order`);
  }
  seen.add(name);
  return name;
}

function isClauseStart(cursor: PrepTokenCursor, order: ReadonlyMap<string, number>): boolean {
  const image = cursor.image();
  return image !== undefined && order.has(image);
}

function formatJoin(config: Record<string, unknown> | undefined): string | null {
  const rightInput = String(config?.rightInput ?? '').trim();
  if (!rightInput) return null;
  const joinType = String(config?.joinType ?? 'left');
  const rightAlias =
    typeof config?.rightAlias === 'string' && config.rightAlias.trim()
      ? config.rightAlias
      : rightInput;
  const asClause = rightAlias !== rightInput ? ` as ${rightAlias}` : '';
  if (joinType === 'asof') {
    const asof = objectValue(config?.asof);
    if (!asof || !String(asof?.leftTime ?? '').trim() || !String(asof?.rightTime ?? '').trim()) {
      return null;
    }
    const parts = [
      `join asof ${rightInput}${asClause} on ${formatFieldRef(
        String(asof?.leftTime ?? 'left.time')
      )} ${String(asof?.operator ?? '>=')} ${formatFieldRef(
        String(asof?.rightTime ?? `${rightAlias}.time`)
      )}`,
    ];
    const by = formatConditions(asof?.by);
    if (by) parts.push(`by ${by}`);
    if (typeof asof?.direction === 'string') parts.push(`direction ${asof.direction}`);
    if (typeof asof?.tolerance === 'string') parts.push(`tolerance ${asof.tolerance}`);
    appendCommonParts(parts, config);
    return parts.join(' ');
  }
  const parts = [`join ${joinType} ${rightInput}${asClause}`];
  const conditions = formatConditions(config?.conditions);
  if (joinType !== 'cross') {
    if (!conditions) return null;
    parts.push(`on ${conditions}`);
  }
  appendCommonParts(parts, config);
  return parts.join(' ');
}

function appendCommonParts(parts: string[], config: Record<string, unknown> | undefined): void {
  const keep = formatKeep(config?.keep);
  if (keep) parts.push(`keep ${keep}`);
  const conflict = formatConflict(config?.conflict);
  if (conflict) parts.push(conflict);
  const expectation = config?.expect;
  if (typeof expectation === 'string' && JOIN_EXPECTATIONS.includes(expectation as never)) {
    parts.push(`expect ${expectation}`);
  }
}

function formatConflict(value: unknown): string | null {
  const conflict = objectValue(value);
  if (!conflict) return null;
  if (conflict.strategy === 'right_prefix' && typeof conflict.rightPrefix === 'string') {
    return `right_prefix ${quoteString(conflict.rightPrefix)}`;
  }
  if (conflict.strategy !== 'suffix') return null;
  const leftSuffix = String(conflict.leftSuffix ?? '_left');
  const rightSuffix = String(conflict.rightSuffix ?? '_right');
  if (leftSuffix === '_left' && rightSuffix === '_right') return null;
  return `suffix ${leftSuffix} ${rightSuffix}`;
}

function formatConditions(value: unknown): string {
  return objectArray(value)
    .filter(isCompleteJoinCondition)
    .map(
      (condition) =>
        `${formatFieldRef(String(condition.left))} ${String(
          condition.operator || '='
        )} ${formatFieldRef(String(condition.right))}`
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
