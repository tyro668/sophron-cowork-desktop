/**
 * Lightweight live linter for the formula editor. It only reports problems that
 * are certain from the text alone — unknown `[field]` references and
 * unbalanced brackets — so it never blocks a formula the compiler would accept.
 */
export type ExpressionIssueKind = 'unknownField' | 'unclosed' | 'unexpectedClose';

export interface ExpressionIssue {
  kind: ExpressionIssueKind;
  /** Offset into the document (0-based). */
  from: number;
  to: number;
  /** 1-based line / column of `from`. */
  line: number;
  column: number;
  /** Field name (unknownField) or the bracket character involved. */
  detail: string;
}

const CLOSERS: Record<string, string> = { '(': ')', '[': ']' };

function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

export function lintExpression(text: string, fields: readonly string[]): ExpressionIssue[] {
  const known = new Set(fields);
  const issues: Array<Omit<ExpressionIssue, 'line' | 'column'>> = [];
  const stack: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      // Skip string literals (backslash escapes and doubled quotes).
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') j += 2;
        else if (text[j] === ch && text[j + 1] === ch) j += 2;
        else if (text[j] === ch) break;
        else j++;
      }
      i = j + 1;
      continue;
    }
    if (ch === '[') {
      const end = text.indexOf(']', i + 1);
      const nl = text.indexOf('\n', i + 1);
      if (end === -1 || (nl !== -1 && nl < end)) {
        issues.push({ kind: 'unclosed', from: i, to: i + 1, detail: '[' });
        i++;
        continue;
      }
      const name = text.slice(i + 1, end);
      if (known.size > 0 && name.trim() !== '' && !known.has(name)) {
        issues.push({ kind: 'unknownField', from: i, to: end + 1, detail: name });
      }
      i = end + 1;
      continue;
    }
    if (ch === '(') stack.push(i);
    else if (ch === ')') {
      if (stack.length > 0) stack.pop();
      else issues.push({ kind: 'unexpectedClose', from: i, to: i + 1, detail: ')' });
    } else if (ch === ']') {
      issues.push({ kind: 'unexpectedClose', from: i, to: i + 1, detail: ']' });
    }
    i++;
  }
  for (const open of stack) {
    issues.push({ kind: 'unclosed', from: open, to: open + 1, detail: text[open] });
  }
  return issues
    .sort((a, b) => a.from - b.from)
    .map((issue) => ({ ...issue, ...position(text, issue.from) }));
}

export function closerFor(open: string): string {
  return CLOSERS[open] ?? open;
}
