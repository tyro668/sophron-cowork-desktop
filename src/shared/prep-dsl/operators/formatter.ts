import type { PrepFlowNodeLike } from '../exporter';
import { formatInputSource } from './input-source-format';
import { formatRegisteredOperator } from './registry';

/** Structured config is the single source of truth; DSL text is always derived. */
export function formatOperator(node: PrepFlowNodeLike): string | null {
  if (node.type === 'input') {
    const alias = typeof node.config?.alias === 'string' ? node.config.alias : 'src';
    return formatInputSource(node, alias);
  }
  return formatRegisteredOperator(node.type, node.config) ?? null;
}
