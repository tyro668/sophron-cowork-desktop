import { useCallback, useMemo } from 'react';

import type { OperatorFormProps } from './types';
import { VennDiagramIcon, type VennRegion } from './shared/VennDiagramIcon';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassSegmentedControl } from './shared/GlassSegmentedControl';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import {
  DEFAULT_OPERATION,
  DEFAULT_MODE,
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
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('setOp');

  const updateConfig = useUpdateConfig(onNodeChange);

  const operation = (node.config.operation as string) ?? DEFAULT_OPERATION;
  const rawRightInput = (node.config.rightInput as string) ?? '';
  const mode = (node.config.mode as string) ?? DEFAULT_MODE;
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

  function opBoxClass() {
    return 'flex h-8 min-w-0 flex-1 items-center rounded-md border border-border-muted/70 bg-surface px-3';
  }

  return (
    <div className="scrollbar-hover flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('setOpConnection')}</GlassFormLabel>
        <GlassSegmentedControl
          value={operation}
          options={operationOptions.map((item) => ({
            value: item.value,
            label: item.label,
            tip: item.tip,
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
          ariaLabel={tr('setOpConnection')}
        />
      </div>

      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('sources.leftInput')}</GlassFormLabel>
        <div className={opBoxClass()}>
          <span className="truncate text-[13px] text-text-secondary">
            {leftSourceLabel || tr('sources.noLeftSource')}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('sources.rightInput')}</GlassFormLabel>
        <div className={opBoxClass()}>
          <span className="truncate text-[13px] text-text-secondary">
            {rightSourceLabel || tr('sources.noRightSource')}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('setOpDedupMode')}</GlassFormLabel>
        <GlassSegmentedControl
          value={mode}
          options={[
            { value: 'all', label: tr('setOpAll'), tip: modeTips.all },
            { value: 'distinct', label: tr('setOpDistinct'), tip: modeTips.distinct },
          ]}
          onChange={(value) => updateConfig((config) => ({ ...config, mode: value }))}
          ariaLabel={tr('setOpDedupMode')}
        />
      </div>

      {operation === 'union' && (
        <div className="flex items-center gap-2">
          <GlassFormLabel>{tr('setOpMatchMode')}</GlassFormLabel>
          <GlassSegmentedControl
            value={match}
            options={[
              { value: 'by_name', label: tr('setOpByName'), tip: tr('setOpByNameTip') },
              { value: 'by_position', label: tr('setOpByPosition'), tip: tr('setOpByPositionTip') },
            ]}
            onChange={(value) => updateConfig((config) => ({ ...config, match: value }))}
            ariaLabel={tr('setOpMatchMode')}
          />
        </div>
      )}
    </div>
  );
}
