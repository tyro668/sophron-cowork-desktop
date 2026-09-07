import type { PrepDiagnostic } from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, type OperatorDslCodec } from './codec';
import { formatSortKeys, parseSortKeys } from './sort';

export const limitCodec: OperatorDslCodec = {
  type: 'limit',
  matches: (text) =>
    text.startsWith('limit ') || text.startsWith('top ') || text.startsWith('sample '),
  parse: (command, diagnostics) => parseLimit(command.text, command.line, diagnostics),
  format: (config) => {
    if (
      typeof config?.limit !== 'number' ||
      !Number.isSafeInteger(config.limit) ||
      config.limit < 1
    ) {
      return null;
    }
    const limit = config.limit;
    if (config?.mode === 'random') {
      const isPercent = config?.unit === 'percent';
      const unit = isPercent ? ' percent' : ' rows';
      const method = isPercent && config?.method === 'bernoulli' ? ' bernoulli' : '';
      const seed = typeof config?.seed === 'number' ? ` repeatable ${config.seed}` : '';
      return `sample ${limit}${unit}${method}${seed}`;
    }
    const orderBy = config?.orderBy;
    if (config?.mode === 'fixed' && Array.isArray(orderBy) && orderBy.length > 0) {
      const unit = config?.unit === 'percent' ? ' percent' : '';
      const offset =
        config?.unit !== 'percent' && typeof config?.offset === 'number' && config.offset > 0
          ? ` offset ${config.offset}`
          : '';
      return `top ${limit}${unit} by ${formatSortKeys(orderBy) || '[field] desc'}${offset}${
        config?.ties ? ' with ties' : ''
      }`;
    }
    const unit = config?.unit === 'percent' ? ' percent' : '';
    const offset =
      config?.unit !== 'percent' && typeof config?.offset === 'number' && config.offset > 0
        ? ` offset ${config.offset}`
        : '';
    return `limit ${limit}${unit}${offset}`;
  },
};

function parseLimit(text: string, line: number, diagnostics: PrepDiagnostic[]) {
  const cursor = new PrepTokenCursor(text, line, diagnostics);
  if (text.startsWith('top ')) {
    cursor.expect('top', 'invalidTop');
    const limit = cursor.expectPositiveInteger('invalidLimit');
    const unit = cursor.expectOneOfIfPresent(['rows', 'percent']) ?? 'rows';
    validatePercentLimit(limit, unit, line, diagnostics);
    cursor.expect('by', 'invalidTop');
    const orderByStart = cursor.index;
    const offsetIndex = findTopLevelSequence(cursor.tokens, ['offset'], orderByStart);
    const withTiesIndex = findTopLevelSequence(cursor.tokens, ['with', 'ties'], orderByStart);
    const suffixIndexes = [offsetIndex, withTiesIndex].filter((index) => index >= 0);
    const orderByEnd = suffixIndexes.length > 0 ? Math.min(...suffixIndexes) : cursor.tokens.length;
    const orderByText = cursor.slice(orderByStart, orderByEnd);
    const orderBy = parseSortKeys(orderByText, line, diagnostics);
    const suffixCursor = new PrepTokenCursor(
      cursor.slice(orderByEnd, cursor.tokens.length),
      line,
      diagnostics
    );
    let offset: number | undefined;
    if (suffixCursor.match('offset')) {
      offset = suffixCursor.expectNonNegativeInteger('invalidLimitOffset') ?? undefined;
    }
    let ties = false;
    if (suffixCursor.match('with')) {
      ties = Boolean(suffixCursor.expect('ties', 'invalidTop'));
    }
    suffixCursor.expectEof('unexpectedTopToken');
    if (unit === 'percent' && offset !== undefined) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'invalidPercentOffset',
          'Percentage-based top does not support offset'
        ),
        line,
      });
    }
    return createOperator('limit', text, {
      mode: 'fixed',
      limit: limit ?? 0,
      unit,
      orderBy,
      ties: ties || undefined,
      offset,
    });
  }

  if (text.startsWith('sample ')) {
    cursor.expect('sample', 'invalidSample');
    const limit = cursor.expectPositiveInteger('invalidLimit');
    const unit = cursor.expectOneOfIfPresent(['rows', 'percent']) ?? 'rows';
    validatePercentLimit(limit, unit, line, diagnostics);
    const specifiedMethod = cursor.expectOneOfIfPresent(['bernoulli', 'system']);
    if (unit === 'rows' && specifiedMethod) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'invalidSampleMethodForRows',
          'Fixed-row sampling always uses reservoir sampling'
        ),
        line,
      });
    }
    const method = unit === 'percent' ? (specifiedMethod ?? 'system') : undefined;
    let seed: number | undefined;
    if (cursor.match('repeatable')) {
      seed = cursor.expectNonNegativeInteger('invalidSampleSeed') ?? undefined;
    }
    cursor.expectEof('unexpectedSampleToken');
    return createOperator('limit', text, {
      mode: 'random',
      limit: limit ?? 0,
      unit,
      method,
      seed,
    });
  }

  cursor.expect('limit', 'invalidLimit');
  const limit = cursor.expectPositiveInteger('invalidLimit');
  const unit = cursor.expectOneOfIfPresent(['rows', 'percent']) ?? 'rows';
  validatePercentLimit(limit, unit, line, diagnostics);
  let offset: number | undefined;
  if (cursor.match('offset')) {
    offset = cursor.expectNonNegativeInteger('invalidLimitOffset') ?? undefined;
  }
  if (unit === 'percent' && offset !== undefined) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'invalidPercentOffset',
        'Percentage-based limit does not support offset'
      ),
      line,
    });
  }
  cursor.expectEof('unexpectedLimitToken');
  return createOperator('limit', text, {
    mode: 'fixed',
    limit: limit ?? 0,
    unit,
    offset,
  });
}

function validatePercentLimit(
  limit: number | null,
  unit: string,
  line: number,
  diagnostics: PrepDiagnostic[]
): void {
  if (unit !== 'percent' || limit === null || limit <= 100) return;
  diagnostics.push({
    ...createPrepDiagnostic('invalidLimitPercent', 'Percentage cannot exceed 100', {
      limit,
    }),
    line,
  });
}

function findTopLevelSequence(
  tokens: PrepTokenCursor['tokens'],
  sequence: readonly string[],
  start: number
): number {
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const tokenName = tokens[index].tokenType.name;
    if (tokenName === 'LSquare') bracketDepth += 1;
    else if (tokenName === 'RSquare') bracketDepth -= 1;
    else if (tokenName === 'LParen') parenthesisDepth += 1;
    else if (tokenName === 'RParen') parenthesisDepth -= 1;
    if (bracketDepth !== 0 || parenthesisDepth !== 0) continue;
    if (sequence.every((part, offset) => tokens[index + offset]?.image.toLowerCase() === part)) {
      return index;
    }
  }
  return -1;
}
