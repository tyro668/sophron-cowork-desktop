import { useCallback, useEffect, useMemo, useId } from 'react';

import type { OperatorFormProps } from './index';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import type { DataColumnTypeInfo } from '../../../shared/data-field-types';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';

const NUMERIC_TYPES = ['integer', 'float', 'decimal'];
const TEMPORAL_TYPES = ['date', 'datetime'];

function checkTypeWarnings(
  leftTypes: DataColumnTypeInfo[],
  rightTypes: DataColumnTypeInfo[],
  leftColumns: string[],
  rightColumns: string[],
  operation: string,
  match: string,
  tr: (key: string, fallback: string) => string
): string[] {
  const warnings: string[] = [];

  const isUnionByName = operation === 'union' && match === 'by_name';

  if (!isUnionByName && leftColumns.length !== rightColumns.length) {
    warnings.push(
      tr('setOpColumnCountMismatch', 'Column count mismatch')
        .replace('{{leftCount}}', String(leftColumns.length))
        .replace('{{rightCount}}', String(rightColumns.length))
    );
  }

  if (match !== 'by_name') {
    const minLen = Math.min(leftColumns.length, rightColumns.length);
    const mismatches: string[] = [];
    for (let i = 0; i < minLen; i++) {
      if (leftColumns[i] !== rightColumns[i]) {
        mismatches.push(
          tr('setOpColumnNameMismatch', 'Column mismatch')
            .replace('{{index}}', String(i + 1))
            .replace('{{left}}', leftColumns[i])
            .replace('{{right}}', rightColumns[i])
        );
      }
    }
    if (mismatches.length > 0) {
      warnings.push(
        tr('setOpPositionMatchWarnings', 'Name mismatch warning').replace(
          '{{details}}',
          mismatches.join('；')
        )
      );
    }
  }

  const minLen = Math.min(leftTypes.length, rightTypes.length);
  for (let i = 0; i < minLen; i++) {
    const lt = leftTypes[i].type;
    const rt = rightTypes[i].type;
    if (lt === rt) continue;
    if (NUMERIC_TYPES.includes(lt) && NUMERIC_TYPES.includes(rt)) continue;
    if (TEMPORAL_TYPES.includes(lt) && TEMPORAL_TYPES.includes(rt)) continue;
    if (lt === 'text' || rt === 'text') {
      warnings.push(
        tr('setOpTypeMismatchWarning', 'Type mismatch warning')
          .replace('{{index}}', String(i + 1))
          .replace('{{col}}', leftTypes[i].name)
          .replace('{{leftType}}', lt)
          .replace('{{rightType}}', rt)
      );
    } else {
      warnings.push(
        tr('setOpTypeIncompatibleWarning', 'Type incompatible warning')
          .replace('{{index}}', String(i + 1))
          .replace('{{col}}', leftTypes[i].name)
          .replace('{{leftType}}', lt)
          .replace('{{rightType}}', rt)
      );
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

  const operation = (node.config.operation as string) ?? 'union';
  const rawRightInput = (node.config.rightInput as string) ?? '';
  const mode = (node.config.mode as string) ?? 'all';
  const match = (node.config.match as string) ?? 'by_name';

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
  const { confirm } = useConfirmDialog();

  // Intentionally only depends on source/input identity, not operation/match
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!taskId || !sourceNode?.id || !rawRightInput) return;
    const api = window.electronAPI?.data;
    if (!api?.getWorkflowNodeColumnTypes) return;

    const rightNode = otherNodes.find(
      (n) => (n.config?.alias as string) === rawRightInput || n.id === rawRightInput
    );
    const rightNodeId = rightNode?.id;
    if (!rightNodeId) return;

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
      .then(async ([leftTypes, rightTypes]) => {
        const leftCols = leftTypes.map((t) => t.name);
        const rightCols = rightTypes.map((t) => t.name);
        const warnings = checkTypeWarnings(
          leftTypes,
          rightTypes,
          leftCols,
          rightCols,
          operation,
          match,
          tr
        );
        if (warnings.length > 0) {
          const confirmed = await confirm({
            title: tr('setOpTypeMismatchTitle', 'Column type mismatch'),
            message: (
              <div>
                <p>{tr('setOpTypeMismatchDesc', 'Column types do not fully match')}</p>
                <pre className="mt-2 whitespace-pre-wrap text-[12px]">{warnings.join('\n')}</pre>
              </div>
            ),
            confirmLabel: tr('setOpIgnoreWarning', 'Ignore warning'),
            cancelLabel: tr('common.cancel', 'Cancel'),
          });
          if (!confirmed) {
            updateConfig((cfg) => ({ ...cfg, rightInput: undefined }));
          }
        }
      })
      .catch(() => {});
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config, rawRightInput, otherNodes]);
  /* eslint-enable react-hooks/exhaustive-deps */

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
                {tr('setOpSources', '数据源')}
              </span>
              <span className="text-[10px] text-text-muted">
                {tr('setOpSourcesHint', '请在上方选择参与运算的两个数据集')}
              </span>
            </div>
          </div>
          <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
            <div className="p-3 grid gap-2.5">
              <div className="grid gap-1">
                <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                  {tr('leftInput', '左表数据源')}
                </span>
                <div className="h-7 flex items-center rounded-md border border-border-muted/70 bg-background/28 px-2 text-[12px] text-text-muted">
                  {leftSourceLabel || tr('noLeftSource', '上游节点')}
                </div>
              </div>
              <div className="grid gap-1">
                <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                  {tr('setOpRightInput', '右表数据源')}
                </span>
                <div className="h-7 flex items-center rounded-md border border-border-muted/70 bg-background/28 px-2 text-[12px] text-text-muted">
                  {rightSourceLabel || tr('noRightSource', '未连接右表')}
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
                {tr('setOpConnection', '连接方式')}
              </span>
              <span className="text-[10px] text-text-muted">
                {tr('setOpConnectionHint', '选择行级合并方式：并集、交集或差集')}
              </span>
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
                      ? tr('setOpUnionTip', '合并两个表的所有数据，重复记录自动去重')
                      : op === 'intersect'
                        ? tr('setOpIntersectTip', '仅保留两个表共有的记录')
                        : tr('setOpExceptTip', '从左表中排除右表中的记录')
                  }
                >
                  <VennSVG type={op} />
                  <div className="grid gap-0.5">
                    <span className="text-[12px] font-medium text-text-primary leading-tight">
                      {op === 'union'
                        ? tr('setOpUnion', '并集')
                        : op === 'intersect'
                          ? tr('setOpIntersect', '交集')
                          : tr('setOpExcept', '差集')}
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
                {tr('setOpConfig', '配置选择')}
              </span>
              <span className="text-[10px] text-text-muted">
                {tr('setOpConfigHint', '配置去重方式与字段匹配规则')}
              </span>
            </div>
          </div>
          <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
            <div className="p-3 grid gap-2.5">
              <GlassRadioSelect
                value={mode}
                options={[
                  {
                    value: 'all',
                    label: tr('setOpAll', '保留重复'),
                    tip: tr('setOpAllTip', '将两个表的数据全部合并，包括重复的行'),
                  },
                  {
                    value: 'distinct',
                    label: tr('setOpDistinct', '去重'),
                    tip: tr('setOpDistinctTip', '合并后自动去除重复的行'),
                  },
                ]}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, mode: v }))}
                label={tr('setOpDedupMode', '重复行处理')}
              />
              {operation === 'union' && (
                <GlassRadioSelect
                  value={match}
                  options={[
                    {
                      value: 'by_name',
                      label: tr('setOpByName', '按名称'),
                      tip: tr('setOpByNameTip', '根据列名自动匹配，列数或顺序不一致时自动对齐'),
                    },
                    {
                      value: 'by_position',
                      label: tr('setOpByPosition', '按位置'),
                      tip: tr('setOpByPositionTip', '按列的顺序位置匹配，两表列数必须一致'),
                    },
                  ]}
                  onChange={(v) => updateConfig((cfg) => ({ ...cfg, match: v }))}
                  label={tr('setOpMatchMode', '匹配方式')}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
