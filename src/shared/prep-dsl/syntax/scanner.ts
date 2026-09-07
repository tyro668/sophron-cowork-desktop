export interface KeywordMatch {
  index: number;
  keyword: string;
}

type QuoteType = "'" | '"';
interface ScanState {
  bracketDepth: number;
  parenthesisDepth: number;
  inString: QuoteType | undefined;
}

interface ScanStep {
  state: ScanState;
  nextIndex: number;
}

function isComplete(state: ScanState): boolean {
  return state.inString === undefined && state.bracketDepth === 0 && state.parenthesisDepth === 0;
}

function advanceScanState(value: string, index: number, state: ScanState): ScanStep {
  const char = value[index];

  if (state.inString) {
    // Backslash escapes the next character, including \', \", and \\.
    if (char === '\\') {
      return { state, nextIndex: Math.min(index + 2, value.length) };
    }
    // SQL standard single-quote escape: ''.
    if (state.inString === "'" && char === "'" && value[index + 1] === "'") {
      return { state, nextIndex: index + 2 };
    }
    // End the string on the matching quote.
    if (char === state.inString) {
      return { state: { ...state, inString: undefined }, nextIndex: index + 1 };
    }
    return { state, nextIndex: index + 1 };
  }

  if (char === "'" || char === '"') {
    return { state: { ...state, inString: char }, nextIndex: index + 1 };
  }
  if (char === '[')
    return { state: { ...state, bracketDepth: state.bracketDepth + 1 }, nextIndex: index + 1 };
  if (char === ']')
    return { state: { ...state, bracketDepth: state.bracketDepth - 1 }, nextIndex: index + 1 };
  if (char === '(')
    return {
      state: { ...state, parenthesisDepth: state.parenthesisDepth + 1 },
      nextIndex: index + 1,
    };
  if (char === ')')
    return {
      state: { ...state, parenthesisDepth: state.parenthesisDepth - 1 },
      nextIndex: index + 1,
    };
  return { state, nextIndex: index + 1 };
}

export function findFirstTopLevelKeyword(
  value: string,
  keywords: readonly string[]
): KeywordMatch | null {
  let state: ScanState = { bracketDepth: 0, parenthesisDepth: 0, inString: undefined };
  for (let index = 0; index < value.length; ) {
    const step = advanceScanState(value, index, state);
    state = step.state;
    if (!isComplete(state)) {
      index = step.nextIndex;
      continue;
    }

    for (const keyword of keywords) {
      const before = value[index - 1];
      const after = value[index + keyword.length];
      if (
        (index === 0 || /\s/.test(before)) &&
        (after === undefined || /\s/.test(after)) &&
        value.slice(index, index + keyword.length).toLowerCase() === keyword.toLowerCase()
      ) {
        return { index, keyword };
      }
    }
    index = step.nextIndex;
  }
  return null;
}

export function splitTopLevelKeyword(value: string, keyword: string): string[] {
  const parts: string[] = [];
  let remaining = value;
  while (remaining) {
    const match = findFirstTopLevelKeyword(remaining, [keyword]);
    if (!match) break;
    parts.push(remaining.slice(0, match.index).trim());
    remaining = remaining.slice(match.index + match.keyword.length).trim();
  }
  if (remaining) parts.push(remaining.trim());
  return parts;
}

export function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let state: ScanState = { bracketDepth: 0, parenthesisDepth: 0, inString: undefined };
  for (let index = 0; index < value.length; ) {
    const char = value[index];
    const step = advanceScanState(value, index, state);
    state = step.state;
    if (char === ',' && isComplete(state)) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
    index = step.nextIndex;
  }
  if (!isComplete(state)) {
    // Structure is incomplete; do not partially split.
    return [value.trim()];
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

export function findMatchingParenthesis(value: string, openIndex: number): number {
  if (value[openIndex] !== '(') return -1;
  let state: ScanState = { bracketDepth: 0, parenthesisDepth: 0, inString: undefined };
  for (let index = openIndex; index < value.length; ) {
    const step = advanceScanState(value, index, state);
    state = step.state;
    if (state.inString === undefined && state.parenthesisDepth === 0) return index;
    index = step.nextIndex;
  }
  return -1;
}

export function stripComment(line: string): string {
  let state: ScanState = { bracketDepth: 0, parenthesisDepth: 0, inString: undefined };
  for (let index = 0; index < line.length; ) {
    const char = line[index];
    if (char === '#' && isComplete(state)) return line.slice(0, index);
    const step = advanceScanState(line, index, state);
    state = step.state;
    index = step.nextIndex;
  }
  return line;
}
