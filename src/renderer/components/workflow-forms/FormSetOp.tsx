import { useCallback, useEffect, useMemo, useId, useState } from 'react';

import type { OperatorFormProps } from './index';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import type { DataColumnTypeInfo } from '../../../shared/data-field-types';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import {
  DEFAULT_OPERATION,
  DEFAULT_MODE,
  DEFAULT_MATCH,
} from '../../../shared/operator-schemas/set-op';

const NUMERIC_TYPES = ['integer', 'float', 'decimal'];
const TEMPORAL_TYPES = ['date', 'datetime'];

function checkTypeWarnings(
  leftTypes: DataColumnTypeInfo[],
  rightTypes: DataColumnTypeInfo[],
  leftColumns: string[],
  rightColumns: string[],
  operation: string,
  match: string,
  tr: (key: string) => string
): string[] {
  const warnings: string[] = [];
  const effectiveMatch = operation === 'union' ? match : 'by_position';
  const isUnionByName = operation === 'union' && effectiveMatch === 'by_name';

  if (!isUnionByName && leftColumns.length !== rightColumns.length) {
    warnings.push(
      tr('setOpColumnCountMismatch')
        .replace('{{leftCount}}', String(leftColumns.length))
        .replace('{{rightCount}}', String(rightColumns.length))
    );
  }

  if (effectiveMatch !== 'by_name') {
    const minLen = Math.min(leftColumns.length, rightColumns.length);
    const mismatches: string[] = [];
    for (let i = 0; i < minLen; i++) {
      if (leftColumns[i] !== rightColumns[i]) {
        mismatches.push(
          tr('setOpColumnNameMismatch')
            .replace('{{index}}', String(i + 1))
            .replace('{{left}}', leftColumns[i])
            .replace('{{right}}', rightColumns[i])
        );
      }
    }
    if (mismatches.length > 0) {
      warnings.push(tr('setOpPositionMatchWarnings').replace('{{details}}', mismatches.join('；')));
    }
  }

  if (effectiveMatch === 'by_name') {
    const rightMap = new Map(rightTypes.map((t) => [t.name.toLowerCase(), t]));
    for (const leftType of leftTypes) {
      const rightType = rightMap.get(leftType.name.toLowerCase());
      if (!rightType) continue;
      if (leftType.type === rightType.type) continue;
      if (NUMERIC_TYPES.includes(leftType.type) && NUMERIC_TYPES.includes(rightType.type)) continue;
      if (TEMPORAL_TYPES.includes(leftType.type) && TEMPORAL_TYPES.includes(rightType.type))
        continue;
      if (leftType.type === 'text' || rightType.type === 'text') {
        warnings.push(
          tr('setOpTypeMismatchWarning')
            .replace('{{index}}', leftType.name)
            .replace('{{col}}', leftType.name)
            .replace('{{leftType}}', leftType.type)
            .replace('{{rightType}}', rightType.type)
        );
      } else {
        warnings.push(
          tr('setOpTypeIncompatibleWarning')
            .replace('{{index}}', leftType.name)
            .replace('{{col}}', leftType.name)
            .replace('{{leftType}}', leftType.type)
            .replace('{{rightType}}', rightType.type)
        );
      }
    }
  } else {
    const minLen = Math.min(leftTypes.length, rightTypes.length);
    for (let i = 0; i < minLen; i++) {
      const lt = leftTypes[i].type;
      const rt = rightTypes[i].type;
      if (lt === rt) continue;
      if (NUMERIC_TYPES.includes(lt) && NUMERIC_TYPES.includes(rt)) continue;
      if (TEMPORAL_TYPES.includes(lt) && TEMPORAL_TYPES.includes(rt)) continue;
      if (lt === 'text' || rt === 'text') {
        warnings.push(
          tr('setOpTypeMismatchWarning')
            .replace('{{index}}', String(i + 1))
            .replace('{{col}}', leftTypes[i].name)
            .replace('{{leftType}}', lt)
            .replace('{{rightType}}', rt)
        );
      } else {
        warnings.push(
          tr('setOpTypeIncompatibleWarning')
            .replace('{{index}}', String(i + 1))
            .replace('{{col}}', leftTypes[i].name)
            .replace('{{leftType}}', lt)
            .replace('{{rightType}}', rt)
        );
      }
    }
  }
  return warnings;
}

function VennSVG({ type }: { type: 'union' | 'intersect' | 'except' }) {
  const id = useId();
  const clipId = `clip-${id}`;
  const maskId = `mask-${id}`;

  if (type === 'union') {
    return (
      <svg viewBox="0 0 60 40" className="h-8 w-auto">
        <circle cx="22" cy="20" r="14" fill="currentColor" opacity="0.55" />
        <circle cx="38" cy="20" r="14" fill="currentColor" opacity="0.55" />
      </svg>
    );
  }

  if (type === 'intersect') {
    return (
      <svg viewBox="0 0 60 40" className="h-8 w-auto">
        <defs>
          <clipPath id={clipId}>
            <circle cx="38" cy="20" r="14" />
          </clipPath>
        </defs>
        <circle
          cx="22"
          cy="20"
          r="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.35"
        />
        <circle
          cx="38"
          cy="20"
          r="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.35"
        />
        <circle
          cx="22"
          cy="20"
          r="14"
          fill="currentColor"
          opacity="0.55"
          clipPath={`url(#${clipId})`}
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 60 40" className="h-8 w-auto">
      <defs>
        <mask id={maskId}>
          <rect width="60" height="40" fill="white" />
          <circle cx="38" cy="20" r="14" fill="black" />
        </mask>
      </defs>
      <circle
        cx="22"
        cy="20"
        r="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.35"
      />
      <circle
        cx="38"
        cy="20"
        r="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.35"
      />
      <circle cx="22" cy="20" r="14" fill="currentColor" opacity="0.55" mask={`url(#${maskId})`} />
    </svg>
  );
}

export default function FormSetOp({
  node,
  taskId,
  otherNodes,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation();

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

  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    setWarnings([]);
    if (!taskId || !sourceNode?.id || !rawRightInput) return;
    const api = window.electronAPI?.data;
    if (!api?.getWorkflowNodeColumnTypes) return;

    const rightNode = otherNodes.find(
      (n) => (n.config?.alias as string) === rawRightInput || n.id === rawRightInput
    );
    const rightNodeId = rightNode?.id;
    if (!rightNodeId) return;

    let aborted = false;
    Promise.all([
      api.getWorkflowNodeColumnTypes({
        taskId,
        nodeId: sourceNode.id,
        nodeType: sourceNode.type as never,
        nodeConfig: (sourceNode.config ?? {}) as Record<string, unknown>,
      }),
      api.getWorkflowNodeColumnTypes({
        taskId,
        nodeId: rightNodeId,
        nodeType: rightNode.type as never,
        nodeConfig: (rightNode.config ?? {}) as Record<string, unknown>,
      }),
    ])
      .then(([leftTypes, rightTypes]) => {
        if (aborted) return;
        const leftCols = leftTypes.map((t) => t.name);
        const rightCols = rightTypes.map((t) => t.name);
        setWarnings(
          checkTypeWarnings(leftTypes, rightTypes, leftCols, rightCols, operation, match, tr)
        );
      })
      .catch((error: unknown) => {
        if (aborted) return;
        setWarnings([]);
        console.warn('[FormSetOp] Failed to compare input column types', {
          taskId,
          leftNodeId: sourceNode.id,
          rightNodeId,
          error,
        });
      });
    return () => {
      aborted = true;
    };
  }, [
    taskId,
    sourceNode?.id,
    sourceNode?.type,
    sourceNode?.config,
    rawRightInput,
    otherNodes,
    operation,
    match,
  ]);

  return (
    <div className="grid content-start gap-2.5">
      <div className="flex items-stretch gap-0">
        {/* ═══ 步骤1: 数据源 ═══ */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-end gap-3 px-0.5">
            <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
              1
            </span>
            <div className="grid">
              <span className="text-[13px] font-semibold text-text-primary">
                {tr('setOpSources')}
              </span>
              <span className="text-[10px] text-text-muted">{tr('setOpSourcesHint')}</span>
            </div>
          </div>
          <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
            <div className="p-3 grid gap-2.5">
              <div className="grid gap-1">
                <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                  {tr('leftInput')}
                </span>
                <div className="h-7 flex items-center rounded-md border border-border-muted/70 bg-background/28 px-2 text-[12px] text-text-muted">
                  {leftSourceLabel || tr('noLeftSource')}
                </div>
              </div>
              <div className="grid gap-1">
                <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                  {tr('setOpRightInput')}
                </span>
                <div className="h-7 flex items-center rounded-md border border-border-muted/70 bg-background/28 px-2 text-[12px] text-text-muted">
                  {rightSourceLabel || tr('noRightSource')}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-start pt-[12px] px-2">
          <span className="text-text-muted font-bold text-base leading-none">❯</span>
        </div>

        {/* ═══ 步骤2: 连接方式 ═══ */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-end gap-3 px-0.5">
            <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
              2
            </span>
            <div className="grid">
              <span className="text-[13px] font-semibold text-text-primary">
                {tr('setOpConnection')}
              </span>
              <span className="text-[10px] text-text-muted">{tr('setOpConnectionHint')}</span>
            </div>
          </div>
          <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
            <div className="p-3 grid gap-2">
              {(['union', 'intersect', 'except'] as const).map((op) => (
                <button
                  key={op}
                  type="button"
                  onClick={() =>
                    updateConfig((cfg) => ({
                      ...cfg,
                      operation: op,
                      ...(op !== 'union' ? { match: undefined } : {}),
                    }))
                  }
                  className={`rounded-lg border p-2 flex items-center gap-2.5 transition-colors ${
                    operation === op
                      ? 'border-accent bg-accent/5'
                      : 'border-border-muted bg-background/28 hover:border-border-muted/80'
                  }`}
                  title={
                    op === 'union'
                      ? tr('setOpUnionTip')
                      : op === 'intersect'
                        ? tr('setOpIntersectTip')
                        : tr('setOpExceptTip')
                  }
                >
                  <VennSVG type={op} />
                  <div className="grid gap-0.5">
                    <span className="text-[12px] font-medium text-text-primary leading-tight">
                      {op === 'union'
                        ? tr('setOpUnion')
                        : op === 'intersect'
                          ? tr('setOpIntersect')
                          : tr('setOpExcept')}
                    </span>
                    <span className="text-[10px] text-text-muted font-mono leading-tight">
                      {op === 'union' ? 'A ∪ B' : op === 'intersect' ? 'A ∩ B' : 'A \\ B'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-start pt-[12px] px-2">
          <span className="text-text-muted font-bold text-base leading-none">❯</span>
        </div>

        {/* ═══ 步骤3: 配置选择 ═══ */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-end gap-3 px-0.5">
            <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
              3
            </span>
            <div className="grid">
              <span className="text-[13px] font-semibold text-text-primary">
                {tr('setOpConfig')}
              </span>
              <span className="text-[10px] text-text-muted">{tr('setOpConfigHint')}</span>
            </div>
          </div>
          <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
            <div className="p-3 grid gap-2.5">
              <GlassRadioSelect
                value={mode}
                options={[
                  {
                    value: 'all',
                    label: tr('setOpAll'),
                    tip: tr('setOpAllTip'),
                  },
                  {
                    value: 'distinct',
                    label: tr('setOpDistinct'),
                    tip: tr('setOpDistinctTip'),
                  },
                ]}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, mode: v }))}
                label={tr('setOpDedupMode')}
              />
              {operation === 'union' && (
                <GlassRadioSelect
                  value={match}
                  options={[
                    {
                      value: 'by_name',
                      label: tr('setOpByName'),
                      tip: tr('setOpByNameTip'),
                    },
                    {
                      value: 'by_position',
                      label: tr('setOpByPosition'),
                      tip: tr('setOpByPositionTip'),
                    },
                  ]}
                  onChange={(v) => updateConfig((cfg) => ({ ...cfg, match: v }))}
                  label={tr('setOpMatchMode')}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="rounded-lg border border-error/30 bg-error/5 p-2.5">
          {warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-error leading-relaxed">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
