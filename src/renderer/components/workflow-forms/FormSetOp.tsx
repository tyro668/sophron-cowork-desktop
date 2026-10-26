import { useCallback, useEffect, useMemo, useState } from 'react';
import { Table2 } from 'lucide-react';

import type { OperatorFormProps } from './types';
import { VennDiagramIcon, type VennRegion } from './shared/VennDiagramIcon';
import {
  Cell,
  ErrorRow,
  FormGrid,
  FormScroll,
  LabelCell,
  SelectCell,
  WarningRow,
} from './shared/FormGrid';
import { SET_OP_GRID_COLUMNS } from './shared/gridColumns';
import { OPERATOR_ICONS } from '../data-view/data-pipelines/workflow/operator-icons';
import { dataClient } from '../../features/data/api/data-client';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import {
  DEFAULT_OPERATION,
  DEFAULT_QUANTIFIER,
  DEFAULT_MATCH,
} from '../../../shared/operator-schemas/set-op';

type SetOperation = 'union' | 'intersect' | 'except';

const SET_OPERATION_REGIONS: Record<SetOperation, VennRegion> = {
  union: 'both',
  intersect: 'overlap',
  except: 'left-only',
};

export default function FormSetOp({
  node,
  otherNodes,
  sourceNode,
  rightSourceNode,
  pipelineId,
  fieldCompletions,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('setOp');

  const updateConfig = useUpdateConfig(onNodeChange);

  const operation = (node.config.operation as string) ?? DEFAULT_OPERATION;
  const rawRightInput = (node.config.rightInput as string) ?? '';
  const mode = (node.config.quantifier as string) ?? DEFAULT_QUANTIFIER;
  const match = (node.config.match as string) ?? DEFAULT_MATCH;

  const resolveNodeLabel = useCallback(
    (ref: { id: string; config?: Record<string, unknown> } | undefined): string => {
      if (!ref) return '';
      const full = otherNodes.find((n) => n.id === ref.id);
      if (full) return full.label || (full.config?.alias as string) || '';
      return (ref.config?.alias as string) || ref.id;
    },
    [otherNodes]
  );

  const leftSourceLabel = useMemo(
    () => resolveNodeLabel(sourceNode),
    [sourceNode, resolveNodeLabel]
  );
  const rightSourceLabel = useMemo(() => {
    if (!rawRightInput) return '';
    const node = otherNodes.find((n) => n.id === rawRightInput);
    return node ? (node.config?.alias as string) || node.label || rawRightInput : rawRightInput;
  }, [rawRightInput, otherNodes]);

  const operationOptions = useMemo(
    () => [
      { value: 'union' as const, label: tr('setOpUnion'), tip: tr('setOpUnionTip') },
      { value: 'intersect' as const, label: tr('setOpIntersect'), tip: tr('setOpIntersectTip') },
      { value: 'except' as const, label: tr('setOpExcept'), tip: tr('setOpExceptTip') },
    ],
    [tr]
  );

  // ALL preserves multiplicity, non-ALL dedupes — the wording differs per
  // operation, so mode tips are looked up by the selected operation.
  const modeTips = useMemo(() => {
    const tips: Record<SetOperation, { all: string; distinct: string }> = {
      union: { all: tr('setOpUnionAllTip'), distinct: tr('setOpUnionDistinctTip') },
      intersect: {
        all: tr('setOpIntersectAllTip'),
        distinct: tr('setOpIntersectDistinctTip'),
      },
      except: { all: tr('setOpExceptAllTip'), distinct: tr('setOpExceptDistinctTip') },
    };
    const key = operation in tips ? (operation as SetOperation) : 'union';
    return tips[key];
  }, [operation, tr]);

  const rightNode = useMemo(() => {
    if (rightSourceNode) return rightSourceNode;
    const found = rawRightInput ? otherNodes.find((n) => n.id === rawRightInput) : undefined;
    return found ? { id: found.id, type: found.type as string, config: found.config } : undefined;
  }, [rightSourceNode, rawRightInput, otherNodes]);

  const [rightColumns, setRightColumns] = useState<string[] | null>(null);
  useEffect(() => {
    setRightColumns(null);
    if (!rightNode || typeof pipelineId !== 'string' || !dataClient.isAvailable()) return;
    let alive = true;
    void dataClient
      .getWorkflowNodeColumns({
        pipelineId,
        nodeId: rightNode.id,
        nodeType: rightNode.type as never,
        nodeConfig: rightNode.config,
      })
      .then((cols: string[]) => alive && setRightColumns(cols))
      .catch(() => alive && setRightColumns(null));
    return () => {
      alive = false;
    };
  }, [rightNode, pipelineId]);

  const columnCheck = useMemo(
    () =>
      checkSetOpColumns(
        fieldCompletions,
        rightColumns,
        operation === 'union' ? (match as 'by_name' | 'by_position') : 'by_position'
      ),
    [fieldCompletions, rightColumns, operation, match]
  );

  const LeftIcon = sourceNode
    ? (OPERATOR_ICONS[sourceNode.type as keyof typeof OPERATOR_ICONS] ?? Table2)
    : null;
  const RightIcon = rightNode
    ? (OPERATOR_ICONS[rightNode.type as keyof typeof OPERATOR_ICONS] ?? Table2)
    : null;
  const isUnion = operation === 'union';

  return (
    <FormScroll>
      <FormGrid columns={SET_OP_GRID_COLUMNS}>
        <LabelCell>{tr('setOpConnection')}</LabelCell>
        <SelectCell
          span={2}
          value={operation}
          ariaLabel={tr('setOpConnection')}
          options={operationOptions.map((item) => ({
            value: item.value,
            label: item.label,
            description: item.tip,
            icon: (
              <VennDiagramIcon
                region={SET_OPERATION_REGIONS[item.value]}
                className="h-4 w-6 shrink-0"
                fillOpacity={0.55}
                outlineOpacity={0.35}
                outlineWidth={1.4}
                showOutlines={item.value !== 'union'}
              />
            ),
          }))}
          onChange={(value) =>
            updateConfig((config) => ({
              ...config,
              operation: value,
              ...(value !== 'union' ? { match: undefined } : {}),
            }))
          }
        />
        <Cell span={2} v={['blank']} />

        <LabelCell>{tr('inputTables')}</LabelCell>
        <Cell span={2} v={['ro']} testId="setop-left-source">
          {LeftIcon ? <LeftIcon className="opg-ic h-3.5 w-3.5" /> : null}
          <span className="truncate font-medium">
            {leftSourceLabel || tr('sources.noLeftSource')}
          </span>
          {sourceNode && fieldCompletions.length > 0 ? (
            <span className="opg-badge">
              {tr('columnCount', { count: fieldCompletions.length })}
            </span>
          ) : null}
          <span className="ml-auto text-[12px] text-text-muted">{tr('leftSide')}</span>
        </Cell>
        <Cell span={2} v={['ro']} testId="setop-right-source">
          {RightIcon ? <RightIcon className="opg-ic h-3.5 w-3.5" /> : null}
          <span className="truncate font-medium">
            {rightSourceLabel || tr('sources.noRightSource')}
          </span>
          {rightColumns ? (
            <span className="opg-badge">{tr('columnCount', { count: rightColumns.length })}</span>
          ) : null}
          <span className="ml-auto text-[12px] text-text-muted">{tr('rightSide')}</span>
        </Cell>

        <LabelCell>{tr('setOpDedupMode')}</LabelCell>
        <SelectCell
          value={mode}
          ariaLabel={tr('setOpDedupMode')}
          options={[
            { value: 'all', label: tr('setOpAll'), description: modeTips.all },
            { value: 'distinct', label: tr('setOpDistinct'), description: modeTips.distinct },
          ]}
          onChange={(value) => updateConfig((config) => ({ ...config, quantifier: value }))}
        />
        <Cell span={2} v={['blank']} />

        {isUnion ? (
          <>
            <LabelCell>{tr('setOpMatchMode')}</LabelCell>
            <SelectCell
              value={match}
              ariaLabel={tr('setOpMatchMode')}
              options={[
                { value: 'by_name', label: tr('setOpByName'), description: tr('setOpByNameTip') },
                {
                  value: 'by_position',
                  label: tr('setOpByPosition'),
                  description: tr('setOpByPositionTip'),
                },
              ]}
              onChange={(value) => updateConfig((config) => ({ ...config, match: value }))}
            />
            <Cell span={2} v={['blank']} />
          </>
        ) : null}

        {columnCheck.kind === 'positionMismatch' ? (
          <ErrorRow span={5}>
            {tr('positionMismatch', { left: columnCheck.left, right: columnCheck.right })}
          </ErrorRow>
        ) : null}
        {columnCheck.kind === 'missing' && columnCheck.missingInRight.length > 0 ? (
          <WarningRow span={5}>
            {tr('missingInRight', {
              count: columnCheck.missingInRight.length,
              cols: columnCheck.missingInRight.join('、'),
            })}
          </WarningRow>
        ) : null}
        {columnCheck.kind === 'missing' && columnCheck.missingInLeft.length > 0 ? (
          <WarningRow span={5}>
            {tr('missingInLeft', {
              count: columnCheck.missingInLeft.length,
              cols: columnCheck.missingInLeft.join('、'),
            })}
          </WarningRow>
        ) : null}
      </FormGrid>
    </FormScroll>
  );
}

export type SetOpColumnCheck =
  | { kind: 'ok' }
  | { kind: 'positionMismatch'; left: number; right: number }
  | { kind: 'missing'; missingInRight: string[]; missingInLeft: string[] };

/**
 * Compare both inputs' column names. Unknown right columns (not loaded yet /
 * failed) or an empty left side yield `ok` — we never warn on missing data.
 */
export function checkSetOpColumns(
  left: string[],
  right: string[] | null,
  match: 'by_name' | 'by_position'
): SetOpColumnCheck {
  if (!right || left.length === 0 || right.length === 0) return { kind: 'ok' };
  if (match === 'by_position') {
    return left.length === right.length
      ? { kind: 'ok' }
      : { kind: 'positionMismatch', left: left.length, right: right.length };
  }
  const r = new Set(right);
  const l = new Set(left);
  const missingInRight = left.filter((c) => !r.has(c));
  const missingInLeft = right.filter((c) => !l.has(c));
  return missingInRight.length || missingInLeft.length
    ? { kind: 'missing', missingInRight, missingInLeft }
    : { kind: 'ok' };
}
