/**
 * Pipeline-name helpers for the creation flows: pick the first available name so
 * the "New data cleaning pipeline N" series never collides with existing pipelines
 * (counting by pipelineCount + 1 produced duplicates whenever names diverged from
 * the series).
 */
export function uniquePipelineName(
  base: string,
  existingNames: Iterable<string>,
  options?: { alwaysNumber?: boolean }
): string {
  const names = new Set(existingNames);
  if (!options?.alwaysNumber && !names.has(base)) return base;
  for (let index = options?.alwaysNumber ? 1 : 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!names.has(candidate)) return candidate;
  }
}
