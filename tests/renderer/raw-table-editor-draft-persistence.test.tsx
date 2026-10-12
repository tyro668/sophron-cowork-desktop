// @vitest-environment happy-dom
/**
 * Input-table workbench draft persistence: a customize draft must survive a
 * failed save. The parent hook reloads rawTables on update errors, which used
 * to feed a new-but-identical inputConfig object into the workbench and reset
 * local state back to the auto strategy — losing the unpublished draft.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './i18n-test';
import { ConfirmDialogProvider } from '../../src/renderer/components/ConfirmDialog';
import { RawTableEditorWorkbench } from '../../src/renderer/components/data-view/raw-table-editor-workbench';
import type {
  DataRawTable,
  DataRawTableConfig,
  DataRawTableNormalizerArtifactVersion,
} from '../../src/renderer/types';

const AUTO_CONFIG: DataRawTableConfig = {
  sourceKind: 'excel',
  sheetName: 'Sheet1',
  sheetNames: ['Sheet1'],
  headerMode: 'auto',
  headerRow: 1,
  dataProcessing: { strategy: 'auto' },
};

const DRAFT_VERSION: DataRawTableNormalizerArtifactVersion = {
  id: 'ver_1',
  artifactId: 'art_1',
  version: 1,
  status: 'draft',
  files: [{ path: 'main.py', content: 'print(1)\n' }],
  fileTreeHash: 'hash_1',
  rulePrompt: 'keep paid rows',
  entrypoint: { command: ['python', 'main.py'] },
  runtime: { language: 'python', environment: 'system' },
  dependencies: [],
  createdAt: 1,
  updatedAt: 1,
};

const CUSTOMIZE_DRAFT_PROCESSING: DataRawTableConfig['dataProcessing'] = {
  strategy: 'customize',
  rulePrompt: 'keep paid rows',
  artifactId: 'art_1',
  artifactVersionId: 'ver_1',
  artifactVersionStatus: 'draft',
  fileTreeHash: 'hash_1',
  runtime: { language: 'python', environment: 'system' },
  entrypoint: { command: ['python', 'main.py'] },
  projectFiles: [{ path: 'main.py', content: 'print(1)\n' }],
};

function makeRawTable(inputConfig: DataRawTableConfig): DataRawTable {
  return {
    id: 'ds_1',
    name: 'Orders',
    groupId: null,
    sourcePath: '/tmp/orders.xlsx',
    sourceKind: 'excel',
    inputConfig,
    fileCount: 1,
    relatedPipelineNames: [],
    tableName: 'in_orders',
    rowCount: 10,
    columnCount: 3,
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderWorkbench(options: {
  rawTable: DataRawTable;
  onUpdateRawTableConfig?: ReturnType<typeof vi.fn>;
  versions?: DataRawTableNormalizerArtifactVersion[];
  publish?: ReturnType<typeof vi.fn>;
}) {
  const listRawTableNormalizerVersions = vi.fn(async () => ({
    versions: options.versions ?? [],
  }));
  (window as { electronAPI?: unknown }).electronAPI = {
    data: {
      previewRawTable: vi.fn(),
      listRawTableNormalizerVersions,
      publishRawTableNormalizerVersion:
        options.publish ?? vi.fn(async () => ({ artifact: {}, version: {} })),
      deleteRawTableNormalizerVersion: vi.fn(async () => undefined),
      previewRawTableNormalizerVersion: vi.fn(),
      onRawTableNormalizerDraftProgress: vi.fn(() => () => undefined),
    },
    skills: { getAll: async () => [] },
    automation: { list: async () => [] },
  };
  const workbench = (rawTable: DataRawTable, onUpdateRawTableConfig?: unknown) => (
    <ConfirmDialogProvider>
      <RawTableEditorWorkbench
        rawTable={rawTable}
        isBusy={false}
        onBack={vi.fn()}
        onRenameRawTable={vi.fn()}
        onChooseRawTableSource={vi.fn()}
        onUpdateRawTableConfig={(onUpdateRawTableConfig ?? options.onUpdateRawTableConfig) as never}
        onSyncCloudSource={vi.fn()}
      />
    </ConfirmDialogProvider>
  );
  return { render: () => render(workbench(options.rawTable)), workbench };
}

function findStrategySelect(): HTMLElement {
  const trigger = screen
    .getAllByRole('combobox')
    .find((el) => el.textContent === 'Auto' || el.textContent === 'Custom');
  if (!trigger) throw new Error('strategy select not found');
  return trigger;
}

async function chooseStrategy(label: 'Auto' | 'Custom') {
  fireEvent.keyDown(findStrategySelect(), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: label }));
  await waitFor(() => expect(findStrategySelect().textContent).toBe(label));
}

function promptTextarea(): HTMLTextAreaElement {
  const textarea = document.querySelector('textarea');
  if (!textarea) throw new Error('rule prompt textarea not found');
  return textarea;
}

describe('RawTableEditorWorkbench custom draft persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps in-progress custom edits when a refetched config is equal by content', async () => {
    const rawTable = makeRawTable(AUTO_CONFIG);
    const { render, workbench } = renderWorkbench({ rawTable });
    const { rerender } = render();

    await chooseStrategy('Custom');
    fireEvent.change(promptTextarea(), { target: { value: 'keep only paid rows' } });
    expect(promptTextarea().value).toBe('keep only paid rows');

    // The failed-save path reloads rawTables — a fresh object with identical
    // persisted content must not reset the editor.
    rerender(
      workbench({
        ...rawTable,
        inputConfig: JSON.parse(JSON.stringify(rawTable.inputConfig)),
      })
    );

    expect(findStrategySelect().textContent).toBe('Custom');
    expect(promptTextarea().value).toBe('keep only paid rows');
  });

  it('restores the custom config after toggling back to Auto and back', async () => {
    renderWorkbench({ rawTable: makeRawTable(AUTO_CONFIG) }).render();

    await chooseStrategy('Custom');
    fireEvent.change(promptTextarea(), { target: { value: 'dedupe by id' } });

    await chooseStrategy('Auto');
    expect(document.querySelector('textarea')).toBeNull();

    await chooseStrategy('Custom');
    expect(promptTextarea().value).toBe('dedupe by id');
  });

  it('rejects save for an unpublished draft, keeps the draft, and publishing unlocks save', async () => {
    const publish = vi.fn(async () => ({
      artifact: {
        id: 'art_1',
        name: 'Orders normalizer',
        sourceKind: 'excel',
        primaryLanguage: 'python',
        activeVersionId: 'ver_1',
        createdAt: 1,
        updatedAt: 1,
      },
      version: { ...DRAFT_VERSION, status: 'published', publishedAt: 2 },
    }));
    const onUpdateRawTableConfig = vi.fn();
    const rawTable = makeRawTable({
      ...AUTO_CONFIG,
      dataProcessing: CUSTOMIZE_DRAFT_PROCESSING,
    });
    renderWorkbench({
      rawTable,
      onUpdateRawTableConfig,
      versions: [DRAFT_VERSION],
      publish,
    }).render();

    // A persisted artifact lands on the review step — go back to step 1 to
    // edit the rule prompt.
    fireEvent.click(screen.getByRole('button', { name: '1 Describe rules' }));

    // Make the config dirty so Save is enabled.
    fireEvent.change(promptTextarea(), {
      target: { value: 'keep paid rows, drop test data' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // No doomed IPC round-trip; the draft stays put and the hint points to
    // publishing — the versions tab becomes active.
    expect(onUpdateRawTableConfig).not.toHaveBeenCalled();
    expect(await screen.findByText(/not published yet/)).toBeTruthy();
    const publishButton = await screen.findByRole('button', { name: 'Publish' });
    expect(findStrategySelect().textContent).toBe('Custom');

    fireEvent.click(publishButton);
    await waitFor(() => expect(publish).toHaveBeenCalledWith({ versionId: 'ver_1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onUpdateRawTableConfig).toHaveBeenCalledTimes(1));
    const savedConfig = onUpdateRawTableConfig.mock.calls[0][1] as DataRawTableConfig;
    expect(savedConfig.dataProcessing).toMatchObject({
      strategy: 'customize',
      artifactVersionStatus: 'published',
      artifactVersionId: 'ver_1',
    });
  });
});
