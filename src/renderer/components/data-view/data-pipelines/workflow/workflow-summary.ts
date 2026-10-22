import type { DataWorkflowNode, DataWorkflowOperatorType } from '../../../../types';
import { dataFieldTypeLabel } from '../../../../../shared/data-field-types';
import { DEFAULT_QUANTIFIER, DEFAULT_MATCH } from '../../../../../shared/operator-schemas/set-op';
import type { TranslateFn } from '../../shared';

export interface WorkflowSummaryRow {
  label: string;
  value: string;
  mono?: boolean;
}

export interface WorkflowConfigSummary {
  primary: WorkflowSummaryRow[];
  details: WorkflowSummaryRow[];
}

/**
 * Per-operator summary builder — one entry per operator type (compile-time
 * exhaustive). Registered into `OPERATOR_UI[type].summarize` in
 * `operator-catalog.ts`.
 */
export type WorkflowSummarizer = (
  config: Record<string, unknown>,
  t: TranslateFn
) => WorkflowConfigSummary;

const summarizeInputSource: WorkflowSummarizer = (config, t) => {
  const rawTableName =
    stringValue(config.rawTableName) || stringValue(config.name) || stringValue(config.rawTableId);
  return {
    primary: [summaryRow(t, 'rawTable', rawTableName, true)],
    details: [],
  };
};

const summarizeFieldSelect: WorkflowSummarizer = (config, t) => ({
  primary: [
    summaryRow(
      t,
      'mode',
      translateWorkflowValue(t, 'selectModes', stringValue(config.selection, 'include'))
    ),
    summaryRow(t, 'columns', formatCount(stringArray(config.fields).length)),
  ],
  details: [summaryRow(t, 'fields', formatList(stringArray(config.fields), t), true)],
});

const summarizeFieldMapping: WorkflowSummarizer = (config, t) => ({
  primary: [
    summaryRow(t, 'mappings', formatCount(recordArray(config.mappings).length)),
    summaryRow(t, 'mode', translateWorkflowValue(t, 'mappingModes', getMappingMode(config))),
  ],
  details: [summaryRow(t, 'fields', formatMappings(config.mappings, t), true)],
});

const summarizeFilter: WorkflowSummarizer = (config, t) => ({
  primary: [summaryRow(t, 'condition', stringValue(config.condition), true)],
  details: [],
});

const summarizeDeduplicate: WorkflowSummarizer = (config, t) => ({
  primary: [
    summaryRow(
      t,
      'strategy',
      translateWorkflowValue(
        t,
        'deduplicateStrategies',
        stringValue(config.strategy, 'all_columns')
      )
    ),
    summaryRow(
      t,
      'keep',
      translateWorkflowValue(t, 'keepRules', stringValue(config.keep, 'first'))
    ),
  ],
  details: [
    summaryRow(t, 'columns', formatList(stringArray(config.fields), t), true),
    summaryRow(t, 'orderBy', formatSortKeys(config.orderBy, t), true),
  ],
});

const summarizeMissingValue: WorkflowSummarizer = (config, t) => ({
  primary: [
    summaryRow(
      t,
      'strategy',
      translateWorkflowValue(t, 'missingStrategies', stringValue(config.strategy, 'by_column'))
    ),
    summaryRow(t, 'rules', formatCount(recordArray(config.rules).length)),
  ],
  details: [
    summaryRow(t, 'condition', stringValue(config.condition)),
    summaryRow(t, 'rules', formatMissingRules(config.rules, t), true),
  ],
});

const summarizeTypeConvert: WorkflowSummarizer = (config, t) => ({
  primary: [summaryRow(t, 'conversions', formatCount(recordArray(config.conversions).length))],
  details: [summaryRow(t, 'fields', formatConversions(config.conversions, t), true)],
});

const summarizeSort: WorkflowSummarizer = (config, t) => ({
  primary: [summaryRow(t, 'sortKeys', formatCount(recordArray(config.orderBy).length))],
  details: [summaryRow(t, 'orderBy', formatSortKeys(config.orderBy, t), true)],
});

const summarizeCalculateField: WorkflowSummarizer = (config, t) => ({
  primary: [summaryRow(t, 'calculations', formatCount(recordArray(config.calculations).length))],
  details: [summaryRow(t, 'expression', formatCalculations(config.calculations, t), true)],
});

const summarizeAggregate: WorkflowSummarizer = (config, t) => ({
  primary: [
    summaryRow(t, 'groupBy', formatList(stringArray(config.groupBy), t), true),
    summaryRow(t, 'metrics', formatCount(recordArray(config.metrics).length)),
  ],
  details: [summaryRow(t, 'metrics', formatMetrics(config.metrics, t), true)],
});

const summarizeJoin: WorkflowSummarizer = (config, t) => getJoinConfigSummary(config, t);

const summarizeLimit: WorkflowSummarizer = (config, t) => ({
  primary: [
    summaryRow(t, 'mode', stringValue(config.sampling, 'fixed')),
    summaryRow(t, 'limit', String(config.limit ?? '')),
  ],
  details: [summaryRow(t, 'orderBy', formatSortKeys(config.orderBy, t), true)],
});

const summarizePivot: WorkflowSummarizer = (config, t) => ({
  primary: [
    summaryRow(
      t,
      'columns',
      formatList(
        recordArray(config.on)
          .map((axis) => (typeof axis.field === 'string' ? axis.field : ''))
          .filter(Boolean),
        t
      ),
      true
    ),
    summaryRow(t, 'metrics', formatCount(recordArray(config.using).length)),
  ],
  details: [summaryRow(t, 'groupBy', formatList(stringArray(config.groupBy), t), true)],
});

const summarizeUnpivot: WorkflowSummarizer = (config, t) => ({
  primary: [
    summaryRow(t, 'columns', formatList(stringArray(config.fields), t), true),
    summaryRow(t, 'mode', stringValue(config.selection, 'include')),
  ],
  details: [
    summaryRow(t, 'name', stringValue(config.nameColumn)),
    summaryRow(t, 'value', stringValue(config.valueColumn)),
  ],
});

const summarizeSetOp: WorkflowSummarizer = (config, t) => {
  const rawOperation = stringValue(config.operation, 'union');
  const opValue = t(`data.workflow.summaryLabels.operation_${rawOperation}`);
  const effectiveMatch =
    rawOperation === 'union' ? stringValue(config.match, DEFAULT_MATCH) : 'by_position';
  return {
    primary: [
      summaryRow(t, 'operation', opValue || rawOperation),
      summaryRow(t, 'rightInput', stringValue(config.rightInput)),
    ],
    details: [
      summaryRow(t, 'mode', stringValue(config.quantifier, DEFAULT_QUANTIFIER)),
      ...(rawOperation === 'union' ? [summaryRow(t, 'match', effectiveMatch)] : []),
    ],
  };
};

const summarizeUnnest: WorkflowSummarizer = (config, t) => ({
  primary: [
    summaryRow(t, 'source', stringValue(config.field), false),
    summaryRow(t, 'alias', stringValue(config.alias, 'item'), false),
  ],
  details: [summaryRow(t, 'mode', stringValue(config.sourceKind, 'list'))],
});

const summarizeOutput: WorkflowSummarizer = (config, t) => {
  const configuredStrategy = stringValue(config.outputStrategy);
  const outputStrategy =
    configuredStrategy === 'auto' || configuredStrategy === 'existing'
      ? configuredStrategy
      : stringValue(config.outputResultTableId) || stringValue(config.resultTableId)
        ? 'existing'
        : 'auto';
  const outputDisplayName = stringValue(config.resultTableName) || stringValue(config.table);
  return {
    primary: [
      summaryRow(
        t,
        'outputStrategy',
        translateWorkflowValue(t, 'outputStrategies', outputStrategy)
      ),
      summaryRow(
        t,
        'destination',
        translateWorkflowValue(t, 'destinations', stringValue(config.destination, 'duckdb_table'))
      ),
      summaryRow(t, 'resultTable', outputDisplayName, true),
    ],
    details: [
      summaryRow(
        t,
        'outputMode',
        translateWorkflowValue(t, 'outputModes', stringValue(config.mode, 'replace'))
      ),
      ...(stringValue(config.mode) === 'merge'
        ? [
            summaryRow(
              t,
              'mergeKeys',
              Array.isArray(config.mergeKeys) ? config.mergeKeys.join(', ') : '',
              true
            ),
          ]
        : []),
      ...(stringValue(config.mode) === 'append' || stringValue(config.mode) === 'merge'
        ? [
            summaryRow(
              t,
              'schemaPolicy',
              translateWorkflowValue(
                t,
                'schemaPolicies',
                stringValue(config.schemaPolicy, 'extend')
              )
            ),
          ]
        : []),
    ],
  };
};

const summarizeExpect: WorkflowSummarizer = (config, t) => {
  const kind = stringValue(config.kind, 'expression');
  const assertion =
    kind === 'unique'
      ? `unique ${(Array.isArray(config.fields) ? config.fields : []).join(', ')}`
      : kind === 'row_count'
        ? `rows ${stringValue(config.operator, '>=')} ${config.value ?? 0}`
        : stringValue(config.expression);
  return {
    primary: [summaryRow(t, 'assertion', assertion, true)],
    details: stringValue(config.rejectStream)
      ? [summaryRow(t, 'rejectStream', stringValue(config.rejectStream))]
      : [],
  };
};

/** Exhaustive per-operator summarizers — keyed by the canonical type union. */
export const WORKFLOW_SUMMARIZERS: Record<DataWorkflowOperatorType, WorkflowSummarizer> = {
  input: summarizeInputSource,
  filter: summarizeFilter,
  select: summarizeFieldSelect,
  deduplicate: summarizeDeduplicate,
  missing_value: summarizeMissingValue,
  cast: summarizeTypeConvert,
  sort: summarizeSort,
  join: summarizeJoin,
  aggregate: summarizeAggregate,
  derive: summarizeCalculateField,
  rename: summarizeFieldMapping,
  limit: summarizeLimit,
  pivot: summarizePivot,
  unpivot: summarizeUnpivot,
  set_op: summarizeSetOp,
  unnest: summarizeUnnest,
  expect: summarizeExpect,
  sql: (config, t) => ({
    primary: [
      {
        label: t('data.workflow.formLabels.sqlQuery.query'),
        value: stringValue(config.sql),
        mono: true,
      },
    ],
    details: [],
  }),
  output: summarizeOutput,
};

export function getWorkflowConfigSummary(
  node: DataWorkflowNode,
  t: TranslateFn
): WorkflowConfigSummary {
  const config = node.config;
  const summarize = WORKFLOW_SUMMARIZERS[node.type];
  const summary: WorkflowConfigSummary = summarize
    ? summarize(config, t)
    : { primary: [], details: [] };
  // DSL text is never cached in config; the 结构化表达式 tab derives it.
  return summary;
}

function getJoinConfigSummary(
  config: Record<string, unknown>,
  t: TranslateFn
): WorkflowConfigSummary {
  const joinType = stringValue(config.joinType, 'left');
  const asof = recordValue(config.asof);
  const primary = [
    summaryRow(t, 'joinType', translateWorkflowValue(t, 'joinTypes', joinType)),
    summaryRow(t, 'rightInput', stringValue(config.rightInput)),
  ];
  const details = [
    summaryRow(
      t,
      'conditions',
      joinType === 'asof' ? formatAsof(asof, t) : formatConditions(config.conditions, t),
      true
    ),
    summaryRow(t, 'by', formatConditions(asof?.by, t), true),
    summaryRow(t, 'tolerance', stringValue(asof?.tolerance)),
    summaryRow(t, 'keep', formatJoinKeep(config.keep, t), true),
    summaryRow(t, 'conflict', formatConflict(config.conflict, t)),
  ];
  return { primary, details };
}

function summaryRow(
  t: TranslateFn,
  label: string,
  value: string,
  mono = false
): WorkflowSummaryRow {
  return {
    label: t(`data.workflow.summaryLabels.${label}`),
    value: value || t('data.workflow.values.notSet'),
    mono,
  };
}

export function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
    : [];
}

function formatCount(value: number): string {
  return String(value);
}

function formatList(values: string[], t: TranslateFn, limit = 6): string {
  if (values.length === 0) return t('data.workflow.values.notSet');
  const head = values.slice(0, limit).join(', ');
  const remaining = values.length - limit;
  return remaining > 0 ? `${head}, ${t('data.workflow.values.more', { count: remaining })}` : head;
}

function translateWorkflowValue(
  t: TranslateFn,
  group: string,
  value: string,
  fallback?: string
): string {
  if (!value) return t('data.workflow.values.notSet');
  return t(`data.workflow.values.${group}.${value}`, { defaultValue: fallback ?? value });
}

function getMappingMode(config: Record<string, unknown>): string {
  if (config.targetMode === 'rename') return 'rename';
  return 'map';
}

function formatMappings(value: unknown, t: TranslateFn): string {
  const mappings = recordArray(value).map(
    (item) => `${stringValue(item.source, '?')} -> ${stringValue(item.target, '?')}`
  );
  return formatList(mappings, t);
}

function formatMissingRules(value: unknown, t: TranslateFn): string {
  const rules = recordArray(value).map((rule) => {
    const method = stringValue(rule.method, 'skip');
    const methodLabel = t(`data.workflow.ruleMethods.${method}`, { defaultValue: method });
    const values = Array.isArray(rule.values)
      ? ` (${rule.values.map((item) => String(item)).join(', ')})`
      : '';
    const fillValue = rule.value === undefined ? '' : ` = ${String(rule.value)}`;
    return `${stringValue(rule.field, '?')}: ${methodLabel}${values}${fillValue}`;
  });
  return formatList(rules, t);
}

function formatConversions(value: unknown, t: TranslateFn): string {
  const conversions = recordArray(value).map((item) => {
    const onError = stringValue(item.onError);
    const suffix = onError ? ` (${onError})` : '';
    return `${stringValue(item.field, '?')} -> ${dataFieldTypeLabel(
      stringValue(item.type, 'text')
    )}${suffix}`;
  });
  return formatList(conversions, t);
}

function formatSortKeys(value: unknown, t: TranslateFn): string {
  const keys = recordArray(value).map((item) => {
    const nulls = stringValue(item.nulls);
    return `${stringValue(item.field, '?')} ${stringValue(item.direction, 'asc')}${
      nulls ? ` nulls ${nulls}` : ''
    }`;
  });
  return formatList(keys, t);
}

function formatCalculations(value: unknown, t: TranslateFn): string {
  const calculations = recordArray(value).map(
    (item) => `${stringValue(item.field, '?')} = ${stringValue(item.expression, '?')}`
  );
  return formatList(calculations, t, 4);
}

function formatMetrics(value: unknown, t: TranslateFn): string {
  const metrics = recordArray(value).map(
    (item) =>
      `${stringValue(item.function, 'count')}(${stringValue(item.expression, '*')}) as ${stringValue(
        item.alias,
        '?'
      )}`
  );
  return formatList(metrics, t, 4);
}

function formatConditions(value: unknown, t: TranslateFn): string {
  const conditions = recordArray(value).map(
    (item) =>
      `${stringValue(item.left, '?')} ${stringValue(item.operator, '=')} ${stringValue(item.right, '?')}`
  );
  return formatList(conditions, t, 4);
}

function formatAsof(asof: Record<string, unknown> | null, t: TranslateFn): string {
  if (!asof) return t('data.workflow.values.notSet');
  return `${stringValue(asof.leftTime, '?')} ${stringValue(asof.operator, '>=')} ${stringValue(
    asof.rightTime,
    '?'
  )}`;
}

function formatJoinKeep(value: unknown, t: TranslateFn): string {
  const keep = recordArray(value).map((item) => {
    if (item.wildcard) {
      return `${stringValue(item.side, '?')} *`;
    }
    const alias = stringValue(item.alias);
    return `${stringValue(item.source, '?')}${alias ? ` as ${alias}` : ''}`;
  });
  return formatList(keep, t, 4);
}

function formatConflict(value: unknown, t: TranslateFn): string {
  const conflict = recordValue(value);
  if (!conflict) return t('data.workflow.values.notSet');
  const strategy = stringValue(conflict.strategy, 'right_prefix');
  if (strategy === 'right_prefix') {
    return `${strategy}: ${stringValue(conflict.rightPrefix, '')}`;
  }
  if (strategy === 'suffix') {
    return `${strategy}: ${stringValue(conflict.leftSuffix, '_left')} / ${stringValue(
      conflict.rightSuffix,
      '_right'
    )}`;
  }
  return strategy;
}

/** Compact "in N · out M · dropped/rejected" line for one node-run stat. */
export function formatNodeRunStatLine(
  stat: {
    inputRows: number | null;
    inputRowsByHandle?: Record<string, number>;
    outputRows: number;
    droppedRows?: number;
    rejectedRows?: number;
  },
  t: TranslateFn
): string {
  const input = stat.inputRowsByHandle
    ? `${t('data.workflow.runStatLeft', { count: stat.inputRowsByHandle.left ?? '—' })} ${t(
        'data.workflow.runStatRight',
        { count: stat.inputRowsByHandle.right ?? '—' }
      )}`
    : t('data.workflow.runStatInput', { count: stat.inputRows ?? '—' });
  const parts = [input, t('data.workflow.runStatOutput', { count: stat.outputRows ?? '—' })];
  if (stat.droppedRows != null) {
    parts.push(t('data.workflow.runStatDropped', { count: stat.droppedRows }));
  }
  if (stat.rejectedRows != null) {
    parts.push(t('data.workflow.runStatRejected', { count: stat.rejectedRows }));
  }
  return parts.join(' · ');
}
