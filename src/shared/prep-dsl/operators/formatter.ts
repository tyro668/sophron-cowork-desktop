import type { PrepFlowNodeLike } from '../exporter';
import { formatRegisteredOperator } from './registry';

export function formatOperator(node: PrepFlowNodeLike): string | null {
  // Structured config is authoritative; a cached `config.dsl` can be stale.
  const registered = formatRegisteredOperator(node.type, node.config);
  if (registered !== undefined) return registered;
  if (typeof node.config?.dsl === 'string' && node.config.dsl.trim().length > 0) {
    return node.config.dsl;
  }
  return registered ?? null;
}
