/**
 * Hierarchical picker tree used by RawTableTree / ResultTableTree in `variant="picker"`.
 * Groups (and raw-source file nodes) are expandable parents; only table leaves are
 * independently selectable. Parent checkboxes are tri-state and apply to selectable children.
 */
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../ui';
import { PickerCheck } from './raw-table-tree';

export type TablePickerNodeKind = 'group' | 'source' | 'table';

export interface TablePickerTreeNode {
  id: string;
  kind: TablePickerNodeKind;
  name: string;
  meta?: string;
  icon: ReactNode;
  disabled?: boolean;
  referenced?: boolean;
  referencedLabel?: string;
  /** Table id for leaf nodes (selection keys). */
  tableId?: string;
  children?: TablePickerTreeNode[];
}

export function TablePickerTree({
  nodes,
  selectedIds,
  onSelectedIdsChange,
  leafTestId,
  sourceTestId,
  groupTestId = 'table-picker-tree-group',
  referencedLabel,
}: {
  nodes: TablePickerTreeNode[];
  selectedIds: readonly string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  leafTestId: string;
  sourceTestId?: string;
  groupTestId?: string;
  referencedLabel: string;
}) {
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const visible = useMemo(() => flattenVisible(nodes, collapsed), [nodes, collapsed]);

  const toggleCollapsed = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyTableIds = (ids: string[], mode: 'select' | 'clear' | 'toggle') => {
    if (!onSelectedIdsChange || ids.length === 0) return;
    const next = new Set(selected);
    if (mode === 'clear') {
      for (const id of ids) next.delete(id);
    } else if (mode === 'select') {
      for (const id of ids) next.add(id);
    } else {
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
    }
    onSelectedIdsChange([...next]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, node: FlatPickerNode) => {
    const index = visible.findIndex((item) => item.node.id === node.node.id);
    if (index < 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = visible[Math.min(visible.length - 1, index + 1)];
      if (next) setFocusedId(next.node.id);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = visible[Math.max(0, index - 1)];
      if (next) setFocusedId(next.node.id);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (hasChildren(node.node) && collapsed.has(node.node.id)) toggleCollapsed(node.node.id);
      else if (hasChildren(node.node) && visible[index + 1])
        setFocusedId(visible[index + 1].node.id);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (hasChildren(node.node) && !collapsed.has(node.node.id)) toggleCollapsed(node.node.id);
      else if (node.parentId) setFocusedId(node.parentId);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      const selectable = selectableChildIds(node.node);
      if (node.node.kind === 'table' && node.node.tableId && !node.node.disabled) {
        applyTableIds([node.node.tableId], 'toggle');
      } else if (selectable.length > 0) {
        const allOn = selectable.every((id) => selected.has(id));
        applyTableIds(selectable, allOn ? 'clear' : 'select');
      }
    }
  };

  return (
    <div role="tree" aria-multiselectable="true" className="py-1 pb-2">
      {visible.map((item) => {
        const { node, level, isLastByLevel } = item;
        const childful = hasChildren(node);
        const expanded = childful && !collapsed.has(node.id);
        const selectable = selectableChildIds(node);
        const selectedCount = selectable.filter((id) => selected.has(id)).length;
        const isLeaf = node.kind === 'table';
        const isSelected = Boolean(isLeaf && node.tableId && selected.has(node.tableId));
        const isIndeterminate = !isLeaf && selectedCount > 0 && selectedCount < selectable.length;
        const isChecked = isLeaf
          ? isSelected
          : selectable.length > 0 && selectedCount === selectable.length;
        const checkDisabled = isLeaf ? Boolean(node.disabled) : selectable.length === 0;
        const testId = isLeaf ? leafTestId : node.kind === 'source' ? sourceTestId : groupTestId;
        return (
          <div
            key={node.id}
            role="treeitem"
            aria-expanded={childful ? expanded : undefined}
            aria-selected={isLeaf ? isSelected : undefined}
            aria-level={level + 1}
            data-testid={testId}
            data-table-id={node.tableId}
            tabIndex={(focusedId ?? visible[0]?.node.id) === node.id ? 0 : -1}
            className={cn(
              'relative flex h-11 cursor-pointer items-center gap-2 pr-4 text-[13px] outline-none transition-colors',
              isSelected && !node.disabled && 'bg-accent-muted',
              !isSelected && 'hover:bg-surface-hover',
              node.kind === 'group' && !isSelected && 'bg-surface-muted/70',
              node.disabled && 'cursor-not-allowed',
              focusedId === node.id && 'ring-1 ring-inset ring-accent/40'
            )}
            style={{ paddingLeft: 12 + level * 22 }}
            onClick={() => {
              setFocusedId(node.id);
              if (childful) toggleCollapsed(node.id);
              else if (isLeaf && node.tableId && !node.disabled) {
                applyTableIds([node.tableId], 'toggle');
              }
            }}
            onKeyDown={(event) => onKeyDown(event, item)}
            ref={(el) => {
              if (focusedId === node.id && el && document.activeElement !== el) el.focus();
            }}
          >
            <TreeGuides level={level} isLastByLevel={isLastByLevel} />
            <span
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-text-muted"
              onClick={(event) => {
                if (!childful) return;
                event.stopPropagation();
                setFocusedId(node.id);
                toggleCollapsed(node.id);
              }}
            >
              {childful ? (
                <ChevronRight
                  className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')}
                />
              ) : null}
            </span>
            <PickerCheck
              checked={isChecked}
              indeterminate={isIndeterminate}
              disabled={checkDisabled}
              label={node.name}
              onChange={() => {
                setFocusedId(node.id);
                if (isLeaf && node.tableId && !node.disabled) {
                  applyTableIds([node.tableId], 'toggle');
                  return;
                }
                if (selectable.length === 0) return;
                applyTableIds(selectable, isChecked ? 'clear' : 'select');
              }}
            />
            <span
              className={cn(
                'flex flex-shrink-0 items-center justify-center',
                node.kind === 'group' && 'text-accent'
              )}
            >
              {node.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'truncate text-text-primary',
                  node.kind === 'table' ? 'font-medium' : 'font-semibold'
                )}
              >
                {node.name}
              </div>
              {node.meta ? (
                <div className="truncate text-[12px] text-text-muted">{node.meta}</div>
              ) : null}
            </div>
            {node.referenced && (
              <span className="flex-shrink-0 border border-border-subtle bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
                {node.referencedLabel ?? referencedLabel}
              </span>
            )}
            {childful && (
              <span className="inline-flex h-5 min-w-[1.25rem] flex-shrink-0 items-center justify-center bg-background px-1.5 text-[11px] font-medium tabular-nums text-text-secondary">
                {countLeaves(node)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

type FlatPickerNode = {
  node: TablePickerTreeNode;
  level: number;
  parentId: string | null;
  isLastByLevel: boolean[];
};

function hasChildren(node: TablePickerTreeNode): boolean {
  return (node.children?.length ?? 0) > 0;
}

function flattenVisible(
  nodes: TablePickerTreeNode[],
  collapsed: ReadonlySet<string>,
  level = 0,
  parentId: string | null = null,
  ancestorIsLast: boolean[] = []
): FlatPickerNode[] {
  const rows: FlatPickerNode[] = [];
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const isLastByLevel = [...ancestorIsLast, isLast];
    rows.push({ node, level, parentId, isLastByLevel });
    if (hasChildren(node) && !collapsed.has(node.id)) {
      rows.push(
        ...flattenVisible(node.children ?? [], collapsed, level + 1, node.id, isLastByLevel)
      );
    }
  });
  return rows;
}

function walkTables(node: TablePickerTreeNode, visit: (node: TablePickerTreeNode) => void) {
  if (node.kind === 'table') visit(node);
  for (const child of node.children ?? []) walkTables(child, visit);
}

function selectableChildIds(node: TablePickerTreeNode): string[] {
  const ids: string[] = [];
  walkTables(node, (table) => {
    if (!table.disabled && table.tableId) ids.push(table.tableId);
  });
  return ids;
}

function countLeaves(node: TablePickerTreeNode): number {
  let count = 0;
  walkTables(node, () => {
    count += 1;
  });
  return count;
}

function TreeGuides({ level, isLastByLevel }: { level: number; isLastByLevel: boolean[] }) {
  if (level === 0) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0">
      {Array.from({ length: level }, (_, index) => {
        const left = 12 + index * 22 + 8;
        const isDirectParent = index === level - 1;
        const ancestorIsLast = isLastByLevel[index];
        const selfIsLast = isLastByLevel[level];
        return (
          <span key={index}>
            {(isDirectParent || !ancestorIsLast) && (
              <span
                className="absolute w-px bg-border-subtle"
                style={{
                  left,
                  top: 0,
                  height: isDirectParent && selfIsLast ? '50%' : '100%',
                }}
              />
            )}
            {isDirectParent && (
              <span
                className="absolute h-px bg-border-subtle"
                style={{ left, top: '50%', width: 12 }}
              />
            )}
          </span>
        );
      })}
    </span>
  );
}
