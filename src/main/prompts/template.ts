const PLACEHOLDER_PATTERN = /{{([A-Z0-9_]+)}}/g;

export function renderPromptTemplate(
  template: string,
  values: Record<string, string>,
  options?: { omitEmptySections?: boolean }
): string {
  const rendered = template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    if (!(key in values)) {
      throw new Error(`Missing prompt template value: ${key}`);
    }
    return values[key];
  });

  if (options?.omitEmptySections) {
    return rendered
      .split(/\n\n/)
      .map((section) => section.trim())
      .filter(Boolean)
      .join('\n\n');
  }
  return rendered.trim();
}
