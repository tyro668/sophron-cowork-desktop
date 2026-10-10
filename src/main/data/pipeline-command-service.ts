import type { DataPipelineStore } from './data-pipeline-store';
import type {
  CreatePipelineCommand,
  ListRawTablesInput,
  ListPipelinesResult,
  PipelineResult,
  UpdatePipelineCommand,
} from './data-command-types';
import { DataCommandResources } from './data-command-resources';
import {
  listWindow,
  normalizeOptionalName,
  normalizeRequiredName,
  toCommandError,
} from './data-command-utils';

export class PipelineCommandService {
  constructor(
    private readonly store: DataPipelineStore,
    private readonly resources: DataCommandResources
  ) {}

  async listPipelines(input: ListRawTablesInput = {}): Promise<ListPipelinesResult> {
    const window = listWindow(input.limit, input.offset);
    const dashboard = await this.store.getDashboard({
      query: input.query,
      includeSummary: false,
      includePipelines: true,
      includeRawTables: false,
      includeResultTables: false,
      pipelineLimit: window.limit,
      pipelineOffset: window.offset,
    });
    return { pipelines: dashboard.pipelines, total: dashboard.totalPipelines, ...window };
  }

  async createPipeline(input: CreatePipelineCommand): Promise<PipelineResult> {
    const name = normalizeRequiredName(input.name, 'Pipeline name is required');
    await this.resources.ensureUniquePipelineName(name);
    if (input.sourceRawTableId) await this.resources.requireRawTable(input.sourceRawTableId);
    if (input.resultTableId) await this.resources.requireResultTable(input.resultTableId);
    try {
      return {
        pipeline: await this.store.createPipeline({
          name,
          sourcePath: input.sourcePath,
          sourceRawTableId: input.sourceRawTableId ?? null,
          resultTableId: input.resultTableId ?? null,
        }),
      };
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  async updatePipeline(input: UpdatePipelineCommand): Promise<PipelineResult> {
    await this.resources.requirePipeline(input.id);
    const name = normalizeOptionalName(input.name);
    if (name) await this.resources.ensureUniquePipelineName(name, input.id);
    try {
      return { pipeline: await this.store.updatePipeline({ id: input.id, name }) };
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }
}
