import React, { Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { hasOperatorForm, getOperatorFormLoader } from './index';
import type { DataWorkflowNode } from '../../types';

interface OperatorFormWrapperProps {
  node: DataWorkflowNode;
  taskId?: string;
  fieldCompletions: string[];
  otherNodes: DataWorkflowNode[];
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  rightSourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  upstreamRowCount?: number;
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}

function LazyOperatorForm({
  node,
  taskId,
  fieldCompletions,
  otherNodes,
  sourceNode,
  rightSourceNode,
  upstreamRowCount,
  onNodeChange,
}: OperatorFormWrapperProps) {
  const { t } = useTranslation();
  const loader = getOperatorFormLoader(node.type);

  const LazyComponent = useMemo(() => {
    if (!loader) return null;
    const cached = formComponentCache.get(node.type);
    if (cached) return cached;
    const Lazy = React.lazy(() =>
      loader().then((mod) => {
        formComponentCache.set(node.type, mod.default);
        return mod;
      })
    );
    formComponentCache.set(node.type, Lazy);
    return Lazy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.type, loader]);

  if (!loader || !LazyComponent) {
    return (
      <div className="flex items-center justify-center py-8 text-[13px] text-text-muted">
        {t('formLabels.noFormSupport', { defaultValue: '该算子暂不支持图形化配置' })}
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
        </div>
      }
    >
      <LazyComponent
        node={node}
        taskId={taskId}
        fieldCompletions={fieldCompletions}
        otherNodes={otherNodes}
        sourceNode={sourceNode}
        rightSourceNode={rightSourceNode}
        upstreamRowCount={upstreamRowCount}
        onNodeChange={onNodeChange}
      />
    </Suspense>
  );
}

export function OperatorFormWrapper(props: OperatorFormWrapperProps) {
  if (!hasOperatorForm(props.node.type)) {
    return (
      <div className="rounded-lg border border-border-muted bg-background/42 px-3 py-6 text-center text-[13px] text-text-muted">
        {t('formLabels.noFormSupportHint', {
          defaultValue: '该算子暂不支持图形化配置，请切换到 DSL 模式',
        })}
      </div>
    );
  }

  return <LazyOperatorForm {...props} />;
}

// Module-level cache for lazy-loaded form components
const formComponentCache = new Map<string, React.ComponentType<OperatorFormProps>>();
