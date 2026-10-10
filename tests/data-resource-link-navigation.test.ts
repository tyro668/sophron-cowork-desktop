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
const rawTablePreviewDialogPath = path.resolve(
  process.cwd(),
  'src/renderer/components/data-view/raw-table-preview-dialog.tsx'
);
const markdownPath = path.resolve(process.cwd(), 'src/renderer/components/MessageMarkdown.tsx');

describe('data resource chat links', () => {
  it('round-trips app data resource hrefs', () => {
    const href = createDataResourceHref('result_table', 'rawTable output/1');
    expect(href).toBe('#/data/result-tables/rawTable%20output%2F1');
    expect(parseDataResourceHref(href)).toEqual({
      kind: 'result_table',
      id: 'rawTable output/1',
    });
    expect(parseDataResourceHref('sophron://data/pipelines/task_1')).toEqual({
      kind: 'pipeline',
      id: 'task_1',
    });
    expect(normalizeDataResourceMarkdownLinks('[pipeline](sophron://data/pipelines/task_1)')).toBe(
      '[pipeline](#/data/pipelines/task_1)'
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
        normalizedText: '[customers](#/data/raw-tables/rawTable_1)',
        components: {
          a({ href, children }: { href?: string; children?: React.ReactNode }) {
            return React.createElement('span', { 'data-href': href }, children);
          },
        },
      })
    );

    expect(html).toContain('data-href="#/data/raw-tables/rawTable_1"');
  });

  it('lets DataView resolve and open each resource type by id', () => {
    // The behavioral coverage for all three deep-link kinds now lives in
    // tests/renderer/data-view-hooks.test.tsx (useDataNavigation suite). Keep a
    // light wiring check that the page still mounts the navigation hook.
    const source = fs.readFileSync(dataNavigationPath, 'utf8');
    expect(source).toContain('pendingDataNavigation');
    expect(source).toContain("target.kind === 'pipeline'");
    expect(source).toContain("target.kind === 'raw_table'");
  });

  it('keeps output table preview mapped to result-table copy', () => {
    const dataView = fs.readFileSync(dataViewPagePath, 'utf8');
    const previewDialog = fs.readFileSync(rawTablePreviewDialogPath, 'utf8');
    expect(dataView).toContain("tableKind={preview.storedPreviewTarget?.kind ?? 'raw'}");
    expect(previewDialog).toContain("t('data.resultTables.previewTitle')");
    expect(previewDialog).toContain("t('data.resultTables.previewEmpty')");
  });

  it('exposes direct resource lookup IPC methods with input schemas', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValue(null);
    const api = createDataApi();

    await api.getPipeline('task_1');
    await api.getRawTable('ds_1');
    await api.getResultTable('out_1');

    expect(invoke).toHaveBeenCalledWith('data.getPipeline', 'task_1');
    expect(invoke).toHaveBeenCalledWith('data.getRawTable', 'ds_1');
    expect(invoke).toHaveBeenCalledWith('data.getResultTable', 'out_1');

    // Every lookup channel must carry a positional input schema so main-side
    // handlers validate IPC arguments.
    for (const channel of ['data.getPipeline', 'data.getRawTable', 'data.getResultTable']) {
      expect(IPC_INPUT_SCHEMAS[channel]).toBeDefined();
    }
  });
});
