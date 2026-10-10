import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const editorSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'src/renderer/components/data-view/data-pipelines/workflow/PipelineEditor.tsx'
  ),
  'utf8'
);
const canvasSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'src/renderer/components/data-view/data-pipelines/workflow/WorkflowCanvas.tsx'
  ),
  'utf8'
);
const inspectorSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'src/renderer/components/data-view/data-pipelines/workflow/WorkflowInspector.tsx'
  ),
  'utf8'
);
const zhLocale = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'src/shared/i18n/locales/zh.json'), 'utf8')
);
const enLocale = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'src/shared/i18n/locales/en.json'), 'utf8')
);

describe('workflow editor toolbar', () => {
  it('disables the save button until the workflow has unsaved changes', () => {
    expect(editorSource).toContain('isWorkflowDirty');
    expect(editorSource).toContain('disabled={isBusy || !workflow || !isWorkflowDirty}');
  });

  it('keeps the selection actions always visible without a collapse toggle', () => {
    expect(canvasSource).not.toContain('toolbarCollapsed');
    expect(canvasSource).not.toContain('expandCanvasToolbar');
    expect(canvasSource).not.toContain('collapseCanvasToolbar');
    expect(canvasSource).not.toContain('ChevronDown');
    expect(canvasSource).toContain("t('data.workflow.copySelected')");
    expect(canvasSource).toContain("t('data.workflow.disableSelected')");
    expect(canvasSource).toContain("t('data.workflow.deleteSelected')");
  });

  it('drops the unused collapse/expand toolbar locale keys', () => {
    expect(zhLocale.data.workflow.collapseCanvasToolbar).toBeUndefined();
    expect(zhLocale.data.workflow.expandCanvasToolbar).toBeUndefined();
    expect(enLocale.data.workflow.collapseCanvasToolbar).toBeUndefined();
    expect(enLocale.data.workflow.expandCanvasToolbar).toBeUndefined();
  });

  it('does not render a dead close icon after the inspector tab bar', () => {
    expect(inspectorSource).not.toContain('<X ');
  });
});
