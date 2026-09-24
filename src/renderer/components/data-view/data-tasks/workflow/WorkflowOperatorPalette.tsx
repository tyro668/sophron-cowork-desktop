import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DataWorkflowOperatorType, OperatorCategory } from '../../../../../shared/operators';
import { Button } from '../../../ui/button';
import { OPERATOR_CATALOG_GROUPS } from './operator-catalog';
import { WORKFLOW_OPERATOR_MIME } from './workflow-model';

export function WorkflowOperatorPalette({
  onAddOperator,
}: {
  onAddOperator?: (type: DataWorkflowOperatorType) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [collapsed, setCollapsed] = useState<Partial<Record<OperatorCategory, boolean>>>({});

  return (
    <aside className="glass-card flex min-h-0 flex-col overflow-hidden rounded-xl p-2">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {OPERATOR_CATALOG_GROUPS.map(({ category, operators }) => {
          const expanded = !collapsed[category];
          const headingId = `${id}-${category}-heading`;
          const contentId = `${id}-${category}-content`;
          const Chevron = expanded ? ChevronDown : ChevronRight;
          return (
            <section key={category} aria-labelledby={headingId}>
              <h3>
                <Button
                  id={headingId}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start px-1 text-xs font-semibold"
                  aria-expanded={expanded}
                  aria-controls={contentId}
                  onClick={() => setCollapsed((current) => ({ ...current, [category]: expanded }))}
                >
                  <Chevron className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{t(`data.workflow.operatorCategories.${category}`)}</span>
                  <span className="ml-auto font-normal text-text-muted">{operators.length}</span>
                </Button>
              </h3>
              <div id={contentId} hidden={!expanded} className="space-y-2 pt-1">
                {operators.map(({ type, labelKey, Icon, colorClassName }) => (
                  <Button
                    key={type}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(WORKFLOW_OPERATOR_MIME, type);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => onAddOperator?.(type)}
                    title={t('data.workflow.addOperatorToCanvas')}
                    aria-label={`${t(labelKey)} — ${t('data.workflow.addOperatorToCanvas')}`}
                    className="h-9 w-full cursor-grab justify-start gap-2 px-2.5 text-xs text-text-secondary hover:border-accent/30 hover:bg-accent-muted hover:text-accent active:cursor-grabbing"
                  >
                    <span
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${colorClassName}`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="truncate">{t(labelKey)}</span>
                  </Button>
                ))}
                {operators.length === 0 && (
                  <p className="px-2 pb-2 text-xs leading-5 text-text-muted">
                    {t('data.workflow.emptyOperatorCategory')}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
