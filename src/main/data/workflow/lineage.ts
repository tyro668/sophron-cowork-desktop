import type {
  DataAutomationColumnSnapshot,
  DataAutomationLineageEntry,
} from '../../../renderer/types';
import type { GeneratedWorkflowColumnBinding } from './types';
import { normalizeDslTypeName } from './utils';

export function sourceColumnsFromBinding(
  column: GeneratedWorkflowColumnBinding
): Array<{ name: string; type?: string }> {
  if (column.sourceColumns && column.sourceColumns.length > 0) return column.sourceColumns;
  return column.sourceColumn ? [column.sourceColumn] : [];
}

export function toAutomationColumnSnapshot(
  column: GeneratedWorkflowColumnBinding | DataAutomationColumnSnapshot
): DataAutomationColumnSnapshot {
  return {
    name: column.name,
    type: column.type ? normalizeDslTypeName(column.type) : undefined,
  };
}

export function toAutomationLineageEntry(
  column: GeneratedWorkflowColumnBinding
): DataAutomationLineageEntry {
  return {
    ...toAutomationColumnSnapshot(column),
    sourceColumns: sourceColumnsFromBinding(column).map(toAutomationColumnSnapshot),
    expression: column.expression,
  };
}

export function mergeAutomationColumns(
  left: DataAutomationColumnSnapshot[],
  right: DataAutomationColumnSnapshot[]
): DataAutomationColumnSnapshot[] {
  const merged = new Map<string, DataAutomationColumnSnapshot>();
  for (const column of [...left, ...right]) {
    merged.set(column.name.toLowerCase(), toAutomationColumnSnapshot(column));
  }
  return [...merged.values()];
}
