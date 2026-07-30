import { createPrepDiagnostic } from '../diagnostics';
import { quoteString, unquoteString } from '../syntax/literals';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, type OperatorDslCodec } from './codec';

export const outputCodec: OperatorDslCodec = {
  type: 'output',
  matches: (text) => text.startsWith('output '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const cursor = new PrepTokenCursor(text, command.line, diagnostics);
    cursor.expect('output', 'invalidOutput');
    const target = cursor.expectOneOf(['table', 'dataset', 'file'], 'invalidOutputTarget');
    const targetLiteral = cursor.expectStringLiteral('invalidOutputName');
    let format: string | undefined;
    let mode = 'replace';
    let name: string | undefined;
    const seenOptions = new Set<string>();
    while (!cursor.eof) {
      if (cursor.match('format')) {
        if (seenOptions.has('format')) {
          cursor.report('duplicateOutputOption', 'Duplicate output format option');
          break;
        }
        seenOptions.add('format');
        format = cursor.expectIdentifier('invalidOutputFormat') ?? undefined;
      } else if (cursor.match('mode')) {
        if (seenOptions.has('mode')) {
          cursor.report('duplicateOutputOption', 'Duplicate output mode option');
          break;
        }
        seenOptions.add('mode');
        mode = cursor.expectOneOf(['replace', 'append'], 'invalidOutputMode') ?? mode;
      } else if (cursor.match('name')) {
        if (seenOptions.has('name')) {
          cursor.report('duplicateOutputOption', 'Duplicate output name option');
          break;
        }
        seenOptions.add('name');
        const literal = cursor.expectStringLiteral('invalidOutputName');
        name = literal ? unquoteString(literal) : undefined;
      } else {
        cursor.expectEof('unexpectedOutputToken');
        break;
      }
    }
    if (!target || !targetLiteral) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidOutput', 'Output configuration is incomplete'),
        line: command.line,
      });
    }
    const targetValue = unquoteString(targetLiteral ?? '""');
    return createOperator('output', text, {
      destination: target === 'table' ? 'duckdb_table' : target,
      table: target === 'table' ? targetValue : undefined,
      dataset: target === 'dataset' ? targetValue : undefined,
      filePath: target === 'file' ? targetValue : undefined,
      format,
      mode,
      name,
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
