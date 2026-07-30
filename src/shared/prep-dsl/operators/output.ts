import { quoteString, unquoteString } from '../syntax/literals';
import { createOperator, type OperatorDslCodec } from './codec';

export const outputCodec: OperatorDslCodec = {
  type: 'output',
  matches: (text) => text.startsWith('output '),
  parse: ({ text }) => {
    const match =
      /^output\s+(table|dataset|file)\s+("(?:[^"\\]|\\.)*")(?:\s+format\s+([A-Za-z_][A-Za-z0-9_]*))?(?:\s+mode\s+([A-Za-z_][A-Za-z0-9_]*))?(?:\s+name\s+("(?:[^"\\]|\\.)*"))?$/.exec(
        text
      );
    const target = match?.[1] ?? 'table';
    return createOperator('output', text, {
      destination: target === 'table' ? 'duckdb_table' : target,
      table: target === 'table' ? unquoteString(match?.[2] ?? '"clean_result"') : undefined,
      dataset: target === 'dataset' ? unquoteString(match?.[2] ?? '""') : undefined,
      filePath: target === 'file' ? unquoteString(match?.[2] ?? '""') : undefined,
      format: match?.[3],
      mode: match?.[4] ?? 'replace',
      name: match?.[5] ? unquoteString(match[5]) : undefined,
    });
  },
  format: (config) => {
    const destination = String(config?.destination ?? 'duckdb_table');
    const target =
      destination === 'dataset'
        ? `dataset ${quoteString(String(config?.dataset ?? ''))}`
        : destination === 'file'
          ? `file ${quoteString(String(config?.filePath ?? ''))}`
          : `table ${quoteString(String(config?.table ?? 'clean_result'))}`;
    const format =
      destination === 'file' && typeof config?.format === 'string'
        ? ` format ${config.format}`
        : '';
    const mode = typeof config?.mode === 'string' ? ` mode ${config.mode}` : '';
    const name = typeof config?.name === 'string' ? ` name ${quoteString(config.name)}` : '';
    return `output ${target}${format}${mode}${name}`;
  },
};
