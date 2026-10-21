import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Plus, Settings, Unlink } from 'lucide-react';
import type { Automation, DataResultTable, DataRawTable } from '../../types';
import { dataClient } from '../../features/data/api/data-client';
import { useAppStore } from '../../store';
import type { DataResourceTarget } from '../../../shared/data-resource-link';
import { Button } from '../ui/button';
import { useConfirmDialog } from '../ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';
import {
  DEFAULT_TABLE_POLICY,
  getAutomationTableBindings,
  tableBindingKey,
} from '../../../shared/automation/table-bindings';
import { RawTableSelect } from './shared';
import { relinkLinearGraph } from '../settings/schedule/model';
import { formatNextRun } from '../settings/schedule/editorPanels';

export function ResultTableAutomations({
  resultTable,
  embedded,
  onNavigateAway,
  Row,
  grid,
}: {
  resultTable: DataResultTable;
  embedded?: boolean;
  onNavigateAway?: () => void;
  Row?: AutomationConfigRow;
  grid?: boolean;
}) {
  return (
    <TableAutomations
      table={resultTable}
      kind="result"
      embedded={embedded}
      onNavigateAway={onNavigateAway}
      Row={Row}
      grid={grid}
    />
  );
}
export function RawTableAutomations({
  rawTable,
  embedded,
  onNavigateAway,
  Row,
  grid,
}: {
  rawTable: DataRawTable;
  embedded?: boolean;
  onNavigateAway?: () => void;
  Row?: AutomationConfigRow;
  grid?: boolean;
}) {
  return (
    <TableAutomations
      table={rawTable}
      kind="raw"
      embedded={embedded}
      onNavigateAway={onNavigateAway}
      Row={Row}
      grid={grid}
    />
  );
}
interface AutomationConfigRowProps {
  align?: 'start' | 'center';
  label: ReactNode;
  children: ReactNode;
}
type AutomationConfigRow = (props: AutomationConfigRowProps) => ReactNode;

function TableAutomations({
  table,
  kind,
  embedded,
  onNavigateAway,
  Row,
  grid,
}: {
  table: { id: string; name: string };
  kind: 'raw' | 'result';
  embedded?: boolean;
  onNavigateAway?: () => void;
  /** Label+content row renderer for embedded mode (matches each form's grid). */
  Row?: AutomationConfigRow;
  /** c08/c12 flush grid: 104 | 1fr | 40 | 40 | 104 inside its own ui-group. */
  grid?: boolean;
}) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const mainView = useAppStore((state) => state.mainView);
  const navigate = useAppStore((state) => state.navigateToTableAutomation);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [associationOrder, setAssociationOrder] = useState<string[]>([]);
  useEffect(() => setAssociationOrder([]), [kind, table.id]);
  const [policy, setPolicy] = useState(DEFAULT_TABLE_POLICY);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const read = useCallback(
    () =>
      Promise.all([
        dataClient.listAutomations(),
        dataClient.getTableAutomationPolicy({ kind, tableId: table.id }),
      ]),
    [kind, table.id]
  );
  const load = useCallback(async () => {
    const [result, savedPolicy] = await read();
    setAutomations(result?.automations ?? []);
    setPolicy(savedPolicy);
  }, [read]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void read()
      .then(([result, savedPolicy]) => {
        if (active) {
          setAutomations(result?.automations ?? []);
          setPolicy(savedPolicy);
        }
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
  }, [mainView, read]);
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
  const isLinkedNode = (node: Automation['actionGraph']['nodes'][number]) =>
    node.type === 'cloud.sync' &&
    node.config.direction === (kind === 'raw' ? 'input' : 'output') &&
    node.config[kind === 'raw' ? 'rawTableId' : 'resultTableId'] === table.id;
  const tableRef = { kind, tableId: table.id };
  const matchesTable = (binding: { kind: 'raw' | 'result'; tableId: string }) =>
    tableBindingKey(binding) === tableBindingKey(tableRef);
  const position = (id: string) => {
    const index = associationOrder.indexOf(id);
    return index === -1 ? associationOrder.length : index;
  };
  const linked = automations
    .filter((a) => getAutomationTableBindings(a).some(matchesTable))
    .sort((a, b) => position(a.id) - position(b.id));
  const available = automations.filter((a) => !linked.includes(a));
  const returnTarget: DataResourceTarget = {
    kind: kind === 'raw' ? 'raw_table' : 'result_table',
    id: table.id,
  };
  // The automations UI often lives inside a portaled dialog — close it before
  // switching views or it stays on top of the automation editor.
  const navigateAndClose = (target: Parameters<typeof navigate>[0]) => {
    onNavigateAway?.();
    navigate({ ...target, returnTarget });
  };
  const bind = async (
    automationId: string,
    updates: { runOnChange?: boolean; runOnTrigger?: boolean } | null
  ) => {
    // Read current associations so editing another output does not lose its links.
    const current = await dataClient.getAutomation(automationId);
    if (!current) throw new Error(t('data.resultTables.automation.missing'));
    const bindings = getAutomationTableBindings(current);
    const existing = bindings.find(matchesTable);
    const tableBindings = bindings.filter((b) => !matchesTable(b));
    if (updates !== null)
      tableBindings.push({
        ...tableRef,
        runOnChange: updates.runOnChange ?? existing?.runOnChange ?? false,
        runOnTrigger: updates.runOnTrigger ?? existing?.runOnTrigger ?? true,
      });
    const saved = await dataClient.updateAutomation(automationId, { tableBindings });
    if (!saved) throw new Error(t('data.resultTables.automation.missing'));
  };
  const confirmSyncRemoval = async (automation: Automation, switching = false) => {
    const steps = automation.actionGraph.nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => isLinkedNode(node));
    if (steps.length === 0) return true;
    return confirm({
      title: t('data.resultTables.automation.unlinkSyncTitle'),
      confirmLabel: t(
        switching
          ? 'data.resultTables.automation.confirmSwitch'
          : 'data.resultTables.automation.unlink'
      ),
      message: (
        <span className="block max-h-64 overflow-y-auto whitespace-pre-line">
          {t('data.resultTables.automation.unlinkSyncMessage', {
            automation: automation.name,
            table: table.name,
          })}
          {'\n'}
          {steps
            .map(({ node, index }) =>
              t('data.resultTables.automation.unlinkSyncStep', {
                index: index + 1,
                name:
                  node.label ||
                  t(kind === 'raw' ? 'schedule.cloudInput.title' : 'schedule.cloudSync.title'),
              })
            )
            .join('\n')}
          {'\n'}
          {t('data.resultTables.automation.unlinkSyncRetained')}
        </span>
      ),
    });
  };
  // Remove both the subscription and its sync actions in one persisted update.
  const unlink = async (automationId: string) => {
    const current = await dataClient.getAutomation(automationId);
    if (!current) throw new Error(t('data.resultTables.automation.missing'));
    if (!(await confirmSyncRemoval(current))) return;
    const nodes = current.actionGraph.nodes.filter((node) => !isLinkedNode(node));
    const saved = await dataClient.updateAutomation(automationId, {
      tableBindings: getAutomationTableBindings(current).filter((b) => !matchesTable(b)),
      outputBindings: current.outputBindings?.filter(
        (b) => kind !== 'result' || b.resultTableId !== table.id
      ),
      actionGraph: relinkLinearGraph({ ...current.actionGraph, nodes }),
    });
    if (!saved) throw new Error(t('data.resultTables.automation.missing'));
  };
  const runAutomation = (automationId: string) => {
    void execute(async () => {
      const run = await dataClient.runAutomation(automationId);
      if (!run) throw new Error(t('data.resultTables.automation.missing'));
      if (run.status === 'failed') throw new Error(run.error || t('schedule.runFailed'));
    });
  };
  const countBlock = (
    <span className="text-[13px] text-text-secondary">
      {t('data.resultTables.automation.linkCount', { count: linked.length })}
    </span>
  );
  const controlsBlock = (
    <div
      role="group"
      aria-label={t('data.resultTables.automation.info')}
      className="min-w-0 space-y-1"
    >
      {linked.length > 0 && (
        <ul
          aria-label={t('data.resultTables.automation.info')}
          className="divide-y divide-border-muted"
        >
          {linked.map((automation) => {
            return (
              <li
                key={automation.id}
                aria-label={automation.name}
                className="min-w-0 space-y-2 py-1.5 first:pt-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <RawTableSelect
                      searchPlaceholder={t('schedule.searchPlaceholder')}
                      value={automation.id}
                      disabled={busy || loading || automation.status === 'running'}
                      options={[automation, ...available.filter((a) => a.status !== 'running')].map(
                        (a) => ({ value: a.id, label: a.name })
                      )}
                      onChange={(nextId) => {
                        if (nextId !== automation.id)
                          void execute(async () => {
                            const current = await dataClient.getAutomation(automation.id);
                            if (!current)
                              throw new Error(t('data.resultTables.automation.missing'));
                            if (!(await confirmSyncRemoval(current, true))) return;
                            await dataClient.replaceTableAutomationAssociation(
                              tableRef,
                              automation.id,
                              nextId
                            );
                            setAssociationOrder(
                              linked.map((a) => (a.id === automation.id ? nextId : a.id))
                            );
                          });
                      }}
                    />
                  </div>
                  <Button
                    size="md"
                    variant="ghost"
                    className="px-2"
                    title={t('data.resultTables.automation.run')}
                    aria-label={t('data.resultTables.automation.run')}
                    disabled={busy || automation.status === 'running'}
                    onClick={() => runAutomation(automation.id)}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="md"
                    variant="ghost"
                    className="px-2"
                    title={t('data.resultTables.automation.edit')}
                    aria-label={t('data.resultTables.automation.edit')}
                    disabled={busy}
                    onClick={() => navigateAndClose({ automationId: automation.id })}
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="md"
                    disabled={busy}
                    onClick={() => void execute(() => unlink(automation.id))}
                  >
                    <Unlink className="h-3.5 w-3.5" />
                    {t('data.resultTables.automation.unlink')}
                  </Button>
                </div>
                {automation.lastError && (
                  <p className="text-xs text-error">
                    {t(automation.lastError, { defaultValue: automation.lastError })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="md"
            variant="ghost"
            className="h-8 justify-start px-1 text-accent hover:bg-accent-muted hover:text-accent"
            disabled={busy || loading || available.length === 0}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('data.resultTables.automation.addLink')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {available.map((automation) => (
            <DropdownMenuItem
              key={automation.id}
              disabled={busy || automation.status === 'running'}
              onSelect={() => void execute(() => bind(automation.id, policy))}
            >
              {automation.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {loading && <p className="text-xs text-text-muted">{t('common.loading')}</p>}
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
  const conditions = (
    <div
      role="group"
      aria-label={t('data.resultTables.automation.triggerCondition')}
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <label className="flex items-center gap-2 text-[13px] text-text-secondary">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-accent"
          checked={policy.runOnChange}
          disabled={busy || loading}
          onChange={(event) =>
            void execute(() =>
              dataClient.setTableAutomationPolicy(tableRef, { runOnChange: event.target.checked })
            )
          }
        />
        {t('data.resultTables.automation.onTableChange')}
      </label>
      <label className="flex items-center gap-2 text-[13px] text-text-secondary">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-accent"
          checked={policy.runOnTrigger}
          disabled={busy || loading}
          onChange={(event) =>
            void execute(() =>
              dataClient.setTableAutomationPolicy(tableRef, { runOnTrigger: event.target.checked })
            )
          }
        />
        {t('data.resultTables.automation.inheritAutomation')}
      </label>
    </div>
  );
  const strategyRow = Row ? (
    <Row label={t('data.resultTables.automation.triggerCondition')}>{conditions}</Row>
  ) : (
    <div className="space-y-2">
      <span className="text-xs text-text-secondary">
        {t('data.resultTables.automation.triggerCondition')}
      </span>
      {conditions}
    </div>
  );
  const infoBlock = Row ? (
    <Row label={t('data.resultTables.automation.info')} align="start">
      {controlsBlock}
    </Row>
  ) : (
    <div className="space-y-2">
      <h4 className="text-[13px] font-medium text-text-secondary">
        {t('data.resultTables.automation.info')}
      </h4>
      {controlsBlock}
    </div>
  );
  if (grid) {
    const cell = 'flex min-h-[35px] items-center border-b border-border-subtle';
    const iconCell = `${cell} justify-center border-l text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-45`;
    const nextRunText = (automation: Automation) =>
      automation.trigger.kind === 'manual'
        ? t('data.resultTables.automation.nextRunManual')
        : automation.enabled && automation.nextRunAt
          ? formatNextRun(automation.nextRunAt)
          : t('data.resultTables.automation.nextRunNone');
    return (
      <section className="ui-group ui-form-flush bg-surface" data-testid="table-automation-grid">
        <div className="flex border-b border-border-subtle bg-surface-muted">
          <div className="ui-group-title flex-1 !border-b-0">
            {t('data.resultTables.automation.sectionTitle')}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ui-accent-cell w-[104px] border-l border-border-subtle"
                disabled={busy || loading || available.length === 0}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('data.resultTables.automation.addLinkShort')}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {available.map((automation) => (
                <DropdownMenuItem
                  key={automation.id}
                  disabled={busy || automation.status === 'running'}
                  onSelect={() => void execute(() => bind(automation.id, policy))}
                >
                  {automation.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="ui-form-row">
          <div className="ui-form-label items-center">
            {t('data.resultTables.automation.linkedLabel')}
          </div>
          <div className="ui-form-value">
            <span className="ui-flush-text">
              {t('data.resultTables.automation.linkCount', { count: linked.length })}
            </span>
          </div>
        </div>
        <div className="ui-form-row">
          <div className="ui-form-label items-center">
            {t('data.resultTables.automation.triggerCondition')}
          </div>
          <div className="ui-form-value !flex-row items-center px-[10px] py-1.5 [&_label]:text-[12.5px]">
            {conditions}
          </div>
        </div>
        {linked.length > 0 && (
          <ul
            aria-label={t('data.resultTables.automation.info')}
            className="grid grid-cols-[104px_minmax(0,1fr)_40px_40px_104px]"
          >
            <li className="contents" aria-hidden>
              <span
                className={`${cell} col-span-2 bg-surface-muted px-[10px] text-[11.5px] font-medium text-text-muted`}
              >
                {t('data.resultTables.automation.nameHeader')}
              </span>
              <span className={`${cell} col-span-3 bg-surface-muted`} />
            </li>
            {linked.map((automation) => (
              <li key={automation.id} aria-label={automation.name} className="contents">
                <div className={`${cell} col-span-2 [&>label]:self-stretch`}>
                  <RawTableSelect
                    flush
                    searchPlaceholder={t('schedule.searchPlaceholder')}
                    value={automation.id}
                    disabled={busy || loading || automation.status === 'running'}
                    options={[automation, ...available.filter((a) => a.status !== 'running')].map(
                      (a) => ({ value: a.id, label: a.name })
                    )}
                    onChange={(nextId) => {
                      if (nextId !== automation.id)
                        void execute(async () => {
                          const current = await dataClient.getAutomation(automation.id);
                          if (!current) throw new Error(t('data.resultTables.automation.missing'));
                          if (!(await confirmSyncRemoval(current, true))) return;
                          await dataClient.replaceTableAutomationAssociation(
                            tableRef,
                            automation.id,
                            nextId
                          );
                          setAssociationOrder(
                            linked.map((a) => (a.id === automation.id ? nextId : a.id))
                          );
                        });
                    }}
                  />
                </div>
                <button
                  type="button"
                  className={iconCell}
                  title={t('data.resultTables.automation.run')}
                  aria-label={t('data.resultTables.automation.run')}
                  disabled={busy || automation.status === 'running'}
                  onClick={() => runAutomation(automation.id)}
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={iconCell}
                  title={t('data.resultTables.automation.edit')}
                  aria-label={t('data.resultTables.automation.edit')}
                  disabled={busy}
                  onClick={() => navigateAndClose({ automationId: automation.id })}
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={`${iconCell} gap-1.5 text-[12px] font-medium hover:!bg-error/10 hover:!text-error`}
                  disabled={busy}
                  onClick={() => void execute(() => unlink(automation.id))}
                >
                  <Unlink className="h-3.5 w-3.5" />
                  {t('data.resultTables.automation.unlink')}
                </button>
                <span className={`${cell} ui-form-label`}>
                  {t('data.resultTables.automation.nextRun')}
                </span>
                <span
                  className={`${cell} col-span-4 px-[10px] text-[12.5px] tabular-nums text-text-muted`}
                >
                  {nextRunText(automation)}
                </span>
                {automation.lastError && (
                  <p className={`${cell} col-span-5 px-[10px] text-xs text-error`}>
                    {t(automation.lastError, { defaultValue: automation.lastError })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {(loading || error) && (
          <div className="px-[10px] py-2 text-xs">
            {loading && <p className="text-text-muted">{t('common.loading')}</p>}
            {error && (
              <p role="alert" className="text-error">
                {error}
              </p>
            )}
          </div>
        )}
      </section>
    );
  }
  if (embedded) {
    const title = t('data.resultTables.automation.title');
    return (
      <>
        {Row ? <Row label={title}>{countBlock}</Row> : countBlock}
        {strategyRow}
        {infoBlock}
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
      {countBlock}
      {strategyRow}
      {infoBlock}
    </div>
  );
}
