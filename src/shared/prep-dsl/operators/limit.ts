import { createOperator, type OperatorDslCodec } from './codec';
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
  if (text.startsWith('top ')) {
    const match = /^top\s+(\d+)\s+by\s+(.+?)(?:\s+with\s+ties)?$/is.exec(text);
    return createOperator('limit', text, {
      mode: 'fixed',
      limit: match ? Number(match[1]) : 0,
      unit: 'rows',
      orderBy: match ? parseSortKeys(match[2]) : [],
      ties: match ? /with\s+ties/i.test(text) : undefined,
    });
  }
  if (text.startsWith('sample ')) {
    const match =
      /^sample\s+(\d+)(?:\s+(rows|percent))?(?:\s+(bernoulli|system))?(?:\s+repeatable\s+(\d+))?$/i.exec(
        text
      );
    return createOperator('limit', text, {
      mode: 'random',
      limit: match ? Number(match[1]) : 0,
      unit: match?.[2] ?? 'rows',
      method: match?.[3] ?? 'system',
      seed: match?.[4] ? Number(match[4]) : undefined,
    });
  }
  const match = /^limit\s+(\d+)(?:\s+(rows|percent))?(?:\s+offset\s+(\d+))?$/.exec(text);
  return createOperator('limit', text, {
    mode: 'fixed',
    limit: match ? Number(match[1]) : 0,
    unit: match?.[2] ?? 'rows',
    offset: match?.[3] ? Number(match[3]) : undefined,
  });
}
