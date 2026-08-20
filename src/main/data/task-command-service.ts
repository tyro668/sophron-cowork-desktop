import type { DataTaskStore } from './data-task-store';
import type {
  CreateTaskCommand,
  ListInputTablesInput,
  ListTasksResult,
  TaskResult,
  UpdateTaskCommand,
} from './data-command-types';
import { DataCommandResources } from './data-command-resources';
import {
  listWindow,
  normalizeOptionalName,
  normalizeRequiredName,
  toCommandError,
} from './data-command-utils';

export class TaskCommandService {
  constructor(
    private readonly store: DataTaskStore,
    private readonly resources: DataCommandResources
  ) {}

  async listTasks(input: ListInputTablesInput = {}): Promise<ListTasksResult> {
    const window = listWindow(input.limit, input.offset);
    const dashboard = await this.store.getDashboard({
      query: input.query,
      includeSummary: false,
      includeTasks: true,
      includeDatasets: false,
      includeOutputTables: false,
      taskLimit: window.limit,
      taskOffset: window.offset,
    });
    return { tasks: dashboard.tasks, total: dashboard.totalTasks, ...window };
  }

  async createTask(input: CreateTaskCommand): Promise<TaskResult> {
    const name = normalizeRequiredName(input.name, 'Task name is required');
    await this.resources.ensureUniqueTaskName(name);
    if (input.sourceInputTableId) await this.resources.requireInputTable(input.sourceInputTableId);
    if (input.outputTableId) await this.resources.requireOutputTable(input.outputTableId);
    try {
      return {
        task: await this.store.createTask({
          name,
          sourcePath: input.sourcePath,
          sourceDatasetId: input.sourceInputTableId ?? null,
          outputTableId: input.outputTableId ?? null,
        }),
      };
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  async updateTask(input: UpdateTaskCommand): Promise<TaskResult> {
    await this.resources.requireTask(input.id);
    const name = normalizeOptionalName(input.name);
    if (name) await this.resources.ensureUniqueTaskName(name, input.id);
    try {
      return { task: await this.store.updateTask({ id: input.id, name }) };
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }
}
