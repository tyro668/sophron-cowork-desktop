import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, objectArray, stringArray, type OperatorDslCodec } from './codec';

export const calculateFieldCodec: OperatorDslCodec = {
  type: 'calculate_field',
  matches: (text) => text.startsWith('derive '),
  parse: ({ text }) => {
    const calculations = splitTopLevel(text.slice(7)).flatMap(parseCalculation);
    return createOperator('calculate_field', text, { calculations });
  },
  format: (config) => {
    const calculations = objectArray(config?.calculations).map(formatCalculation);
    return `derive ${calculations.join(', ') || '[new_field] = null'}`;
  },
};

function parseCalculation(part: string): Array<Record<string, unknown>> {
  const equals = part.indexOf('=');
  if (equals < 0) return [];
  const field = parseFieldRef(part.slice(0, equals));
  if (!field) return [];
  const expression = part.slice(equals + 1).trim();
  const open = expression.indexOf('(');
  if (open <= 0) return [{ field: toFieldName(field), expression }];

  const close = expression.lastIndexOf(')');
  const functionName = expression.slice(0, open);
  const args = splitTopLevel(expression.slice(open + 1, close)).map((arg) => arg.trim());
  const partitionBy = parsePartitionBy(expression.slice(close + 1).trim());
  if (functionName === 'period_compare' && args.length >= 3) {
    const modes: Record<string, string> = {
      yoy_diff: 'period_yoy_value',
      yoy_rate: 'period_yoy_rate',
      yoy_prev: 'period_yoy_prev',
      mom_diff: 'period_mom_value',
      mom_rate: 'period_mom_rate',
      mom_prev: 'period_mom_prev',
    };
    return [
      {
        field: toFieldName(field),
        expression: '',
        fn: modes[args[0]] || `period_${args[0]}`,
        fnArg: fieldName(args[1]) || args[1],
        orderBy: orderBy(args[2]),
        partitionBy,
      },
    ];
  }
  if (functionName === 'accumulate' && args.length >= 4) {
    const windowType = args[0].toLowerCase();
    const aggregate =
      args[1].toLowerCase() === 'distinct' ? 'distinct_count' : args[1].toLowerCase();
    const extra = args[4];
    let fn = '';
    let fnArg2 = '';
    let fiscalStartMonth = 0;
    if (['ytd', 'qtd', 'mtd', 'wtd'].includes(windowType)) {
      fn = `${windowType}_${aggregate}`;
      if (extra?.startsWith('fiscal_start=')) {
        fiscalStartMonth = Number.parseInt(extra.split('=')[1], 10);
      }
    } else if (windowType === 'rolling' || windowType.startsWith('rolling_')) {
      const count = extra || '1';
      const granularity =
        windowType === 'rolling' ? args[5]?.toLowerCase() || 'year' : windowType.slice(8);
      fn = `rolling_${granularity}_${aggregate}`;
      fnArg2 = count;
    }
    return [
      {
        field: toFieldName(field),
        expression: '',
        fn,
        fnArg: fieldName(args[2]),
        fnArg2: fnArg2 || undefined,
        orderBy: orderBy(args[3]),
        fiscalStartMonth: fiscalStartMonth > 0 ? fiscalStartMonth : undefined,
        partitionBy,
      },
    ];
  }
  return [{ field: toFieldName(field), expression }];
}

function parsePartitionBy(value: string): string[] | undefined {
  const match = /^over\(partition\s+by\s+(.+)\)$/i.exec(value);
  if (!match) return undefined;
  return splitTopLevel(match[1]).flatMap((part) => {
    const field = parseFieldRef(part);
    return field ? [toFieldName(field)] : [];
  });
}

function fieldName(value: string): string {
  return parseFieldRef(value)?.name ?? '';
}

function orderBy(value: string): Array<Record<string, string>> | undefined {
  const field = parseFieldRef(value);
  return field ? [{ field: toFieldName(field), direction: 'asc' }] : undefined;
}

function formatCalculation(calculation: Record<string, unknown>): string {
  const fn = String(calculation.fn ?? '');
  const fnArg = String(calculation.fnArg ?? '');
  const fnArg2 = String(calculation.fnArg2 ?? '');
  const order = objectArray(calculation.orderBy);
  const dateField = order.length > 0 ? String(order[0].field ?? '') : '';
  const fiscalStartMonth = Number(calculation.fiscalStartMonth ?? 0);
  const partitionBy = stringArray(calculation.partitionBy);
  const over =
    partitionBy.length > 0
      ? ` over(partition by ${partitionBy.map(formatFieldRef).join(', ')})`
      : '';
  const target = formatFieldRef(String(calculation.field ?? 'new_field'));

  if (fn.startsWith('period_yoy') || fn.startsWith('period_mom')) {
    const modes: Record<string, string> = {
      period_yoy_value: 'yoy_diff',
      period_yoy_rate: 'yoy_rate',
      period_yoy_prev: 'yoy_prev',
      period_mom_value: 'mom_diff',
      period_mom_rate: 'mom_rate',
      period_mom_prev: 'mom_prev',
    };
    const args = [modes[fn] || fn, formatFieldRef(fnArg), formatFieldRef(dateField)]
      .filter(Boolean)
      .join(', ');
    return `${target} = period_compare(${args})${over}`;
  }

  const prefix = [
    'ytd_',
    'qtd_',
    'mtd_',
    'wtd_',
    'rolling_year_',
    'rolling_month_',
    'rolling_day_',
    'rolling_week_',
  ].find((candidate) => fn.startsWith(candidate));
  if (prefix) {
    const rawPrefix = prefix.replace(/_$/, '');
    const rolling = rawPrefix.startsWith('rolling_');
    const args = [
      rawPrefix,
      fn.slice(prefix.length),
      formatFieldRef(fnArg),
      formatFieldRef(dateField),
    ];
    if (rolling && fnArg2) args.push(fnArg2, rawPrefix.slice(8));
    else if (!rolling && fiscalStartMonth > 1) args.push(`fiscal_start=${fiscalStartMonth}`);
    return `${target} = accumulate(${args.filter(Boolean).join(', ')})${over}`;
  }
  return `${target} = ${String(calculation.expression ?? 'null')}`;
}
