import { Database, ExternalLink, Plus, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DataPipeline, DataRawTable, DataResultTable } from '../../types';
import { RawTableStatusBadge, StatusBadge } from './shared';

const GRID = 'grid grid-cols-[104px_minmax(0,1fr)_140px_120px_124px]';
const CELL =
  'flex min-h-[35px] min-w-0 items-center whitespace-nowrap border-b border-border-subtle px-[10px] text-[12.5px] [&+*]:border-l';
const shortTime = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const TH = `${CELL} !text-[11.5px] font-medium text-text-muted`;

/** Read-only 关联设置 tab (c07): pipelines reading this raw table and their result tables. */
export function RawTableRelations({
  rawTable,
  pipelines,
  resultTables,
  onOpenPipeline,
  onOpenResultTable,
  onCreatePipeline,
}: {
  rawTable: DataRawTable;
  pipelines: DataPipeline[];
  resultTables: DataResultTable[];
  onOpenPipeline?: (pipeline: DataPipeline) => void;
  onOpenResultTable?: (resultTable: DataResultTable) => void;
  onCreatePipeline?: (rawTable: DataRawTable) => void;
}) {
  const { t } = useTranslation();
  const linked = pipelines.filter((pipeline) => pipeline.sourceRawTableId === rawTable.id);
  const linkedIds = new Set(linked.map((pipeline) => pipeline.id));
  const downstream = resultTables
    .map((table) => ({
      table,
      via: linked.find(
        (pipeline) =>
          table.relatedPipelineIds.includes(pipeline.id) ||
          table.relatedPipelineNames.includes(pipeline.name) ||
          (pipeline.resultTable !== null &&
            (pipeline.resultTable === table.name || pipeline.resultTable === table.tableName))
      ),
    }))
    .filter((entry) => entry.via && linkedIds.has(entry.via.id));
  const openCell = (onClick?: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="ui-accent-cell min-h-[35px] border-b border-l border-border-subtle !text-[12.5px]"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      {t('data.rawTables.relations.open')}
    </button>
  );
  return (
    <div data-testid="raw-table-relations">
      <section className="ui-group ui-form-flush bg-surface">
        <div className={GRID}>
          <div className="ui-group-title col-span-4">
            {t('data.rawTables.relations.pipelines', { count: linked.length })}
          </div>
          {onCreatePipeline ? (
            <button
              type="button"
              onClick={() => onCreatePipeline(rawTable)}
              className="ui-accent-cell border-b border-l border-border-subtle bg-surface-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('data.rawTables.relations.newPipeline')}
            </button>
          ) : (
            <div className="ui-group-title" />
          )}
          <div className={`${TH} col-span-2`}>{t('data.rawTables.relations.colName')}</div>
          <div className={`${TH}`}>{t('data.rawTables.relations.colLastRun')}</div>
          <div className={`${TH}`}>{t('data.rawTables.relations.colStatus')}</div>
          <div className={`${TH}`} />
          {linked.length === 0 ? (
            <div className={`${CELL} col-span-5 text-text-muted`}>
              {t('data.rawTables.relations.noPipelines')}
            </div>
          ) : (
            linked.map((pipeline) => (
              <div key={pipeline.id} className="contents" data-testid="relation-pipeline-row">
                <div className={`${CELL} col-span-2 gap-2 font-medium text-text-primary`}>
                  <Workflow className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                  <span className="truncate">{pipeline.name}</span>
                </div>
                <div className={`${CELL} tabular-nums text-text-muted`}>
                  {pipeline.lastRunAt
                    ? shortTime(pipeline.lastRunAt)
                    : t('data.rawTables.relations.neverRun')}
                </div>
                <div className={CELL}>
                  <StatusBadge status={pipeline.status} />
                </div>
                {openCell(onOpenPipeline ? () => onOpenPipeline(pipeline) : undefined)}
              </div>
            ))
          )}
          <div className="ui-group-title col-span-5">
            {t('data.rawTables.relations.resultTables', { count: downstream.length })}
          </div>
          {downstream.length === 0 ? (
            <div className={`${CELL} col-span-5 text-text-muted`}>
              {t('data.rawTables.relations.noResultTables')}
            </div>
          ) : (
            downstream.map(({ table, via }) => (
              <div key={table.id} className="contents" data-testid="relation-result-row">
                <div className={`${CELL} col-span-2 gap-2 font-medium text-text-primary`}>
                  <Database className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                  <span className="truncate">{table.name}</span>
                </div>
                <div className={`${CELL} text-text-muted`}>
                  <span className="truncate">
                    {t('data.rawTables.relations.via', { name: via?.name ?? '' })}
                  </span>
                </div>
                <div className={`${CELL}`}>
                  <RawTableStatusBadge label={t('data.rawTables.status.available')} />
                </div>
                {openCell(onOpenResultTable ? () => onOpenResultTable(table) : undefined)}
              </div>
            ))
          )}
          <div className="ui-group-title col-span-5">{t('data.rawTables.relations.impact')}</div>
          <div className="ui-form-label col-span-1 min-h-[35px] items-center">
            {t('data.rawTables.relations.impactLabel')}
          </div>
          <div className="col-span-4 flex min-h-[35px] items-center px-[10px] py-2 text-[12.5px] text-text-muted">
            {t('data.rawTables.relations.impactText', {
              pipelines: linked.length,
              tables: downstream.length,
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
