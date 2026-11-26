import { useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { showToast } from '../../../utils/toast';
import { Button, Input, Switch } from '../../ui';
import type { MCPServerConfig } from '../shared';

interface KeyValueSecretSectionProps {
  label: string;
  entries: Record<string, string>;
  isAdding: boolean;
  draftKey: string;
  draftValue: string;
  emptyLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  existingValuePlaceholder: (key: string) => string;
  addButtonLabel: string;
  onEntryChange: (key: string, value: string) => void;
  onEntryRemove: (key: string) => void;
  onStartAdd: () => void;
  onDraftKeyChange: (value: string) => void;
  onDraftValueChange: (value: string) => void;
  onSaveDraft: () => void;
  onCancelDraft: () => void;
}

function KeyValueSecretSection({
  label,
  entries,
  isAdding,
  draftKey,
  draftValue,
  emptyLabel,
  keyPlaceholder,
  valuePlaceholder,
  existingValuePlaceholder,
  addButtonLabel,
  onEntryChange,
  onEntryRemove,
  onStartAdd,
  onDraftKeyChange,
  onDraftValueChange,
  onSaveDraft,
  onCancelDraft,
}: KeyValueSecretSectionProps) {
  const { t } = useTranslation();
  const entryList = Object.entries(entries);

  return (
    <div className="grid min-h-[40px] min-w-0 grid-cols-[116px_minmax(0,1fr)] border-b border-border-subtle">
      <span className="flex items-start whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 pt-2.5 text-[12px] font-medium text-text-secondary">
        {label}
      </span>
      <div className="min-w-0 space-y-2 px-3 py-2">
        {entryList.map(([key, value]) => (
          <div key={key} className="flex min-w-0 items-center gap-1.5">
            <span
              className="w-32 shrink-0 truncate font-mono text-[12px] text-text-secondary"
              title={key}
            >
              {key}
            </span>
            <Input
              type="password"
              value={value}
              onChange={(event) => onEntryChange(key, event.target.value)}
              placeholder={existingValuePlaceholder(key)}
              className="h-8 min-w-0 flex-1 font-mono text-[12.5px]"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEntryRemove(key)}
              className="h-8 w-8 shrink-0 text-text-muted hover:bg-error/10 hover:text-error"
              title={t('mcp.removeVar')}
              aria-label={t('mcp.removeVar')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}

        {isAdding && (
          <div className="space-y-1.5 rounded-lg border border-border-muted bg-surface-muted/50 p-2">
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <Input
                type="text"
                value={draftKey}
                onChange={(event) => onDraftKeyChange(event.target.value)}
                placeholder={keyPlaceholder}
                className="h-8 bg-surface font-mono text-[12.5px]"
                autoFocus
              />
              <Input
                type="password"
                value={draftValue}
                onChange={(event) => onDraftValueChange(event.target.value)}
                placeholder={valuePlaceholder}
                className="h-8 bg-surface font-mono text-[12.5px]"
              />
            </div>
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" onClick={onCancelDraft}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={onSaveDraft} disabled={!draftKey.trim()}>
                {t('common.add')}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          {entryList.length === 0 && !isAdding ? (
            <span className="text-[12px] text-text-muted">{emptyLabel}</span>
          ) : (
            <span />
          )}
          {!isAdding && (
            <button
              type="button"
              onClick={onStartAdd}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-accent transition-colors hover:bg-accent-muted/75"
            >
              <Plus className="h-3.5 w-3.5" />
              {addButtonLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function McpServerForm({
  server,
  onSave,
  onCancel,
  isLoading,
}: {
  server?: MCPServerConfig;
  onSave: (server: MCPServerConfig) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(server?.name || '');
  const [type, setType] = useState<'stdio' | 'sse' | 'streamable-http'>(
    server?.type || 'streamable-http'
  );
  const [command, setCommand] = useState(server?.command || '');
  const [args, setArgs] = useState(server?.args?.join(' ') || '');
  const [url, setUrl] = useState(server?.url || '');
  const [enabled, setEnabled] = useState(server?.enabled ?? true);

  const [envVars, setEnvVars] = useState<Record<string, string>>(server?.env || {});
  const [isAddingEnvVar, setIsAddingEnvVar] = useState(false);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');

  const [headers, setHeaders] = useState<Record<string, string>>(server?.headers || {});
  const [isAddingHeader, setIsAddingHeader] = useState(false);
  const [newHeaderKey, setNewHeaderKey] = useState('');
  const [newHeaderValue, setNewHeaderValue] = useState('');

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!name.trim()) {
      showToast('error', t('mcp.nameRequired'));
      return;
    }

    const config: MCPServerConfig = {
      id: server?.id || `mcp-${Date.now()}`,
      name: name.trim(),
      type,
      enabled,
    };

    if (type === 'stdio') {
      if (!command.trim()) {
        showToast('error', t('mcp.commandRequired'));
        return;
      }
      config.command = command.trim();
      config.args = args.trim() ? args.trim().split(/\s+/) : [];
      const mergedEnv =
        isAddingEnvVar && newEnvKey.trim()
          ? { ...envVars, [newEnvKey.trim()]: newEnvValue.trim() }
          : envVars;
      if (Object.keys(mergedEnv).length > 0) {
        config.env = mergedEnv;
      }
    } else {
      if (!url.trim()) {
        showToast('error', t('mcp.urlRequired'));
        return;
      }
      config.url = url.trim();
      const mergedHeaders =
        isAddingHeader && newHeaderKey.trim()
          ? { ...headers, [newHeaderKey.trim()]: newHeaderValue.trim() }
          : headers;
      if (Object.keys(mergedHeaders).length > 0) {
        config.headers = mergedHeaders;
      }
    }

    onSave(config);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <h2 className="text-[13px] font-semibold text-text-primary">
          {server ? t('mcp.editConnector') : t('mcp.addConnectorTitle')}
        </h2>
      </div>

      <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto">
        <div className="grid min-h-[40px] min-w-0 grid-cols-[116px_minmax(0,1fr)] border-b border-border-subtle">
          <label
            htmlFor="mcp-name-input"
            className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary"
          >
            {t('mcp.name')}
          </label>
          <div className="flex min-w-0 items-center px-3 py-1.5">
            <Input
              id="mcp-name-input"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('mcp.namePlaceholder')}
              className="h-8 px-2.5"
              required
            />
          </div>
        </div>

        <div className="grid min-h-[40px] min-w-0 grid-cols-[116px_minmax(0,1fr)] border-b border-border-subtle">
          <span
            id="mcp-type-label"
            className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary"
          >
            {t('mcp.type')}
          </span>
          <div className="flex min-w-0 items-center px-3 py-1.5">
            <div
              role="radiogroup"
              aria-labelledby="mcp-type-label"
              className="inline-flex rounded-lg border border-border-subtle bg-surface-muted p-0.5"
            >
              {(
                [
                  ['streamable-http', 'mcp.typeStreamableHttp'],
                  ['sse', 'mcp.typeSseRemote'],
                  ['stdio', 'mcp.typeStdioLocal'],
                ] as const
              ).map(([value, labelKey]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={type === value}
                  onClick={() => setType(value)}
                  className={`h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors ${
                    type === value
                      ? 'bg-surface text-accent shadow-soft ring-1 ring-accent/25'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {type === 'stdio' ? (
          <>
            <div className="grid min-h-[40px] min-w-0 grid-cols-[116px_minmax(0,1fr)] border-b border-border-subtle">
              <label
                htmlFor="mcp-command-input"
                className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary"
              >
                {t('mcp.command')}
              </label>
              <div className="flex min-w-0 items-center px-3 py-1.5">
                <Input
                  id="mcp-command-input"
                  type="text"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder={t('mcp.commandPlaceholder')}
                  className="h-8 px-2.5 font-mono text-[12.5px]"
                  required
                />
              </div>
            </div>
            <div className="grid min-h-[40px] min-w-0 grid-cols-[116px_minmax(0,1fr)] border-b border-border-subtle">
              <label
                htmlFor="mcp-args-input"
                className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary"
              >
                {t('mcp.arguments')}
              </label>
              <div className="flex min-w-0 items-center px-3 py-1.5">
                <Input
                  id="mcp-args-input"
                  type="text"
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  placeholder={t('mcp.argumentsPlaceholder')}
                  className="h-8 px-2.5 font-mono text-[12.5px]"
                />
              </div>
            </div>
            <KeyValueSecretSection
              label={t('credentials.envVars')}
              entries={envVars}
              isAdding={isAddingEnvVar}
              draftKey={newEnvKey}
              draftValue={newEnvValue}
              emptyLabel={t('credentials.noEnvVars')}
              keyPlaceholder="API_TOKEN"
              valuePlaceholder={t('mcp.envValuePlaceholder')}
              existingValuePlaceholder={(key) => `${t('mcp.envValuePlaceholder')}: ${key}`}
              addButtonLabel={t('credentials.envVars')}
              onEntryChange={(key, value) => setEnvVars((prev) => ({ ...prev, [key]: value }))}
              onEntryRemove={(key) =>
                setEnvVars((prev) => {
                  const next = { ...prev };
                  delete next[key];
                  return next;
                })
              }
              onStartAdd={() => setIsAddingEnvVar(true)}
              onDraftKeyChange={setNewEnvKey}
              onDraftValueChange={setNewEnvValue}
              onSaveDraft={() => {
                if (!newEnvKey.trim()) return;
                setEnvVars((prev) => ({ ...prev, [newEnvKey.trim()]: newEnvValue.trim() }));
                setNewEnvKey('');
                setNewEnvValue('');
                setIsAddingEnvVar(false);
              }}
              onCancelDraft={() => {
                setNewEnvKey('');
                setNewEnvValue('');
                setIsAddingEnvVar(false);
              }}
            />
          </>
        ) : (
          <>
            <div className="grid min-h-[40px] min-w-0 grid-cols-[116px_minmax(0,1fr)] border-b border-border-subtle">
              <label
                htmlFor="mcp-url-input"
                className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary"
              >
                {t('mcp.url')}
              </label>
              <div className="flex min-w-0 items-center px-3 py-1.5">
                <Input
                  id="mcp-url-input"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/mcp"
                  className="h-8 px-2.5 font-mono text-[12.5px]"
                  required
                />
              </div>
            </div>
            <KeyValueSecretSection
              label={t('mcp.headers')}
              entries={headers}
              isAdding={isAddingHeader}
              draftKey={newHeaderKey}
              draftValue={newHeaderValue}
              emptyLabel={t('mcp.noHeaders')}
              keyPlaceholder={t('mcp.headerNamePlaceholder')}
              valuePlaceholder={t('mcp.headerValuePlaceholder')}
              existingValuePlaceholder={() => t('mcp.headerValuePlaceholder')}
              addButtonLabel={t('mcp.headers')}
              onEntryChange={(key, value) => setHeaders((prev) => ({ ...prev, [key]: value }))}
              onEntryRemove={(key) =>
                setHeaders((prev) => {
                  const next = { ...prev };
                  delete next[key];
                  return next;
                })
              }
              onStartAdd={() => setIsAddingHeader(true)}
              onDraftKeyChange={setNewHeaderKey}
              onDraftValueChange={setNewHeaderValue}
              onSaveDraft={() => {
                if (!newHeaderKey.trim()) return;
                setHeaders((prev) => ({ ...prev, [newHeaderKey.trim()]: newHeaderValue.trim() }));
                setNewHeaderKey('');
                setNewHeaderValue('');
                setIsAddingHeader(false);
              }}
              onCancelDraft={() => {
                setNewHeaderKey('');
                setNewHeaderValue('');
                setIsAddingHeader(false);
              }}
            />
          </>
        )}

        <div className="grid min-h-[40px] min-w-0 grid-cols-[116px_minmax(0,1fr)] border-b border-border-subtle">
          <span className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary">
            {t('mcp.status')}
          </span>
          <div className="flex min-w-0 items-center gap-2.5 px-3 py-1.5">
            <Switch
              id="mcp-enabled-switch"
              size="sm"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <label
              htmlFor="mcp-enabled-switch"
              className="cursor-pointer text-[12.5px] text-text-primary"
            >
              {t('mcp.enableConnector')}
            </label>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-surface-muted/40 px-4 py-2.5">
        <Button variant="secondary" onClick={onCancel} disabled={isLoading} className="h-8 px-3">
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={isLoading} className="h-8 px-3.5">
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {isLoading ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
