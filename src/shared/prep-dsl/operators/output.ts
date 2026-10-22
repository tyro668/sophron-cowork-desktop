import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName } from '../syntax/fields';
import { quoteString, unquoteString } from '../syntax/literals';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, type OperatorDslCodec } from './codec';

export const OUTPUT_MODES = ['replace', 'append', 'error_if_exists', 'merge'] as const;
export const OUTPUT_SCHEMA_POLICIES = ['extend', 'strict', 'ignore'] as const;

export const outputCodec: OperatorDslCodec = {
  type: 'output',
  matches: (text) => text.startsWith('output '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const cursor = new PrepTokenCursor(text, command.line, diagnostics);
    cursor.expect('output', 'invalidOutput');
    // `output table` is the only sink: raw tables are immutable imported sources and
    // file export is a separate (non-pipeline) action, so rawTable/file are not grammar.
    const peek = cursor.peek()?.image;
    if (peek === 'rawTable' || peek === 'file') {
      diagnostics.push({
        ...createPrepDiagnostic(
          'unsupportedOutputDestination',
          `Output destination "${peek}" is not supported in pipeline workflows; use "output table" instead`,
          { value: peek }
        ),
        line: command.line,
      });
      return createOperator('output', text, {});
    }
    const target = cursor.expect('table', 'invalidOutputTarget');
    const targetLiteral = cursor.expectStringLiteral('invalidOutputName');
    let mode = 'replace';
    const mergeKeys: string[] = [];
    let schemaPolicy: string | undefined;
    let name: string | undefined;
    const seenOptions = new Set<string>();
    while (!cursor.eof) {
      if (cursor.match('mode')) {
        if (seenOptions.has('mode')) {
          cursor.report('duplicateOutputOption', 'Duplicate output mode option');
          break;
        }
        seenOptions.add('mode');
        mode = cursor.expectOneOf([...OUTPUT_MODES], 'invalidOutputMode') ?? mode;
        if (mode === 'merge' && cursor.match('by')) {
          while (!cursor.eof) {
            const field = cursor.expectFieldRef('invalidOutputMergeKeys');
            if (!field) break;
            const key = toFieldName(field).trim();
            if (key) mergeKeys.push(key);
            if (!cursor.matchType('Comma')) break;
          }
        }
      } else if (cursor.match('schema')) {
        if (seenOptions.has('schema')) {
          cursor.report('duplicateOutputOption', 'Duplicate output schema option');
          break;
        }
        seenOptions.add('schema');
        schemaPolicy =
          cursor.expectOneOf([...OUTPUT_SCHEMA_POLICIES], 'invalidOutputSchemaPolicy') ?? undefined;
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
    if (mode === 'merge' && mergeKeys.length === 0) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'invalidOutputMergeKeys',
          'mode merge requires by [key], [key], ... business key columns'
        ),
        line: command.line,
      });
    }
    if (mode !== 'merge' && mergeKeys.length > 0) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'invalidOutputMergeKeys',
          'by <keys> is only valid with mode merge'
        ),
        line: command.line,
      });
    }
    const targetValue = unquoteString(targetLiteral ?? '""');
    return createOperator('output', text, {
      destination: 'duckdb_table',
      table: targetValue,
      mode,
      mergeKeys: mergeKeys.length > 0 ? mergeKeys : undefined,
      schemaPolicy,
      name,
    });
  },
  format: (config) => {
    const target = `table ${quoteString(
      String(config?.resultTableName ?? config?.table ?? 'clean_result')
    )}`;
    const modeValue = String(config?.mode ?? 'replace');
    const mergeKeys =
      modeValue === 'merge'
        ? (config?.mergeKeys as unknown[] | undefined)
            ?.map((key) => formatFieldRef(String(key)))
            .filter(Boolean)
        : undefined;
    const mode =
      modeValue === 'merge'
        ? mergeKeys && mergeKeys.length > 0
          ? ` mode merge by ${mergeKeys.join(', ')}`
          : ' mode merge'
        : ` mode ${modeValue}`;
    const schema =
      typeof config?.schemaPolicy === 'string' && config.schemaPolicy !== 'extend'
        ? ` schema ${config.schemaPolicy}`
        : '';
    const name = typeof config?.name === 'string' ? ` name ${quoteString(config.name)}` : '';
    return `output ${target}${mode}${schema}${name}`;
  },
};
