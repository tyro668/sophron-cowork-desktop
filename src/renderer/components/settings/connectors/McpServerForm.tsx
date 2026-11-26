import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import type { MCPServerConfig } from '../shared';

interface KeyValueSecretSectionProps {
  label: string;
  hint?: string;
  entries: Record<string, string>;
  expanded: boolean;
  isAdding: boolean;
  draftKey: string;
  draftValue: string;
  emptyLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  existingValuePlaceholder: (key: string) => string;
  addButtonLabel: string;
  onToggleExpanded: () => void;
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
  hint,
  entries,
  expanded,
  isAdding,
  draftKey,
  draftValue,
  emptyLabel,
  keyPlaceholder,
  valuePlaceholder,
  existingValuePlaceholder,
  addButtonLabel,
  onToggleExpanded,
  onEntryChange,
  onEntryRemove,
  onStartAdd,
  onDraftKeyChange,
  onDraftValueChange,
  onSaveDraft,
  onCancelDraft,
}: KeyValueSecretSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="ui-form-row">
      <div className="ui-form-label items-center">{label}</div>
      <div className="ui-form-value space-y-2 py-1.5">
        <div className={`flex items-center ${hint ? 'justify-between' : 'justify-end'}`}>
          {hint ? <label className="text-xs text-text-muted">{hint}</label> : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleExpanded}
            className="h-auto px-1 py-0.5 text-xs text-accent hover:text-accent-hover"
          >
            {expanded ? t('mcp.hide') : t('mcp.show')}
          </Button>
        </div>
        {expanded && (
          <div className="space-y-2 rounded-md border border-border-subtle bg-surface-muted p-2">
            {Object.entries(entries).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs font-mono text-text-secondary w-32 truncate" title={key}>
                  {key}
                </span>
                <Input
                  type="password"
                  value={value}
                  onChange={(e) => onEntryChange(key, e.target.value)}
                  placeholder={existingValuePlaceholder(key)}
                  className="h-8 flex-1 px-2.5 font-mono text-[13px]"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEntryRemove(key)}
                  className="h-8 w-8 text-text-muted hover:bg-error/10 hover:text-error"
                  title={t('mcp.removeVar')}
                  aria-label={t('mcp.removeVar')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            {Object.keys(entries).length === 0 && !isAdding && (
              <p className="text-xs text-text-muted text-center py-2">{emptyLabel}</p>
            )}
            {isAdding && (
              <div className="space-y-2 p-2 rounded bg-background border border-accent/30">
                <Input
                  type="text"
                  value={draftKey}
                  onChange={(e) => onDraftKeyChange(e.target.value)}
                  placeholder={keyPlaceholder}
                  className="h-8 border-border px-2.5 font-mono text-[13px]"
                  autoFocus
                />
                <Input
                  type="password"
                  value={draftValue}
                  onChange={(e) => onDraftValueChange(e.target.value)}
                  placeholder={valuePlaceholder}
                  className="h-8 border-border px-2.5 font-mono text-[13px]"
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onSaveDraft}
                    disabled={!draftKey.trim()}
                    className="h-auto flex-1 px-3 py-1 text-xs"
                  >
                    {t('common.save')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onCancelDraft}
                    className="h-auto flex-1 border-transparent bg-surface-muted px-3 py-1 text-xs hover:bg-surface-active"
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}
            {!isAdding && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onStartAdd}
                className="mt-2 h-auto w-full gap-1 border-dashed border-border px-3 py-1.5 text-xs hover:border-accent hover:bg-accent-muted hover:text-accent"
              >
                <Plus className="w-3.5 h-3.5" />
                {addButtonLabel}
              </Button>
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
  const [type, setType] = useState<'stdio' | 'sse' | 'streamable-http'>(server?.type || 'stdio');
  const [command, setCommand] = useState(server?.command || '');
  const [args, setArgs] = useState(server?.args?.join(' ') || '');
  const [url, setUrl] = useState(server?.url || '');
  const [enabled, setEnabled] = useState(server?.enabled ?? true);

  const [envVars, setEnvVars] = useState<Record<string, string>>(server?.env || {});
  const [showEnvSection, setShowEnvSection] = useState(Object.keys(server?.env || {}).length > 0);
  const [isAddingEnvVar, setIsAddingEnvVar] = useState(false);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');

  const [headers, setHeaders] = useState<Record<string, string>>(server?.headers || {});
  const [showHeadersSection, setShowHeadersSection] = useState(
    Object.keys(server?.headers || {}).length > 0
  );
  const [isAddingHeader, setIsAddingHeader] = useState(false);
  const [newHeaderKey, setNewHeaderKey] = useState('');
  const [newHeaderValue, setNewHeaderValue] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const config: MCPServerConfig = {
      id: server?.id || `mcp-${Date.now()}`,
      name: name.trim(),
      type,
      enabled,
    };

    if (type === 'stdio') {
      if (!command.trim()) {
        alert(t('mcp.commandRequired'));
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
        alert(t('mcp.urlRequired'));
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
    <form onSubmit={handleSubmit} className="ui-group bg-surface">
      <h3 className="ui-group-title">
        {server ? t('mcp.editConnector') : t('mcp.addConnectorTitle')}
      </h3>

      <div className="ui-form-row">
        <label className="ui-form-label items-center">{t('mcp.name')}</label>
        <div className="ui-form-value py-1.5">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('mcp.namePlaceholder')}
            className="h-8 px-2.5"
            required
          />
        </div>
      </div>

      <div className="ui-form-row">
        <span id="mcp-type-label" className="ui-form-label items-center">
          {t('mcp.type')}
        </span>
        <div className="ui-form-value py-1.5">
          <div
            role="radiogroup"
            aria-labelledby="mcp-type-label"
            className="grid grid-cols-3 gap-1.5"
          >
            {(
              [
                ['stdio', 'mcp.typeStdioLocal'],
                ['sse', 'mcp.typeSseRemote'],
                ['streamable-http', 'mcp.typeStreamableHttp'],
              ] as const
            ).map(([value, labelKey]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={type === value}
                onClick={() => setType(value)}
                className={`h-8 px-3 rounded-md text-[13px] font-medium transition-all ${
                  type === value
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-surface-muted text-text-secondary hover:bg-surface-active'
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
            <label className="ui-form-label items-center">{t('mcp.command')}</label>
            <div className="ui-form-value py-1.5">
              <Input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t('mcp.commandPlaceholder')}
                className="h-8 px-2.5 font-mono text-[13px]"
                required
              />
            </div>
          </div>
          <div className="ui-form-row">
            <label className="ui-form-label items-center">{t('mcp.arguments')}</label>
            <div className="ui-form-value py-1.5">
              <Input
                type="text"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder={t('mcp.argumentsPlaceholder')}
                className="h-8 px-2.5 font-mono text-[13px]"
              />
              <p className="text-xs text-text-muted mt-1">{t('mcp.spaceSeparated')}</p>
            </div>
          </div>
          <KeyValueSecretSection
            label={t('credentials.envVars')}
            hint={t('credentials.usedForTokens')}
            entries={envVars}
            expanded={showEnvSection}
            isAdding={isAddingEnvVar}
            draftKey={newEnvKey}
            draftValue={newEnvValue}
            emptyLabel={t('credentials.noEnvVars')}
            keyPlaceholder="NOTION_TOKEN"
            valuePlaceholder={t('mcp.envValuePlaceholder')}
            existingValuePlaceholder={(key) => `${t('mcp.envValuePlaceholder')}: ${key}`}
            addButtonLabel={t('credentials.envVars')}
            onToggleExpanded={() => setShowEnvSection((open) => !open)}
            onEntryChange={(key, value) => setEnvVars((prev) => ({ ...prev, [key]: value }))}
            onEntryRemove={(key) =>
              setEnvVars((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              })
            }
            onStartAdd={() => {
              setIsAddingEnvVar(true);
              setShowEnvSection(true);
            }}
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
            <label className="ui-form-label items-center">{t('mcp.url')}</label>
            <div className="ui-form-value py-1.5">
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                className="h-8 px-2.5 font-mono text-[13px]"
                required
              />
            </div>
          </div>
          <KeyValueSecretSection
            label={t('mcp.headers')}
            entries={headers}
            expanded={showHeadersSection}
            isAdding={isAddingHeader}
            draftKey={newHeaderKey}
            draftValue={newHeaderValue}
            emptyLabel={t('mcp.noHeaders')}
            keyPlaceholder={t('mcp.headerNamePlaceholder')}
            valuePlaceholder={t('mcp.headerValuePlaceholder')}
            existingValuePlaceholder={() => t('mcp.headerValuePlaceholder')}
            addButtonLabel={t('mcp.headers')}
            onToggleExpanded={() => setShowHeadersSection((open) => !open)}
            onEntryChange={(key, value) => setHeaders((prev) => ({ ...prev, [key]: value }))}
            onEntryRemove={(key) =>
              setHeaders((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              })
            }
            onStartAdd={() => {
              setIsAddingHeader(true);
              setShowHeadersSection(true);
            }}
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
        <div className="ui-form-label items-center">{t('mcp.status')}</div>
        <div className="ui-form-value">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-border text-accent focus:ring-accent"
            />
            <label htmlFor="enabled" className="text-sm text-text-primary">
              {t('mcp.enableConnector')}
            </label>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border-subtle bg-surface-muted px-3 py-2">
        <Button type="submit" variant="primary" loading={isLoading} className="h-8 gap-2 px-4">
          {isLoading ? t('common.saving') : t('common.save')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={isLoading} className="h-8 px-4">
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
