import { z } from 'zod';
import type { Automation, AutomationTableBinding, AutomationTableRef } from './types';

export const automationTableRefSchema = z.object({
  kind: z.enum(['raw', 'result']),
  tableId: z.string().trim().min(1),
});
export const automationTablePolicyPatchSchema = z
  .object({
    runOnChange: z.boolean().optional(),
    runOnTrigger: z.boolean().optional(),
  })
  .refine(
    (value) => value.runOnChange !== undefined || value.runOnTrigger !== undefined,
    'A policy field is required'
  );
export const DEFAULT_TABLE_POLICY = { runOnChange: false, runOnTrigger: true };

export const automationTableBindingsSchema = z
  .array(
    z.object({
      kind: z.enum(['raw', 'result']),
      tableId: z.string().trim().min(1),
      runOnChange: z.boolean(),
      runOnTrigger: z.boolean(),
    })
  )
  .refine(
    (bindings) => new Set(bindings.map(tableBindingKey)).size === bindings.length,
    'A table can only be linked once'
  );

export function tableBindingKey(table: AutomationTableRef): string {
  return `${table.kind}:${table.tableId}`;
}

export function tableSyncNodeIds(
  automation: Pick<Automation, 'actionGraph'>,
  table: AutomationTableRef
): string[] {
  return automation.actionGraph.nodes
    .filter(
      (node) =>
        node.type === 'cloud.sync' &&
        node.config.direction === (table.kind === 'raw' ? 'input' : 'output') &&
        node.config[table.kind === 'raw' ? 'rawTableId' : 'resultTableId'] === table.tableId
    )
    .map((node) => node.id);
}

/** Legacy config is read without side effects. An explicit list (including [])
 * is authoritative; old node flags/outputBindings cannot resurrect removed links. */
export function getAutomationTableBindings(
  automation: Pick<Automation, 'tableBindings' | 'outputBindings' | 'actionGraph'>
): AutomationTableBinding[] {
  if (automation.tableBindings !== undefined) return automation.tableBindings;
  const bindings = new Map<string, AutomationTableBinding>();
  for (const node of automation.actionGraph.nodes) {
    if (node.type !== 'cloud.sync') continue;
    const kind = node.config.direction === 'input' ? 'raw' : 'result';
    const tableId = node.config[kind === 'raw' ? 'rawTableId' : 'resultTableId'];
    if (typeof tableId !== 'string' || !tableId) continue;
    const key = tableBindingKey({ kind, tableId });
    const previous = bindings.get(key);
    bindings.set(key, {
      kind,
      tableId,
      runOnChange: previous?.runOnChange || (kind === 'raw' && node.config.runOnChange === true),
      runOnTrigger: (previous?.runOnTrigger ?? true) && node.config.runOnTrigger !== false,
    });
  }
  for (const binding of automation.outputBindings ?? []) {
    const ref = { kind: 'result' as const, tableId: binding.resultTableId };
    const previous = bindings.get(tableBindingKey(ref));
    bindings.set(tableBindingKey(ref), {
      ...ref,
      runOnChange: binding.runOnChange,
      runOnTrigger: binding.runOnTrigger !== false && (previous?.runOnTrigger ?? true),
    });
  }
  return [...bindings.values()];
}
