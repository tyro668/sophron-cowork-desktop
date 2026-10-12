import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Plus, Settings, Unlink } from 'lucide-react';
import type { Automation, DataResultTable, DataRawTable } from '../../types';
import { dataClient } from '../../features/data/api/data-client';
import { useAppStore } from '../../store';
import type { PendingCloudInputSource } from '../../store';
import type { DataResourceTarget } from '../../../shared/data-resource-link';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { RawTableSelect, getCloudMirror } from './shared';
import { relinkLinearGraph } from '../settings/schedule/model';

export function ResultTableAutomations({
  resultTable,
  embedded,
  onNavigateAway,
  Row,
}: {
  resultTable: DataResultTable;
  embedded?: boolean;
  onNavigateAway?: () => void;
  Row?: AutomationConfigRow;
}) {
  return (
    <TableAutomations
      table={resultTable}
      kind="result"
      embedded={embedded}
      onNavigateAway={onNavigateAway}
      Row={Row}
    />
  );
}
export function RawTableAutomations({
  rawTable,
  embedded,
  onNavigateAway,
  Row,
}: {
  rawTable: DataRawTable;
  embedded?: boolean;
  onNavigateAway?: () => void;
  Row?: AutomationConfigRow;
}) {
  // Carry the stored cloud source so a scheduled sync reuses the same cloud
  // table instead of asking the user to locate it again.
  const mirror = getCloudMirror(rawTable);
  const cloudSource: PendingCloudInputSource | undefined = mirror
    ? {
        spaceId: mirror.spaceId ?? '',
        projectId: mirror.projectId ?? '',
        tableId: mirror.tableId,
        tableKind: mirror.tableKind ?? 'analysis',
        tableName: mirror.tableName,
        spaceName: mirror.spaceName,
        projectName: mirror.projectName,
      }
    : undefined;
  return (
    <TableAutomations
      table={rawTable}
      kind="raw"
      embedded={embedded}
      cloudSource={cloudSource}
      onNavigateAway={onNavigateAway}
      Row={Row}
    />
  );
}
interface AutomationConfigRowProps {
  label: ReactNode;
  children: ReactNode;
}
type AutomationConfigRow = (props: AutomationConfigRowProps) => ReactNode;

function TableAutomations({
  table,
  kind,
  embedded,
  cloudSource,
  onNavigateAway,
  Row,
}: {
  table: { id: string; name: string };
  kind: 'raw' | 'result';
  embedded?: boolean;
  cloudSource?: PendingCloudInputSource;
  onNavigateAway?: () => void;
  /** Label+content row renderer for embedded mode (matches each form's grid). */
  Row?: AutomationConfigRow;
}) {
  const { t } = useTranslation();
  const mainView = useAppStore((state) => state.mainView);
  const navigate = useAppStore((state) => state.navigateToTableAutomation);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const result = await dataClient.listAutomations();
    setAutomations(result?.automations ?? []);
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.resolve()
      .then(() => dataClient.listAutomations())
      .then((result) => {
        if (active) setAutomations(result?.automations ?? []);
      })
      .catch((error) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mainView]);
  const execute = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const referencesTable = (automation: Automation) =>
    automation.actionGraph.nodes.some(
      (node) =>
        node.type === 'cloud.sync' &&
        node.config.direction === (kind === 'raw' ? 'input' : 'output') &&
        node.config[kind === 'raw' ? 'rawTableId' : 'resultTableId'] === table.id
    );
  const linked = automations.filter(
    (a) =>
      referencesTable(a) ||
      (kind === 'result' && a.outputBindings?.some((b) => b.resultTableId === table.id))
  );
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (linked.length > 0) setEnabled(true);
  }, [linked.length]);
  // Echo the linked automation in the dropdown — after linking (or returning
  // from the automation editor) the select should show the link, not the placeholder.
  const firstLinkedId = linked[0]?.id;
  useEffect(() => {
    if (!selectedId && firstLinkedId) setSelectedId(firstLinkedId);
  }, [firstLinkedId, selectedId]);
  // Linked automations always show their controls — an active link must stay
  // visible. The switch only expands configuration for tables without links.
  const hasLinks = linked.length > 0;
  const effectiveEnabled = enabled || hasLinks;
  const returnTarget: DataResourceTarget = {
    kind: kind === 'raw' ? 'raw_table' : 'result_table',
    id: table.id,
  };
  const navigation = kind === 'raw' ? { rawTable: table, cloudSource } : { resultTable: table };
  // The automations UI often lives inside a portaled dialog — close it before
  // switching views or it stays on top of the automation editor.
  const navigateAndClose = (target: Parameters<typeof navigate>[0]) => {
    onNavigateAway?.();
    navigate({ ...target, returnTarget });
  };
  const bind = async (automationId: string, runOnChange: boolean | null) => {
    // Read current associations so editing another output does not lose its links.
    const current = await dataClient.getAutomation(automationId);
    if (!current) throw new Error(t('data.resultTables.automation.missing'));
    const bindings = (current.outputBindings ?? []).filter((b) => b.resultTableId !== table.id);
    if (runOnChange !== null) bindings.push({ resultTableId: table.id, runOnChange });
    const saved = await dataClient.updateAutomation(automationId, { outputBindings: bindings });
    if (!saved) throw new Error(t('data.resultTables.automation.missing'));
  };
  // Graph links live in the action graph — unlink removes the cloud.sync node
  // pointing at this table, not just an outputBindings entry.
  const unlinkNode = async (automationId: string) => {
    const current = await dataClient.getAutomation(automationId);
    if (!current) throw new Error(t('data.resultTables.automation.missing'));
    const nodes = current.actionGraph.nodes.filter(
      (node) =>
        !(
          node.type === 'cloud.sync' &&
          node.config.direction === (kind === 'raw' ? 'input' : 'output') &&
          node.config[kind === 'raw' ? 'rawTableId' : 'resultTableId'] === table.id
        )
    );
    const saved = await dataClient.updateAutomation(automationId, {
      actionGraph: relinkLinearGraph({ ...current.actionGraph, nodes }),
    });
    if (!saved) throw new Error(t('data.resultTables.automation.missing'));
  };
  // The trigger strategy for a raw-table link lives on the cloud.sync input
  // node — update the flag inside the automation's action graph.
  const setNodeRunOnChange = async (automationId: string, runOnChange: boolean) => {
    const current = await dataClient.getAutomation(automationId);
    if (!current) throw new Error(t('data.resultTables.automation.missing'));
    const nodes = current.actionGraph.nodes.map((node) =>
      node.type === 'cloud.sync' &&
      node.config.direction === 'input' &&
      node.config.rawTableId === table.id
        ? { ...node, config: { ...node.config, runOnChange } }
        : node
    );
    const saved = await dataClient.updateAutomation(automationId, {
      actionGraph: { ...current.actionGraph, nodes },
    });
    if (!saved) throw new Error(t('data.resultTables.automation.missing'));
  };
  const applyTableStrategy = async (value: 'automation' | 'change') => {
    const runOnChange = value === 'change';
    for (const automation of linked) {
      if (kind === 'raw') await setNodeRunOnChange(automation.id, runOnChange);
      else await bind(automation.id, runOnChange);
    }
  };
  const selectedAutomation = automations.find((a) => a.id === selectedId);
  const selectedLinked = Boolean(selectedAutomation && linked.includes(selectedAutomation));
  // The trigger strategy is table-wide: it applies to every linked automation.
  const linkedRunOnChange = (a: Automation): boolean =>
    kind === 'raw'
      ? a.actionGraph.nodes.some(
          (node) =>
            node.type === 'cloud.sync' &&
            node.config.direction === 'input' &&
            node.config.rawTableId === table.id &&
            node.config.runOnChange === true
        )
      : Boolean(a.outputBindings?.some((b) => b.resultTableId === table.id && b.runOnChange));
  const tableStrategy: 'automation' | 'change' =
    linked.length > 0 && linked.every(linkedRunOnChange) ? 'change' : 'automation';
  const selectedRunning = selectedAutomation?.status === 'running';
  const runSelected = () => {
    if (!selectedId) return;
    void execute(async () => {
      const run = await dataClient.runAutomation(selectedId);
      if (!run) throw new Error(t('data.resultTables.automation.missing'));
      if (run.status === 'failed') throw new Error(run.error || t('schedule.runFailed'));
    });
  };
  const switchBlock = (
    <div className="flex items-center gap-2">
      <span
        title={hasLinks ? t('data.resultTables.automation.locked') : undefined}
        className="inline-flex"
      >
        <Switch
          checked={effectiveEnabled}
          onCheckedChange={setEnabled}
          disabled={busy || hasLinks}
          aria-label={t('data.resultTables.automation.title')}
        />
      </span>
      <span className="text-[13px] text-text-secondary">
        {effectiveEnabled
          ? t('data.resultTables.automation.enabled')
          : t('data.resultTables.automation.disabled')}
      </span>
      {hasLinks ? (
        <span className="text-xs text-text-muted">{t('data.resultTables.automation.locked')}</span>
      ) : null}
    </div>
  );
  const controlsBlock = effectiveEnabled ? (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <RawTableSelect
            value={selectedId}
            disabled={busy}
            options={[
              { value: '', label: t('data.resultTables.automation.select') },
              ...automations.map((a) => ({
                value: a.id,
                label: linked.includes(a)
                  ? `${a.name} · ${t('data.resultTables.automation.linked')}`
                  : a.name,
              })),
            ]}
            onChange={setSelectedId}
          />
        </div>
        <Button
          size="md"
          variant="ghost"
          className="px-2"
          title={t('data.resultTables.automation.run')}
          aria-label={t('data.resultTables.automation.run')}
          disabled={busy || !selectedId || selectedRunning}
          onClick={runSelected}
        >
          <Play className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="md"
          variant="ghost"
          className="px-2"
          title={t('data.resultTables.automation.edit')}
          aria-label={t('data.resultTables.automation.edit')}
          disabled={busy || !selectedId}
          onClick={() => navigateAndClose({ automationId: selectedId })}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="md"
          disabled={loading || busy || !selectedId}
          onClick={() => {
            if (!selectedId) return;
            if (selectedLinked && selectedAutomation) {
              void execute(() =>
                referencesTable(selectedAutomation)
                  ? unlinkNode(selectedId)
                  : bind(selectedId, null)
              );
            } else if (kind === 'raw') {
              navigateAndClose({
                automationId: selectedId,
                rawTable: table,
                cloudSource,
              });
            } else {
              void execute(() => bind(selectedId, tableStrategy === 'change'));
            }
          }}
        >
          {selectedLinked ? <Unlink className="h-3.5 w-3.5" /> : null}
          {selectedLinked
            ? t('data.resultTables.automation.unlink')
            : t('data.resultTables.automation.link')}
        </Button>
      </div>
      <Button
        size="md"
        variant="secondary"
        className="w-full justify-center border-dashed"
        title={t('data.resultTables.automation.create')}
        disabled={busy}
        onClick={() => navigateAndClose(navigation)}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
      {selectedAutomation?.lastError && (
        <p className="text-xs text-error">
          {t(selectedAutomation.lastError, { defaultValue: selectedAutomation.lastError })}
        </p>
      )}
      {loading && <p className="text-xs text-text-muted">{t('common.loading')}</p>}
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  ) : null;
  // Table-wide trigger strategy — its own config row right below the
  // automation info row, applied to every linked automation at once.
  const strategySelect = effectiveEnabled ? (
    <div className="w-44">
      <RawTableSelect
        value={tableStrategy}
        disabled={busy || linked.length === 0}
        options={[
          {
            value: 'automation',
            label: t('data.resultTables.automation.triggerByAutomation'),
          },
          {
            value: 'change',
            label: t('data.resultTables.automation.triggerOnChange'),
          },
        ]}
        onChange={(value) =>
          void execute(() => applyTableStrategy(value as 'automation' | 'change'))
        }
      />
    </div>
  ) : null;
  const strategyLabel = t('data.resultTables.automation.triggerMode');
  const strategyRow = strategySelect ? (
    Row ? (
      <Row label={strategyLabel}>{strategySelect}</Row>
    ) : (
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary">{strategyLabel}</span>
        {strategySelect}
      </div>
    )
  ) : null;
  if (embedded) {
    const title = t('data.resultTables.automation.title');
    const info = t('data.resultTables.automation.info');
    return (
      <>
        {Row ? <Row label={title}>{switchBlock}</Row> : switchBlock}
        {controlsBlock ? Row ? <Row label={info}>{controlsBlock}</Row> : controlsBlock : null}
        {strategyRow}
      </>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-text-primary">
          {t('data.resultTables.automation.title')}
        </h3>
      </div>
      {switchBlock}
      {controlsBlock}
      {strategyRow}
    </div>
  );
}
