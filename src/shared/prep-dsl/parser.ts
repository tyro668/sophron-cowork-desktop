import type {
  PrepAsofJoinConfig,
  PrepDiagnostic,
  PrepFieldRef,
  PrepJoinCondition,
  PrepOperatorAst,
  PrepOperatorParseResult,
  PrepOperatorType,
  PrepParseResult,
  PrepWorkflowAst,
} from './ast';
import { DATA_FIELD_TYPES, isDataFieldType } from '../data-field-types';
import { createPrepDiagnostic } from './diagnostics';
import { prepDslLexer, tokenizePrepDsl } from './tokens';
import { tokenizeExpression } from '../expression-tokenizer';

const OPERATOR_LABELS: Record<PrepOperatorType, string> = {
  input_source: 'input_source',
  filter: 'filter',
  field_select: 'field_select',
  deduplicate: 'deduplicate',
  missing_value: 'missing_value',
  type_convert: 'type_convert',
  sort: 'sort',
  join: 'join',
  aggregate: 'aggregate',
  calculate_field: 'calculate_field',
  field_mapping: 'field_mapping',
  limit: 'limit',
  pivot: 'pivot',
  unpivot: 'unpivot',
  set_op: 'set_op',
  unnest: 'unnest',
  output: 'output',
};

interface NormalizedLine {
  text: string;
  line: number;
}

interface CommandLine {
  text: string;
  line: number;
}

interface Clause {
  name: string;
  value: string;
}

const FIELD_REF_REGEX = '\\[[^\\]]*\\]';
const FIELD_REF_QUALIFIED_REGEX = `${FIELD_REF_REGEX}(?:\\.${FIELD_REF_REGEX})?`;

export function parsePrepDsl(input: string): PrepParseResult {
  const diagnostics = collectInitialDiagnostics(input);

  const lines = normalizeLines(input);
  if (lines.length === 0) {
    return {
      ast: null,
      diagnostics: addError(diagnostics, 'emptyDsl', 'DSL content cannot be empty'),
    };
  }

  const commands = collectCommands(lines);
  if (commands.length === 0) {
    return {
      ast: null,
      diagnostics: addError(diagnostics, 'noCommands', 'No parseable DSL commands found'),
    };
  }

  const sources: PrepOperatorAst[] = [];
  const operators: PrepOperatorAst[] = [];
  let mainSource = '';
  let output: PrepOperatorAst | undefined;
  let cursor = 0;

  while (cursor < commands.length && isInputSource(commands[cursor].text)) {
    const source = parseInputSource(commands[cursor], diagnostics);
    if (source) sources.push(source);
    cursor += 1;
    if (cursor < commands.length && !isInputSource(commands[cursor].text)) {
      break;
    }
  }

  if (cursor < commands.length && commands[cursor].text.startsWith('from ')) {
    mainSource = commands[cursor].text.slice('from '.length).trim();
    cursor += 1;
  } else if (sources.length === 1) {
    mainSource = sourceAlias(sources[0]) ?? 'source';
  } else if (sources.length > 1) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'multiSourceMissingFrom',
        'Multi-source tasks must use from <alias> to choose the main source'
      ),
      line: commands[cursor]?.line,
    });
  }

  if (sources.length === 0 && cursor < commands.length && isInputSource(commands[cursor].text)) {
    const source = parseInputSource(commands[cursor], diagnostics);
    if (source) {
      sources.push(source);
      mainSource = sourceAlias(source) ?? 'source';
    }
    cursor += 1;
  }

  for (; cursor < commands.length; cursor += 1) {
    const command = commands[cursor];
    const operator = parseOperator(command, diagnostics);
    if (!operator) continue;
    if (operator.type === 'output') {
      output = operator;
    } else if (operator.type === 'input_source') {
      sources.push(operator);
    } else {
      operators.push(operator);
    }
  }

  if (sources.length === 0) {
    diagnostics.push(
      createPrepDiagnostic('missingInputSource', 'At least one input source is required')
    );
  }
  if (!mainSource && sources[0]) {
    mainSource = sourceAlias(sources[0]) ?? 'source';
  }

  const ast: PrepWorkflowAst = {
    version: 'prep-dsl/v1',
    sources,
    mainSource,
    operators,
    output,
  };
  return { ast, diagnostics };
}

export function parsePrepOperatorDsl(
  input: string,
  expectedType?: PrepOperatorType
): PrepOperatorParseResult {
  const diagnostics = collectInitialDiagnostics(input);
  const lines = normalizeLines(input);
  if (lines.length === 0) {
    return {
      operator: null,
      diagnostics: addError(diagnostics, 'emptyDsl', 'DSL content cannot be empty'),
    };
  }

  const command = collectOperatorCommand(lines, diagnostics);
  if (!command) {
    return {
      operator: null,
      diagnostics: addError(diagnostics, 'noCommands', 'No parseable DSL commands found'),
    };
  }

  const operator = parseOperator(command, diagnostics);
  if (operator && expectedType && operator.type !== expectedType) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'operatorDslTypeMismatch',
        `Expected ${expectedType} DSL but got ${operator.type}`,
        { expected: expectedType, actual: operator.type }
      ),
      line: command.line,
    });
  }

  return { operator, diagnostics };
}

function parseOperator(
  command: CommandLine,
  diagnostics: PrepDiagnostic[]
): PrepOperatorAst | null {
  const text = command.text;
  if (isInputSource(text)) return parseInputSource(command, diagnostics);
  if (text.startsWith('select '))
    return makeOperator('field_select', text, {
      mode: 'include',
      columns: parseFieldRefs(text.slice(7)).map(toFieldName),
    });
  if (text.startsWith('drop '))
    return makeOperator('field_select', text, {
      mode: 'exclude',
      columns: parseFieldRefs(text.slice(5)).map(toFieldName),
    });
  if (text.startsWith('map ') || text.startsWith('rename '))
    return parseMapping(command, diagnostics);
  if (text.startsWith('filter '))
    return makeOperator('filter', text, { condition: text.slice(7).trim() });
  if (text.startsWith('deduplicate')) return parseDeduplicate(text);
  if (text.startsWith('missing value ')) return parseMissingValue(text);
  if (text.startsWith('cast ')) return parseCast(command, diagnostics);
  if (text.startsWith('sort by ')) return parseSort(text);
  if (text.startsWith('join ')) return parseJoin(command, diagnostics);
  if (text.startsWith('aggregate ')) return parseAggregate(text);
  if (text.startsWith('derive ')) return parseDerive(text);
  if (text.startsWith('limit ') || text.startsWith('top ')) return parseLimit(text);
  if (text.startsWith('pivot ')) return parsePivot(command, diagnostics);
  if (text.startsWith('unpivot ')) return parseUnpivot(text);
  if (text.startsWith('union ') || text.startsWith('intersect ') || text.startsWith('except ')) {
    return parseSetOp(text);
  }
  if (text.startsWith('unnest ') || text.startsWith('explode ')) return parseUnnest(text);
  if (text.startsWith('output ')) return parseOutput(text);
  diagnostics.push({
    ...createPrepDiagnostic('unsupportedCommand', `Unsupported DSL command: ${text}`, {
      value: text,
    }),
    line: command.line,
  });
  return null;
}

function parseInputSource(
  command: CommandLine,
  diagnostics: PrepDiagnostic[]
): PrepOperatorAst | null {
  const text = command.text;
  const lexResult = prepDslLexer.tokenize(text);

  // Collect lexer errors as diagnostics
  for (const err of lexResult.errors) {
    diagnostics.push({
      severity: 'error' as const,
      message: err.message,
      line: command.line + (err.line ?? 1) - 1,
      column: err.column,
    });
  }

  // Filter to meaningful tokens (skip whitespace and comments)
  const tokens = lexResult.tokens.filter(
    (t) => t.tokenType.name !== 'WhiteSpace' && t.tokenType.name !== 'Comment'
  );

  let pos = 0;
  const peek = () => tokens[pos];
  const advance = () => tokens[pos++];
  const atEof = () => pos >= tokens.length;

  const error = (msg: string) => {
    diagnostics.push({
      ...createPrepDiagnostic('invalidInputSource', msg, { value: text }),
      line: command.line,
    });
  };

  function expectIdent(errorMsg: string) {
    const token = peek();
    if (!token || token.tokenType.name !== 'Identifier') {
      error(errorMsg);
      return null;
    }
    advance();
    return token;
  }

  function expectString(errorMsg: string) {
    const token = peek();
    if (!token || token.tokenType.name !== 'StringLiteral') {
      error(errorMsg);
      return null;
    }
    advance();
    return token;
  }

  // Consume "input"
  const t1 = peek();
  if (!t1 || t1.image !== 'input') {
    error('Expected "input"');
    return null;
  }
  advance();

  // Consume "source"
  const t2 = peek();
  if (!t2 || t2.image !== 'source') {
    error('Expected "source"');
    return null;
  }
  advance();

  // Source type: task | file <string> | dataset <string>
  const srcType = peek();
  if (!srcType || srcType.tokenType.name !== 'Identifier') {
    error('Expected "task", "file", or "dataset"');
    return null;
  }
  advance();

  const config: Record<string, unknown> = { dsl: text };

  if (srcType.image === 'task') {
    config.source = 'task';
  } else if (srcType.image === 'file') {
    config.source = 'file';
    const pathToken = expectString('Expected file path string after "file"');
    if (!pathToken) return null;
    config.filePath = unquote(pathToken.image);
  } else if (srcType.image === 'dataset') {
    config.source = 'dataset';
    const idToken = expectString('Expected dataset ID string after "dataset"');
    if (!idToken) return null;
    config.datasetId = unquote(idToken.image);
  } else {
    error(`Unknown source type "${srcType.image}". Expected "task", "file", or "dataset"`);
    return null;
  }

  // Optional keyword-value pairs (order-independent)
  const consumed = new Set<string>();
  while (!atEof()) {
    const kw = peek();
    if (!kw || kw.tokenType.name !== 'Identifier') {
      error(`Unexpected token: ${kw?.image ?? 'EOF'}`);
      return null;
    }

    if (consumed.has(kw.image)) {
      error(`Duplicate keyword "${kw.image}"`);
      return null;
    }

    switch (kw.image) {
      case 'format': {
        advance();
        const fmt = expectIdent('Expected format name after "format"');
        if (!fmt) return null;
        config.format = fmt.image;
        break;
      }
      case 'sheet': {
        advance();
        const s = expectString('Expected sheet name string after "sheet"');
        if (!s) return null;
        config.sheet = unquote(s.image);
        break;
      }
      case 'header': {
        advance();
        const h = peek();
        if (
          !h ||
          h.tokenType.name !== 'Identifier' ||
          (h.image !== 'true' && h.image !== 'false')
        ) {
          error('Expected "true" or "false" after "header"');
          return null;
        }
        advance();
        config.header = h.image === 'true';
        break;
      }
      case 'encoding': {
        advance();
        const enc = expectString('Expected encoding string after "encoding"');
        if (!enc) return null;
        config.encoding = unquote(enc.image);
        break;
      }
      case 'as': {
        advance();
        const alias = expectIdent('Expected alias name after "as"');
        if (!alias) return null;
        config.alias = alias.image;
        break;
      }
      default: {
        error(
          `Unknown keyword "${kw.image}". Expected "format", "sheet", "header", "encoding", or "as"`
        );
        return null;
      }
    }

    consumed.add(kw.image);
  }

  return makeOperator('input_source', text, config);
}

function parseMapping(command: CommandLine, diagnostics: PrepDiagnostic[]): PrepOperatorAst {
  const text = command.text;
  const body = text.startsWith('map ') ? text.slice(4) : text.slice(7);
  const separator = text.startsWith('map ') ? /\s+to\s+/ : /\s+as\s+/;
  const mappings = splitTopLevel(body).flatMap((part) => {
    const pieces = part.split(separator);
    if (pieces.length !== 2) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidFieldMapping', `Cannot parse field mapping: ${part}`, {
          value: part,
        }),
        line: command.line,
      });
      return [];
    }
    const source = parseFieldRef(pieces[0].trim());
    const target = parseFieldRef(pieces[1].trim());
    if (!source || !target) return [];
    return [{ source: toFieldName(source), target: toFieldName(target) }];
  });
  return makeOperator('field_mapping', text, { dsl: text, mappings });
}

function parseDeduplicate(text: string): PrepOperatorAst {
  const byMatch = /\s+by\s+(.+?)(?:\s+keep\s+|\s+order\s+by\s+|$)/.exec(text);
  const keepMatch = /\s+keep\s+(first|last)/.exec(text);
  const orderMatch = /\s+order\s+by\s+(.+)$/.exec(text);
  return makeOperator('deduplicate', text, {
    strategy: byMatch ? 'by_columns' : 'all_columns',
    columns: byMatch ? parseFieldRefs(byMatch[1]).map(toFieldName) : undefined,
    keep: keepMatch?.[1] ?? 'first',
    orderBy: orderMatch ? parseSortKeys(orderMatch[1]) : undefined,
  });
}

function parseMissingValue(text: string): PrepOperatorAst {
  const body = text.slice('missing value '.length);
  if (body.startsWith('row drop when ')) {
    const raw = body.slice('row drop when '.length).trim();
    const inMatch = /\s+in\s+(.+)$/i.exec(raw);
    const condition = inMatch ? raw.slice(0, inMatch.index).trim() : raw;
    const columns = inMatch ? parseFieldRefs(inMatch[1]).map(toFieldName) : undefined;
    return makeOperator('missing_value', text, {
      strategy: condition === 'all_null' ? 'drop_empty_rows' : 'drop_rows_by_nulls',
      condition,
      columns,
    });
  }
  const rules = splitTopLevel(body).map((part) => {
    const field = parseFieldRef(part);
    const afterField = field ? part.slice(field.raw.length).trim() : part;
    if (afterField.startsWith('nullify values ')) {
      return {
        column: field ? toFieldName(field) : '',
        method: 'nullify_values',
        values: parseLiteralList(afterField.slice(15).trim()),
      };
    }
    if (afterField.startsWith('fill ')) {
      const value = afterField.slice(5).trim();
      const methods: Record<string, string> = {
        forward: 'forward_fill',
        backward: 'backward_fill',
        mean: 'mean_fill',
        median: 'median_fill',
        mode: 'mode_fill',
      };
      return {
        column: field ? toFieldName(field) : '',
        method: methods[value] ?? 'literal_fill',
        value: methods[value] ? undefined : parseLiteral(value),
      };
    }
    if (afterField === 'drop rows')
      return { column: field ? toFieldName(field) : '', method: 'drop' };
    return { column: field ? toFieldName(field) : '', method: 'skip' };
  });
  return makeOperator('missing_value', text, { strategy: 'by_column', rules });
}

function parseCast(command: CommandLine, diagnostics: PrepDiagnostic[]): PrepOperatorAst {
  const text = command.text;
  const conversions = splitTopLevel(text.slice(5)).flatMap((part) => {
    const match = /^(.*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/.exec(part.trim());
    if (!match) return [];
    const field = parseFieldRef(match[1].trim());
    const rest = match[3] ?? '';
    const targetType = match[2];
    if (!isDataFieldType(targetType)) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'invalidCastTargetType',
          `Unsupported cast target type: ${targetType}. Use one of ${DATA_FIELD_TYPES.join(', ')}.`,
          { type: targetType }
        ),
        line: command.line,
      });
    }
    return [
      {
        column: field ? toFieldName(field) : match[1].trim(),
        type: targetType,
        format: pickQuotedOption(rest, 'format'),
        onError: pickWordOption(rest, 'on_error') ?? 'null',
        locale: pickQuotedOption(rest, 'locale'),
        timezone: pickQuotedOption(rest, 'timezone'),
      },
    ];
  });
  return makeOperator('type_convert', text, { conversions });
}

function parseSort(text: string): PrepOperatorAst {
  return makeOperator('sort', text, { keys: parseSortKeys(text.slice('sort by '.length)) });
}

function parseAggregate(text: string): PrepOperatorAst {
  const match = /^aggregate\s+(all|by\s+.+?)\s+metrics\s+(.+)$/s.exec(text);
  const groupBy =
    match?.[1] === 'all'
      ? []
      : parseFieldRefs((match?.[1] ?? '').replace(/^by\s+/, '')).map(toFieldName);
  const metrics = parseMetricList(match?.[2] ?? '', true);
  return makeOperator('aggregate', text, { groupBy, metrics });
}

function parseDerive(text: string): PrepOperatorAst {
  const calculations = splitTopLevel(text.slice(7)).flatMap((part) => {
    const index = part.indexOf('=');
    if (index < 0) return [];
    const field = parseFieldRef(part.slice(0, index).trim());
    return field ? [{ field: toFieldName(field), expression: part.slice(index + 1).trim() }] : [];
  });
  return makeOperator('calculate_field', text, { calculations });
}

function parseLimit(text: string): PrepOperatorAst {
  if (text.startsWith('top ')) {
    const match = /^top\s+(\d+)\s+by\s+(.+)$/s.exec(text);
    return makeOperator('limit', text, {
      mode: 'top',
      limit: match ? Number(match[1]) : 0,
      unit: 'rows',
      orderBy: match ? parseSortKeys(match[2]) : [],
    });
  }
  const match = /^limit\s+(\d+)(?:\s+(rows|percent))?(?:\s+offset\s+(\d+))?$/.exec(text);
  return makeOperator('limit', text, {
    mode: 'limit',
    limit: match ? Number(match[1]) : 0,
    unit: match?.[2] ?? 'rows',
    offset: match?.[3] ? Number(match[3]) : undefined,
  });
}

function parsePivot(command: CommandLine, diagnostics: PrepDiagnostic[]): PrepOperatorAst | null {
  const text = command.text;
  const match = /^pivot\s+on\s+(.+?)\s+using\s+(.+?)(?:\s+group\s+by\s+(.+))?$/s.exec(text);
  if (!match) {
    diagnostics.push({
      ...createPrepDiagnostic('invalidPivot', `Cannot parse pivot: ${text}`, { value: text }),
      line: command.line,
    });
    return null;
  }
  const onMatch = /^(.+?)(?:\s+in\s+(\(.+\)))?$/.exec(match[1].trim());
  return makeOperator('pivot', text, {
    on: parseFieldRefs(onMatch?.[1] ?? '').map(toFieldName),
    values: onMatch?.[2] ? parseLiteralList(onMatch[2]) : [],
    using: parseMetricList(match[2], false),
    groupBy: match[3] ? parseFieldRefs(match[3]).map(toFieldName) : [],
  });
}

function parseUnpivot(text: string): PrepOperatorAst {
  const includeNulls = text.startsWith('unpivot include nulls ');
  const body = text.slice(includeNulls ? 'unpivot include nulls '.length : 'unpivot '.length);
  const match = /^(.+?)\s+into\s+name\s+(.+?)\s+value\s+(.+)$/.exec(body);
  const columnSpec = match?.[1].trim() ?? '';
  const nameColumn = match ? parseFieldRef(match[2].trim()) : null;
  const valueColumn = match ? parseFieldRef(match[3].trim()) : null;
  const except = columnSpec.startsWith('columns except ');
  return makeOperator('unpivot', text, {
    mode: except ? 'except' : 'include',
    columns: parseFieldRefs(except ? columnSpec.slice('columns except '.length) : columnSpec).map(
      toFieldName
    ),
    nameColumn: nameColumn ? toFieldName(nameColumn) : '',
    valueColumn: valueColumn ? toFieldName(valueColumn) : '',
    includeNulls,
  });
}

function parseSetOp(text: string): PrepOperatorAst {
  const match = /^(union|intersect|except)\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/.exec(text);
  const rest = match?.[3] ?? '';
  const mode = pickWordOption(rest, 'mode') ?? (match?.[1] === 'union' ? 'distinct' : 'distinct');
  const byMatch = /\s+by\s+(name|position)\b/.exec(rest);
  return makeOperator('set_op', text, {
    operation: match?.[1] ?? 'union',
    rightInput: match?.[2] ?? '',
    mode,
    match: byMatch?.[1] === 'name' ? 'by_name' : 'by_position',
  });
}

function parseUnnest(text: string): PrepOperatorAst {
  const isJson = text.startsWith('explode json ');
  if (isJson) {
    const match = new RegExp(
      `^explode\\s+json\\s+(${FIELD_REF_QUALIFIED_REGEX})\\s+path\\s+("(?:[^"\\\\]|\\\\.)*")\\s+as\\s+(${FIELD_REF_QUALIFIED_REGEX})(.*)$`,
      'u'
    ).exec(text);
    const column = match ? parseFieldRef(match[1].trim()) : null;
    const alias = match ? parseFieldRef(match[3].trim()) : null;
    return makeOperator('unnest', text, {
      sourceKind: 'json',
      column: column ? toFieldName(column) : '',
      path: match ? unquote(match[2]) : '',
      alias: alias ? toFieldName(alias) : '',
      ...parseUnnestOptions(match?.[4] ?? ''),
    });
  }
  const match = new RegExp(
    `^(unnest|explode)\\s+(${FIELD_REF_QUALIFIED_REGEX})\\s+as\\s+(${FIELD_REF_QUALIFIED_REGEX})(.*)$`,
    'u'
  ).exec(text);
  const column = match ? parseFieldRef(match[2].trim()) : null;
  const alias = match ? parseFieldRef(match[3].trim()) : null;
  return makeOperator('unnest', text, {
    sourceKind: 'list',
    column: column ? toFieldName(column) : '',
    alias: alias ? toFieldName(alias) : '',
    ...parseUnnestOptions(match?.[4] ?? ''),
  });
}

function parseOutput(text: string): PrepOperatorAst {
  const match =
    /^output\s+(table|dataset|file)\s+("(?:[^"\\]|\\.)*")(?:\s+format\s+([A-Za-z_][A-Za-z0-9_]*))?(?:\s+mode\s+([A-Za-z_][A-Za-z0-9_]*))?(?:\s+name\s+("(?:[^"\\]|\\.)*"))?$/.exec(
      text
    );
  const target = match?.[1] ?? 'table';
  return makeOperator('output', text, {
    destination: target === 'table' ? 'duckdb_table' : target,
    table: target === 'table' ? unquote(match?.[2] ?? '"clean_result"') : undefined,
    dataset: target === 'dataset' ? unquote(match?.[2] ?? '""') : undefined,
    filePath: target === 'file' ? unquote(match?.[2] ?? '""') : undefined,
    format: match?.[3],
    mode: match?.[4] ?? 'replace',
    name: match?.[5] ? unquote(match[5]) : undefined,
  });
}

function parseJoin(command: CommandLine, diagnostics: PrepDiagnostic[]): PrepOperatorAst | null {
  const text = command.text;
  if (text.startsWith('join asof ')) {
    return parseAsofJoin(command, diagnostics);
  }
  const match =
    /^join\s+(inner|left|right|full|cross|semi|anti)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?(.*)$/s.exec(
      text
    );
  if (!match) {
    diagnostics.push({
      ...createPrepDiagnostic('invalidJoin', `Cannot parse join: ${text}`, { value: text }),
      line: command.line,
    });
    return null;
  }
  const clauses = parseClauses(match[4] ?? '', ['on', 'keep', 'suffix', 'right_prefix', 'expect']);
  const conditions = parseJoinConditions(findClause(clauses, 'on') ?? '');
  return makeOperator('join', text, {
    joinType: match[1],
    rightInput: match[2],
    rightAlias: match[3] ?? match[2],
    conditions,
    keep: parseJoinKeep(findClause(clauses, 'keep') ?? ''),
    cardinality: findClause(clauses, 'expect'),
    conflict: parseJoinConflict(clauses, match[3] ?? match[2]),
  });
}

function parseAsofJoin(
  command: CommandLine,
  diagnostics: PrepDiagnostic[]
): PrepOperatorAst | null {
  const text = command.text;
  const match =
    /^join\s+asof\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?(.*)$/s.exec(text);
  if (!match) {
    diagnostics.push({
      ...createPrepDiagnostic('invalidAsofJoin', `Cannot parse asof join: ${text}`, {
        value: text,
      }),
      line: command.line,
    });
    return null;
  }
  const clauses = parseClauses(match[3] ?? '', [
    'on',
    'by',
    'direction',
    'tolerance',
    'keep',
    'suffix',
    'right_prefix',
    'expect',
  ]);
  const asof = parseAsofClause(
    findClause(clauses, 'on') ?? '',
    findClause(clauses, 'by') ?? '',
    findClause(clauses, 'direction'),
    findClause(clauses, 'tolerance')
  );
  return makeOperator('join', text, {
    joinType: 'asof',
    rightInput: match[1],
    rightAlias: match[2] ?? match[1],
    asof,
    keep: parseJoinKeep(findClause(clauses, 'keep') ?? ''),
    cardinality: findClause(clauses, 'expect'),
    conflict: parseJoinConflict(clauses, match[2] ?? match[1]),
  });
}

function parseAsofClause(
  onClause: string,
  byClause: string,
  direction?: string,
  tolerance?: string
): PrepAsofJoinConfig | undefined {
  const match = /^(.+?)\s*(>=|<=|nearest)\s*(.+)$/.exec(onClause.trim());
  if (!match) return undefined;
  const left = parseFieldRef(match[1].trim());
  const right = parseFieldRef(match[3].trim());
  if (!left || !right) return undefined;
  const op = match[2] as PrepAsofJoinConfig['operator'];
  return {
    leftTime: toQualifiedName(left),
    operator: op,
    rightTime: toQualifiedName(right),
    direction:
      (direction as PrepAsofJoinConfig['direction'] | undefined) ??
      (op === '>=' ? 'backward' : op === '<=' ? 'forward' : 'nearest'),
    tolerance,
    by: byClause ? parseJoinConditions(byClause) : undefined,
  };
}

function parseJoinConditions(value: string): PrepJoinCondition[] {
  if (!value) return [];
  return value.split(/\s+and\s+/).flatMap((part) => {
    const match = /^(.+?)\s*=\s*(.+)$/.exec(part.trim());
    const left = match ? parseFieldRef(match[1].trim()) : null;
    const right = match ? parseFieldRef(match[2].trim()) : null;
    return left && right
      ? [{ left: toQualifiedName(left), operator: '=', right: toQualifiedName(right) }]
      : [];
  });
}

function parseJoinKeep(value: string): unknown[] | undefined {
  if (!value) return undefined;
  return splitTopLevel(value).flatMap((item): unknown[] => {
    const trimmed = item.trim();
    if (trimmed === 'left *') return [{ side: 'left', wildcard: true }];
    if (trimmed === 'right *') return [{ side: 'right', wildcard: true }];
    const match = /^(.+?)(?:\s+as\s+(.+))?$/.exec(trimmed);
    const source = match ? parseFieldRef(match[1].trim()) : null;
    const alias = match?.[2] ? parseFieldRef(match[2].trim()) : null;
    return source
      ? [{ source: toQualifiedName(source), alias: alias ? toFieldName(alias) : undefined }]
      : [];
  });
}

function parseJoinConflict(clauses: Clause[], rightAlias: string): Record<string, string> {
  const rightPrefix = findClause(clauses, 'right_prefix');
  const suffix = findClause(clauses, 'suffix');
  if (rightPrefix) {
    return { strategy: 'right_prefix', rightPrefix: unquoteMaybe(rightPrefix) };
  }
  if (suffix) {
    const parts = suffix.split(/\s+/);
    return {
      strategy: 'suffix',
      leftSuffix: unquoteMaybe(parts[0] ?? '_left'),
      rightSuffix: unquoteMaybe(parts[1] ?? '_right'),
    };
  }
  return { strategy: 'right_prefix', rightPrefix: `${rightAlias}_` };
}

function parseMetricList(value: string, requireAlias: boolean): Array<Record<string, unknown>> {
  return splitTopLevel(value).flatMap((part) => {
    const trimmed = part.trim();
    const metric = /^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)(?:\s+as\s+(.+))?$/.exec(trimmed);
    if (!metric || (requireAlias && !metric[3])) return [];
    const alias = metric[3] ? parseFieldRef(metric[3].trim()) : null;
    return [
      {
        function: metric[1],
        expression: metric[2].trim(),
        alias: alias ? toFieldName(alias) : defaultMetricAlias(metric[1], metric[2]),
      },
    ];
  });
}

function defaultMetricAlias(fn: string, expression: string): string {
  const field = parseFieldRef(expression.trim());
  return field ? `${fn}_${toFieldName(field)}` : fn;
}

function parseUnnestOptions(value: string): Record<string, unknown> {
  const withIndex =
    /\s+with\s+index\s+(.+?)(?:\s+recursive\s+|\s+max_depth\s+|\s+keep\s+parent\s+names\s+|$)/.exec(
      value
    );
  const indexField = withIndex ? parseFieldRef(withIndex[1].trim()) : null;
  const recursive = pickWordOption(value, 'recursive');
  const maxDepth = pickWordOption(value, 'max_depth');
  const keepParentNames = /keep\s+parent\s+names\s+true/.test(value);
  return {
    withIndex: indexField ? toFieldName(indexField) : undefined,
    recursive: recursive === 'true',
    maxDepth: maxDepth ? Number(maxDepth) : undefined,
    keepParentNames,
  };
}

function collectInitialDiagnostics(input: string): PrepDiagnostic[] {
  const diagnostics = tokenizePrepDsl(input).diagnostics;
  const refs = input.match(/\[[^\]]+\]/g) ?? [];
  for (const ref of refs) {
    const inner = ref.slice(1, -1);
    if (inner.includes('.') && !inner.startsWith('`')) {
      diagnostics.push({
        severity: 'error',
        code: 'invalidQualifiedField',
        message: `Invalid field reference ${ref}; use [table_name].[field_name]`,
        params: { value: ref },
      });
    }
  }
  return diagnostics;
}

function collectOperatorCommand(
  lines: NormalizedLine[],
  diagnostics: PrepDiagnostic[]
): CommandLine | null {
  const [first, ...rest] = lines;
  if (!first) return null;
  let text = first.text.startsWith('|') ? first.text.slice(1).trim() : first.text;
  let hasMultipleCommands = false;
  for (const line of rest) {
    if (line.text.startsWith('|') || isTopLevelLine(line.text)) {
      hasMultipleCommands = true;
      continue;
    }
    text = `${text} ${line.text}`;
  }
  if (hasMultipleCommands) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'operatorDslMultipleCommands',
        'Operator DSL must contain exactly one operator command'
      ),
      line: first.line,
    });
  }
  return text ? { text, line: first.line } : null;
}

function normalizeLines(input: string): NormalizedLine[] {
  return input
    .split(/\r?\n/)
    .map((line, index) => ({ text: stripComment(line).trim(), line: index + 1 }))
    .filter((line) => line.text.length > 0);
}

function collectCommands(lines: NormalizedLine[]): CommandLine[] {
  const commands: CommandLine[] = [];
  let current: CommandLine | null = null;
  const flush = () => {
    if (current) commands.push(current);
    current = null;
  };
  for (const line of lines) {
    if (line.text.startsWith('|')) {
      flush();
      current = { text: line.text.slice(1).trim(), line: line.line };
      continue;
    }
    if (isTopLevelLine(line.text)) {
      flush();
      current = { text: line.text, line: line.line };
      continue;
    }
    if (current) {
      current.text = `${current.text} ${line.text}`;
    }
  }
  flush();
  return commands;
}

function isTopLevelLine(text: string): boolean {
  return isInputSource(text) || text.startsWith('from ');
}

function isInputSource(text: string): boolean {
  return text.startsWith('input source ');
}

function makeOperator(
  type: PrepOperatorType,
  dsl: string,
  config: Record<string, unknown>
): PrepOperatorAst {
  return {
    type,
    label: OPERATOR_LABELS[type],
    dsl,
    config: { dsl, ...withoutUndefined(config) },
  };
}

function parseFieldRefs(value: string): PrepFieldRef[] {
  return splitTopLevel(value).flatMap((part) => {
    const field = parseFieldRef(part.trim());
    return field ? [field] : [];
  });
}

function parseFieldRef(value: string): PrepFieldRef | null {
  try {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const tokens = tokenizeExpression(trimmed);
    let idx = 0;

    if (tokens[idx]?.type === 'FieldRef') {
      const raw = tokens[idx].value;
      idx++;

      if (tokens[idx]?.type === 'Dot' && tokens[idx + 1]?.type === 'FieldRef') {
        return {
          raw: `${raw}.${tokens[idx + 1].value}`,
          source: unwrapFieldName(raw),
          name: unwrapFieldName(tokens[idx + 1].value),
        };
      }

      return {
        raw,
        source: undefined,
        name: unwrapFieldName(raw),
      };
    }
  } catch {
    // Tokenization error - not a valid field reference
  }

  return null;
}

function parseSortKeys(value: string): Array<Record<string, string>> {
  return splitTopLevel(value).flatMap((part) => {
    const pieces = part.trim().split(/\s+/);
    const field = parseFieldRef(pieces[0] ?? '');
    if (!field) return [];
    return [
      {
        field: toFieldName(field),
        direction: pieces[1] === 'desc' ? 'desc' : 'asc',
        nulls: pieces[3],
      },
    ];
  });
}

function parseLiteralList(value: string): unknown[] {
  const trimmed = value.trim();
  const body = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed;
  return splitTopLevel(body).map((item) => parseLiteral(item.trim()));
}

function parseLiteral(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) return unquote(value);
  return value;
}

function parseClauses(text: string, names: string[]): Clause[] {
  const pattern = new RegExp(`\\s(${names.join('|')})\\s`, 'g');
  const matches = [...text.matchAll(pattern)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end =
      index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    return { name: match[1], value: text.slice(start, end).trim() };
  });
}

function findClause(clauses: Clause[], name: string): string | undefined {
  return clauses.find((clause) => clause.name === name)?.value;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];
    if (char === '"' && previous !== '\\') inString = !inString;
    if (!inString) {
      if (char === '(' || char === '[') depth += 1;
      if (char === ')' || char === ']') depth -= 1;
      if (char === ',' && depth === 0) {
        parts.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function stripComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = line[index - 1];
    if (char === '"' && previous !== '\\') inString = !inString;
    if (char === '#' && !inString) return line.slice(0, index);
  }
  return line;
}

function sourceAlias(source: PrepOperatorAst): string | undefined {
  const alias = source.config.alias;
  return typeof alias === 'string' ? alias : undefined;
}

function toFieldName(field: PrepFieldRef): string {
  return field.name;
}

function toQualifiedName(field: PrepFieldRef): string {
  return field.source ? `${field.source}.${field.name}` : field.name;
}

function unwrapFieldName(value: string): string {
  const inner = value.slice(1, -1);
  return inner.startsWith('`') && inner.endsWith('`')
    ? inner.slice(1, -1).replace(/\\`/g, '`')
    : inner;
}

function unquote(value: string): string {
  return value.slice(1, -1).replace(/\\"/g, '"');
}

function unquoteMaybe(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? unquote(trimmed) : trimmed;
}

function pickQuotedOption(value: string, key: string): string | undefined {
  const match = new RegExp(`\\s${key}\\s+("(?:[^"\\\\]|\\\\.)*")`).exec(value);
  return match ? unquote(match[1]) : undefined;
}

function pickWordOption(value: string, key: string): string | undefined {
  const match = new RegExp(`\\s${key}\\s+([A-Za-z_][A-Za-z0-9_]*)`).exec(value);
  return match?.[1];
}

function withoutUndefined(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
}

function addError(diagnostics: PrepDiagnostic[], code: string, message: string): PrepDiagnostic[] {
  return [...diagnostics, createPrepDiagnostic(code, message)];
}
