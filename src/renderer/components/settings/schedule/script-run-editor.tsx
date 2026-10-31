import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileSearch, FolderOpen, PencilLine, Play } from 'lucide-react';
import type { AutomationActionNode, DataRawTable } from '../../../types';
import {
  DEFAULT_SCRIPT_TIMEOUT_MS,
  SCRIPT_TIMEOUT_OPTIONS_MS,
  type ScriptPackageSummary,
  type ScriptTestRunResult,
} from '../../../../shared/automation/script-package';
import { FlushSelect, FormRow } from './editor-controls';
import { useAppStore } from '../../../store';
import { formatDateTime } from '../../data-view/shared';
import { SCRIPT_SOURCE_KEYS } from '../../scripts/labels';

const CREATE_TABLE = '__create__';
const NEW_PACKAGE = '__new_package__';

function timeoutLabel(ms: number, t: (key: string, options?: Record<string, unknown>) => string) {
  return ms < 60_000
    ? t('schedule.script.seconds', { count: Math.round(ms / 1000) })
    : t('schedule.script.minutes', { count: Math.round(ms / 60_000) });
}

export function ScriptRunEditor({
  node,
  rawTables,
  onChange,
}: {
  node: AutomationActionNode;
  rawTables: DataRawTable[];
  onChange: (node: AutomationActionNode) => void;
}) {
  const { t } = useTranslation();
  const config = node.config;
  const update = (patch: Record<string, unknown>) =>
    onChange({ ...node, config: { ...config, ...patch } });
  // 新建脚本包 binds the package to this node when the editor creates it (latest node/onChange).
  const latest = useRef({ node, onChange });
  latest.current = { node, onChange };
  const packageId = String(config.packageId ?? '');
  const timeoutMs = Number(config.timeoutMs) || DEFAULT_SCRIPT_TIMEOUT_MS;
  const rawTableId = String(config.rawTableId ?? '');
  const [packages, setPackages] = useState<ScriptPackageSummary[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<ScriptTestRunResult | null>(null);
  const openScriptEditor = useAppStore((state) => state.openScriptEditor);
  const scriptEditorOpen = useAppStore((state) => state.scriptEditor !== null);

  const refresh = useCallback(async () => {
    try {
      setPackages(await window.electronAPI.automation.scripts.list());
    } catch {
      setPackages([]);
    }
  }, []);
  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);
  useEffect(() => setTest(null), [packageId]);
  // Coming back from the editor page: pick up new versions.
  useEffect(() => {
    if (!scriptEditorOpen) void refresh();
  }, [scriptEditorOpen, refresh]);

  const selected = packages?.find((item) => item.id === packageId);
  const packageOptions: Array<{ value: string; label: string; hint?: string }> = (
    packages ?? []
  ).map((item) => ({
    value: item.id,
    label: item.name,
    hint: item.published
      ? t('schedule.script.optionVersion', { version: item.published.version })
      : t('schedule.script.noPublished'),
  }));
  if (packageId && !selected) packageOptions.push({ value: packageId, label: packageId });
  packageOptions.push({ value: NEW_PACKAGE, label: `＋ ${t('schedule.script.newPackage')}` });

  const timeoutOptions = SCRIPT_TIMEOUT_OPTIONS_MS.includes(timeoutMs)
    ? SCRIPT_TIMEOUT_OPTIONS_MS
    : [...SCRIPT_TIMEOUT_OPTIONS_MS, timeoutMs].sort((a, b) => a - b);

  const tableOptions = [
    {
      value: CREATE_TABLE,
      label: t('schedule.script.createTable', {
        name: selected?.name ?? t('schedule.script.package'),
      }),
    },
    ...rawTables.map((table) => ({
      value: table.id,
      label: t('schedule.script.rawTableOption', { name: table.name }),
    })),
  ];
  if (rawTableId && !rawTables.some((table) => table.id === rawTableId)) {
    tableOptions.push({
      value: rawTableId,
      label: t('schedule.script.rawTableOption', {
        name: String(config.rawTableName ?? rawTableId),
      }),
    });
  }

  const runTest = async () => {
    if (!packageId || testing) return;
    setTesting(true);
    setTest(null);
    try {
      setTest(
        await window.electronAPI.automation.scripts.testRun(packageId, timeoutMs, 'published')
      );
    } catch (error) {
      setTest({
        ok: false,
        durationMs: 0,
        installedDeps: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
      void refresh();
    }
  };

  const status = (() => {
    if (testing) return { text: t('schedule.script.testing'), error: false };
    if (test?.ok)
      return { text: t('schedule.script.testOk', { count: test.rows ?? 0 }), error: false };
    if (test && !test.ok) return { text: test.error ?? '', error: true };
    if (!selected) return null;
    if (selected.invalid) return { text: selected.invalid, error: true };
    const parts = [
      selected.depsReady ? t('schedule.script.depsReady') : t('schedule.script.depsOnFirstRun'),
    ];
    if (selected.lastSuccess)
      parts.push(t('schedule.script.lastSuccess', { count: selected.lastSuccess.rows }));
    return { text: parts.join(' · '), error: false };
  })();

  const entryText = selected
    ? selected.invalid
      ? '—'
      : [
          selected.entry,
          selected.runtimeVersion ?? (selected.runtime === 'node' ? 'Node' : 'Python'),
        ]
          .filter(Boolean)
          .join(' · ')
    : '—';

  return (
    <div data-testid="script-run-editor">
      <FormRow label={t('schedule.script.package')}>
        <div className="ui-flush-split flex min-h-[35px] flex-1 items-stretch">
          <FlushSelect
            ariaLabel={t('schedule.script.package')}
            value={packageId}
            placeholder={
              packages && packages.length === 0
                ? t('schedule.script.noPackages')
                : t('schedule.script.selectPackage')
            }
            options={packageOptions}
            onChange={(value) => {
              if (value === NEW_PACKAGE) {
                openScriptEditor({
                  step: 'rules',
                  onCreated: (createdId) => {
                    const { node: current, onChange: apply } = latest.current;
                    apply({ ...current, config: { ...current.config, packageId: createdId } });
                    void refresh();
                  },
                });
                return;
              }
              update({ packageId: value });
            }}
          />
          <button
            type="button"
            className="ui-accent-cell w-[28.5714%] flex-shrink-0 border-l border-border-subtle"
            disabled={!packageId}
            onClick={() => void window.electronAPI.automation.scripts.open(packageId)}
          >
            <FolderOpen size={13} />
            {t('schedule.script.open')}
          </button>
        </div>
      </FormRow>
      <FormRow label={t('schedule.script.version')}>
        <div className="ui-flush-split flex min-h-[35px] flex-1 items-stretch">
          <span
            className="ui-flush-text min-w-0 flex-1 truncate text-text-muted"
            data-testid="script-version-text"
          >
            {selected ? (
              <>
                {selected.published
                  ? t('schedule.script.versionPublished', {
                      version: selected.published.version,
                      time: formatDateTime(
                        selected.published.publishedAt ?? selected.published.updatedAt
                      ).replace(/^\d{4}-/, ''),
                    })
                  : t('schedule.script.noPublished')}
                {selected.draft ? (
                  <span className="text-warning">
                    {' · '}
                    {t('schedule.script.draftPending', {
                      version: selected.draft.version,
                      source: t(SCRIPT_SOURCE_KEYS[selected.draft.source]),
                    })}
                  </span>
                ) : null}
              </>
            ) : (
              '—'
            )}
          </span>
          <button
            type="button"
            className="ui-accent-cell w-[28.5714%] flex-shrink-0 border-l border-border-subtle"
            disabled={!selected}
            data-testid="script-edit-cell"
            onClick={() =>
              selected?.draft
                ? openScriptEditor({
                    packageId,
                    version: selected.draft.version,
                    step: 'review',
                  })
                : openScriptEditor({ packageId, step: 'rules' })
            }
          >
            {selected?.draft ? <FileSearch size={13} /> : <PencilLine size={13} />}
            {selected?.draft ? t('schedule.script.viewDraft') : t('schedule.script.editScript')}
          </button>
        </div>
      </FormRow>
      <FormRow label={t('schedule.script.entry')}>
        <span className="ui-flush-text">{entryText}</span>
      </FormRow>
      <FormRow label={t('schedule.script.timeout')}>
        <FlushSelect
          ariaLabel={t('schedule.script.timeout')}
          value={String(timeoutMs)}
          placeholder={t('schedule.script.timeout')}
          options={timeoutOptions.map((ms) => ({ value: String(ms), label: timeoutLabel(ms, t) }))}
          onChange={(value) => value && update({ timeoutMs: Number(value) })}
        />
      </FormRow>
      <FormRow label={t('schedule.script.output')}>
        <FlushSelect
          ariaLabel={t('schedule.script.output')}
          value={rawTableId || CREATE_TABLE}
          placeholder={t('schedule.rawTablePlaceholder')}
          options={tableOptions}
          onChange={(value) => {
            if (!value) return;
            const table = rawTables.find((item) => item.id === value);
            update(
              value === CREATE_TABLE
                ? { rawTableId: undefined, rawTableName: undefined }
                : { rawTableId: value, rawTableName: table?.name }
            );
          }}
        />
      </FormRow>
      <FormRow label={t('schedule.script.onError')}>
        <FlushSelect
          ariaLabel={t('schedule.script.onError')}
          value={config.onScriptError === 'ai_repair' ? 'ai_repair' : 'notify'}
          placeholder={t('schedule.script.onError')}
          options={[
            { value: 'notify', label: t('schedule.script.notify') },
            { value: 'ai_repair', label: t('schedule.script.aiRepair') },
          ]}
          onChange={(value) => value && update({ onScriptError: value })}
        />
      </FormRow>
      <FormRow label={t('schedule.script.testRun')}>
        <button
          type="button"
          className="ui-flush-control flex items-center gap-1.5 text-left text-[12.5px] font-medium text-accent-text disabled:opacity-50"
          disabled={!packageId || testing}
          onClick={() => void runTest()}
        >
          <Play size={13} />
          {t('schedule.script.testRun')}
          {status && (
            <span
              className={`ml-auto min-w-0 truncate whitespace-nowrap pl-3 text-[12px] font-normal ${
                status.error ? 'text-error' : 'text-text-muted'
              }`}
              title={status.text}
            >
              {status.text}
            </span>
          )}
        </button>
      </FormRow>
    </div>
  );
}
