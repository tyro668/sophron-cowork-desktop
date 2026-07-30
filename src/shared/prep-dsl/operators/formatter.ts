import type { PrepFlowNodeLike } from '../exporter';
import { formatRegisteredOperator } from './registry';

export function formatOperator(node: PrepFlowNodeLike): string | null {
  if (typeof node.config?.dsl === 'string' && node.config.dsl.trim().length > 0) {
    return node.config.dsl;
  }
  const registered = formatRegisteredOperator(node.type, node.config);
  if (registered !== undefined) return registered;
  return registered ?? null;
}
