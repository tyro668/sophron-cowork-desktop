import { useCallback, useMemo } from 'react';

import type { OperatorFormProps } from './index';
import { GlassFieldCompactSelect } from './shared/GlassFieldCompactSelect';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { SortKeysEditor } from './shared/SortKeysEditor';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import type { SortKey } from '../../../shared/operator-schemas';

export default function FormDeduplicate({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('deduplicate');
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const columns = useMemo(() => (node.config?.columns as string[]) ?? [], [node.config?.columns]);
  const keep = (node.config?.keep as string) ?? 'first';
  const orderBy = useMemo(() => (node.config?.orderBy as SortKey[]) ?? [], [node.config?.orderBy]);

  const commitColumns = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        strategy: 'by_columns',
        columns: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  const commitSortKeys = useCallback(
    (next: SortKey[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        orderBy: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 w-full flex-1 gap-2.5">
        {/* ═══ LEFT: 选择字段 ═══ */}
        <section className="operator-section flex-[4] content-start flex min-h-0 min-w-0 w-0 flex-col">
          <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col px-3 pb-3">
            <div className="mb-3 px-0.5 pt-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                {tr('dedupDimensionsLabel')}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-text-muted">
                {tr('dedupDimensionsHint')}
              </p>
            </div>
            <GlassFieldCompactSelect
              columns={fieldCompletions}
              selected={columns}
              onChange={commitColumns}
              columnTypes={columnTypes}
              maxHeight="none"
            />
          </div>
        </section>

        {/* ═══ RIGHT: 保留策略 + 排序设置 ═══ */}
        <section className="operator-section flex-[6] content-start flex min-h-0 min-w-0 w-0 flex-col">
          <div className="scrollbar-hover flex-1 min-h-0 overflow-y-auto border-l border-border-subtle/70 pl-3 pr-3">
            <div className="grid content-start gap-3">
              <div className="px-0.5 pt-1">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                  <span className="h-2 w-2 rounded-full bg-accent" />
                  {tr('dedupConfigLabel')}
                </div>
                <p className="mt-1 text-[12px] leading-5 text-text-muted">
                  {tr('dedupConfigHint')}
                </p>
              </div>

              {/* ── 保留策略 ── */}
              <GlassRadioSelect
                value={keep}
                options={[
                  { value: 'first', label: tr('first') },
                  { value: 'last', label: tr('last') },
                ]}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, keep: v }))}
                label={tr('dedupKeepStrategy')}
                direction="horizontal"
              />

              {/* ── 排序设置 ── */}
              <SortKeysEditor
                keys={orderBy}
                fieldCompletions={fieldCompletions}
                columnTypes={columnTypes}
                onChange={commitSortKeys}
                copyable={false}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
