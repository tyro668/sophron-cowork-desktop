import { formatFieldRef, toFieldName } from '../syntax/fields';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, stringArray, type OperatorDslCodec } from './codec';

export const EXPECT_ROW_OPERATORS = ['>', '>=', '=', '!=', '<=', '<'] as const;

/**
 * `expect` — row-quality assertions.
 *
 *   expect <expression>                       every row must satisfy
 *   expect unique [k1], [k2]                  key columns must be unique
 *   expect rows >= 1                          row-count assertion
 *   expect <assertion> reject to <stream>     violating rows flow to the named
 *                                             stream instead of failing the run
 */
export const expectCodec: OperatorDslCodec = {
  type: 'expect',
  matches: (text) => text.startsWith('expect '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const cursor = new PrepTokenCursor(text, command.line, diagnostics);
    cursor.expect('expect', 'invalidExpect');

    const start = cursor.index;
    let rejectIndex = -1;
    for (let i = start; i + 1 < cursor.tokens.length; i += 1) {
      if (cursor.tokens[i].image === 'reject' && cursor.tokens[i + 1].image === 'to') {
        rejectIndex = i;
        break;
      }
    }
    const assertionEnd = rejectIndex === -1 ? cursor.tokens.length : rejectIndex;

    const config: Record<string, unknown> = {};
    const first = cursor.image();
    if (first === 'unique') {
      cursor.consume();
      const columns: string[] = [];
      while (cursor.index < assertionEnd) {
        const field = cursor.expectFieldRef('invalidExpectUnique');
        if (!field) break;
        const name = toFieldName(field).trim();
        if (name) columns.push(name);
        if (!cursor.matchType('Comma')) break;
      }
      if (columns.length === 0) {
        cursor.report('invalidExpectUnique', 'expect unique requires at least one field');
      }
      config.kind = 'unique';
      config.columns = columns;
    } else if (first === 'rows') {
      cursor.consume();
      const operator = cursor.expectOneOf([...EXPECT_ROW_OPERATORS], 'invalidExpectRows');
      const valueToken = cursor.matchType('NumberLiteral');
      const value = valueToken ? Number(valueToken.image) : NaN;
      if (!operator || !Number.isSafeInteger(value) || value < 0) {
        cursor.report('invalidExpectRows', 'expect rows requires a comparison, e.g. rows >= 1');
      }
      config.kind = 'row_count';
      config.operator = operator ?? '>=';
      config.value = Number.isSafeInteger(value) && value >= 0 ? value : 0;
    } else {
      const expression = cursor.slice(start, assertionEnd).trim();
      if (!expression) {
        cursor.report('invalidExpectExpression', 'expect requires an expression');
      }
      config.kind = 'expression';
      config.expression = expression;
      // Nothing to consume — the expression is the raw text slice.
      while (cursor.index < assertionEnd) cursor.consume();
    }

    if (cursor.index < assertionEnd) {
      cursor.report('unexpectedExpectToken', 'Unexpected tokens in expect assertion');
    }

    if (rejectIndex !== -1) {
      const nameToken = cursor.tokens[rejectIndex + 2];
      if (nameToken?.tokenType.name === 'Identifier' && /^[a-zA-Z_][\w]*$/.test(nameToken.image)) {
        config.rejectStream = nameToken.image;
      } else {
        cursor.report('invalidExpectReject', 'reject to requires a stream name');
      }
      if (rejectIndex + 3 < cursor.tokens.length) {
        cursor.report('unexpectedExpectToken', 'Unexpected tokens after reject stream name');
      }
    }

    return createOperator('expect', text, config);
  },
  format: (config) => {
    const kind = String(config?.kind ?? 'expression');
    let assertion = '';
    if (kind === 'unique') {
      const columns = stringArray(config?.columns).map(formatFieldRef).join(', ');
      if (!columns) return null;
      assertion = `unique ${columns}`;
    } else if (kind === 'row_count') {
      assertion = `rows ${String(config?.operator ?? '>=')} ${Number(config?.value ?? 0)}`;
    } else {
      const expression = typeof config?.expression === 'string' ? config.expression.trim() : '';
      if (!expression) return null;
      assertion = expression;
    }
    const reject =
      typeof config?.rejectStream === 'string' && config.rejectStream.trim()
        ? ` reject to ${config.rejectStream.trim()}`
        : '';
    return `expect ${assertion}${reject}`;
  },
};
