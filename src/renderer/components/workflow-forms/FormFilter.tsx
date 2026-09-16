import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassValueInput } from './shared/GlassValueInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import {
  filterOpGroupsForType,
  firstValidFilterOp,
  normalizeFilterConditionOps,
  validFilterOpsForType,
  buildFilterConditionTree,
  parseEditableFilterCondition,
  isLeaf,
  createEmptyLeaf,
  removeNodeFromBranch,
  updateLeafInBranch,
  updateBranchInTree,
  toggleBranchConnectiveInTree,
  wrapItemsInGroup,
  splitInValues,
  joinInValues,
  MAX_NESTING_DEPTH,
  type FilterConditionLeaf,
  type FilterConditionBranch,
  type FilterConditionNode,
  type FilterConditionConnective,
} from '../../../shared/filter-condition';

// ── Operator definitions ──────────────────────────────────────────────

// Op values, grouping, and type compatibility live in shared/filter-condition/ops;
// the component only resolves i18n labels for them.

// ── Condition Leaf Row ────────────────────────────────────────────────

// Destructive row actions stay hidden until the row is hovered or focused.
const ROW_ACTION_CLASSES =
  'opacity-0 pointer-events-none transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100';

const FILTER_CONDITION_ROW_HEIGHT = 32;
const FILTER_CONDITION_ROW_GAP = 4;

export function getFilterConditionNodeLayout(node: FilterConditionNode): {
  height: number;
  anchor: number;
} {
  if (isLeaf(node) || node.items.length === 0) {
    return {
      height: FILTER_CONDITION_ROW_HEIGHT,
      anchor: FILTER_CONDITION_ROW_HEIGHT / 2,
    };
  }

  const childLayouts = node.items.map(getFilterConditionNodeLayout);
  const childAnchors: number[] = [];
  let height = 0;

  childLayouts.forEach((layout, index) => {
    childAnchors.push(height + layout.anchor);
    height += layout.height;
    if (index < childLayouts.length - 1) height += FILTER_CONDITION_ROW_GAP;
  });

  const middleIndex = Math.floor(childAnchors.length / 2);
  const anchor =
    childAnchors.length % 2 === 1
      ? childAnchors[middleIndex]
      : (childAnchors[middleIndex - 1] + childAnchors[middleIndex]) / 2;

  return { height, anchor };
}

interface LeafLocation {
  leafId: string;
  branchId: string;
  index: number;
  parentConnective: FilterConditionConnective;
  depth: number;
}

function findFirstLeafId(branch: FilterConditionBranch): string | null {
  for (const item of branch.items) {
    if (isLeaf(item)) return item.id;
    const nestedLeafId = findFirstLeafId(item);
    if (nestedLeafId) return nestedLeafId;
  }
  return null;
}

function findLeafLocation(
  branch: FilterConditionBranch,
  leafId: string,
  depth = 0
): LeafLocation | null {
  for (let index = 0; index < branch.items.length; index += 1) {
    const item = branch.items[index];
    if (isLeaf(item) && item.id === leafId) {
      return {
        leafId,
        branchId: branch.id,
        index,
        parentConnective: branch.connective,
        depth,
      };
    }
    if (!isLeaf(item)) {
      const nestedLocation = findLeafLocation(item, leafId, depth + 1);
      if (nestedLocation) return nestedLocation;
    }
  }
  return null;
}

function canAddWithConnective(
  location: LeafLocation | null,
  connective: FilterConditionConnective
): boolean {
  return Boolean(
    location && (location.parentConnective === connective || location.depth < MAX_NESTING_DEPTH)
  );
}

interface LeafRowContext {
  columnTypes: Record<string, string>;
  columnValues: Record<string, string[]>;
  loadingValues: Record<string, boolean>;
  columnValuesError: Record<string, boolean>;
  fieldCompletions: string[];
  fetchColumnValues: (colName: string) => void;
  retryColumnValues: (colName: string) => void;
  updateLeaf: (leafId: string, patch: Partial<FilterConditionLeaf>) => void;
  removeNode: (nodeId: string) => void;
  selectedLeafId: string | null;
  selectLeaf: (leafId: string) => void;
  tr: (key: string) => string;
}

function ConditionLeafRow({ leaf, ctx }: { leaf: FilterConditionLeaf; ctx: LeafRowContext }) {
  const { tr } = ctx;
  const colType = ctx.columnTypes[leaf.field];
  const opGroups = useMemo(() => filterOpGroupsForType(colType), [colType]);
  const opGroupsTranslated = useMemo(
    () =>
      opGroups.map((g) => ({
        key: g.key,
        items: g.items.map((item) => ({ value: item.value, label: tr(item.labelKey) })),
      })),
    [opGroups, tr]
  );
  const validOps = useMemo(() => validFilterOpsForType(colType), [colType]);
  const effectiveOp = validOps.includes(leaf.op) ? leaf.op : firstValidFilterOp(colType);
  const isBetween = effectiveOp === 'between';
  const isMultiValue = effectiveOp === 'in' || effectiveOp === 'not in';
  const isNullOp = effectiveOp === 'is null' || effectiveOp === 'is not null';
  const colVals = ctx.columnValues[leaf.field] ?? [];
  const isValsLoading = ctx.loadingValues[leaf.field] ?? false;
  const isValsError = ctx.columnValuesError[leaf.field] ?? false;
  const selected = ctx.selectedLeafId === leaf.id;

  return (
    <div
      data-selected={selected ? 'true' : 'false'}
      onPointerDownCapture={() => ctx.selectLeaf(leaf.id)}
      onFocusCapture={() => ctx.selectLeaf(leaf.id)}
      className={`group relative -ml-1 -mr-3 h-8 cursor-default rounded-lg py-0.5 pl-1 pr-3 outline-none transition-colors ${
        selected ? '' : 'hover:bg-surface-hover/30'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-1 right-0 top-1 w-0.5 rounded-full transition-colors ${
          selected ? 'bg-accent' : 'bg-transparent'
        }`}
      />
      <div className="grid min-w-0 grid-cols-[minmax(140px,180px)_112px_minmax(180px,1fr)_28px_32px] items-center gap-2">
        {/* Field */}
        <div className="min-w-0">
          <GlassFieldSingleSelect
            value={leaf.field}
            options={ctx.fieldCompletions}
            columnTypes={ctx.columnTypes}
            onChange={(v) => {
              ctx.fetchColumnValues(v);
              const nextOp = validFilterOpsForType(ctx.columnTypes[v]).includes(leaf.op)
                ? leaf.op
                : firstValidFilterOp(ctx.columnTypes[v]);
              ctx.updateLeaf(leaf.id, { field: v, op: nextOp });
            }}
            placeholder={ctx.tr('filterFieldPlaceholder')}
            emptyText={ctx.tr('fieldPicker.noMatch')}
            className="h-8 w-full"
          />
        </div>

        {/* Operator */}
        <GlassOptionSingleSelect
          value={effectiveOp}
          groups={opGroupsTranslated}
          onChange={(v) => ctx.updateLeaf(leaf.id, { op: v })}
          variant="highlight"
          className="h-8 w-28 rounded-md text-[12px]"
        />

        {/* Value(s) */}
        <div className="flex min-w-0 items-center gap-2">
          {!isNullOp &&
            (isMultiValue ? (
              <GlassValueInput
                multi
                values={leaf.values ?? splitInValues(leaf.val1)}
                suggestions={colVals}
                isLoading={isValsLoading}
                error={isValsError}
                onRetry={() => ctx.retryColumnValues(leaf.field)}
                onValuesChange={(values) =>
                  ctx.updateLeaf(leaf.id, { values, val1: joinInValues(values) })
                }
                placeholder={ctx.tr('filterValuesPlaceholder')}
                className="!w-full"
                addLabel={ctx.tr('filterAddValue')}
                noSuggestionsLabel={ctx.tr('valueInput.noSuggestions')}
                onOpen={() => ctx.fetchColumnValues(leaf.field)}
              />
            ) : (
              <GlassValueInput
                value={leaf.val1}
                suggestions={colVals}
                isLoading={isValsLoading}
                error={isValsError}
                onRetry={() => ctx.retryColumnValues(leaf.field)}
                onChange={(v) => ctx.updateLeaf(leaf.id, { val1: v })}
                placeholder={ctx.tr('filterValuePlaceholder')}
                className="!w-full"
                onOpen={() => ctx.fetchColumnValues(leaf.field)}
              />
            ))}

          {isBetween && (
            <>
              <span className="flex-shrink-0 text-[11px] text-text-muted">
                {ctx.tr('filterAnd')}
              </span>
              <GlassValueInput
                value={leaf.val2}
                suggestions={colVals}
                isLoading={isValsLoading}
                error={isValsError}
                onRetry={() => ctx.retryColumnValues(leaf.field)}
                onChange={(v) => ctx.updateLeaf(leaf.id, { val2: v })}
                placeholder={ctx.tr('filterValue2Placeholder')}
                className="!w-full"
                onOpen={() => ctx.fetchColumnValues(leaf.field)}
              />
            </>
          )}
        </div>

        {/* Delete */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            ctx.removeNode(leaf.id);
          }}
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-muted/50 hover:text-error hover:bg-error/10 ${ROW_ACTION_CLASSES}`}
          title={ctx.tr('filterDeleteCondition')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>

        {/* Explicit selection point in the safe area at the far right. */}
        <button
          type="button"
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            ctx.selectLeaf(leaf.id);
          }}
          className="group/selector flex h-8 w-8 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/30"
          title={ctx.tr('filterSelectCondition')}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full border transition-colors ${
              selected
                ? 'border-accent bg-accent'
                : 'border-border-muted bg-surface group-hover/selector:border-accent/60'
            }`}
          />
        </button>
      </div>
    </div>
  );
}

// ── Branch Group Renderer (recursive) ─────────────────────────────────

function BranchGroupRenderer({
  branch,
  depth,
  ctx,
}: {
  branch: FilterConditionBranch;
  depth: number;
  ctx: LeafRowContext & {
    updateBranch: (
      branchId: string,
      updater: (b: FilterConditionBranch) => FilterConditionBranch
    ) => void;
    toggleBranchConnective: (branchId: string) => void;
  };
}) {
  const itemCount = branch.items.length;
  const branchLayout = getFilterConditionNodeLayout(branch);

  const renderItem = (item: FilterConditionNode) => {
    if (isLeaf(item)) {
      return (
        <div>
          <ConditionLeafRow leaf={item} ctx={ctx} />
        </div>
      );
    }
    return (
      <div>
        <BranchGroupRenderer branch={item} depth={depth + 1} ctx={ctx} />
      </div>
    );
  };

  // Empty state
  if (itemCount === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-muted/70 px-4 py-6 text-center">
        <p className="text-[12px] text-text-muted">{ctx.tr('filterEmptyHint')}</p>
      </div>
    );
  }

  // Root and single-item branches do not need a standalone group header.
  if (itemCount === 1) {
    return <div>{renderItem(branch.items[0])}</div>;
  }

  // Nested groups: file-tree style header + indentation.
  return (
    <div className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)] gap-x-3">
      <div className="relative min-h-8 self-stretch">
        <button
          type="button"
          onClick={() => ctx.toggleBranchConnective(branch.id)}
          style={{ top: branchLayout.anchor }}
          className="absolute left-0 flex h-6 w-8 -translate-y-1/2 items-center justify-center rounded border border-accent/70 bg-accent/10 text-center text-[12px] font-medium text-accent-text transition-colors hover:border-accent hover:bg-accent/15"
          title={ctx.tr('filterToggleAndOr')}
        >
          {ctx.tr(branch.connective === 'and' ? 'filterConnectiveAnd' : 'filterConnectiveOr')}
        </button>
        <span
          style={{ top: branchLayout.anchor }}
          className="pointer-events-none absolute left-8 w-1 border-t border-text-secondary/55"
        />
      </div>

      <div className="relative space-y-1">
        {branch.items.map((item, i) => {
          const itemLayout = getFilterConditionNodeLayout(item);

          return (
            <div key={item.id} className="relative min-w-0">
              <span
                style={{ top: itemLayout.anchor }}
                className="pointer-events-none absolute -left-3 w-3 border-t border-text-secondary/55"
              />
              {i > 0 && (
                <span
                  style={{ top: -2, height: itemLayout.anchor + 2 }}
                  className="pointer-events-none absolute -left-3 border-l border-text-secondary/55"
                />
              )}
              {i < itemCount - 1 && (
                <span
                  style={{ top: itemLayout.anchor, bottom: -2 }}
                  className="pointer-events-none absolute -left-3 border-l border-text-secondary/55"
                />
              )}
              {renderItem(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FormFilter({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('filter');

  // ── Config sync ────────────────────────────────────────────────────

  const updateConfig = useUpdateConfig(onNodeChange);

  // Parse condition from config into tree (ensure at least one empty row)
  const [initialParse] = useState(() =>
    parseEditableFilterCondition(node.config.condition as string | undefined)
  );
  const [root, setRoot] = useState<FilterConditionBranch>(initialParse.tree);
  const [parseError, setParseError] = useState<string | null>(initialParse.error);
  const [selectedLeafId, setSelectedLeafId] = useState<string | null>(() =>
    findFirstLeafId(initialParse.tree)
  );

  const localUpdateRef = useRef(false);
  const lastSyncedConfigRef = useRef<string | undefined>(
    node.config.condition as string | undefined
  );

  // Sync from external config changes. We only re-parse when the incoming
  // config differs from the last value we wrote locally, so that column-type
  // refreshes (which change `columnTypesRef` without touching the config) and
  // our own write-back round-trips never clobber in-flight edits.
  useEffect(() => {
    const incoming = node.config.condition as string | undefined;
    if (localUpdateRef.current) {
      localUpdateRef.current = false;
      lastSyncedConfigRef.current = incoming;
      return;
    }
    if (incoming === lastSyncedConfigRef.current) return;
    const reparsed = parseEditableFilterCondition(incoming);
    setParseError(reparsed.error);
    if (!reparsed.error) {
      lastSyncedConfigRef.current = incoming;
      setRoot(reparsed.tree);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.config.condition]);

  useEffect(() => {
    if (selectedLeafId && findLeafLocation(root, selectedLeafId)) return;
    setSelectedLeafId(findFirstLeafId(root));
  }, [root, selectedLeafId]);

  // ── Column metadata ────────────────────────────────────────────────

  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const columnTypesRef = useRef(columnTypes);
  useEffect(() => {
    columnTypesRef.current = columnTypes;
  }, [columnTypes]);
  const [columnValues, setColumnValues] = useState<Record<string, string[]>>({});
  const [loadingValues, setLoadingValues] = useState<Record<string, boolean>>({});
  const [columnValuesError, setColumnValuesError] = useState<Record<string, boolean>>({});

  const fetchColumnValues = useCallback(
    (colName: string) => {
      if (!taskId || !sourceNode?.id || !colName) return;
      if (columnValues[colName] || loadingValues[colName]) return;
      const api = window.electronAPI?.data;
      if (!api?.getWorkflowNodeColumnValues) return;
      setLoadingValues((prev) => ({ ...prev, [colName]: true }));
      api
        .getWorkflowNodeColumnValues({
          taskId,
          nodeId: sourceNode.id,
          nodeType: sourceNode.type as never,
          nodeConfig: (sourceNode.config ?? {}) as Record<string, unknown>,
          column: colName,
        })
        .then((vals) => {
          setColumnValues((prev) => ({ ...prev, [colName]: vals }));
          setLoadingValues((prev) => ({ ...prev, [colName]: false }));
        })
        .catch(() => {
          setColumnValuesError((prev) => ({ ...prev, [colName]: true }));
          setLoadingValues((prev) => ({ ...prev, [colName]: false }));
        });
    },
    [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config, columnValues, loadingValues]
  );

  const retryColumnValues = useCallback(
    (colName: string) => {
      setColumnValuesError((prev) => ({ ...prev, [colName]: false }));
      fetchColumnValues(colName);
    },
    [fetchColumnValues]
  );

  // Ops configured against one column type may become invalid once the column
  // types resolve (DSL imports, upstream schema changes). Write the corrected
  // op back instead of displaying an operator the config does not hold.
  useEffect(() => {
    if (Object.keys(columnTypes).length === 0) return;
    setRoot((prev) => {
      const { next, changed } = normalizeFilterConditionOps(prev, columnTypes);
      if (!changed) return prev;
      localUpdateRef.current = true;
      updateConfig((cfg) => ({
        ...cfg,
        condition: buildFilterConditionTree(next, columnTypesRef.current),
      }));
      return next;
    });
  }, [columnTypes, updateConfig]);

  // ── Tree mutation handlers ──────────────────────────────────────────

  const updateLeaf = useCallback(
    (leafId: string, patch: Partial<FilterConditionLeaf>) => {
      setParseError(null);
      setRoot((prev) => {
        const next = updateLeafInBranch(prev, leafId, patch);
        localUpdateRef.current = true;
        updateConfig((cfg) => ({
          ...cfg,
          condition: buildFilterConditionTree(next, columnTypesRef.current),
        }));
        return next;
      });
    },
    [updateConfig]
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      setParseError(null);
      setRoot((prev) => {
        let next = removeNodeFromBranch(prev, nodeId);
        if (next.items.length === 0) {
          next = { ...next, items: [createEmptyLeaf()] };
        }
        localUpdateRef.current = true;
        updateConfig((cfg) => ({
          ...cfg,
          condition: buildFilterConditionTree(next, columnTypesRef.current),
        }));
        return next;
      });
    },
    [updateConfig]
  );

  const selectedLeafLocation = useMemo(
    () => (selectedLeafId ? findLeafLocation(root, selectedLeafId) : null),
    [root, selectedLeafId]
  );

  const addConditionWithConnective = useCallback(
    (targetConnective: FilterConditionConnective) => {
      const targetLeafId = selectedLeafLocation?.leafId;
      if (!targetLeafId || !canAddWithConnective(selectedLeafLocation, targetConnective)) return;

      const newLeaf = createEmptyLeaf();
      setParseError(null);
      setSelectedLeafId(newLeaf.id);
      setRoot((prev) => {
        const location = findLeafLocation(prev, targetLeafId);
        if (!location || !canAddWithConnective(location, targetConnective)) return prev;

        const next = updateBranchInTree(prev, location.branchId, (branch) => {
          const items = [...branch.items];
          items.splice(location.index + 1, 0, newLeaf);
          const withNewLeaf = { ...branch, items };
          if (location.parentConnective === targetConnective) return withNewLeaf;
          return (
            wrapItemsInGroup(withNewLeaf, [targetLeafId, newLeaf.id], targetConnective) ??
            withNewLeaf
          );
        });
        localUpdateRef.current = true;
        updateConfig((cfg) => ({
          ...cfg,
          condition: buildFilterConditionTree(next, columnTypesRef.current),
        }));
        return next;
      });
    },
    [selectedLeafLocation, updateConfig]
  );

  const updateBranch = useCallback(
    (branchId: string, updater: (b: FilterConditionBranch) => FilterConditionBranch) => {
      setParseError(null);
      setRoot((prev) => {
        const next = updateBranchInTree(prev, branchId, updater);
        localUpdateRef.current = true;
        updateConfig((cfg) => ({
          ...cfg,
          condition: buildFilterConditionTree(next, columnTypesRef.current),
        }));
        return next;
      });
    },
    [updateConfig]
  );

  const toggleBranchConnective = useCallback(
    (branchId: string) => {
      setParseError(null);
      setRoot((prev) => {
        const next = toggleBranchConnectiveInTree(prev, branchId);
        localUpdateRef.current = true;
        updateConfig((cfg) => ({
          ...cfg,
          condition: buildFilterConditionTree(next, columnTypesRef.current),
        }));
        return next;
      });
    },
    [updateConfig]
  );

  // Build leaf row context
  const leafCtx = useMemo<LeafRowContext>(
    () => ({
      columnTypes,
      columnValues,
      loadingValues,
      columnValuesError,
      fieldCompletions,
      fetchColumnValues,
      retryColumnValues,
      updateLeaf,
      removeNode,
      selectedLeafId,
      selectLeaf: setSelectedLeafId,
      tr,
    }),
    [
      columnTypes,
      columnValues,
      loadingValues,
      columnValuesError,
      fieldCompletions,
      fetchColumnValues,
      retryColumnValues,
      updateLeaf,
      removeNode,
      selectedLeafId,
      tr,
    ]
  );

  const branchCtx = useMemo(
    () => ({
      ...leafCtx,
      updateBranch,
      toggleBranchConnective,
    }),
    [leafCtx, updateBranch, toggleBranchConnective]
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="scrollbar-hover min-w-0 flex-1 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <div className="space-y-2.5">
            {parseError && (
              <p role="alert" className="rounded-md bg-error/10 px-2.5 py-2 text-[11px] text-error">
                {tr('filterParseError')}: {parseError}
              </p>
            )}
            {/* Add relative to the selected condition */}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  disabled={!selectedLeafLocation}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border-subtle bg-transparent px-2.5 text-[12px] font-medium text-text-muted opacity-75 outline-none transition-colors hover:border-border-muted hover:bg-surface-hover hover:text-text-secondary hover:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" />
                  {tr('filterAddCondition')}
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={6}
                  collisionPadding={12}
                  className="z-50 min-w-36 overflow-hidden rounded-lg border border-border-muted bg-surface p-1 shadow-soft"
                >
                  <DropdownMenu.Item
                    disabled={!canAddWithConnective(selectedLeafLocation, 'and')}
                    onSelect={() => addConditionWithConnective('and')}
                    className="flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-text-secondary outline-none transition-colors hover:bg-surface-hover hover:text-text-primary focus:bg-surface-hover focus:text-text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-45"
                  >
                    <span className="inline-flex h-5 w-8 items-center justify-center rounded border border-current text-[10px] leading-none">
                      {tr('filterConnectiveAnd')}
                    </span>
                    {tr('filterAddAnd')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={!canAddWithConnective(selectedLeafLocation, 'or')}
                    onSelect={() => addConditionWithConnective('or')}
                    className="flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-text-secondary outline-none transition-colors hover:bg-surface-hover hover:text-text-primary focus:bg-surface-hover focus:text-text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-45"
                  >
                    <span className="inline-flex h-5 w-8 items-center justify-center rounded border border-current text-[10px] leading-none">
                      {tr('filterConnectiveOr')}
                    </span>
                    {tr('filterAddOr')}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            {/* Condition tree */}
            <BranchGroupRenderer branch={root} depth={0} ctx={branchCtx} />
          </div>
        </div>
      </div>
    </div>
  );
}
