import type { PrepFlowNodeLike } from '../exporter';
import { quoteString } from '../syntax/literals';
import { formatFieldRef } from '../syntax/fields';

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function formatInputSource(node: PrepFlowNodeLike, alias: string): string | null {
  const config = node.config ?? {};
  const source = isString(config.source)
    ? config.source
    : isString(config.rawTableId)
      ? 'rawTable'
      : isString(config.filePath)
        ? 'file'
        : 'pipeline';
  const incremental =
    source !== 'rawTable' && isString(config.incrementalBy)
      ? ` incremental by ${formatFieldRef(config.incrementalBy)}`
      : '';
  if (source === 'rawTable') {
    const rawTableId = stringValue(config.rawTableId) ?? stringValue(config.name);
    return rawTableId
      ? `input source rawTable ${quoteString(rawTableId)}${incremental} as ${alias}`
      : null;
  }
  if (source === 'file') {
    const filePath = stringValue(config.filePath);
    return filePath ? `input source file ${quoteString(filePath)}${incremental} as ${alias}` : null;
  }
  return `input source pipeline${incremental} as ${alias}`;
}
