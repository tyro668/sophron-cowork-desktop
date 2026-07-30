import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';
import { prepDslLexer } from '../tokens';
import { createOperator, stringArray, type OperatorDslCodec } from './codec';
import { formatSortKeys, parseSortKeys } from './sort';

export const deduplicateCodec: OperatorDslCodec = {
  type: 'deduplicate',
  matches: (text) => text.startsWith('deduplicate'),
  parse: (command, diagnostics) => {
    const { text } = command;
    const clauses = parseDeduplicateClauses(text);
    const columns = clauses.by
      ? splitTopLevel(clauses.by).flatMap((part) => {
          const field = parseFieldRef(part);
          const name = field ? toFieldName(field).trim() : '';
          return name ? [name] : [];
        })
      : undefined;
    if (clauses.by !== undefined && columns?.length === 0) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'deduplicateMissingField',
          'Deduplicate by requires at least one field'
        ),
        line: command.line,
      });
    }
    return createOperator('deduplicate', text, {
      strategy: clauses.by ? 'by_columns' : 'all_columns',
      columns,
      keep: clauses.keep === 'last' ? 'last' : 'first',
      orderBy: clauses.orderBy ? parseSortKeys(clauses.orderBy) : undefined,
    });
  },
  format: (config) => {
    const columns = stringArray(config?.columns).map(formatFieldRef).join(', ');
    if (!columns && config?.strategy !== 'all_columns') return null;
    const parts = ['deduplicate'];
    if (columns) parts.push(`by ${columns}`);
    if (typeof config?.keep === 'string') parts.push(`keep ${config.keep}`);
    const orderBy = formatSortKeys(config?.orderBy);
    if (orderBy) parts.push(`order by ${orderBy}`);
    return parts.join(' ');
  },
};

interface DeduplicateClauses {
  by?: string;
  keep?: string;
  orderBy?: string;
}

interface ClauseStart {
  kind: keyof DeduplicateClauses;
  start: number;
  valueStart: number;
}

function parseDeduplicateClauses(text: string): DeduplicateClauses {
  const tokens = prepDslLexer.tokenize(text).tokens;
  const starts: ClauseStart[] = [];
  let bracketDepth = 0;
  let parenthesisDepth = 0;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const tokenName = token.tokenType.name;
    if (tokenName === 'LSquare') {
      bracketDepth += 1;
      continue;
    }
    if (tokenName === 'RSquare') {
      bracketDepth -= 1;
      continue;
    }
    if (tokenName === 'LParen') {
      parenthesisDepth += 1;
      continue;
    }
    if (tokenName === 'RParen') {
      parenthesisDepth -= 1;
      continue;
    }
    if (bracketDepth !== 0 || parenthesisDepth !== 0) continue;

    const keyword = token.image.toLowerCase();
    if (keyword === 'by' || keyword === 'keep') {
      starts.push({
        kind: keyword,
        start: token.startOffset,
        valueStart: (token.endOffset ?? token.startOffset) + 1,
      });
      continue;
    }
    if (keyword === 'order' && tokens[index + 1]?.image.toLowerCase() === 'by') {
      const byToken = tokens[index + 1];
      starts.push({
        kind: 'orderBy',
        start: token.startOffset,
        valueStart: (byToken.endOffset ?? byToken.startOffset) + 1,
      });
      index += 1;
    }
  }

  return Object.fromEntries(
    starts.map((clause, index) => [
      clause.kind,
      text.slice(clause.valueStart, starts[index + 1]?.start).trim(),
    ])
  );
}
