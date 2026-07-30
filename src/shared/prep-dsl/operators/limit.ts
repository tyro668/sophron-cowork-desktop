import { createOperator, type OperatorDslCodec } from './codec';
import { prepDslLexer } from '../tokens';
import { formatSortKeys, parseSortKeys } from './sort';

export const limitCodec: OperatorDslCodec = {
  type: 'limit',
  matches: (text) =>
    text.startsWith('limit ') || text.startsWith('top ') || text.startsWith('sample '),
  parse: ({ text }) => parseLimit(text),
  format: (config) => {
    const limit = Number(config?.limit ?? 100);
    if (config?.mode === 'random') {
      const unit = config?.unit === 'percent' ? ' percent' : ' rows';
      const method = config?.method === 'bernoulli' ? ' bernoulli' : '';
      const seed = typeof config?.seed === 'number' ? ` repeatable ${config.seed}` : '';
      return `sample ${limit}${unit}${method}${seed}`;
    }
    const orderBy = config?.orderBy;
    if (config?.mode === 'fixed' && Array.isArray(orderBy) && orderBy.length > 0) {
      return `top ${limit} by ${formatSortKeys(orderBy) || '[field] desc'}${
        config?.ties ? ' with ties' : ''
      }`;
    }
    const unit = config?.unit === 'percent' ? ' percent' : '';
    const offset = typeof config?.offset === 'number' ? ` offset ${config.offset}` : '';
    return `limit ${limit}${unit}${offset}`;
  },
};

function parseLimit(text: string) {
  const tokens = prepDslLexer.tokenize(text).tokens;
  const images = tokens.map((token) => token.image.toLowerCase());

  if (text.startsWith('top ')) {
    const limit = integerTokenValue(tokens[1]);
    const withTiesIndex = findTopLevelSequence(tokens, ['with', 'ties'], 3);
    const byToken = tokens[2];
    const orderByStart =
      byToken?.image.toLowerCase() === 'by' ? (byToken.endOffset ?? byToken.startOffset) + 1 : 0;
    const orderByEnd = withTiesIndex >= 0 ? tokens[withTiesIndex].startOffset : text.length;
    const orderBy = orderByStart ? text.slice(orderByStart, orderByEnd).trim() : '';
    return createOperator('limit', text, {
      mode: 'fixed',
      limit: limit ?? 0,
      unit: 'rows',
      orderBy: orderBy ? parseSortKeys(orderBy) : [],
      ties: withTiesIndex >= 0 || undefined,
    });
  }

  if (text.startsWith('sample ')) {
    let cursor = 2;
    const limit = integerTokenValue(tokens[1]);
    const unit =
      images[cursor] === 'rows' || images[cursor] === 'percent' ? images[cursor++] : 'rows';
    const method =
      images[cursor] === 'bernoulli' || images[cursor] === 'system' ? images[cursor++] : 'system';
    const hasRepeatable = images[cursor] === 'repeatable';
    const seed = hasRepeatable ? integerTokenValue(tokens[cursor + 1]) : undefined;
    return createOperator('limit', text, {
      mode: 'random',
      limit: limit ?? 0,
      unit,
      method,
      seed,
    });
  }

  let cursor = 2;
  const limit = integerTokenValue(tokens[1]);
  const unit =
    images[cursor] === 'rows' || images[cursor] === 'percent' ? images[cursor++] : 'rows';
  const offset = images[cursor] === 'offset' ? integerTokenValue(tokens[cursor + 1]) : undefined;
  return createOperator('limit', text, {
    mode: 'fixed',
    limit: limit ?? 0,
    unit,
    offset,
  });
}

function integerTokenValue(
  token: ReturnType<typeof prepDslLexer.tokenize>['tokens'][number] | undefined
) {
  if (!token || token.tokenType.name !== 'NumberLiteral') return undefined;
  const value = Number(token.image);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function findTopLevelSequence(
  tokens: ReturnType<typeof prepDslLexer.tokenize>['tokens'],
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
