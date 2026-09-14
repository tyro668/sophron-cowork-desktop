export function extractFencedBlock(
  text: string,
  acceptedLanguages: readonly string[] = []
): string | null {
  const accepted = new Set(acceptedLanguages.map((language) => language.toLowerCase()));
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const opening = readFence(lines[lineIndex]);
    if (!opening) continue;
    const language = opening.info.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
    if (accepted.size > 0 && language && !accepted.has(language)) continue;
    for (let closingIndex = lineIndex + 1; closingIndex < lines.length; closingIndex += 1) {
      if (!isClosingFence(lines[closingIndex], opening.marker, opening.length)) continue;
      return lines
        .slice(lineIndex + 1, closingIndex)
        .join('\n')
        .trim();
    }
  }
  return null;
}

export function extractJsonObjectText(text: string): string {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = extractFencedBlock(trimmed, ['json']);
  if (fenced) candidates.push(fenced);
  candidates.push(...findBalancedJsonObjects(trimmed));
  for (const candidate of candidates) {
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return candidate;
    } catch {
      // Keep scanning; prose and earlier fenced blocks may contain brace-like text.
    }
  }
  throw new Error('No valid JSON object found in response');
}

function readFence(line: string): { marker: '`' | '~'; length: number; info: string } | null {
  const value = line.trimStart();
  const marker = value[0];
  if (marker !== '`' && marker !== '~') return null;
  let length = 0;
  while (value[length] === marker) length += 1;
  if (length < 3) return null;
  return { marker, length, info: value.slice(length).trim() };
}

function isClosingFence(line: string, marker: '`' | '~', openingLength: number): boolean {
  const value = line.trim();
  let length = 0;
  while (value[length] === marker) length += 1;
  return length >= openingLength && value.slice(length).trim().length === 0;
}

function findBalancedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char !== '}' || depth === 0) continue;
    depth -= 1;
    if (depth === 0 && start >= 0) {
      objects.push(text.slice(start, index + 1));
      start = -1;
    }
  }
  return objects;
}
