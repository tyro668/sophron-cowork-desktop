import { useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { showToast } from '../../../utils/toast';
import { Switch } from '../../ui';
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
    <div className="ui-form-row">
      <span className="ui-form-label items-start pt-2.5">{label}</span>
      <div className="ui-form-value divide-y divide-border-subtle">
        {entryList.map(([key, value]) => (
          <div key={key} className="flex min-h-[35px] min-w-0 items-stretch">
            <span
              className="flex w-36 shrink-0 items-center truncate border-r border-border-subtle bg-surface-muted/40 px-[10px] font-mono text-[12px] text-text-secondary"
              title={key}
            >
              {key}
            </span>
            <input
              type="password"
              value={value}
              onChange={(event) => onEntryChange(key, event.target.value)}
              placeholder={existingValuePlaceholder(key)}
              className="min-w-0 flex-1 bg-transparent px-[10px] font-mono text-[12.5px] text-text-primary placeholder:font-sans placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onEntryRemove(key)}
              className="flex w-9 shrink-0 items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-error/10 hover:text-error"
              title={t('mcp.removeVar')}
              aria-label={t('mcp.removeVar')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {isAdding && (
          <div className="flex min-h-[35px] min-w-0 items-stretch bg-surface-hover/25">
            <input
              type="text"
              value={draftKey}
              onChange={(event) => onDraftKeyChange(event.target.value)}
              placeholder={keyPlaceholder}
              className="w-36 shrink-0 border-r border-border-subtle bg-transparent px-[10px] font-mono text-[12px] text-text-primary placeholder:font-sans placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
              autoFocus
            />
            <input
              type="password"
              value={draftValue}
              onChange={(event) => onDraftValueChange(event.target.value)}
              placeholder={valuePlaceholder}
              className="min-w-0 flex-1 bg-transparent px-[10px] font-mono text-[12px] text-text-primary placeholder:font-sans placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={!draftKey.trim()}
              className="ui-accent-cell shrink-0 border-l border-border-subtle"
            >
              {t('common.add')}
            </button>
            <button
              type="button"
              onClick={onCancelDraft}
              className="inline-flex shrink-0 items-center justify-center border-l border-border-subtle px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              {t('common.cancel')}
            </button>
          </div>
        )}

        {!isAdding && (
          <div className="flex min-h-[35px] items-stretch">
            {entryList.length === 0 ? (
              <>
                <span className="ui-flush-text min-w-0 flex-1">{emptyLabel}</span>
                <button
                  type="button"
                  onClick={onStartAdd}
                  className="ui-accent-cell shrink-0 border-l border-border-subtle"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {addButtonLabel}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onStartAdd}
                className="ui-accent-cell w-full !justify-start !px-[10px]"
              >
                <Plus className="h-3.5 w-3.5" />
                {addButtonLabel}
              </button>
            )}
          </div>
        )}
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
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border-subtle bg-surface-muted px-3">
        <h2 className="text-[12.5px] font-semibold text-text-primary">
          {server ? t('mcp.editConnector') : t('mcp.addConnectorTitle')}
        </h2>
      </div>

      <div className="scrollbar-hover ui-form-flush min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-border-subtle">
          <div className="ui-form-row">
            <label htmlFor="mcp-name-input" className="ui-form-label items-center">
              {t('mcp.name')}
            </label>
            <div className="ui-form-value">
              <input
                id="mcp-name-input"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('mcp.namePlaceholder')}
                className="text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
                required
              />
            </div>
          </div>

          <div className="ui-form-row">
            <span id="mcp-type-label" className="ui-form-label items-center">
              {t('mcp.type')}
            </span>
            <div className="ui-form-value">
              <div
                role="radiogroup"
                aria-labelledby="mcp-type-label"
                className="grid min-h-[35px] w-full grid-cols-3 divide-x divide-border-subtle"
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
                    className={`flex items-center justify-center px-2 text-[12px] font-medium transition-colors ${
                      type === value
                        ? 'bg-accent-muted text-accent'
                        : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
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
              <div className="ui-form-row">
                <label htmlFor="mcp-command-input" className="ui-form-label items-center">
                  {t('mcp.command')}
                </label>
                <div className="ui-form-value">
                  <input
                    id="mcp-command-input"
                    type="text"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    placeholder={t('mcp.commandPlaceholder')}
                    className="font-mono text-text-primary placeholder:font-sans placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
                    required
                  />
                </div>
              </div>
              <div className="ui-form-row">
                <label htmlFor="mcp-args-input" className="ui-form-label items-center">
                  {t('mcp.arguments')}
                </label>
                <div className="ui-form-value">
                  <input
                    id="mcp-args-input"
                    type="text"
                    value={args}
                    onChange={(event) => setArgs(event.target.value)}
                    placeholder={t('mcp.argumentsPlaceholder')}
                    className="font-mono text-text-primary placeholder:font-sans placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
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
              <div className="ui-form-row">
                <label htmlFor="mcp-url-input" className="ui-form-label items-center">
                  {t('mcp.url')}
                </label>
                <div className="ui-form-value">
                  <input
                    id="mcp-url-input"
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://example.com/mcp"
                    className="font-mono text-text-primary placeholder:font-sans placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
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

          <div className="ui-form-row">
            <span className="ui-form-label items-center">{t('mcp.status')}</span>
            <div className="ui-form-value !flex-row items-center gap-2.5 px-[10px]">
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
      </div>

      {/* Flush, gapless bottom action bar */}
      <div className="flex h-9 shrink-0 items-stretch border-t border-border-subtle bg-surface">
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="inline-flex shrink-0 items-center justify-center border-l border-border-subtle px-4 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle bg-accent px-4 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {isLoading ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
