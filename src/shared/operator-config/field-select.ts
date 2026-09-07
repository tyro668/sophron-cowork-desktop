export function mergeSelectedFields(
  currentFields: readonly string[],
  selectedFields: readonly string[]
): string[] {
  const retainedFields = currentFields.filter((field) => selectedFields.includes(field));
  const addedFields = selectedFields.filter((field) => !currentFields.includes(field));
  return [...retainedFields, ...addedFields];
}
