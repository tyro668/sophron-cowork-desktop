import type { DataPipeline, DataResultTable } from '../../../../shared/contracts/data';

type Translate = (key: string, options?: Record<string, unknown>) => string;

function joinNames(names: string[], max = 3): string {
  const shown = names.slice(0, max).join('、');
  return names.length > max ? `${shown} 等 ${names.length} 个` : shown;
}

/** 影响 text for deleting a result table: pipelines writing into it lose their output. */
export function resultTableDeleteImpact(table: DataResultTable, t: Translate): string {
  const names = table.relatedPipelineNames.filter(Boolean);
  return names.length > 0
    ? t('data.deleteImpact.resultTablePipelines', { names: joinNames(names) })
    : t('data.deleteImpact.resultTableNone');
}

/** 影响 text for deleting a raw table: pipelines using it as input stop working. */
export function rawTableDeleteImpact(
  rawTableId: string,
  pipelines: DataPipeline[],
  t: Translate
): string {
  const names = pipelines
    .filter((pipeline) => pipeline.sourceRawTableId === rawTableId)
    .map((pipeline) => pipeline.name);
  return names.length > 0
    ? t('data.deleteImpact.rawTablePipelines', { names: joinNames(names) })
    : t('data.deleteImpact.rawTableNone');
}

/** 影响 text for deleting a pipeline: its result table stays but stops updating. */
export function pipelineDeleteImpact(pipeline: DataPipeline, t: Translate): string {
  return pipeline.resultTable
    ? t('data.deleteImpact.pipelineResult', { name: pipeline.resultTable })
    : t('data.deleteImpact.pipelineNone');
}
