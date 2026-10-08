import type { DataDashboard } from '../../../types';
import { dataClient } from './data-client';

/** Task selection must include every saved task, not just the first workspace page. */
export async function loadDataTaskResources(): Promise<DataDashboard> {
  const pageSize = 200;
  const first = await dataClient.getDashboard({
    includeSummary: false,
    includeTasks: true,
    includeDatasets: true,
    includeOutputTables: true,
    taskLimit: pageSize,
    datasetLimit: pageSize,
    outputLimit: pageSize,
  });
  const result = {
    ...first,
    tasks: [...first.tasks],
    datasets: [...first.datasets],
    outputTables: [...first.outputTables],
  };
  let moreTasks = first.tasks.length === pageSize;
  let moreInputs = first.datasets.length === pageSize;
  let moreOutputs = first.outputTables.length === pageSize;
  while (moreTasks || moreInputs || moreOutputs) {
    const page = await dataClient.getDashboard({
      includeSummary: false,
      includeTasks: moreTasks,
      includeDatasets: moreInputs,
      includeOutputTables: moreOutputs,
      taskLimit: pageSize,
      datasetLimit: pageSize,
      outputLimit: pageSize,
      taskOffset: result.tasks.length,
      datasetOffset: result.datasets.length,
      outputOffset: result.outputTables.length,
    });
    if (moreTasks) result.tasks.push(...page.tasks);
    if (moreInputs) result.datasets.push(...page.datasets);
    if (moreOutputs) result.outputTables.push(...page.outputTables);
    moreTasks = moreTasks && page.tasks.length === pageSize;
    moreInputs = moreInputs && page.datasets.length === pageSize;
    moreOutputs = moreOutputs && page.outputTables.length === pageSize;
  }
  return result;
}
