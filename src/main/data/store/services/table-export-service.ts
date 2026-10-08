/**
 * Table file exports — CSV / Excel data files and the self-contained HTML
 * report (source provenance, processing DSL, last-computation metadata).
 * The IPC layer owns the save dialog + file write; this service only builds
 * file payloads.
 */
import * as XLSX from '../../../utils/xlsx';
import type {
  DataColumnTypeInfo,
  DataExportTableInput,
  DataOutputTable,
  DataTaskRun,
} from '../../../../shared/contracts';
import { DATA_FIELD_TYPE_LABELS } from '../../../../shared/data-field-types';
import { exportPrepWorkflowDsl } from '../../../../shared/prep-dsl';
import { quoteIdentifier, toNumber } from '../../operators';
import { csvCell } from '../input-source';
import type { DataStoreContext } from '../data-store-context';
import type { DatasetRepository } from '../repositories/dataset-repository';
import type { TaskRepository } from '../repositories/task-repository';
import type { WorkflowRepository } from '../repositories/workflow-repository';
import type { TaskRunsRepository } from '../repositories/task-runs-repository';

const EXPORT_MAX_ROWS = 200_000;
const REPORT_SAMPLE_ROWS = 100;

export interface PreparedTableExport {
  fileName: string;
  content: string | Buffer;
}

interface TableRowsSnapshot {
  columns: string[];
  columnTypes: DataColumnTypeInfo[];
  rows: Record<string, unknown>[];
  totalRows: number;
}

export interface TableReportTaskSection {
  name: string;
  /** Canonical DSL for the task's workflow; null when not expressible. */
  dsl: string | null;
}

export interface TableReportData {
  locale: 'zh' | 'en';
  tableName: string;
  physicalTable: string;
  tableKind: 'input' | 'output';
  rowCount: number;
  tableUpdatedAt: number;
  generatedAt: number;
  sourceDatasetName: string | null;
  tasks: TableReportTaskSection[];
  lastRun: Pick<
    DataTaskRun,
    'seq' | 'status' | 'startedAt' | 'finishedAt' | 'inputRows' | 'outputRows' | 'workflowSignature'
  > | null;
  columnTypes: { name: string; label: string; storageType: string }[];
  sampleRows: Record<string, unknown>[];
  sampleLimit: number;
}

const REPORT_LABELS = {
  zh: {
    reportTitle: '数据报告',
    generatedAt: '报告生成时间',
    tableUpdatedAt: '数据更新时间',
    rows: '行数',
    physicalTable: '物理表',
    source: '来源',
    sourceInput: '输入表',
    producingTasks: '关联数据任务',
    noSource: '无关联来源',
    processing: '处理逻辑（DSL）',
    dslUnavailable: '（该流程无法用 DSL 表达）',
    computation: '计算信息',
    lastRun: '最近一次运行',
    runSeq: '运行编号',
    runStatus: '状态',
    runFinishedAt: '计算完成时间',
    runDuration: '耗时',
    runInputRows: '输入行数',
    runOutputRows: '输出行数',
    runSignature: '任务版本',
    noRun: '尚无运行记录',
    schema: '字段结构',
    sampleData: '样例数据',
    sampleNote: '仅展示前 {count} 行，完整数据请使用导出功能。',
    statusSuccess: '成功',
    statusFailed: '失败',
    statusRunning: '运行中',
  },
  en: {
    reportTitle: 'Data Report',
    generatedAt: 'Report generated at',
    tableUpdatedAt: 'Data updated at',
    rows: 'Rows',
    physicalTable: 'Physical table',
    source: 'Source',
    sourceInput: 'Input table',
    producingTasks: 'Producing tasks',
    noSource: 'No linked source',
    processing: 'Processing logic (DSL)',
    dslUnavailable: '(Workflow cannot be expressed as DSL)',
    computation: 'Computation',
    lastRun: 'Latest run',
    runSeq: 'Run',
    runStatus: 'Status',
    runFinishedAt: 'Computed at',
    runDuration: 'Duration',
    runInputRows: 'Input rows',
    runOutputRows: 'Output rows',
    runSignature: 'Task version',
    noRun: 'No runs recorded yet',
    schema: 'Schema',
    sampleData: 'Sample data',
    sampleNote: 'Showing the first {count} rows — use export for the full data.',
    statusSuccess: 'Succeeded',
    statusFailed: 'Failed',
    statusRunning: 'Running',
  },
};

type ReportLabels = (typeof REPORT_LABELS)['zh'];

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return cleaned.length > 0 ? cleaned : 'table';
}

function reportTime(ts: number | null | undefined, zh: boolean): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(zh ? 'zh-CN' : 'en-US', { hour12: false });
}

function reportDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

function reportStatus(run: NonNullable<TableReportData['lastRun']>, L: ReportLabels): string {
  if (run.status === 'completed') return L.statusSuccess;
  if (run.status === 'failed') return L.statusFailed;
  return L.statusRunning;
}

function metaRow(label: string, value: unknown): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

/** Pure HTML report builder — kept exported for unit tests. */
export function buildTableReportHtml(data: TableReportData): string {
  const zh = data.locale === 'zh';
  const L = REPORT_LABELS[zh ? 'zh' : 'en'];
  const run = data.lastRun;
  const durationMs =
    run?.finishedAt && run.startedAt ? Math.max(0, run.finishedAt - run.startedAt) : null;

  const sourceRows: string[] = [];
  if (data.sourceDatasetName) sourceRows.push(metaRow(L.sourceInput, data.sourceDatasetName));
  if (data.tasks.length > 0) {
    sourceRows.push(metaRow(L.producingTasks, data.tasks.map((t) => t.name).join('、')));
  }
  const sourceSection =
    sourceRows.length > 0
      ? `<table class="meta">${sourceRows.join('')}</table>`
      : `<p class="muted">${escapeHtml(L.noSource)}</p>`;

  const processingSection = data.tasks
    .map(
      (task) => `
      <h3>${escapeHtml(task.name)}</h3>
      <pre class="dsl">${escapeHtml(task.dsl ?? L.dslUnavailable)}</pre>`
    )
    .join('');

  const runSection = run
    ? `<table class="meta">${[
        metaRow(L.runSeq, `#${run.seq}`),
        metaRow(L.runStatus, reportStatus(run, L)),
        metaRow(L.runFinishedAt, reportTime(run.finishedAt, zh)),
        metaRow(L.runDuration, reportDuration(durationMs)),
        metaRow(L.runInputRows, run.inputRows ?? '—'),
        metaRow(L.runOutputRows, run.outputRows ?? '—'),
        metaRow(L.runSignature, run.workflowSignature?.slice(0, 12) ?? '—'),
      ].join('')}</table>`
    : `<p class="muted">${escapeHtml(L.noRun)}</p>`;

  const headerCells = data.columnTypes
    .map((column) => `<th>${escapeHtml(column.name)}</th>`)
    .join('');
  const typeCells = data.columnTypes
    .map(
      (column) =>
        `<td class="muted">${escapeHtml(column.label)} · ${escapeHtml(column.storageType)}</td>`
    )
    .join('');
  const bodyRows = data.sampleRows
    .map(
      (row) =>
        `<tr>${data.columnTypes
          .map((column) => `<td>${escapeHtml(row[column.name] ?? '')}</td>`)
          .join('')}</tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.tableName)} · ${escapeHtml(L.reportTitle)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif; margin: 32px; color: #1f2329; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  h3 { font-size: 13px; margin: 12px 0 4px; color: #374151; }
  .sub { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
  .muted { color: #6b7280; }
  table.meta { border-collapse: collapse; font-size: 13px; }
  table.meta th { text-align: left; padding: 4px 16px 4px 0; color: #6b7280; font-weight: 500; white-space: nowrap; }
  table.meta td { padding: 4px 0; }
  pre.dsl { background: #f6f7f9; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; }
  table.data { border-collapse: collapse; font-size: 12px; margin-top: 4px; }
  table.data th, table.data td { border: 1px solid #e5e7eb; padding: 5px 10px; text-align: left; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  table.data th { background: #f6f7f9; }
</style>
</head>
<body>
<h1>${escapeHtml(data.tableName)}</h1>
<div class="sub">${escapeHtml(L.reportTitle)} · ${escapeHtml(L.generatedAt)}: ${escapeHtml(reportTime(data.generatedAt, zh))}</div>

<h2>${escapeHtml(L.source)}</h2>
<table class="meta">
  ${metaRow(L.rows, data.rowCount)}
  ${metaRow(L.tableUpdatedAt, reportTime(data.tableUpdatedAt, zh))}
  ${metaRow(L.physicalTable, data.physicalTable)}
</table>
${sourceSection}

${processingSection ? `<h2>${escapeHtml(L.processing)}</h2>${processingSection}` : ''}

<h2>${escapeHtml(L.computation)}</h2>
${runSection}

<h2>${escapeHtml(L.schema)} · ${escapeHtml(L.sampleData)}</h2>
<p class="muted">${escapeHtml(L.sampleNote.replace('{count}', String(data.sampleLimit)))}</p>
<table class="data">
  <thead><tr>${headerCells}</tr><tr>${typeCells}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
</body>
</html>`;
}

export class TableExportService {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly datasets: DatasetRepository,
    private readonly tasks: TaskRepository,
    private readonly workflows: WorkflowRepository,
    private readonly taskRuns: TaskRunsRepository
  ) {}

  async buildTableExport(input: DataExportTableInput): Promise<PreparedTableExport> {
    await this.ctx.ensureMetadataReady();
    const dataset =
      input.tableKind === 'output'
        ? await this.datasets.requireOutputTable(input.id)
        : await this.datasets.requireInputDataset(input.id);
    await this.ctx.ensureReady();
    if (!(await this.ctx.physicalTableExists(dataset.tableName))) {
      throw new Error(`Data table is not materialized: ${input.id}`);
    }
    const baseName = sanitizeFileName(dataset.name);

    if (input.format === 'csv') {
      const snapshot = await this.readRows(dataset.tableName, EXPORT_MAX_ROWS);
      const csv =
        [
          snapshot.columns.map(csvCell).join(','),
          ...snapshot.rows.map((row) =>
            snapshot.columns.map((column) => csvCell(row[column])).join(',')
          ),
        ].join('\n') + '\n';
      return { fileName: `${baseName}.csv`, content: csv };
    }

    if (input.format === 'xlsx') {
      const snapshot = await this.readRows(dataset.tableName, EXPORT_MAX_ROWS);
      const sheet = XLSX.utils.aoa_to_sheet([
        snapshot.columns,
        ...snapshot.rows.map((row) => snapshot.columns.map((column) => row[column] ?? null)),
      ]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'data');
      const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      return { fileName: `${baseName}.xlsx`, content: buffer };
    }

    const report = await this.buildReportData(dataset, input);
    return {
      fileName: `${baseName}-report.html`,
      content: buildTableReportHtml(report),
    };
  }

  private async readRows(tableName: string, maxRows: number): Promise<TableRowsSnapshot> {
    const totalRows = toNumber(
      (
        await this.ctx.queryRows<{ count: number | string }>(
          `SELECT count(*) AS count FROM ${quoteIdentifier(tableName)}`
        )
      )[0]?.count
    );
    if (totalRows > maxRows) {
      throw new Error(`Data table has ${totalRows} rows, above export limit ${maxRows}`);
    }
    const rows = await this.ctx.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(tableName)}`
    );
    return {
      columns: await this.ctx.getTableColumns(tableName),
      columnTypes: await this.ctx.getTableColumnTypes(tableName),
      rows,
      totalRows,
    };
  }

  private async buildReportData(
    dataset: { id: string; name: string; tableName: string; rowCount: number; updatedAt: number },
    input: DataExportTableInput
  ): Promise<TableReportData> {
    const locale = input.locale === 'zh' ? 'zh' : 'en';
    const isOutput = input.tableKind === 'output';
    const outputTable = isOutput ? (dataset as DataOutputTable) : null;

    let sourceDatasetName: string | null = null;
    if (outputTable?.sourceDatasetId) {
      sourceDatasetName =
        (await this.datasets.getDataset(outputTable.sourceDatasetId))?.name ?? null;
    }

    const taskIds = outputTable?.relatedTaskIds ?? [];
    const tasks: TableReportTaskSection[] = [];
    let lastRun: TableReportData['lastRun'] = null;
    for (const taskId of taskIds.slice(0, 4)) {
      const task = await this.tasks.getTask(taskId);
      if (!task) continue;
      let dsl: string | null = null;
      try {
        const workflow = await this.workflows.getRuntimeWorkflow(taskId);
        dsl =
          workflow.nodes.length > 0 ? exportPrepWorkflowDsl(workflow.nodes, workflow.edges) : '';
      } catch {
        dsl = null;
      }
      tasks.push({ name: task.name, dsl });
    }
    if (taskIds[0]) {
      lastRun = await this.taskRuns.getLatestTaskRun(taskIds[0], 'run');
    }

    const snapshot = await this.readRows(dataset.tableName, EXPORT_MAX_ROWS);
    const sampleRows = snapshot.rows.slice(0, REPORT_SAMPLE_ROWS);
    return {
      locale,
      tableName: dataset.name,
      physicalTable: dataset.tableName,
      tableKind: input.tableKind,
      rowCount: snapshot.totalRows,
      tableUpdatedAt: dataset.updatedAt,
      generatedAt: Date.now(),
      sourceDatasetName,
      tasks,
      lastRun,
      columnTypes: snapshot.columnTypes.map((column) => ({
        name: column.name,
        label: DATA_FIELD_TYPE_LABELS[column.type] ?? column.type,
        storageType: column.storageType,
      })),
      sampleRows,
      sampleLimit: REPORT_SAMPLE_ROWS,
    };
  }
}
