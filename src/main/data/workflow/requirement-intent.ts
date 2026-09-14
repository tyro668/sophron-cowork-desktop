const REMOVAL_PHRASES = ['删除', '去掉', '移除', '去除', '删掉', '剔除', '排除', '不要'] as const;
const REMOVAL_WORDS = new Set(['drop', 'delete', 'remove', 'exclude', 'strip']);
const CURRENCY_PHRASES = ['美元', '金额', '价格'] as const;
const CURRENCY_WORDS = new Set(['price', 'money', 'currency']);

export function requirementHasRemovalIntent(requirement: string): boolean {
  return containsPhrase(requirement, REMOVAL_PHRASES) || hasWord(requirement, REMOVAL_WORDS);
}

export function requirementHasCurrencyContext(requirement: string): boolean {
  return containsPhrase(requirement, CURRENCY_PHRASES) || hasWord(requirement, CURRENCY_WORDS);
}

export function requirementMentionsColumn(requirement: string, columnName: string): boolean {
  const normalizedColumn = columnName.normalize('NFKC').trim().toLowerCase();
  if (!normalizedColumn) return false;

  const columnWords = tokenizeAsciiWords(normalizedColumn);
  if (isAsciiColumnName(normalizedColumn) && columnWords.length > 0) {
    return containsWordSequence(tokenizeAsciiWords(requirement), columnWords);
  }

  return compactText(requirement).includes(compactText(normalizedColumn));
}

function containsPhrase(value: string, phrases: readonly string[]): boolean {
  const normalized = value.normalize('NFKC').toLowerCase();
  return phrases.some((phrase) => normalized.includes(phrase));
}

function hasWord(value: string, words: ReadonlySet<string>): boolean {
  return tokenizeAsciiWords(value).some((word) => words.has(word));
}

function containsWordSequence(words: string[], expected: string[]): boolean {
  if (expected.length > words.length) return false;
  for (let start = 0; start <= words.length - expected.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < expected.length; offset += 1) {
      if (words[start + offset] !== expected[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function tokenizeAsciiWords(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  const words: string[] = [];
  let current = '';
  for (const char of normalized) {
    if (isAsciiLetterOrDigit(char)) {
      current += char;
    } else if (current) {
      words.push(current);
      current = '';
    }
  }
  if (current) words.push(current);
  return words;
}

function isAsciiColumnName(value: string): boolean {
  for (const char of value) {
    if (!isAsciiLetterOrDigit(char) && char !== '_' && !isWhitespace(char)) return false;
  }
  return true;
}

function isAsciiLetterOrDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function compactText(value: string): string {
  let result = '';
  for (const char of value.normalize('NFKC').toLowerCase()) {
    if (!isWhitespace(char)) result += char;
  }
  return result;
}

function isWhitespace(char: string): boolean {
  return char.trim().length === 0;
}
