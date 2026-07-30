export interface KeywordMatch {
  index: number;
  keyword: string;
}

interface ScanState {
  bracketDepth: number;
  parenthesisDepth: number;
  inString: boolean;
}

function updateScanState(state: ScanState, char: string, previous: string | undefined): ScanState {
  if (char === '"' && previous !== '\\') {
    return { ...state, inString: !state.inString };
  }
  if (state.inString) return state;
  if (char === '[') return { ...state, bracketDepth: state.bracketDepth + 1 };
  if (char === ']') return { ...state, bracketDepth: state.bracketDepth - 1 };
  if (char === '(') return { ...state, parenthesisDepth: state.parenthesisDepth + 1 };
  if (char === ')') return { ...state, parenthesisDepth: state.parenthesisDepth - 1 };
  return state;
}

function isTopLevel(state: ScanState): boolean {
  return !state.inString && state.bracketDepth === 0 && state.parenthesisDepth === 0;
}

export function findFirstTopLevelKeyword(
  value: string,
  keywords: readonly string[]
): KeywordMatch | null {
  let state: ScanState = { bracketDepth: 0, parenthesisDepth: 0, inString: false };
  for (let index = 0; index < value.length; index += 1) {
    state = updateScanState(state, value[index], value[index - 1]);
    if (!isTopLevel(state)) continue;

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
  let state: ScanState = { bracketDepth: 0, parenthesisDepth: 0, inString: false };
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    state = updateScanState(state, char, value[index - 1]);
    if (char === ',' && isTopLevel(state)) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

export function stripComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index - 1] !== '\\') inString = !inString;
    if (char === '#' && !inString) return line.slice(0, index);
  }
  return line;
}
