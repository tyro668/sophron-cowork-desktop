import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Plus, Settings, Unlink } from 'lucide-react';
import type { Automation, DataResultTable, DataRawTable } from '../../types';
import { dataClient } from '../../features/data/api/data-client';
import { useAppStore } from '../../store';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { RawTableSelect, formatDateTime } from './shared';

export function ResultTableAutomations({
  resultTable,
  embedded,
}: {
  resultTable: DataResultTable;
  embedded?: boolean;
}) {
  return <TableAutomations table={resultTable} kind="result" embedded={embedded} />;
}
export function RawTableAutomations({ rawTable }: { rawTable: DataRawTable }) {
  return <TableAutomations table={rawTable} kind="raw" />;
}
function TableAutomations({
  table,
  kind,
  embedded,
}: {
  table: { id: string; name: string };
  kind: 'raw' | 'result';
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const mainView = useAppStore((state) => state.mainView);
  const navigate = useAppStore((state) => state.navigateToTableAutomation);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(
    async () => setAutomations((await dataClient.listAutomations()).automations),
    []
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    void dataClient
      .listAutomations()
      .then((result) => {
        if (active) setAutomations(result.automations);
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
  const navigation = kind === 'raw' ? { rawTable: table } : { resultTable: table };
  const available = automations.filter((a) => !linked.includes(a));
  const bind = async (automationId: string, runOnChange: boolean | null) => {
    // Read current associations so editing another output does not lose its links.
    const current = await dataClient.getAutomation(automationId);
    if (!current) throw new Error(t('data.resultTables.automation.missing'));
    const bindings = (current.outputBindings ?? []).filter((b) => b.resultTableId !== table.id);
    if (runOnChange !== null) bindings.push({ resultTableId: table.id, runOnChange });
    const saved = await dataClient.updateAutomation(automationId, { outputBindings: bindings });
    if (!saved) throw new Error(t('data.resultTables.automation.missing'));
    setSelectedId('');
  };
  const createButton = (size: 'sm' | 'md') => (
    <Button size={size} onClick={() => navigate(navigation)} disabled={busy}>
      <Plus size={14} />
      {t('data.resultTables.automation.create')}
    </Button>
  );
  const linkControls = (
    <>
      <div className="min-w-0 flex-1">
        <RawTableSelect
          value={selectedId}
          disabled={busy}
          options={[
            { value: '', label: t('data.resultTables.automation.select') },
            ...available.map((a) => ({ value: a.id, label: a.name })),
          ]}
          onChange={setSelectedId}
        />
      </div>
      <Button
        size="md"
        disabled={loading || busy || !selectedId}
        onClick={() =>
          kind === 'raw'
            ? navigate({ automationId: selectedId, rawTable: table })
            : void execute(() => bind(selectedId, true))
        }
      >
        {t('data.resultTables.automation.link')}
      </Button>
    </>
  );
  return (
    <div className="space-y-3">
      {embedded ? (
        <div className="flex items-center gap-2">
          {linkControls}
          {createButton('md')}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-medium text-text-primary">
              {t('data.resultTables.automation.title')}
            </h3>
            {createButton('sm')}
          </div>
          <div className="flex items-center gap-2">{linkControls}</div>
        </>
      )}
      {loading && <p className="text-xs text-text-muted">{t('common.loading')}</p>}
      {linked.map((automation) => {
        const binding = automation.outputBindings?.find((b) => b.resultTableId === table.id);
        return (
          <div key={automation.id} className="space-y-2 border-t border-border-subtle py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-text-primary">
                  {automation.name}
                </div>
                <div className="text-xs text-text-muted">
                  {t(`schedule.status.${automation.status}`)}
                  {automation.lastRunAt ? ` · ${formatDateTime(automation.lastRunAt)}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || automation.status === 'running'}
                  onClick={() =>
                    void execute(async () => {
                      const run = await dataClient.runAutomation(automation.id);
                      if (!run) throw new Error(t('data.resultTables.automation.missing'));
                      if (run.status === 'failed')
                        throw new Error(run.error || t('schedule.runFailed'));
                    })
                  }
                >
                  <Play size={13} />
                  {t('data.resultTables.automation.run')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => navigate({ automationId: automation.id })}
                >
                  <Settings size={13} />
                  {t('data.resultTables.automation.edit')}
                </Button>
                {kind === 'result' && !referencesTable(automation) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void execute(() => bind(automation.id, null))}
                  >
                    <Unlink size={13} />
                    {t('data.resultTables.automation.unlink')}
                  </Button>
                )}
              </div>
            </div>
            {kind === 'result' && (
              <label className="flex items-center gap-3 text-xs text-text-secondary">
                <Switch
                  checked={binding?.runOnChange ?? false}
                  disabled={busy}
                  onCheckedChange={(checked) => void execute(() => bind(automation.id, checked))}
                />
                {t('data.resultTables.automation.onChange')}
              </label>
            )}
            {automation.lastError && (
              <p className="text-xs text-error">
                {t(automation.lastError, { defaultValue: automation.lastError })}
              </p>
            )}
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
