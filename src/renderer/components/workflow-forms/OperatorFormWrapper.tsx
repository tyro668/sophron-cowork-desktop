import React, { Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { hasOperatorForm, getOperatorFormLoader } from './index';
import type { DataWorkflowNode } from '../../types';
import type { DataColumnTypeInfo } from '../../../shared/data-field-types';

interface OperatorFormWrapperProps {
  node: DataWorkflowNode;
  pipelineId?: string;
  fieldCompletions: string[];
  fieldTypes?: DataColumnTypeInfo[];
  otherNodes: DataWorkflowNode[];
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  rightSourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  upstreamRowCount?: number;
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}

function LazyOperatorForm({
  node,
  pipelineId,
  fieldCompletions,
  fieldTypes,
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
  }, [node.type, loader]);

  if (!loader || !LazyComponent) {
    return (
      <div className="flex items-center justify-center py-8 text-[13px] text-text-muted">
        {t('data.workflow.formLabels.common.noFormSupport', {
          defaultValue: 'This operator does not support graphical configuration yet',
        })}
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
        pipelineId={pipelineId}
        fieldCompletions={fieldCompletions}
        fieldTypes={fieldTypes}
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
  const { t } = useTranslation();

  if (!hasOperatorForm(props.node.type)) {
    return (
      <div className="px-1 py-2 text-center text-[12px] text-text-muted">
        {t('data.workflow.formLabels.common.noFormSupportHint', {
          defaultValue:
            'This operator does not support graphical configuration yet. Switch to the DSL tab.',
        })}
      </div>
    );
  }

  return <LazyOperatorForm {...props} />;
}

// Module-level cache for lazy-loaded form components
const formComponentCache = new Map<string, React.ComponentType<OperatorFormProps>>();
