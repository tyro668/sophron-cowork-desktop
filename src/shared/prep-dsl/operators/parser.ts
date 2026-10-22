import type {
  PrepDiagnostic,
  PrepOperatorAst,
  PrepOperatorParseResult,
  PrepOperatorType,
  PrepParseResult,
  PrepStepAst,
  PrepWorkflowAst,
} from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { prepDslLexer, tokenizePrepDsl } from '../tokens';
import { stripComment } from '../syntax/scanner';
import { parseRegisteredOperator } from './registry';
import { validateOperatorConfig } from '../../operator-schemas';

export {
  parseFieldRef,
  parseFieldRefExact,
  formatFieldName,
  toFieldName,
  toQualifiedName,
  unwrapFieldName,
} from '../syntax/fields';

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
  expect: 'expect',
  sql_query: 'sql_query',
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
  const steps: PrepStepAst[] = [];
  const outputs: PrepOperatorAst[] = [];
  let mainSource = '';
  let stepSeq = 0;
  let currentStep: PrepStepAst | null = null;

  const startStep = (
    input: string | undefined,
    name: string | undefined,
    line: number,
    named = false
  ) => {
    stepSeq += 1;
    currentStep = {
      name: name ?? `step${stepSeq}`,
      input,
      line,
      named,
      operators: [],
    };
    steps.push(currentStep);
  };
  const ensureStep = (line: number) => {
    if (!currentStep) {
      // Implicit v1 chain: reads the main source (or the previous chain tail).
      startStep(mainSource || undefined, steps.length === 0 ? 'main' : undefined, line);
    }
    return currentStep;
  };

  for (const command of commands) {
    const text = command.text;
    if (isInputSource(text)) {
      const source = parseInputSource(command, diagnostics);
      if (source) {
        sources.push(source);
        if (!mainSource) mainSource = sourceAlias(source) ?? 'source';
      }
      continue;
    }
    if (text === 'from' || text.startsWith('from ')) {
      const ref = text === 'from' ? '' : text.slice('from '.length).trim();
      if (!ref) {
        diagnostics.push({
          ...createPrepDiagnostic('invalidStep', 'from must name a source alias or step name'),
          line: command.line,
        });
      }
      startStep(ref || undefined, undefined, command.line);
      continue;
    }
    if (text.startsWith('step ')) {
      parseStepHeader(command, diagnostics, (name, input) =>
        startStep(input, name, command.line, true)
      );
      continue;
    }
    const operator = parseOperator(command, diagnostics);
    if (!operator) continue;
    if (operator.type === 'input_source') {
      sources.push(operator);
      if (!mainSource) mainSource = sourceAlias(operator) ?? 'source';
      continue;
    }
    ensureStep(command.line)?.operators.push(operator);
    if (operator.type === 'output') outputs.push(operator);
  }

  if (sources.length === 0) {
    diagnostics.push(
      createPrepDiagnostic('missingInputSource', 'At least one input source is required')
    );
  }
  if (!mainSource && sources[0]) {
    mainSource = sourceAlias(sources[0]) ?? 'source';
  }
  // A lone `input source` followed by operators chains implicitly; multi-source
  // v1 documents still need `from <alias>` which maps to the first step's input.
  if (steps.length > 0 && !steps[0].input && steps[0].name === 'main') {
    steps[0].input = mainSource;
  }
  if (sources.length > 1 && steps.every((step) => !step.input)) {
    diagnostics.push(
      createPrepDiagnostic(
        'multiSourceMissingFrom',
        'Multi-source pipelines must use from <alias> or step <name> = <ref> to choose a chain input'
      )
    );
  }

  // `operators` keeps the v1 meaning: the flat list of data operators (no
  // output sinks — those live in `outputs`).
  const operators = steps.flatMap((step) =>
    step.operators.filter((operator) => operator.type !== 'output')
  );
  const ast: PrepWorkflowAst = {
    version: 'prep-dsl/v3',
    sources,
    mainSource,
    steps,
    operators,
    outputs,
    output: outputs[outputs.length - 1],
  };
  return { ast, diagnostics };
}

/** Parses `step <name> = <ref>` chain headers. */
function parseStepHeader(
  command: CommandLine,
  diagnostics: PrepDiagnostic[],
  onStep: (name: string, input: string | undefined) => void
): void {
  const match = /^step\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S+)\s*(.*)$/.exec(command.text);
  if (!match) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'invalidStep',
        'Step must be written as: step <name> = <source-or-step>'
      ),
      line: command.line,
    });
    return;
  }
  const [, name, input, rest] = match;
  if (rest.trim()) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'invalidStep',
        `Unexpected text after step header: ${rest.trim()}; put operators on lines starting with |`
      ),
      line: command.line,
    });
    return;
  }
  if (['input', 'from', 'step', 'output'].includes(name.toLowerCase())) {
    diagnostics.push({
      ...createPrepDiagnostic('invalidStep', `Step name "${name}" conflicts with a DSL keyword`, {
        value: name,
      }),
      line: command.line,
    });
    return;
  }
  onStep(name, input);
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

  // Source type: pipeline | file <string> | rawTable <string>
  const srcType = peek();
  if (!srcType || srcType.tokenType.name !== 'Identifier') {
    error('Expected "pipeline", "file", or "rawTable"');
    return null;
  }
  advance();

  const config: Record<string, unknown> = {};

  if (srcType.image === 'pipeline') {
    config.source = 'pipeline';
  } else if (srcType.image === 'file') {
    config.source = 'file';
    const pathToken = expectString('Expected file path string after "file"');
    if (!pathToken) return null;
    config.filePath = unquote(pathToken.image);
  } else if (srcType.image === 'rawTable') {
    config.source = 'rawTable';
    const idToken = expectString('Expected rawTable ID string after "rawTable"');
    if (!idToken) return null;
    config.rawTableId = unquote(idToken.image);
  } else {
    error(`Unknown source type "${srcType.image}". Expected "pipeline", "file", or "rawTable"`);
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
      case 'incremental': {
        if (config.source === 'rawTable') {
          error(
            'Input tables are always read in full; incremental by is only for pipeline/file sources'
          );
          return null;
        }
        advance();
        const byKw = expectIdent('Expected "by" after "incremental"');
        if (!byKw || byKw.image !== 'by') {
          if (byKw) error('Expected "by" after "incremental"');
          return null;
        }
        const fieldStart = peek()?.startOffset ?? 0;
        if (peek()?.tokenType.name === 'LSquare') {
          let closed = false;
          while (!atEof()) {
            const token = advance();
            if (token?.tokenType.name === 'RSquare') {
              closed = true;
              break;
            }
          }
          if (!closed) {
            error('Expected "]" after incremental field');
            return null;
          }
          const fieldEnd = tokens[pos - 1]?.endOffset ?? fieldStart;
          config.incrementalBy = text
            .slice(fieldStart, fieldEnd + 1)
            .replace(/^\[\s*|\s*\]$/g, '')
            .replace(/^`|`$/g, '')
            .trim();
        } else {
          const ident = expectIdent('Expected a field reference after "incremental by"');
          if (!ident) return null;
          config.incrementalBy = ident.image;
        }
        break;
      }
      default: {
        error(
          `Unknown keyword "${kw.image}". Expected "format", "sheet", "header", "encoding", "incremental by [field]", or "as"`
        );
        return null;
      }
    }

    consumed.add(kw.image);
  }

  return makeOperator('input_source', text, config);
}

function collectInitialDiagnostics(input: string): PrepDiagnostic[] {
  const tokenized = tokenizePrepDsl(input);
  const diagnostics = tokenized.diagnostics;
  for (let index = 0; index < tokenized.tokens.length; index += 1) {
    const open = tokenized.tokens[index];
    if (open.tokenType.name !== 'LSquare') continue;
    const closeIndex = tokenized.tokens.findIndex(
      (token, candidateIndex) => candidateIndex > index && token.tokenType.name === 'RSquare'
    );
    if (closeIndex < 0) break;
    const innerTokens = tokenized.tokens.slice(index + 1, closeIndex);
    const isQuotedName =
      innerTokens.length === 1 && innerTokens[0]?.tokenType.name === 'BacktickName';
    if (!isQuotedName && innerTokens.some((token) => token.tokenType.name === 'Dot')) {
      const end = (tokenized.tokens[closeIndex].endOffset ?? open.startOffset) + 1;
      const ref = input.slice(open.startOffset, end);
      diagnostics.push({
        severity: 'error',
        code: 'invalidQualifiedField',
        message: `Invalid field reference ${ref}; use [table_name].[field_name]`,
        params: { value: ref },
      });
    }
    index = closeIndex;
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
  return isInputSource(text) || text.startsWith('from ') || /^step\s+\S/.test(text);
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
    // Structured config is the single source of truth; the DSL text lives on the
    // AST only and is re-derived by the formatter, never cached in config.
    config: withoutUndefined(config),
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
