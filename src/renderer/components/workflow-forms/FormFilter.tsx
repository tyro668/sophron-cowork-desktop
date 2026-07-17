import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassValueInput } from './shared/GlassValueInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import {
  isNumericDataFieldType,
  isTemporalDataFieldType,
  normalizeDataFieldType,
} from '../../../shared/data-field-types';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import {
  buildFilterConditionTree,
  parseConditionTree,
  resetNodeIdCounter,
  isLeaf,
  isBranch,
  createEmptyLeaf,
  addLeafToBranch,
  removeNodeFromBranch,
  updateLeafInBranch,
  wrapItemsInGroup,
  MAX_NESTING_DEPTH,
  type FilterConditionLeaf,
  type FilterConditionBranch,
  type FilterConditionNode,
  type FilterConditionConnective,
} from './shared/filter-condition';

// ── Operator definitions ──────────────────────────────────────────────

type OpDef = { labelKey: string; value: string };
type OpGroup = { groupKey: string; items: OpDef[] };

const ALL_OP_GROUPS: OpGroup[] = [
  {
    groupKey: 'filterGroupCompare',
    items: [
      { labelKey: 'filterOpEq', value: '=' },
      { labelKey: 'filterOpNeq', value: '!=' },
    ],
  },
  {
    groupKey: 'filterGroupRange',
    items: [
      { labelKey: 'filterOpGt', value: '>' },
      { labelKey: 'filterOpLt', value: '<' },
      { labelKey: 'filterOpGte', value: '>=' },
      { labelKey: 'filterOpLte', value: '<=' },
      { labelKey: 'filterOpBetween', value: 'between' },
    ],
  },
  {
    groupKey: 'filterGroupSet',
    items: [
      { labelKey: 'filterOpIn', value: 'in' },
      { labelKey: 'filterOpNotIn', value: 'not in' },
    ],
  },
];

const STRING_OP_GROUPS: OpGroup[] = [
  {
    groupKey: 'filterGroupCompare',
    items: [
      { labelKey: 'filterOpEq', value: '=' },
      { labelKey: 'filterOpNeq', value: '!=' },
    ],
  },
  {
    groupKey: 'filterGroupMatch',
    items: [
      { labelKey: 'filterOpLike', value: 'like' },
      { labelKey: 'filterOpNotLike', value: 'not like' },
      { labelKey: 'filterOpMatches', value: 'matches' },
      { labelKey: 'filterOpNotMatches', value: 'not matches' },
    ],
  },
  {
    groupKey: 'filterGroupBoundary',
    items: [
      { labelKey: 'filterOpBegin', value: 'begin' },
      { labelKey: 'filterOpEnd', value: 'end' },
    ],
  },
  {
    groupKey: 'filterGroupSet',
    items: [
      { labelKey: 'filterOpIn', value: 'in' },
      { labelKey: 'filterOpNotIn', value: 'not in' },
    ],
  },
];

const BOOLEAN_OP_GROUPS: OpGroup[] = [
  { groupKey: 'filterGroupCompare', items: [{ labelKey: 'filterOpEq', value: '=' }] },
];

const TEMPORAL_OP_GROUPS: OpGroup[] = [
  {
    groupKey: 'filterGroupCompare',
    items: [
      { labelKey: 'filterOpEq', value: '=' },
      { labelKey: 'filterOpNeq', value: '!=' },
    ],
  },
  {
    groupKey: 'filterGroupRange',
    items: [
      { labelKey: 'filterDateGt', value: '>' },
      { labelKey: 'filterDateLt', value: '<' },
      { labelKey: 'filterDateLte', value: '<=' },
      { labelKey: 'filterDateGte', value: '>=' },
      { labelKey: 'filterOpBetween', value: 'between' },
    ],
  },
  {
    groupKey: 'filterGroupSet',
    items: [
      { labelKey: 'filterOpIn', value: 'in' },
      { labelKey: 'filterOpNotIn', value: 'not in' },
    ],
  },
];

function operatorsForType(colType: string | undefined): OpGroup[] {
  if (!colType) return ALL_OP_GROUPS;
  const type = normalizeDataFieldType(colType);
  if (isNumericDataFieldType(type)) return ALL_OP_GROUPS;
  if (type === 'text') return STRING_OP_GROUPS;
  if (isTemporalDataFieldType(type)) return TEMPORAL_OP_GROUPS;
  if (type === 'boolean') return BOOLEAN_OP_GROUPS;
  return ALL_OP_GROUPS;
}

/** Flatten groups to a plain OpDef array for validation lookups. */
function flattenOps(groups: OpGroup[]): OpDef[] {
  return groups.flatMap((g) => g.items);
}

// ── Condition Leaf Row ────────────────────────────────────────────────

interface LeafRowContext {
  columnTypes: Record<string, string>;
  columnValues: Record<string, string[]>;
  loadingValues: Record<string, boolean>;
  fieldCompletions: string[];
  fetchColumnValues: (colName: string) => void;
  updateLeaf: (leafId: string, patch: Partial<FilterConditionLeaf>) => void;
  removeNode: (nodeId: string) => void;
  addAfter: (branchId: string, afterIndex: number) => void;
  addWithConnective: (
    branchId: string,
    afterIndex: number,
    leafId: string,
    parentConnective: FilterConditionConnective,
    targetConnective: FilterConditionConnective
  ) => void;
  tr: (key: string, fallback: string) => string;
}

function ConditionLeafRow({
  leaf,
  branchId,
  index,
  depth,
  parentConnective,
  ctx,
}: {
  leaf: FilterConditionLeaf;
  branchId: string;
  index: number;
  depth: number;
  parentConnective: FilterConditionConnective;
  ctx: LeafRowContext;
}) {
  const { tr } = ctx;
  const fieldSelected = !!leaf.field;
  const colType = ctx.columnTypes[leaf.field];
  const opGroups = useMemo(() => operatorsForType(colType), [colType]);
  const opGroupsTranslated = useMemo(
    () =>
      opGroups.map((g) => ({
        key: g.groupKey,
        items: g.items.map((o) => ({ value: o.value, label: tr(o.labelKey, o.value) })),
      })),
    [opGroups, tr]
  );
  const allOps = flattenOps(opGroups);
  const validOps = allOps.map((o) => o.value);
  const effectiveOp = validOps.includes(leaf.op) ? leaf.op : (allOps[0]?.value ?? '=');
  const isBetween = effectiveOp === 'between';
  const isMultiValue = effectiveOp === 'in' || effectiveOp === 'not in';
  const colVals = ctx.columnValues[leaf.field] ?? [];
  const isValsLoading = ctx.loadingValues[leaf.field] ?? false;

  return (
    <div className="group relative py-0.5">
      <div className="flex items-center gap-2 min-w-0">
        {/* Field */}
        <div className="flex-1 min-w-[100px] max-w-[180px]">
          <GlassFieldSingleSelect
            value={leaf.field}
            options={ctx.fieldCompletions}
            columnTypes={ctx.columnTypes}
            onChange={(v) => {
              ctx.fetchColumnValues(v);
              ctx.updateLeaf(leaf.id, { field: v, op: effectiveOp });
            }}
            placeholder={ctx.tr('filterFieldPlaceholder', '选择字段')}
            emptyText={ctx.tr('noMatch', '无匹配字段')}
            className="h-8 w-full"
          />
        </div>

        {/* Operator */}
        <GlassOptionSingleSelect
          value={effectiveOp}
          groups={opGroupsTranslated}
          disabled={!fieldSelected}
          onChange={(v) => ctx.updateLeaf(leaf.id, { op: v })}
          className="h-8 w-28 rounded-md text-[12px]"
        />

        {/* Value(s) */}
        {isMultiValue ? (
          <GlassValueInput
            multi
            value={leaf.val1}
            suggestions={colVals}
            isLoading={isValsLoading}
            onChange={(v) => ctx.updateLeaf(leaf.id, { val1: v })}
            placeholder={ctx.tr('filterValuesPlaceholder', '输入值后按 Enter 添加')}
            disabled={!fieldSelected}
            addLabel={ctx.tr('filterAddValue', '添加')}
            noSuggestionsLabel={ctx.tr('noSuggestions', '暂无建议值')}
            clearLabel={ctx.tr('filterClearValues', '清空输入框')}
          />
        ) : (
          <GlassValueInput
            value={leaf.val1}
            suggestions={colVals}
            isLoading={isValsLoading}
            onChange={(v) => ctx.updateLeaf(leaf.id, { val1: v })}
            placeholder={ctx.tr('filterValuePlaceholder', '值')}
            disabled={!fieldSelected}
          />
        )}

        {isBetween && (
          <>
            <span className="text-[11px] text-text-muted flex-shrink-0">
              {ctx.tr('filterAnd', '至')}
            </span>
            <GlassValueInput
              value={leaf.val2}
              suggestions={colVals}
              isLoading={isValsLoading}
              onChange={(v) => ctx.updateLeaf(leaf.id, { val2: v })}
              placeholder={ctx.tr('filterValue2Placeholder', '值2')}
              disabled={!fieldSelected}
            />
          </>
        )}

        <div className="flex-1 min-w-0" />

        {/* Add AND condition */}
        <button
          type="button"
          onClick={() => {
            if (parentConnective !== 'and' && depth >= MAX_NESTING_DEPTH) return;
            ctx.addWithConnective(branchId, index, leaf.id, parentConnective, 'and');
          }}
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center transition-colors ${
            parentConnective !== 'and' && depth >= MAX_NESTING_DEPTH
              ? 'text-text-muted/20 cursor-not-allowed'
              : 'text-text-muted/50 hover:text-accent'
          }`}
          title={
            parentConnective !== 'and' && depth >= MAX_NESTING_DEPTH
              ? ctx.tr('filterMaxDepth', '已达最大嵌套深度')
              : ctx.tr('filterAddAnd', '添加与条件')
          }
        >
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-current text-[9px] font-bold leading-none">
            A
          </span>
        </button>

        {/* Add OR condition */}
        <button
          type="button"
          onClick={() => {
            if (parentConnective !== 'or' && depth >= MAX_NESTING_DEPTH) return;
            ctx.addWithConnective(branchId, index, leaf.id, parentConnective, 'or');
          }}
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center transition-colors ${
            parentConnective !== 'or' && depth >= MAX_NESTING_DEPTH
              ? 'text-text-muted/20 cursor-not-allowed'
              : 'text-text-muted/50 hover:text-accent'
          }`}
          title={
            parentConnective !== 'or' && depth >= MAX_NESTING_DEPTH
              ? ctx.tr('filterMaxDepth', '已达最大嵌套深度')
              : ctx.tr('filterAddOr', '添加或条件')
          }
        >
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[9px] font-bold leading-none">
            +
          </span>
        </button>

        {/* Delete */}
        <button
          type="button"
          onClick={() => ctx.removeNode(leaf.id)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-muted/50 hover:text-error hover:bg-error/10 transition-colors"
          title={ctx.tr('filterDeleteCondition', '删除此条件')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Branch Group Renderer (recursive) ─────────────────────────────────

function BranchGroupRenderer({
  branch,
  root,
  depth,
  ctx,
}: {
  branch: FilterConditionBranch;
  root: FilterConditionBranch;
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
  const showBracket = itemCount > 1;
  const groupRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLDivElement | null>(null);
  const firstRowRef = useRef<HTMLDivElement | null>(null);
  const lastRowRef = useRef<HTMLDivElement | null>(null);
  const [diagLines, setDiagLines] = useState<{ top: string; bottom: string } | null>(null);

  const recalcDiag = useCallback(() => {
    const group = groupRef.current;
    const btn = btnRef.current;
    const first = firstRowRef.current;
    const last = lastRowRef.current;
    if (!group || !btn || !first || !last) return;
    const gr = group.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const fr = first.getBoundingClientRect();
    const lr = last.getBoundingClientRect();
    const btnTop = br.top - gr.top;
    const btnBottom = br.bottom - gr.top;
    const btnRight = br.right - gr.left;
    const firstLeft = fr.left - gr.left;
    const lastLeft = lr.left - gr.left;
    const firstY = (fr.top + fr.bottom) / 2 - gr.top;
    const lastY = (lr.top + lr.bottom) / 2 - gr.top;
    const next = {
      top: `M${btnRight},${btnTop} L${firstLeft},${firstY}`,
      bottom: `M${btnRight},${btnBottom} L${lastLeft},${lastY}`,
    };
    setDiagLines((prev) => (prev?.top === next.top && prev?.bottom === next.bottom ? prev : next));
  }, []);

  useEffect(() => {
    recalcDiag();
    const ro = new ResizeObserver(recalcDiag);
    if (groupRef.current) ro.observe(groupRef.current);
    return () => ro.disconnect();
  }, [recalcDiag, itemCount]);

  const singleItemRef = useCallback((el: HTMLDivElement | null) => {
    firstRowRef.current = el;
    lastRowRef.current = el;
  }, []);

  const renderItem = (item: FilterConditionNode, i: number) => {
    const isFirst = i === 0;
    const isLast = i === itemCount - 1;
    const ref =
      isFirst && isLast ? singleItemRef : isFirst ? firstRowRef : isLast ? lastRowRef : undefined;
    if (isLeaf(item)) {
      return (
        <div ref={ref}>
          <ConditionLeafRow
            leaf={item}
            branchId={branch.id}
            index={i}
            depth={depth}
            parentConnective={branch.connective}
            ctx={ctx}
          />
        </div>
      );
    }
    return (
      <div ref={ref}>
        <BranchGroupRenderer
          branch={item}
          root={root}
          depth={item.items.length > 1 ? depth + 1 : depth}
          ctx={ctx}
        />
      </div>
    );
  };

  // Empty state
  if (itemCount === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-muted/70 px-4 py-6 text-center">
        <p className="text-[12px] text-text-muted">
          {ctx.tr('filterEmptyHint', '尚未添加筛选条件')}
        </p>
      </div>
    );
  }

  // Single item: no bracket, just render directly
  if (!showBracket) {
    return (
      <div>
        {branch.items.map((item, i) => (
          <div key={item.id}>{renderItem(item, i)}</div>
        ))}
      </div>
    );
  }

  // Multiple items: diagonal connector lines + AND/OR button
  return (
    <div ref={groupRef} className="relative min-w-0">
      {/* AND/OR button vertically centered at far left */}
      <div
        ref={btnRef}
        className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 z-10"
      >
        <button
          type="button"
          onClick={() => ctx.toggleBranchConnective(branch.id)}
          className="rounded border border-border-muted/60 bg-background/50 px-2 py-0.5 text-[12px] text-center text-accent hover:bg-accent/10 hover:border-accent/30 transition-colors"
          title={ctx.tr('filterToggleAndOr', '点击切换与 / 或')}
        >
          {ctx.tr(
            branch.connective === 'and' ? 'filterConnectiveAnd' : 'filterConnectiveOr',
            branch.connective === 'and' ? '与' : '或'
          )}
        </button>
      </div>

      {/* Diagonal connector lines */}
      {diagLines && (
        <svg
          className="absolute inset-0 pointer-events-none overflow-visible"
          style={{ zIndex: 5 }}
        >
          <path d={diagLines.top} fill="none" stroke="rgba(139,148,158,0.35)" strokeWidth={1.2} />
          <path
            d={diagLines.bottom}
            fill="none"
            stroke="rgba(139,148,158,0.35)"
            strokeWidth={1.2}
          />
        </svg>
      )}

      {/* Content area — pushed right of the AND/OR button */}
      <div className="pl-[56px]">
        {branch.items.map((item, i) => {
          return (
            <div key={item.id}>
              <div className="relative">
                <div className="py-0.5">{renderItem(item, i)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main FormFilter ───────────────────────────────────────────────────

export default function FormFilter({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation();

  // ── Config sync ────────────────────────────────────────────────────

  const updateConfig = useUpdateConfig(onNodeChange);

  // Parse condition from config into tree (ensure at least one empty row)
  const [root, setRoot] = useState<FilterConditionBranch>(() => {
    resetNodeIdCounter();
    const tree = parseConditionTree(node.config.condition as string | undefined);
    if (tree.items.length === 0) {
      tree.items.push(createEmptyLeaf());
    }
    return tree;
  });

  const localUpdateRef = useRef(false);

  // Sync from external config changes
  useEffect(() => {
    if (localUpdateRef.current) {
      localUpdateRef.current = false;
      return;
    }
    const fromTree = buildFilterConditionTree(root);
    const fromConfig = node.config.condition as string | undefined;
    if ((fromTree || undefined) === (fromConfig || undefined)) return;
    // Re-parse from config
    resetNodeIdCounter();
    const reparsed = parseConditionTree(node.config.condition as string | undefined);
    if (reparsed.items.length === 0) {
      reparsed.items.push(createEmptyLeaf());
    }
    setRoot(reparsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.config.condition]);

  // ── Column metadata ────────────────────────────────────────────────

  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const [columnValues, setColumnValues] = useState<Record<string, string[]>>({});
  const [loadingValues, setLoadingValues] = useState<Record<string, boolean>>({});

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
          setColumnValues((prev) => ({ ...prev, [colName]: [] }));
          setLoadingValues((prev) => ({ ...prev, [colName]: false }));
        });
    },
    [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config, columnValues, loadingValues]
  );

  // ── Tree mutation handlers ──────────────────────────────────────────

  const updateLeaf = useCallback(
    (leafId: string, patch: Partial<FilterConditionLeaf>) => {
      setRoot((prev) => {
        const next = updateLeafInBranch(prev, leafId, patch);
        localUpdateRef.current = true;
        updateConfig((cfg) => ({ ...cfg, condition: buildFilterConditionTree(next) }));
        return next;
      });
    },
    [updateConfig]
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      setRoot((prev) => {
        let next = removeNodeFromBranch(prev, nodeId);
        if (next.items.length === 0) {
          next = { ...next, items: [createEmptyLeaf()] };
        }
        localUpdateRef.current = true;
        updateConfig((cfg) => ({ ...cfg, condition: buildFilterConditionTree(next) }));
        return next;
      });
    },
    [updateConfig]
  );

  const addAfter = useCallback(
    (branchId: string, afterIndex: number) => {
      setRoot((prev) => {
        const next = updateBranchInTree(prev, branchId, (b) => addLeafToBranch(b, afterIndex));
        localUpdateRef.current = true;
        updateConfig((cfg) => ({ ...cfg, condition: buildFilterConditionTree(next) }));
        return next;
      });
    },
    [updateConfig]
  );

  const addAfterAndGroup = useCallback(
    (
      branchId: string,
      leafId: string,
      afterIndex: number,
      connective: FilterConditionConnective = 'and'
    ) => {
      setRoot((prev) => {
        const next = updateBranchInTree(prev, branchId, (b) => {
          const withNewLeaf = addLeafToBranch(b, afterIndex);
          const newLeafId = withNewLeaf.items[afterIndex + 1]?.id;
          if (newLeafId) {
            return wrapItemsInGroup(withNewLeaf, [leafId, newLeafId], connective) ?? withNewLeaf;
          }
          return withNewLeaf;
        });
        localUpdateRef.current = true;
        updateConfig((cfg) => ({ ...cfg, condition: buildFilterConditionTree(next) }));
        return next;
      });
    },
    [updateConfig]
  );

  const addWithConnective = useCallback(
    (
      branchId: string,
      afterIndex: number,
      leafId: string,
      parentConnective: FilterConditionConnective,
      targetConnective: FilterConditionConnective
    ) => {
      if (targetConnective === parentConnective) {
        // Same connective: just add a leaf after the current one
        addAfter(branchId, afterIndex);
      } else {
        // Different connective: wrap current + new into a nested group
        addAfterAndGroup(branchId, leafId, afterIndex, targetConnective);
      }
    },
    [addAfter, addAfterAndGroup]
  );

  const updateBranch = useCallback(
    (branchId: string, updater: (b: FilterConditionBranch) => FilterConditionBranch) => {
      setRoot((prev) => {
        const next = updateBranchInTree(prev, branchId, updater);
        localUpdateRef.current = true;
        updateConfig((cfg) => ({ ...cfg, condition: buildFilterConditionTree(next) }));
        return next;
      });
    },
    [updateConfig]
  );

  const toggleBranchConnective = useCallback(
    (branchId: string) => {
      setRoot((prev) => {
        const next = updateBranchConnectiveInTree(prev, branchId);
        localUpdateRef.current = true;
        updateConfig((cfg) => ({ ...cfg, condition: buildFilterConditionTree(next) }));
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
      fieldCompletions,
      fetchColumnValues,
      updateLeaf,
      removeNode,
      addAfter,
      addWithConnective,
      tr,
    }),
    [
      columnTypes,
      columnValues,
      loadingValues,
      fieldCompletions,
      fetchColumnValues,
      updateLeaf,
      removeNode,
      addAfter,
      addWithConnective,
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
    <div className="grid content-start gap-2.5 min-w-0">
      <div className="space-y-2.5">
        {/* Global add button */}
        <button
          type="button"
          onClick={() => {
            setRoot((prev) => {
              const next = addLeafToBranch(prev, prev.items.length - 1);
              localUpdateRef.current = true;
              updateConfig((cfg) => ({ ...cfg, condition: buildFilterConditionTree(next) }));
              return next;
            });
          }}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border-muted bg-background/42 px-2 text-[11px] text-text-secondary hover:border-accent/30 hover:text-accent transition-colors"
        >
          <Plus className="h-3 w-3" />
          {tr('filterAddCondition', '添加筛选条件')}
        </button>

        {/* Condition tree */}
        <BranchGroupRenderer branch={root} root={root} depth={0} ctx={branchCtx} />
      </div>
    </div>
  );
}

// ── Tree walking helpers ──────────────────────────────────────────────

function updateBranchInTree(
  branch: FilterConditionBranch,
  branchId: string,
  updater: (b: FilterConditionBranch) => FilterConditionBranch
): FilterConditionBranch {
  if (branch.id === branchId) {
    return updater(branch);
  }
  const items = branch.items.map((item) => {
    if (isBranch(item)) {
      return updateBranchInTree(item, branchId, updater);
    }
    return item;
  });
  return { ...branch, items };
}

function updateBranchConnectiveInTree(
  branch: FilterConditionBranch,
  branchId: string
): FilterConditionBranch {
  if (branch.id === branchId) {
    return {
      ...branch,
      connective: branch.connective === 'and' ? 'or' : 'and',
    };
  }
  const items = branch.items.map((item) => {
    if (isBranch(item)) {
      return updateBranchConnectiveInTree(item, branchId);
    }
    return item;
  });
  return { ...branch, items };
}
