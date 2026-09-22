import type { z } from 'zod';
import type { AutomationStore } from './automation-store';
import type { AutomationActionNode } from '../../shared/automation/types';

/** Compare before saving so a completing run cannot overwrite an edited action. */
export function cloudActionState<T extends Record<string, unknown>>(
  store: AutomationStore,
  automationId: string,
  node: AutomationActionNode,
  schema: z.ZodType<T>,
  config: T
) {
  let currentConfig = config;
  return {
    get config() {
      return currentConfig;
    },
    save(updates: Record<string, unknown>) {
      const current = store.get(automationId);
      const currentNode = current?.actionGraph.nodes.find((item) => item.id === node.id);
      const parsed = schema.safeParse(currentNode?.config);
      if (
        !current ||
        currentNode?.type !== node.type ||
        !parsed.success ||
        JSON.stringify(parsed.data) !== JSON.stringify(currentConfig)
      )
        return false;
      const next = schema.parse({ ...currentConfig, ...updates });
      if (
        !store.update(current.id, {
          actionGraph: {
            ...current.actionGraph,
            nodes: current.actionGraph.nodes.map((item) =>
              item.id === node.id ? { ...item, config: { ...item.config, ...updates } } : item
            ),
          },
        })
      )
        throw new Error('Could not save cloud action state');
      currentConfig = next;
      return true;
    },
  };
}
