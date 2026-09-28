/**
 * HTML report provenance: source task, processing DSL, and computation
 * metadata (run seq, finished-at, duration, row counts, workflow signature)
 * must be present so a shared report stands on its own.
 */
import { describe, expect, it } from 'vitest';
import {
  buildTableReportHtml,
  type TableReportData,
} from '../src/main/data/store/services/table-export-service';

function makeReport(overrides: Partial<TableReportData> = {}): TableReportData {
  return {
    locale: 'en',
    tableName: 'Clean orders',
    physicalTable: 'out_clean_orders',
    tableKind: 'output',
    rowCount: 1234,
    tableUpdatedAt: 1_700_000_000_000,
    generatedAt: 1_700_000_100_000,
    sourceDatasetName: 'orders.xlsx',
    tasks: [
      {
        name: 'Clean orders task',
        dsl: 'input source orders as src\nfrom src |> filter amount > 0\noutput to "Clean orders"',
      },
    ],
    lastRun: {
      seq: 7,
      status: 'completed',
      startedAt: 1_700_000_050_000,
      finishedAt: 1_700_000_053_500,
      inputRows: 2000,
      outputRows: 1234,
      workflowSignature: 'abcdef1234567890',
    },
    columnTypes: [
      { name: 'id', label: 'Integer', storageType: 'BIGINT' },
      { name: 'amount', label: 'Float', storageType: 'DOUBLE' },
    ],
    sampleRows: [{ id: 1, amount: 9.5 }],
    sampleLimit: 100,
    ...overrides,
  };
}

describe('buildTableReportHtml', () => {
  it('embeds source, filters (DSL), and computation time', () => {
    const html = buildTableReportHtml(makeReport());
    expect(html).toContain('Clean orders');
    expect(html).toContain('orders.xlsx'); // source provenance
    expect(html).toContain('Clean orders task');
    expect(html).toContain('filter amount &gt; 0'); // processing/filter DSL, escaped
    expect(html).toContain('#7'); // run number
    expect(html).toContain('3.5 s'); // duration
    expect(html).toContain('2000'); // input rows
    expect(html).toContain('abcdef123456'); // workflow signature
    expect(html).toContain('Computed at'); // computation timestamp label
    expect(html).toContain('9.5'); // sample row value
    expect(html).toContain('BIGINT'); // column storage type
  });

  it('localizes labels and marks missing runs explicitly', () => {
    const html = buildTableReportHtml(makeReport({ locale: 'zh', lastRun: null }));
    expect(html).toContain('尚无运行记录');
    expect(html).toContain('数据报告');
    expect(html).toContain('处理逻辑');
  });

  it('escapes html in table names and cell values', () => {
    const html = buildTableReportHtml(
      makeReport({
        tableName: '<b>bad</b>',
        sampleRows: [{ id: 1, amount: '<script>' as unknown as number }],
      })
    );
    expect(html).not.toContain('<b>bad</b>');
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
    expect(html).not.toContain('<script>');
  });

  it('shows a fallback when the workflow is not DSL-expressible', () => {
    const html = buildTableReportHtml(makeReport({ tasks: [{ name: 'Odd task', dsl: null }] }));
    expect(html).toContain('(Workflow cannot be expressed as DSL)');
  });
});
