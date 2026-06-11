export interface ParsedPseudoToolUse {
  raw: string;
  name: string;
  id: string;
  input: Record<string, unknown>;
}

interface ExtractPseudoToolUsesResult {
  cleanText: string;
  toolUses: ParsedPseudoToolUse[];
}

const PSEUDO_TOOL_USE_PATTERN = /<tool_use\b([^>]*)>([\s\S]*?)<\/tool_use>/gi;
const ATTRIBUTE_PATTERN = /([A-Za-z_][\w:-]*)\s*=\s*"([^"]*)"/g;

export function extractPseudoToolUsesFromText(text: string): ExtractPseudoToolUsesResult {
  const toolUses: ParsedPseudoToolUse[] = [];
  const cleanParts: string[] = [];
  let lastIndex = 0;
  let found = false;
  let match: RegExpExecArray | null;

  PSEUDO_TOOL_USE_PATTERN.lastIndex = 0;
  while ((match = PSEUDO_TOOL_USE_PATTERN.exec(text)) !== null) {
    found = true;
    const raw = match[0];
    const start = match.index;
    cleanParts.push(text.slice(lastIndex, start));
    lastIndex = start + raw.length;

    const attrs = parseAttributes(match[1] || '');
    const name = attrs.name || '';
    const id = attrs.id || '';
    const input = parseJsonObject(unescapeXmlText(match[2] || ''));
    if (name && id && input) {
      toolUses.push({ raw, name, id, input });
    }
  }

  cleanParts.push(text.slice(lastIndex));

  return {
    cleanText: found ? cleanAssistantText(cleanParts.join('')) : text,
    toolUses,
  };
}

function parseAttributes(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(value)) !== null) {
    result[match[1]] = unescapeXmlText(match[2] || '');
  }
  return result;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function unescapeXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function cleanAssistantText(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
