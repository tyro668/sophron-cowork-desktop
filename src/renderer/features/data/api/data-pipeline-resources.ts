import type { DataDashboard } from '../../../types';
import { dataClient } from './data-client';

/** Pipeline selection must include every saved pipeline, not just the first workspace page. */
export async function loadDataPipelineResources(): Promise<DataDashboard> {
  const pageSize = 200;
  const first = await dataClient.getDashboard({
    includeSummary: false,
    includePipelines: true,
    includeRawTables: true,
    includeResultTables: true,
    pipelineLimit: pageSize,
    rawTableLimit: pageSize,
    outputLimit: pageSize,
  });
  const result = {
    ...first,
    pipelines: [...first.pipelines],
    rawTables: [...first.rawTables],
    resultTables: [...first.resultTables],
  };
  let morePipelines = first.pipelines.length === pageSize;
  let moreInputs = first.rawTables.length === pageSize;
  let moreOutputs = first.resultTables.length === pageSize;
  while (morePipelines || moreInputs || moreOutputs) {
    const page = await dataClient.getDashboard({
      includeSummary: false,
      includePipelines: morePipelines,
      includeRawTables: moreInputs,
      includeResultTables: moreOutputs,
      pipelineLimit: pageSize,
      rawTableLimit: pageSize,
      outputLimit: pageSize,
      pipelineOffset: result.pipelines.length,
      rawTableOffset: result.rawTables.length,
      outputOffset: result.resultTables.length,
    });
    if (morePipelines) result.pipelines.push(...page.pipelines);
    if (moreInputs) result.rawTables.push(...page.rawTables);
    if (moreOutputs) result.resultTables.push(...page.resultTables);
    morePipelines = morePipelines && page.pipelines.length === pageSize;
    moreInputs = moreInputs && page.rawTables.length === pageSize;
    moreOutputs = moreOutputs && page.resultTables.length === pageSize;
  }
  return result;
}
