import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { DataWorkflowOperatorType, OperatorCategory } from '../../../../../shared/operators';
import { Button } from '../../../ui/button';
import { OPERATOR_CATALOG_GROUPS } from './operator-catalog';
import { OPERATOR_NAMING } from '../../../../../shared/operators/naming';
import { WORKFLOW_OPERATOR_MIME } from './workflow-model';

export function WorkflowOperatorPalette({
  onAddOperator,
}: {
  onAddOperator?: (type: DataWorkflowOperatorType) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const [collapsed, setCollapsed] = useState<Partial<Record<OperatorCategory, boolean>>>({
    advanced_compute: true,
  });

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-border-subtle bg-surface">
      <label className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-3">
        <Search className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('data.workflow.searchOperators')}
          aria-label={t('data.workflow.searchOperators')}
          className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2" data-testid="operator-palette-list">
        {OPERATOR_CATALOG_GROUPS.map(({ category, operators: allOperators }) => {
          const operators = normalizedQuery
            ? allOperators.filter(
                ({ type, labelKey }) =>
                  t(labelKey).toLowerCase().includes(normalizedQuery) ||
                  type.toLowerCase().includes(normalizedQuery) ||
                  OPERATOR_NAMING[type].dsl.some((kw) => kw.includes(normalizedQuery))
              )
            : allOperators;
          if (normalizedQuery && operators.length === 0) return null;
          const expanded = normalizedQuery ? true : !collapsed[category];
          const headingId = `${id}-${category}-heading`;
          const contentId = `${id}-${category}-content`;
          const Chevron = expanded ? ChevronDown : ChevronRight;
          return (
            <section key={category} aria-labelledby={headingId} className="mt-2">
              <h3>
                <Button
                  id={headingId}
                  variant="ghost"
                  size="sm"
                  className="mx-2.5 h-[30px] w-[calc(100%-20px)] justify-start gap-1.5 rounded-none bg-transparent px-2 text-[11.5px] font-semibold text-text-secondary shadow-none hover:bg-transparent hover:text-text-primary"
                  aria-expanded={expanded}
                  aria-controls={contentId}
                  onClick={() => setCollapsed((current) => ({ ...current, [category]: expanded }))}
                >
                  <Chevron className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{t(`data.workflow.operatorCategories.${category}`)}</span>
                  <span className="ml-auto font-normal text-text-muted">{operators.length}</span>
                </Button>
              </h3>
              <div id={contentId} hidden={!expanded} className="">
                {operators.map(({ type, labelKey, Icon, colorClassName }) => (
                  <Button
                    key={type}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(WORKFLOW_OPERATOR_MIME, type);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onDoubleClick={() => onAddOperator?.(type)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onAddOperator?.(type);
                    }}
                    title={`${t('data.workflow.addOperatorToCanvas')}\n${type} · DSL: ${OPERATOR_NAMING[type].dsl.join(' / ')}`}
                    aria-label={`${t(labelKey)} — ${t('data.workflow.addOperatorToCanvas')}`}
                    className="relative mx-2.5 h-8 w-[calc(100%-20px)] cursor-grab justify-start gap-2 rounded-none border-0 bg-transparent pl-[18px] pr-2 text-xs text-text-secondary shadow-none before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent before:opacity-0 hover:bg-accent-muted hover:text-accent hover:before:opacity-100 focus-visible:bg-accent-muted focus-visible:before:opacity-100 active:cursor-grabbing"
                  >
                    <span
                      className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] ${colorClassName}`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="truncate">{t(labelKey)}</span>
                  </Button>
                ))}
                {operators.length === 0 && (
                  <p className="mx-2.5 px-[18px] py-1 text-xs leading-5 text-text-muted">
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
