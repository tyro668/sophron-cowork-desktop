export const DEFAULT_SQL_QUERY = 'SELECT *\nFROM input';
export const MAX_SQL_QUERY_LENGTH = 100_000;

/** Lexical framing only. DuckDB remains the authority for SQL syntax and binding. */
export function normalizeSqlQuery(value: string): string {
  const sql = value.trim();
  let visible = '';
  let i = 0;
  while (i < sql.length) {
    const start = i;
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      visible += ' '.repeat(i - start);
    } else if (sql.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw new Error('Unterminated SQL comment');
      visible += ' '.repeat(i - start);
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++];
      const escaped = quote === "'" && /(?:^|\W)[eE]$/.test(sql.slice(0, start));
      let closed = false;
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i++] === quote) {
          if (sql[i] === quote) {
            i++;
            continue;
          }
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error('Unterminated SQL quoted value');
      visible += 'x' + ' '.repeat(i - start - 1);
    } else {
      const dollar = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (dollar) {
        const end = sql.indexOf(dollar, i + dollar.length);
        if (end < 0) throw new Error('Unterminated SQL dollar-quoted value');
        i = end + dollar.length;
        visible += 'x' + ' '.repeat(i - start - 1);
      } else {
        visible += sql[i++];
      }
    }
  }
  if (!visible.trim()) throw new Error('SQL query is required');
  if (!/^\s*(?:select\b|with\b|from\b|values\b|table\b|pivot\b|unpivot\b|\()/i.test(visible)) {
    throw new Error(
      'SQL operator requires a query (SELECT or WITH); write statements are not supported'
    );
  }
  const delimiter = visible.indexOf(';');
  if (delimiter >= 0) {
    if (visible.slice(delimiter + 1).trim()) throw new Error('SQL operator accepts only one query');
    return sql.slice(0, delimiter) + sql.slice(delimiter + 1);
  }
  return sql;
}

const SQL_FORMAT_KEYWORDS = new Set([
  'select',
  'distinct',
  'from',
  'where',
  'and',
  'or',
  'not',
  'in',
  'is',
  'null',
  'like',
  'between',
  'exists',
  'case',
  'when',
  'then',
  'else',
  'end',
  'as',
  'asc',
  'desc',
  'on',
  'join',
  'left',
  'right',
  'inner',
  'full',
  'outer',
  'cross',
  'group',
  'by',
  'having',
  'order',
  'limit',
  'offset',
  'union',
  'all',
  'intersect',
  'except',
  'with',
  'over',
  'partition',
  'values',
  'using',
  'natural',
  'filter',
  'within',
  'recursive',
]);

// Words that force a line break when they appear at the top nesting level.
const SQL_CLAUSE_WORDS = new Set([
  'select',
  'from',
  'where',
  'having',
  'limit',
  'offset',
  'union',
  'intersect',
  'except',
]);
const SQL_CLAUSE_PAIRS = new Set(['group', 'order', 'union', 'partition']);
const SQL_JOIN_MODIFIERS = new Set(['left', 'right', 'inner', 'full', 'cross', 'outer', 'natural']);

interface SqlToken {
  kind: 'word' | 'atom';
  text: string;
}

/** Split raw SQL into word/atom tokens; throws when quoting or comments are unclosed. */
function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;
  const push = (kind: SqlToken['kind'], text: string) => tokens.push({ kind, text });
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        if (ch === "'" && sql[j] === '\\' && j + 1 < sql.length) j++;
        j++;
      }
      if (j > sql.length || sql[j - 1] !== ch) throw new Error('Unterminated quoted value');
      push('atom', sql.slice(i, j));
      i = j;
      continue;
    }
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      push('atom', sql.slice(i, end < 0 ? sql.length : end));
      i = end < 0 ? sql.length : end;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unterminated block comment');
      push('atom', sql.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    if ('(),;.'.includes(ch)) {
      push('atom', ch);
      i++;
      continue;
    }
    if ('+-*/%=<>!|&^~:'.includes(ch)) {
      let j = i + 1;
      while (
        j < sql.length &&
        '+-*/%=<>!|&^~:'.includes(sql[j]) &&
        sql[j] !== '*' &&
        sql[j] !== '/'
      )
        j++;
      push('atom', sql.slice(i, j));
      i = j;
      continue;
    }
    let j = i;
    while (j < sql.length && !/[\s(),;.'"+\-*/%=<>!|&^~:`]/.test(sql[j])) j++;
    push('word', sql.slice(i, j));
    i = j;
  }
  return tokens;
}

/**
 * Best-effort pretty printer for the SQL operator editor: uppercase keywords,
 * one clause per line, and one SELECT-list item per line. Falls back to the
 * original text when the input cannot be tokenized (unclosed quotes/comments).
 */
export function formatSqlQuery(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  let tokens: SqlToken[];
  try {
    tokens = tokenizeSql(trimmed);
  } catch {
    return value;
  }

  const lines: string[] = [];
  let line = '';
  let depth = 0;
  let inSelectList = false;
  let lineIndented = false;
  let pendingClauseWord: string | null = null;
  let pendingJoin: string[] = [];
  let attachNext = false;
  let prevText = '';
  let prevIdentLike = false;
  let expectOperand = true;

  const emit = (text: string, identLike = false) => {
    if (lineIndented && line === '') {
      line = '    ';
      lineIndented = false;
    }
    if (line !== '' && line !== '    ') {
      const noSpaceBefore = [',', ')', ';', '.'].includes(text) || (text === '(' && prevIdentLike);
      const noSpaceAfterPrev = ['(', '.'].includes(prevText) || attachNext;
      if (!noSpaceBefore && !noSpaceAfterPrev) line += ' ';
    }
    line += text;
    prevText = text;
    prevIdentLike = identLike;
    attachNext = false;
  };
  const newline = (indent: boolean) => {
    if (line.trim() !== '') lines.push(line);
    line = '';
    lineIndented = indent;
    prevText = '';
    prevIdentLike = false;
    expectOperand = true;
  };
  const flushJoin = () => {
    if (!pendingJoin.length) return;
    emit(pendingJoin.join(' '));
    pendingJoin = [];
  };

  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t];
    const next = tokens[t + 1];
    const nextWord = next?.kind === 'word' ? next.text.toLowerCase() : null;

    if (token.kind === 'word') {
      const word = token.text.toLowerCase();
      if (depth === 0 && word === 'join') {
        if (!pendingJoin.length) newline(false);
        pendingJoin.push('JOIN');
        flushJoin();
        inSelectList = false;
        expectOperand = true;
        continue;
      }
      if (
        depth === 0 &&
        SQL_JOIN_MODIFIERS.has(word) &&
        (nextWord === 'join' || nextWord === 'outer')
      ) {
        if (!pendingJoin.length) newline(false);
        pendingJoin.push(word.toUpperCase());
        continue;
      }
      flushJoin();
      if (pendingClauseWord) {
        // Second word of a two-word clause head (e.g. GROUP BY, UNION ALL).
        emit(`${pendingClauseWord.toUpperCase()} ${word.toUpperCase()}`);
        pendingClauseWord = null;
        expectOperand = true;
        continue;
      }
      if (depth === 0) {
        if (SQL_CLAUSE_PAIRS.has(word) && (nextWord === 'by' || nextWord === 'all')) {
          newline(false);
          inSelectList = false;
          pendingClauseWord = word;
          continue;
        }
        if (SQL_CLAUSE_WORDS.has(word)) {
          newline(false);
          inSelectList = word === 'select';
          emit(word.toUpperCase());
          if (inSelectList) {
            newline(true);
            inSelectList = true;
          }
          expectOperand = true;
          continue;
        }
      }
      const isKeyword = SQL_FORMAT_KEYWORDS.has(word);
      emit(isKeyword ? word.toUpperCase() : token.text, !isKeyword);
      expectOperand = false;
      continue;
    }

    flushJoin();
    const text = token.text;
    if (text === '(') {
      emit('(');
      depth++;
      expectOperand = true;
      continue;
    }
    if (text === ')') {
      emit(')', true);
      depth = Math.max(0, depth - 1);
      expectOperand = false;
      continue;
    }
    if (text === ',') {
      emit(',');
      if (depth === 0 && inSelectList) newline(true);
      expectOperand = true;
      continue;
    }
    if ((text === '-' || text === '+') && expectOperand) {
      emit(text);
      attachNext = true;
      continue;
    }
    const isQuotedOrNumber = /^["'`\d]/.test(text);
    emit(text, isQuotedOrNumber);
    expectOperand = !/^[+\-*/%=<>!|&^~:;(]$/.test(text);
    if (text === ';') expectOperand = true;
  }
  if (pendingClauseWord) emit(pendingClauseWord.toUpperCase());
  flushJoin();
  if (line.trim() !== '') lines.push(line);
  return lines.join('\n') + '\n';
}

interface NamedInputCandidate {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

type RelationToken = { kind: 'word' | 'ident' | 'punct'; text: string };

function tokenizeSqlForRelations(sql: string): RelationToken[] {
  const tokens: RelationToken[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i++] === "'") break;
      }
      tokens.push({ kind: 'punct', text: "'" });
    } else if (ch === '"') {
      let text = '';
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          text += '"';
          i += 2;
        } else if (sql[i] === '"') {
          i += 1;
          break;
        } else text += sql[i++];
      }
      tokens.push({ kind: 'ident', text });
    } else if (/[A-Za-z_\u0080-\uffff]/.test(ch)) {
      const match = /^[A-Za-z_0-9\u0080-\uffff$]+/.exec(sql.slice(i))![0];
      tokens.push({ kind: 'word', text: match });
      i += match.length;
    } else if (/\s/.test(ch)) {
      i += 1;
    } else {
      tokens.push({ kind: 'punct', text: ch });
      i += 1;
    }
  }
  return tokens;
}

const RELATION_CLAUSE_END = new Set([
  'where',
  'group',
  'having',
  'order',
  'limit',
  'offset',
  'qualify',
  'window',
  'union',
  'intersect',
  'except',
  'on',
  'using',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'natural',
  'asof',
  'positional',
  'anti',
  'semi',
  'lateral',
  'select',
  'pivot',
  'unpivot',
  'sample',
  'tablesample',
  'returning',
]);

/**
 * Names that appear in relation position: right after FROM / JOIN, or after a comma
 * inside a FROM list (`FROM a x, b`). Column names, aliases, functions and CTE
 * names are not relations, so an input alias equal to a column name is not pulled in.
 */
export function sqlRelationNames(sql: string): Set<string> {
  const tokens = tokenizeSqlForRelations(sql);
  const relations = new Set<string>();
  const ctes = new Set<string>();
  const lower = (t: RelationToken | undefined) =>
    t && t.kind === 'word' ? t.text.toLowerCase() : '';
  const isName = (t: RelationToken | undefined) => !!t && (t.kind === 'ident' || t.kind === 'word');
  for (let k = 0; k < tokens.length; k += 1) {
    const word = lower(tokens[k]);
    // CTE definitions: `WITH name AS (` / `, name AS (`
    if (isName(tokens[k]) && lower(tokens[k + 1]) === 'as' && tokens[k + 2]?.text === '(') {
      const prev = tokens[k - 1];
      if (lower(prev) === 'with' || lower(prev) === 'recursive' || prev?.text === ',') {
        ctes.add(tokens[k].text.toLowerCase());
      }
    }
    if (word !== 'from' && word !== 'join') continue;
    let p = k + 1;
    for (;;) {
      const rel = tokens[p];
      if (!isName(rel) || (rel.kind === 'word' && RELATION_CLAUSE_END.has(lower(rel)))) break;
      // schema-qualified names (`main.t`) are not input aliases
      if (tokens[p + 1]?.text === '.' || tokens[p + 1]?.text === '(') break;
      relations.add(rel.text.toLowerCase());
      p += 1;
      if (word === 'join') break;
      // optional alias: `AS x` or a bare name
      if (lower(tokens[p]) === 'as') p += 2;
      else if (
        isName(tokens[p]) &&
        !(tokens[p].kind === 'word' && RELATION_CLAUSE_END.has(lower(tokens[p])))
      )
        p += 1;
      if (tokens[p]?.text !== ',') break;
      p += 1;
    }
  }
  for (const cte of ctes) relations.delete(cte);
  return relations;
}

/**
 * Named inputs of a SQL node: besides the wired upstream (`input`), every
 * enabled input with an alias that the query uses as a relation (FROM/JOIN position) is visible under
 * that alias, e.g. `SELECT … FROM erp JOIN bank USING (单号)`.
 */
export function sqlNamedInputs(
  sql: string,
  nodes: readonly NamedInputCandidate[]
): Array<{ alias: string; nodeId: string }> {
  const words = sqlRelationNames(sql);
  const seen = new Set<string>();
  const named: Array<{ alias: string; nodeId: string }> = [];
  for (const node of nodes) {
    if (node.type !== 'input' || node.config.disabled === true) continue;
    const alias = typeof node.config.alias === 'string' ? node.config.alias.trim() : '';
    const key = alias.toLowerCase();
    if (!alias || key === 'input' || seen.has(key) || !words.has(key)) continue;
    seen.add(key);
    named.push({ alias, nodeId: node.id });
  }
  return named;
}
