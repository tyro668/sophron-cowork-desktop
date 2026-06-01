import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createDataResourceHref,
  parseDataResourceHref,
} from '../src/shared/data-resource-link';

const contentBlockViewPath = path.resolve(
  process.cwd(),
  'src/renderer/components/message/ContentBlockView.tsx'
);
const dataViewPath = path.resolve(process.cwd(), 'src/renderer/components/DataView.tsx');
const markdownPath = path.resolve(process.cwd(), 'src/renderer/components/MessageMarkdown.tsx');
const preloadPath = path.resolve(process.cwd(), 'src/preload/index.ts');
const mainIndexPath = path.resolve(process.cwd(), 'src/main/index.ts');

describe('data resource chat links', () => {
  it('round-trips app data resource hrefs', () => {
    const href = createDataResourceHref('output_table', 'dataset output/1');
    expect(href).toBe('sophron://data/output-tables/dataset%20output%2F1');
    expect(parseDataResourceHref(href)).toEqual({
      kind: 'output_table',
      id: 'dataset output/1',
    });
  });

  it('wires message markdown links to data navigation', () => {
    const source = fs.readFileSync(contentBlockViewPath, 'utf8');
    const markdown = fs.readFileSync(markdownPath, 'utf8');
    expect(source).toContain('parseDataResourceHref(href)');
    expect(source).toContain('navigateToDataElement(dataTarget)');
    expect(markdown).toContain("'sophron'");
  });

  it('lets DataView resolve and open each resource type by id', () => {
    const source = fs.readFileSync(dataViewPath, 'utf8');
    expect(source).toContain('pendingDataNavigation');
    expect(source).toContain('getTask(target.id)');
    expect(source).toContain('getInputTable(target.id)');
    expect(source).toContain('getOutputTable(target.id)');
    expect(source).toContain('setEditingTaskId(task.id)');
    expect(source).toContain('setEditingInputTableDatasetId(inputTable.id)');
    expect(source).toContain('setEditingOutputTableId(outputTable.id)');
  });

  it('keeps output table preview mapped to output-table copy', () => {
    const source = fs.readFileSync(dataViewPath, 'utf8');
    expect(source).toContain("tableKind={storedPreviewTarget?.kind ?? 'input'}");
    expect(source).toContain("t('data.outputTables.previewTitle')");
    expect(source).toContain("t('data.outputTables.previewEmpty')");
  });

  it('exposes direct resource lookup IPC methods', () => {
    const preload = fs.readFileSync(preloadPath, 'utf8');
    const main = fs.readFileSync(mainIndexPath, 'utf8');
    expect(preload).toContain("ipcRenderer.invoke('data.getTask', id)");
    expect(preload).toContain("ipcRenderer.invoke('data.getInputTable', id)");
    expect(preload).toContain("ipcRenderer.invoke('data.getOutputTable', id)");
    expect(main).toContain("ipcMain.handle('data.getTask'");
    expect(main).toContain("ipcMain.handle('data.getInputTable'");
    expect(main).toContain("ipcMain.handle('data.getOutputTable'");
  });
});
