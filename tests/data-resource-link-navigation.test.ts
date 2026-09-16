import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createDataResourceHref,
  normalizeDataResourceMarkdownLinks,
  parseDataResourceHref,
} from '../src/shared/data-resource-link';
import { MessageMarkdown } from '../src/renderer/components/MessageMarkdown';

const contentBlockViewPath = path.resolve(
  process.cwd(),
  'src/renderer/components/message/ContentBlockView.tsx'
);
const dataViewPath = path.resolve(process.cwd(), 'src/renderer/components/DataView.tsx');
const inputTablesPath = path.resolve(
  process.cwd(),
  'src/renderer/components/data-view/input-tables.tsx'
);
const markdownPath = path.resolve(process.cwd(), 'src/renderer/components/MessageMarkdown.tsx');
const preloadPath = path.resolve(process.cwd(), 'src/preload/api/data.ts');
const dataIpcDir = path.resolve(process.cwd(), 'src/main/data/ipc');

describe('data resource chat links', () => {
  it('round-trips app data resource hrefs', () => {
    const href = createDataResourceHref('output_table', 'dataset output/1');
    expect(href).toBe('#/data/output-tables/dataset%20output%2F1');
    expect(parseDataResourceHref(href)).toEqual({
      kind: 'output_table',
      id: 'dataset output/1',
    });
    expect(parseDataResourceHref('sophron://data/tasks/task_1')).toEqual({
      kind: 'task',
      id: 'task_1',
    });
    expect(normalizeDataResourceMarkdownLinks('[task](sophron://data/tasks/task_1)')).toBe(
      '[task](#/data/tasks/task_1)'
    );
  });

  it('wires message markdown links to data navigation', () => {
    const source = fs.readFileSync(contentBlockViewPath, 'utf8');
    const markdown = fs.readFileSync(markdownPath, 'utf8');
    expect(source).toContain('parseDataResourceHref(href)');
    expect(source).toContain('navigateToDataElement(dataTarget)');
    expect(source).toContain('event.preventDefault();');
    expect(source).toContain('normalizeDataResourceMarkdownLinks');
    expect(markdown).toContain("'sophron'");
  });

  it('keeps hash data links available after markdown sanitization', () => {
    const html = renderToStaticMarkup(
      React.createElement(MessageMarkdown, {
        normalizedText: '[customers](#/data/input-tables/dataset_1)',
        components: {
          a({ href, children }: { href?: string; children?: React.ReactNode }) {
            return React.createElement('span', { 'data-href': href }, children);
          },
        },
      })
    );

    expect(html).toContain('data-href="#/data/input-tables/dataset_1"');
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
    const dataView = fs.readFileSync(dataViewPath, 'utf8');
    const inputTables = fs.readFileSync(inputTablesPath, 'utf8');
    expect(dataView).toContain("tableKind={storedPreviewTarget?.kind ?? 'input'}");
    expect(inputTables).toContain("t('data.outputTables.previewTitle')");
    expect(inputTables).toContain("t('data.outputTables.previewEmpty')");
  });

  it('exposes direct resource lookup IPC methods', () => {
    const preload = fs.readFileSync(preloadPath, 'utf8');
    const mainHandlers = fs
      .readdirSync(dataIpcDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => fs.readFileSync(path.join(dataIpcDir, entry.name), 'utf8'))
      .join('\n');
    expect(preload).toContain("ipcRenderer.invoke('data.getTask', id)");
    expect(preload).toContain("ipcRenderer.invoke('data.getInputTable', id)");
    expect(preload).toContain("ipcRenderer.invoke('data.getOutputTable', id)");
    expect(mainHandlers).toContain("handleIpc('data.getTask'");
    expect(mainHandlers).toContain("handleIpc('data.getInputTable'");
    expect(mainHandlers).toContain("handleIpc('data.getOutputTable'");
  });
});
