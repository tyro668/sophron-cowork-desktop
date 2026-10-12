import type { Automation, AutomationTableTriggerContext, AutomationTriggerReason } from './types';
import { getAutomationTableBindings, tableBindingKey, tableSyncNodeIds } from './table-bindings';

/** Select the event's branch before executing. Graph edges are dependencies:
 * a skipped prerequisite blocks its descendants; a committed raw input is
 * already satisfied and must not be downloaded a second time. */
export function planTableExecution(
  automation: Automation,
  reason: AutomationTriggerReason,
  context?: AutomationTableTriggerContext
): { execute: Set<string>; satisfied: Set<string> } {
  const nodes = automation.actionGraph.nodes;
  const bindings = getAutomationTableBindings(automation);
  const scopes = bindings.map((binding) => ({
    binding,
    ids: tableSyncNodeIds(automation, binding),
  }));
  const owned = new Set(scopes.flatMap(({ ids }) => ids));
  const unowned = nodes.filter((node) => !owned.has(node.id)).map((node) => node.id);
  const execute = new Set<string>();
  const satisfied = new Set<string>();
  const blocked = new Set(nodes.filter((node) => node.enabled === false).map((node) => node.id));
  const changed = new Set(context?.tables.map(tableBindingKey) ?? []);
  if (reason === 'output_change') {
    for (const { binding, ids } of scopes) {
      if (!binding.runOnChange || !changed.has(tableBindingKey(binding))) continue;
      if (!ids.length) unowned.forEach((id) => execute.add(id));
      for (const id of ids) {
        if (binding.kind === 'raw') satisfied.add(id);
        else execute.add(id);
      }
    }
    // Follow unowned downstream steps, but never cross into another table's
    // sync action. That action requires its own matching event.
    let changedPlan = true;
    while (changedPlan) {
      changedPlan = false;
      for (const edge of automation.actionGraph.edges) {
        if (
          (execute.has(edge.sourceNodeId) || satisfied.has(edge.sourceNodeId)) &&
          !owned.has(edge.targetNodeId) &&
          !execute.has(edge.targetNodeId)
        ) {
          execute.add(edge.targetNodeId);
          changedPlan = true;
        }
      }
    }
  } else {
    nodes.forEach((node) => execute.add(node.id));
    if (reason === 'timer' || reason === 'file_change' || reason === 'queued_overlap') {
      for (const { binding, ids } of scopes) {
        if (
          !binding.runOnTrigger &&
          !(binding.runOnChange && changed.has(tableBindingKey(binding)))
        ) {
          (ids.length ? ids : unowned).forEach((id) => blocked.add(id));
        }
      }
    }
  }
  // Explicit value dependencies cannot consume outputs from an unselected node.
  for (const node of nodes) {
    if (
      Object.values(node.inputBindings ?? {}).some(
        (ref) => ref.kind === 'node_output' && !execute.has(ref.nodeId)
      )
    )
      blocked.add(node.id);
  }
  let changedPlan = true;
  while (changedPlan) {
    changedPlan = false;
    for (const edge of automation.actionGraph.edges) {
      if (blocked.has(edge.sourceNodeId) && !blocked.has(edge.targetNodeId)) {
        blocked.add(edge.targetNodeId);
        changedPlan = true;
      }
    }
    for (const node of nodes) {
      if (
        !blocked.has(node.id) &&
        Object.values(node.inputBindings ?? {}).some(
          (ref) => ref.kind === 'node_output' && blocked.has(ref.nodeId)
        )
      ) {
        blocked.add(node.id);
        changedPlan = true;
      }
    }
  }
  blocked.forEach((id) => {
    execute.delete(id);
    satisfied.delete(id);
  });
  return { execute, satisfied };
}
