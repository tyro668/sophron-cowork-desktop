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
  parseEditableFilterCondition,
  isLeaf,
  createEmptyLeaf,
  addLeafToBranch,
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
  {
    groupKey: 'filterGroupNull',
    items: [
      { labelKey: 'filterOpIsNull', value: 'is null' },
      { labelKey: 'filterOpIsNotNull', value: 'is not null' },
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
  {
    groupKey: 'filterGroupNull',
    items: [
      { labelKey: 'filterOpIsNull', value: 'is null' },
      { labelKey: 'filterOpIsNotNull', value: 'is not null' },
    ],
  },
];

const BOOLEAN_OP_GROUPS: OpGroup[] = [
  {
    groupKey: 'filterGroupCompare',
    items: [{ labelKey: 'filterOpEq', value: '=' }],
  },
  {
    groupKey: 'filterGroupNull',
    items: [
      { labelKey: 'filterOpIsNull', value: 'is null' },
      { labelKey: 'filterOpIsNotNull', value: 'is not null' },
    ],
  },
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
  {
    groupKey: 'filterGroupNull',
    items: [
      { labelKey: 'filterOpIsNull', value: 'is null' },
      { labelKey: 'filterOpIsNotNull', value: 'is not null' },
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
  addWithConnective: (
    branchId: string,
    afterIndex: number,
    leafId: string,
    parentConnective: FilterConditionConnective,
    targetConnective: FilterConditionConnective,
    depth: number
  ) => void;
  tr: (key: string) => string;
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
  const colType = ctx.columnTypes[leaf.field];
  const opGroups = useMemo(() => operatorsForType(colType), [colType]);
  const opGroupsTranslated = useMemo(
    () =>
      opGroups.map((g) => ({
        key: g.groupKey,
        items: g.items.map((o) => ({ value: o.value, label: tr(o.labelKey) })),
      })),
    [opGroups, tr]
  );
  const allOps = flattenOps(opGroups);
  const validOps = allOps.map((o) => o.value);
  const effectiveOp = validOps.includes(leaf.op) ? leaf.op : (allOps[0]?.value ?? '=');
  const isBetween = effectiveOp === 'between';
  const isMultiValue = effectiveOp === 'in' || effectiveOp === 'not in';
  const isNullOp = effectiveOp === 'is null' || effectiveOp === 'is not null';
  const colVals = ctx.columnValues[leaf.field] ?? [];
  const isValsLoading = ctx.loadingValues[leaf.field] ?? false;
  const canAddAnd = parentConnective === 'and' || depth < MAX_NESTING_DEPTH;
  const canAddOr = parentConnective === 'or' || depth < MAX_NESTING_DEPTH;

  return (
    <div className="group relative py-0.5">
      <div className="grid min-w-0 grid-cols-[minmax(140px,180px)_112px_minmax(180px,1fr)_40px_40px_28px] items-center gap-2">
        {/* Field */}
        <div className="min-w-0">
          <GlassFieldSingleSelect
            value={leaf.field}
            options={ctx.fieldCompletions}
            columnTypes={ctx.columnTypes}
            onChange={(v) => {
              ctx.fetchColumnValues(v);
              const newValidOps = flattenOps(operatorsForType(ctx.columnTypes[v])).map(
                (o) => o.value
              );
              const nextOp = newValidOps.includes(leaf.op) ? leaf.op : '=';
              ctx.updateLeaf(leaf.id, { field: v, op: nextOp });
            }}
            placeholder={ctx.tr('filterFieldPlaceholder')}
            emptyText={ctx.tr('noMatch')}
            className="h-7 w-full"
          />
        </div>

        {/* Operator */}
        <GlassOptionSingleSelect
          value={effectiveOp}
          groups={opGroupsTranslated}
          onChange={(v) => ctx.updateLeaf(leaf.id, { op: v })}
          className="h-7 w-28 rounded-md text-[12px]"
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
                onValuesChange={(values) =>
                  ctx.updateLeaf(leaf.id, { values, val1: joinInValues(values) })
                }
                placeholder={ctx.tr('filterValuesPlaceholder')}
                className="!w-full"
                addLabel={ctx.tr('filterAddValue')}
                noSuggestionsLabel={ctx.tr('noSuggestions')}
                clearLabel={ctx.tr('filterClearValues')}
                onOpen={() => ctx.fetchColumnValues(leaf.field)}
              />
            ) : (
              <GlassValueInput
                value={leaf.val1}
                suggestions={colVals}
                isLoading={isValsLoading}
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
                onChange={(v) => ctx.updateLeaf(leaf.id, { val2: v })}
                placeholder={ctx.tr('filterValue2Placeholder')}
                className="!w-full"
                onOpen={() => ctx.fetchColumnValues(leaf.field)}
              />
            </>
          )}
        </div>

        {/* Add AND condition */}
        <button
          type="button"
          onClick={() => {
            if (!canAddAnd) return;
            ctx.addWithConnective(branchId, index, leaf.id, parentConnective, 'and', depth);
          }}
          className={`flex h-7 flex-shrink-0 items-center justify-center transition-colors ${
            !canAddAnd
              ? 'text-text-muted/20 cursor-not-allowed'
              : 'text-text-muted/50 hover:text-accent'
          }`}
          title={!canAddAnd ? ctx.tr('filterMaxDepth') : ctx.tr('filterAddAnd')}
        >
          <span className="inline-flex h-5 w-8 items-center justify-center rounded border border-current text-[10px] font-medium leading-none">
            {ctx.tr('filterConnectiveAnd')}
          </span>
        </button>

        {/* Add OR condition */}
        <button
          type="button"
          onClick={() => {
            if (!canAddOr) return;
            ctx.addWithConnective(branchId, index, leaf.id, parentConnective, 'or', depth);
          }}
          className={`flex h-7 flex-shrink-0 items-center justify-center transition-colors ${
            !canAddOr
              ? 'text-text-muted/20 cursor-not-allowed'
              : 'text-text-muted/50 hover:text-accent'
          }`}
          title={!canAddOr ? ctx.tr('filterMaxDepth') : ctx.tr('filterAddOr')}
        >
          <span className="inline-flex h-5 w-8 items-center justify-center rounded border border-current text-[10px] font-medium leading-none">
            {ctx.tr('filterConnectiveOr')}
          </span>
        </button>

        {/* Delete */}
        <button
          type="button"
          onClick={() => ctx.removeNode(leaf.id)}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-text-muted/50 hover:text-error hover:bg-error/10 transition-colors"
          title={ctx.tr('filterDeleteCondition')}
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

  const renderItem = (item: FilterConditionNode, i: number) => {
    if (isLeaf(item)) {
      return (
        <div>
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
    return <div>{renderItem(branch.items[0], 0)}</div>;
  }

  // Nested groups: file-tree style header + indentation.
  return (
    <div className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)] gap-x-3">
      <div className="relative flex h-7 items-center">
        <button
          type="button"
          onClick={() => ctx.toggleBranchConnective(branch.id)}
          className="flex h-6 w-8 items-center justify-center rounded border border-accent/70 bg-accent/10 text-center text-[12px] font-medium text-accent-text transition-colors hover:border-accent hover:bg-accent/15"
          title={ctx.tr('filterToggleAndOr')}
        >
          {ctx.tr(branch.connective === 'and' ? 'filterConnectiveAnd' : 'filterConnectiveOr')}
        </button>
        <span className="pointer-events-none absolute left-8 top-1/2 w-1 border-t border-text-secondary/55" />
      </div>

      <div className="relative space-y-1">
        {branch.items.map((item, i) => (
          <div key={item.id} className="relative min-w-0">
            <span className="pointer-events-none absolute -left-3 top-3.5 w-3 border-t border-text-secondary/55" />
            {i < itemCount - 1 && (
              <span className="pointer-events-none absolute -bottom-[18px] -left-3 top-3.5 border-l border-text-secondary/55" />
            )}
            {renderItem(item, i)}
          </div>
        ))}
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
  const tr = useFormTranslation();

  // ── Config sync ────────────────────────────────────────────────────

  const updateConfig = useUpdateConfig(onNodeChange);

  // Parse condition from config into tree (ensure at least one empty row)
  const [initialParse] = useState(() =>
    parseEditableFilterCondition(node.config.condition as string | undefined)
  );
  const [root, setRoot] = useState<FilterConditionBranch>(initialParse.tree);
  const [parseError, setParseError] = useState<string | null>(initialParse.error);

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

  // ── Column metadata ────────────────────────────────────────────────

  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const columnTypesRef = useRef(columnTypes);
  useEffect(() => {
    columnTypesRef.current = columnTypes;
  }, [columnTypes]);
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

  const addAfter = useCallback(
    (branchId: string, afterIndex: number) => {
      setParseError(null);
      setRoot((prev) => {
        const next = updateBranchInTree(prev, branchId, (b) => addLeafToBranch(b, afterIndex));
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

  const addAfterAndGroup = useCallback(
    (
      branchId: string,
      leafId: string,
      afterIndex: number,
      connective: FilterConditionConnective = 'and'
    ) => {
      setParseError(null);
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
        updateConfig((cfg) => ({
          ...cfg,
          condition: buildFilterConditionTree(next, columnTypesRef.current),
        }));
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
      targetConnective: FilterConditionConnective,
      depth: number
    ) => {
      if (targetConnective === parentConnective) {
        addAfter(branchId, afterIndex);
        return;
      }
      if (depth < MAX_NESTING_DEPTH) {
        addAfterAndGroup(branchId, leafId, afterIndex, targetConnective);
      }
    },
    [addAfter, addAfterAndGroup]
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
      fieldCompletions,
      fetchColumnValues,
      updateLeaf,
      removeNode,
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
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="scrollbar-hover min-w-0 flex-1 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <div className="space-y-2.5">
            {parseError && (
              <p role="alert" className="rounded-md bg-error/10 px-2.5 py-2 text-[11px] text-error">
                {tr('filterParseError')}: {parseError}
              </p>
            )}
            {/* Global add button */}
            <button
              type="button"
              onClick={() => {
                setParseError(null);
                setRoot((prev) => {
                  const next = addLeafToBranch(prev, prev.items.length - 1);
                  localUpdateRef.current = true;
                  updateConfig((cfg) => ({
                    ...cfg,
                    condition: buildFilterConditionTree(next, columnTypesRef.current),
                  }));
                  return next;
                });
              }}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2.5 text-[13px] font-medium text-accent hover:border-accent/50 hover:text-accent-hover transition-colors"
            >
              <Plus className="h-3 w-3" />
              {tr('filterAddCondition')}
            </button>

            {/* Condition tree */}
            <BranchGroupRenderer branch={root} depth={0} ctx={branchCtx} />
          </div>
        </div>
      </div>
    </div>
  );
}
