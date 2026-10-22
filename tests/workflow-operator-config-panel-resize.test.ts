import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'src/renderer/components/data-view/WorkflowOperatorConfigPanel.tsx'),
  'utf8'
);
const inspectorSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'src/renderer/components/data-view/data-pipelines/workflow/WorkflowInspector.tsx'
  ),
  'utf8'
);
const modelSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'src/renderer/components/data-view/data-pipelines/workflow/workflow-model.ts'
  ),
  'utf8'
);

describe('WorkflowOperatorConfigPanel inspector tabs', () => {
  it('treats visual config, DSL, data, and logs as inspector tabs', () => {
    expect(modelSource).toContain(
      "export type WorkflowInspectorTab = 'config' | 'dsl' | 'data' | 'logs'"
    );
    expect(inspectorSource).toContain("t('data.workflow.visualConfig')");
    expect(inspectorSource).toContain("t('data.workflow.dsl')");
    expect(inspectorSource).toContain("t('data.workflow.data')");
    expect(inspectorSource).toContain("t('data.workflow.logs')");
    expect(inspectorSource).toContain("{ id: 'config', label: t('data.workflow.visualConfig') }");
    expect(inspectorSource).toContain("{ id: 'dsl', label: t('data.workflow.dsl') }");
    expect(inspectorSource).toContain("{ id: 'data', label: t('data.workflow.data') }");
    expect(inspectorSource).toContain("{ id: 'logs', label: t('data.workflow.logs') }");
  });

  it('shows the DSL tab only for operator nodes', () => {
    expect(inspectorSource).toContain(
      'const inspectorTabs: { id: WorkflowInspectorTab; label: string }[] = usesOperatorDsl'
    );
    expect(inspectorSource).toContain("if (activeTab === 'dsl' && !usesOperatorDsl)");
    expect(inspectorSource).toContain("onActiveTabChange('config')");
  });

  it('does not keep a graphical/DSL split pane in the operator panel', () => {
    expect(source).not.toContain('splitRatio');
    expect(source).not.toContain('GripHorizontal');
    expect(source).not.toContain('operator-panel-layout');
    expect(source).not.toContain('calculateOperatorPanelSplitLayout');
    expect(inspectorSource).not.toContain('operatorPanelMode');
    expect(inspectorSource).not.toContain('graphicalConfig');
    expect(inspectorSource).not.toContain('splitView');
    expect(inspectorSource).not.toContain('dslView');
  });

  it('renders visual configuration and DSL as separate panel modes', () => {
    expect(source).toContain("mode: 'form' | 'dsl'");
    expect(source).toContain("if (mode === 'form')");
    expect(source).toContain('<OperatorFormWrapper');
    expect(inspectorSource).toContain("mode={resolvedTab === 'dsl' ? 'dsl' : 'form'}");
  });

  it('keeps an editable DSL tab with copy, format, expand, and the full DSL editing dialog', () => {
    expect(source).toContain("t('data.workflow.copyDsl', 'Copy DSL')");
    expect(source).toContain("t('data.workflow.formatDsl', 'Format')");
    expect(source).toContain("t('common.expand', 'Expand')");
    expect(source).toContain('WorkflowOperatorDslDialog');
    expect(source).toContain('onChange={onDslChange}');
    expect(source).toContain('isDslDialogOpen');
  });
});
