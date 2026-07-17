/**
 * Single capability manifest for the generated JavaScript authoring surface. Keep this list
 * narrower than the data-task UI until the corresponding IR compiler, schema
 * inference and lineage implementation are all available.
 */
export const WORKFLOW_JAVASCRIPT_CAPABILITIES = [
  { method: 'filter', operatorType: 'filter' },
  { method: 'select', operatorType: 'select' },
  { method: 'drop', operatorType: 'select' },
  { method: 'rename', operatorType: 'field_mapping' },
  { method: 'derive', operatorType: 'calculate_field' },
  { method: 'cast', operatorType: 'type_convert' },
  { method: 'sort', operatorType: 'sort' },
  { method: 'aggregate', operatorType: 'aggregate' },
  { method: 'deduplicate', operatorType: 'deduplicate' },
  { method: 'handleMissing', operatorType: 'missing_value' },
  { method: 'limit', operatorType: 'limit' },
  { method: 'top', operatorType: 'limit' },
  { method: 'pivot', operatorType: 'pivot' },
  { method: 'unpivot', operatorType: 'unpivot' },
  { method: 'unnest', operatorType: 'unnest' },
] as const;

export const WORKFLOW_JAVASCRIPT_METHODS = new Set<string>([
  'inputDataset',
  ...WORKFLOW_JAVASCRIPT_CAPABILITIES.map((capability) => capability.method),
  'outputTable',
]);

export function getWorkflowJavascriptCapabilityPrompt(): string {
  return WORKFLOW_JAVASCRIPT_CAPABILITIES.map((capability) => capability.method).join(', ');
}
