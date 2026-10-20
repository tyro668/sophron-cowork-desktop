import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { Copy, CornerDownRight, GitMerge, Plus } from 'lucide-react';
import {
  AddRow,
  Cell,
  ErrorRow,
  FormGrid,
  FormScroll,
  GridRow,
  RowActionsCell,
} from './shared/FormGrid';
import type { OperatorFormProps } from './types';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassValueInput } from './shared/GlassValueInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { dataClient } from '../../features/data/api/data-client';
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

export const FILTER_GRID_COLUMNS = '56px minmax(160px,1fr) 120px minmax(200px,1.6fr) 84px';

/** One flattened condition row: the leaf plus the connective that joins it to the previous row. */
export interface FlatFilterRow {
  leaf: FilterConditionLeaf;
  /** null for the first row (「当」). */
  connective: FilterConditionConnective | null;
  /** Branch whose connective the badge shows / toggles. */
  connectiveBranchId: string | null;
  depth: number;
}

export function flattenFilterTree(root: FilterConditionBranch): FlatFilterRow[] {
  const rows: FlatFilterRow[] = [];
  const walk = (
    branch: FilterConditionBranch,
    depth: number,
    inherited: FilterConditionConnective | null,
    inheritedBranchId: string | null
  ) => {
    branch.items.forEach((item, index) => {
      const connective = index === 0 ? inherited : branch.connective;
      const connectiveBranchId = index === 0 ? inheritedBranchId : branch.id;
      if (isLeaf(item)) rows.push({ leaf: item, connective, connectiveBranchId, depth });
      else walk(item, depth + 1, connective, connectiveBranchId);
    });
  };
  walk(root, 0, null, null);
  return rows;
}

const NULL_OPS = new Set(['is null', 'is not null']);

/** Leaf validation: a chosen field needs its value(s); extra rows need a field. */
export function validateFilterLeaf(
  leaf: FilterConditionLeaf,
  op: string,
  totalRows: number
): 'fieldRequired' | 'valueRequired' | null {
  if (!leaf.field) return totalRows > 1 ? 'fieldRequired' : null;
  if (NULL_OPS.has(op)) return null;
  if (op === 'in' || op === 'not in') {
    const values = leaf.values ?? splitInValues(leaf.val1);
    return values.length > 0 ? null : 'valueRequired';
  }
  if (!String(leaf.val1 ?? '').trim()) return 'valueRequired';
  if (op === 'between' && !String(leaf.val2 ?? '').trim()) return 'valueRequired';
  return null;
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
  addAfter: (leafId: string, connective: FilterConditionConnective, clone?: boolean) => void;
  canAddAfter: (leafId: string, connective: FilterConditionConnective) => boolean;
  toggleBranchConnective: (branchId: string) => void;
  totalRows: number;
  tr: (key: string, params?: Record<string, unknown>) => string;
}

const MENU_ITEM_CLASS =
  'flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2.5 text-[13px] text-text-secondary outline-none transition-colors hover:bg-surface-hover hover:text-text-primary focus:bg-accent-muted focus:text-text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-45';

function ConditionLeafRow({
  row,
  index,
  ctx,
}: {
  row: FlatFilterRow;
  index: number;
  ctx: LeafRowContext;
}) {
  const { tr } = ctx;
  const { leaf } = row;
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
  const isNullOp = NULL_OPS.has(effectiveOp);
  const colVals = ctx.columnValues[leaf.field] ?? [];
  const isValsLoading = ctx.loadingValues[leaf.field] ?? false;
  const isValsError = ctx.columnValuesError[leaf.field] ?? false;
  const issue = validateFilterLeaf(leaf, effectiveOp, ctx.totalRows);
  const indentStyle =
    row.depth > 0
      ? {
          paddingLeft: 12 * row.depth,
          boxShadow: 'inset 2px 0 0 var(--color-accent-muted)',
        }
      : undefined;

  return (
    <>
      <GridRow testId={`filter-row-${index}`}>
        <Cell v={['ctr']}>
          {row.connective === null ? (
            <span className="text-[11px] text-text-muted">{tr('filterWhen')}</span>
          ) : (
            <button
              type="button"
              className="opg-lgc"
              onClick={() =>
                row.connectiveBranchId && ctx.toggleBranchConnective(row.connectiveBranchId)
              }
              title={tr('filterToggleAndOr')}
              aria-label={`${tr(row.connective === 'and' ? 'filterConnectiveAnd' : 'filterConnectiveOr')} · ${tr('filterToggleAndOr')}`}
            >
              {tr(row.connective === 'and' ? 'filterConnectiveAnd' : 'filterConnectiveOr')}
            </button>
          )}
        </Cell>
        <Cell v={['ctl', issue === 'fieldRequired' && 'err']} style={indentStyle}>
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
            placeholder={tr('filterFieldPlaceholder')}
            emptyText={tr('fieldPicker.noMatch')}
            className="w-full"
          />
        </Cell>
        <Cell v={['ctl', 'hl']}>
          <GlassOptionSingleSelect
            value={effectiveOp}
            groups={opGroupsTranslated}
            onChange={(v) => ctx.updateLeaf(leaf.id, { op: v })}
            variant="highlight"
            className="w-full"
          />
        </Cell>
        <Cell
          v={isNullOp ? ['muted'] : ['ctl', issue === 'valueRequired' && 'err']}
          className={isBetween ? 'opg-between' : undefined}
        >
          {isNullOp ? (
            <span className="truncate">{tr('filterNoValueNeeded')}</span>
          ) : isMultiValue ? (
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
              placeholder={tr('filterValuesPlaceholder')}
              className="!w-full"
              addLabel={tr('filterAddValue')}
              noSuggestionsLabel={tr('valueInput.noSuggestions')}
              onOpen={() => ctx.fetchColumnValues(leaf.field)}
            />
          ) : (
            <>
              <GlassValueInput
                value={leaf.val1}
                suggestions={colVals}
                isLoading={isValsLoading}
                error={isValsError}
                onRetry={() => ctx.retryColumnValues(leaf.field)}
                onChange={(v) => ctx.updateLeaf(leaf.id, { val1: v })}
                placeholder={tr('filterValuePlaceholderFull')}
                className="!w-full"
                onOpen={() => ctx.fetchColumnValues(leaf.field)}
              />
              {isBetween ? (
                <>
                  <span className="opg-between-sep">{tr('filterAnd')}</span>
                  <GlassValueInput
                    value={leaf.val2}
                    suggestions={colVals}
                    isLoading={isValsLoading}
                    error={isValsError}
                    onRetry={() => ctx.retryColumnValues(leaf.field)}
                    onChange={(v) => ctx.updateLeaf(leaf.id, { val2: v })}
                    placeholder={tr('filterValue2Placeholder')}
                    className="!w-full"
                    onOpen={() => ctx.fetchColumnValues(leaf.field)}
                  />
                </>
              ) : null}
            </>
          )}
        </Cell>
        <RowActionsCell
          labels={{
            add: tr('rowAdd'),
            copy: tr('filterCopyCondition'),
            remove: tr('filterDeleteCondition'),
          }}
          onCopy={() => ctx.addAfter(leaf.id, row.connective ?? 'and', true)}
          onRemove={() => ctx.removeNode(leaf.id)}
          canAdd={ctx.canAddAfter(leaf.id, 'and') || ctx.canAddAfter(leaf.id, 'or')}
          extra={
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="opg-act"
                  title={tr('filterAddMenu')}
                  aria-label={tr('filterAddMenu')}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  collisionPadding={12}
                  className="operator-ui z-50 min-w-[150px] overflow-hidden rounded-lg border border-border-muted bg-surface p-1 shadow-soft"
                >
                  <DropdownMenu.Item
                    disabled={!ctx.canAddAfter(leaf.id, 'and')}
                    onSelect={() => ctx.addAfter(leaf.id, 'and')}
                    className={MENU_ITEM_CLASS}
                  >
                    <CornerDownRight className="h-3.5 w-3.5" />
                    {tr('filterAddAnd')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={!ctx.canAddAfter(leaf.id, 'or')}
                    onSelect={() => ctx.addAfter(leaf.id, 'or')}
                    className={MENU_ITEM_CLASS}
                  >
                    <GitMerge className="h-3.5 w-3.5" />
                    {tr('filterAddOr')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
                  <DropdownMenu.Item
                    onSelect={() => ctx.addAfter(leaf.id, row.connective ?? 'and', true)}
                    className={MENU_ITEM_CLASS}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {tr('filterCopyCondition')}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          }
        />
      </GridRow>
      {issue ? (
        <ErrorRow span={5}>
          <b>{tr('filterRowPrefix', { index: index + 1 })}</b>
          {tr(issue === 'fieldRequired' ? 'filterFieldRequired' : 'filterValueRequired')}
        </ErrorRow>
      ) : null}
    </>
  );
}

export default function FormFilter({
  node,
  pipelineId,
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
  }, [node.config.condition]);

  // ── Column metadata ────────────────────────────────────────────────

  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });
  const columnTypesRef = useRef(columnTypes);
  useEffect(() => {
    columnTypesRef.current = columnTypes;
  }, [columnTypes]);
  const [columnValues, setColumnValues] = useState<Record<string, string[]>>({});
  const [loadingValues, setLoadingValues] = useState<Record<string, boolean>>({});
  const [columnValuesError, setColumnValuesError] = useState<Record<string, boolean>>({});

  const fetchColumnValues = useCallback(
    (colName: string) => {
      if (!pipelineId || !sourceNode?.id || !colName) return;
      if (columnValues[colName] || loadingValues[colName]) return;
      if (!dataClient.has('getWorkflowNodeColumnValues')) return;
      setLoadingValues((prev) => ({ ...prev, [colName]: true }));
      dataClient
        .getWorkflowNodeColumnValues({
          pipelineId,
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
    [pipelineId, sourceNode?.id, sourceNode?.type, sourceNode?.config, columnValues, loadingValues]
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

  const canAddAfter = useCallback(
    (leafId: string, connective: FilterConditionConnective) =>
      canAddWithConnective(findLeafLocation(root, leafId), connective),
    [root]
  );

  const addAfter = useCallback(
    (targetLeafId: string, targetConnective: FilterConditionConnective, clone = false) => {
      const newLeaf = createEmptyLeaf();
      setParseError(null);
      setRoot((prev) => {
        const location = findLeafLocation(prev, targetLeafId);
        if (!location || !canAddWithConnective(location, targetConnective)) return prev;
        let inserted: FilterConditionLeaf = newLeaf;
        if (clone) {
          const source = flattenFilterTree(prev).find((row) => row.leaf.id === targetLeafId)?.leaf;
          if (source) inserted = { ...source, id: newLeaf.id };
        }

        const next = updateBranchInTree(prev, location.branchId, (branch) => {
          const items = [...branch.items];
          items.splice(location.index + 1, 0, inserted);
          const withNewLeaf = { ...branch, items };
          if (location.parentConnective === targetConnective) return withNewLeaf;
          return (
            wrapItemsInGroup(withNewLeaf, [targetLeafId, inserted.id], targetConnective) ??
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
    [updateConfig]
  );

  const appendCondition = useCallback(() => {
    setParseError(null);
    setRoot((prev) => {
      const next = { ...prev, items: [...prev.items, createEmptyLeaf()] };
      localUpdateRef.current = true;
      updateConfig((cfg) => ({
        ...cfg,
        condition: buildFilterConditionTree(next, columnTypesRef.current),
      }));
      return next;
    });
  }, [updateConfig]);

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

  const rows = useMemo(() => flattenFilterTree(root), [root]);

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
      addAfter,
      canAddAfter,
      toggleBranchConnective,
      totalRows: rows.length,
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
      addAfter,
      canAddAfter,
      toggleBranchConnective,
      rows.length,
      tr,
    ]
  );

  return (
    <FormScroll>
      <FormGrid columns={FILTER_GRID_COLUMNS} testId="filter-form-grid">
        {parseError ? (
          <ErrorRow span={5}>
            {tr('filterParseError')}: {parseError}
          </ErrorRow>
        ) : null}
        <Cell v={['th']} />
        <Cell v={['th']}>{tr('filterHeaderField')}</Cell>
        <Cell v={['th']}>{tr('filterHeaderOp')}</Cell>
        <Cell v={['th']}>{tr('filterHeaderValue')}</Cell>
        <Cell v={['th']} />
        {rows.map((row, index) => (
          <ConditionLeafRow key={row.leaf.id} row={row} index={index} ctx={leafCtx} />
        ))}
        <AddRow
          span={5}
          label={tr('filterAddConditionShort')}
          onClick={appendCondition}
          extra={
            <>
              <span className="text-border">·</span>
              <span className="font-normal text-text-muted">{tr('filterAddHint')}</span>
            </>
          }
        />
      </FormGrid>
    </FormScroll>
  );
}
