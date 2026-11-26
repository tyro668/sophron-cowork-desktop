import { createMetricId, type MetricEntry } from '../../../../shared/operator-schemas';

const EMPTY_METRIC_TEMPLATE: Readonly<Omit<MetricEntry, 'id'>> = {
  function: 'count',
  expression: '',
  alias: '',
};

/** Create a new blank aggregate/pivot metric row with a stable generated ID. */
export function createEmptyMetric<T extends { id?: string } = MetricEntry>(): T {
  return { ...EMPTY_METRIC_TEMPLATE, id: createMetricId() } as unknown as T;
}

/**
 * Inline validation for metric rows (aggregate / pivot): empty expression,
 * duplicate output name, output name colliding with a group-by field.
 */
export interface MetricRowIssue {
  expressionError: boolean;
  aliasError: boolean;
  messages: Array<{ key: string; params?: Record<string, unknown> }>;
}

interface MetricLike {
  function?: string;
  expression?: string;
  alias?: string;
}

export function validateAggregateMetrics(
  metrics: MetricLike[],
  groupBy: string[] = [],
  options: { aliasField?: 'alias'; checkGroupConflict?: boolean } = {}
): MetricRowIssue[] {
  const checkGroup = options.checkGroupConflict ?? true;
  const firstIndex = new Map<string, number>();
  const groupSet = new Set(groupBy);
  return metrics.map((metric, index) => {
    const issue: MetricRowIssue = { expressionError: false, aliasError: false, messages: [] };
    const expression = (metric.expression ?? '').trim();
    if (!expression && metric.function !== 'count') {
      issue.expressionError = true;
      issue.messages.push({ key: 'metricExpressionEmpty' });
    }
    const alias = (metric.alias ?? '').trim();
    if (alias) {
      const prev = firstIndex.get(alias);
      if (prev !== undefined) {
        issue.aliasError = true;
        issue.messages.push({
          key: 'metricAliasDuplicate',
          params: { name: alias, row: prev + 1 },
        });
      } else {
        firstIndex.set(alias, index);
        if (checkGroup && groupSet.has(alias)) {
          issue.aliasError = true;
          issue.messages.push({ key: 'metricAliasGroupConflict', params: { name: alias } });
        }
      }
    }
    return issue;
  });
}
