import { useCallback, useMemo } from 'react';

import type { OperatorFormProps } from './index';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { VennDiagramIcon, type VennRegion } from './shared/VennDiagramIcon';
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

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside className="scrollbar-hover w-[180px] shrink-0 overflow-y-auto border-r border-border-muted bg-surface/40 p-3.5">
        <div className="mb-2 text-[12px] font-medium text-text-secondary">
          {tr('setOpConnection')}
        </div>
        <div className="grid gap-1">
          {operationOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.tip}
              aria-pressed={operation === option.value}
              onClick={() =>
                updateConfig((config) => ({
                  ...config,
                  operation: option.value,
                  ...(option.value !== 'union' ? { match: undefined } : {}),
                }))
              }
              className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/30 ${
                operation === option.value
                  ? 'bg-accent/10 font-medium text-accent'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              <VennDiagramIcon
                region={SET_OPERATION_REGIONS[option.value]}
                outlineOpacity={0.35}
                outlineWidth={1.5}
                showOutlines={option.value !== 'union'}
              />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="scrollbar-hover flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto p-4">
        <div className="flex items-center gap-4">
          <GlassFormLabel>{tr('sources.leftInput')}</GlassFormLabel>
          <div className="flex h-7 w-72 min-w-0 items-center rounded-md border border-border-muted/70 bg-background/28 px-2">
            <span className="truncate text-[12px] text-text-primary">
              {leftSourceLabel || tr('sources.noLeftSource')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <GlassFormLabel>{tr('sources.rightInput')}</GlassFormLabel>
          <div className="flex h-7 w-72 min-w-0 items-center rounded-md border border-border-muted/70 bg-background/28 px-2">
            <span className="truncate text-[12px] text-text-primary">
              {rightSourceLabel || tr('sources.noRightSource')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <GlassFormLabel>{tr('setOpDedupMode')}</GlassFormLabel>
          <GlassRadioSelect
            value={mode}
            options={[
              { value: 'all', label: tr('setOpAll'), tip: tr('setOpAllTip') },
              { value: 'distinct', label: tr('setOpDistinct'), tip: tr('setOpDistinctTip') },
            ]}
            onChange={(value) => updateConfig((config) => ({ ...config, mode: value }))}
            direction="horizontal"
          />
        </div>

        {operation === 'union' && (
          <div className="flex items-center gap-4">
            <GlassFormLabel>{tr('setOpMatchMode')}</GlassFormLabel>
            <GlassRadioSelect
              value={match}
              options={[
                { value: 'by_name', label: tr('setOpByName'), tip: tr('setOpByNameTip') },
                {
                  value: 'by_position',
                  label: tr('setOpByPosition'),
                  tip: tr('setOpByPositionTip'),
                },
              ]}
              onChange={(value) => updateConfig((config) => ({ ...config, match: value }))}
              direction="horizontal"
            />
          </div>
        )}
      </div>
    </div>
  );
}
