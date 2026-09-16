import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ipcRenderer } from 'electron';
import {
  createDataResourceHref,
  normalizeDataResourceMarkdownLinks,
  parseDataResourceHref,
} from '../src/shared/data-resource-link';
import { IPC_INPUT_SCHEMAS } from '../src/shared/contracts/ipc/schemas';
import { createDataApi } from '../src/preload/api/data';
import { MessageMarkdown } from '../src/renderer/components/MessageMarkdown';

const contentBlockViewPath = path.resolve(
  process.cwd(),
  'src/renderer/components/message/ContentBlockView.tsx'
);
const dataViewPagePath = path.resolve(
  process.cwd(),
  'src/renderer/features/data/pages/DataViewPage.tsx'
);
const dataNavigationPath = path.resolve(
  process.cwd(),
  'src/renderer/features/data/hooks/use-data-navigation.ts'
);
const inputTablePreviewDialogPath = path.resolve(
  process.cwd(),
  'src/renderer/components/data-view/input-table-preview-dialog.tsx'
);
const markdownPath = path.resolve(process.cwd(), 'src/renderer/components/MessageMarkdown.tsx');

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
    // The behavioral coverage for all three deep-link kinds now lives in
    // tests/renderer/data-view-hooks.test.tsx (useDataNavigation suite). Keep a
    // light wiring check that the page still mounts the navigation hook.
    const source = fs.readFileSync(dataNavigationPath, 'utf8');
    expect(source).toContain('pendingDataNavigation');
    expect(source).toContain("target.kind === 'task'");
    expect(source).toContain("target.kind === 'input_table'");
  });

  it('keeps output table preview mapped to output-table copy', () => {
    const dataView = fs.readFileSync(dataViewPagePath, 'utf8');
    const previewDialog = fs.readFileSync(inputTablePreviewDialogPath, 'utf8');
    expect(dataView).toContain("tableKind={preview.storedPreviewTarget?.kind ?? 'input'}");
    expect(previewDialog).toContain("t('data.outputTables.previewTitle')");
    expect(previewDialog).toContain("t('data.outputTables.previewEmpty')");
  });

  it('exposes direct resource lookup IPC methods with input schemas', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValue(null);
    const api = createDataApi();

    await api.getTask('task_1');
    await api.getInputTable('ds_1');
    await api.getOutputTable('out_1');

    expect(invoke).toHaveBeenCalledWith('data.getTask', 'task_1');
    expect(invoke).toHaveBeenCalledWith('data.getInputTable', 'ds_1');
    expect(invoke).toHaveBeenCalledWith('data.getOutputTable', 'out_1');

    // Every lookup channel must carry a positional input schema so main-side
    // handlers validate IPC arguments.
    for (const channel of ['data.getTask', 'data.getInputTable', 'data.getOutputTable']) {
      expect(IPC_INPUT_SCHEMAS[channel]).toBeDefined();
    }
  });
});
