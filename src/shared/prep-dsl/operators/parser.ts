import type {
  PrepDiagnostic,
  PrepOperatorAst,
  PrepOperatorParseResult,
  PrepOperatorType,
  PrepParseResult,
  PrepWorkflowAst,
} from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { prepDslLexer, tokenizePrepDsl } from '../tokens';
import { stripComment } from '../syntax/scanner';
import { parseRegisteredOperator } from './registry';
import { validateOperatorConfig } from '../../operator-schemas';

export { parseFieldRef, toFieldName, toQualifiedName, unwrapFieldName } from '../syntax/fields';

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
  if (operator) {
    diagnostics.push(
      ...validateOperatorConfig(operator.type, operator.config).map((diagnostic) => ({
        ...diagnostic,
        line: command.line,
      }))
    );
  }
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
  const registered = parseRegisteredOperator(command, diagnostics);
  if (registered.matched) return registered.operator;
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

function sourceAlias(source: PrepOperatorAst): string | undefined {
  const alias = source.config.alias;
  return typeof alias === 'string' ? alias : undefined;
}

function unquote(value: string): string {
  return value.slice(1, -1).replace(/\\"/g, '"');
}

function withoutUndefined(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
}

function addError(diagnostics: PrepDiagnostic[], code: string, message: string): PrepDiagnostic[] {
  return [...diagnostics, createPrepDiagnostic(code, message)];
}
