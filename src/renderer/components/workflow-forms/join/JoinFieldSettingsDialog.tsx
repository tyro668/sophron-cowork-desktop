import { useEffect, useMemo, useRef, useState } from 'react';
import { GlassFormTextInput } from '../shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from '../shared/GlassOptionSingleSelect';
import { toggleSelectAll } from '@/shared/collections/selection';
import type { KeepItem } from '@/shared/operator-schemas';
import {
  buildJoinConflictConfig,
  createJoinKeepDraft,
  JOIN_CONFLICT_DEFAULTS,
  qualifyJoinField,
  serializeJoinKeepDraft,
  type JoinConflictConfig,
  type JoinConflictUi,
  type JoinKeepDraft,
} from '@/shared/operator-config';
import { useFormTranslation } from '../../../hooks/useFormTranslation';

interface JoinKeepFieldColumnProps {
  side: 'left' | 'right';
  title: string;
  fields: string[];
  alias: string;
  selected: ReadonlySet<string>;
  aliases: ReadonlyMap<string, string>;
  allChecked: boolean;
  allIndeterminate?: boolean;
  onToggleAll: () => void;
  onToggleField: (field: string) => void;
  onAliasChange: (field: string, alias: string) => void;
}

function JoinKeepFieldColumn({
  side,
  title,
  fields,
  alias,
  selected,
  aliases,
  allChecked,
  allIndeterminate,
  onToggleAll,
  onToggleField,
  onAliasChange,
}: JoinKeepFieldColumnProps) {
  const tr = useFormTranslation('join');

  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = Boolean(allIndeterminate);
    }
  }, [allIndeterminate]);

  return (
    <div
      className={side === 'left' ? 'flex-1 border-r border-border-muted/50 pr-4' : 'flex-1 pl-4'}
    >
      <h4 className="mb-1 text-[12px] font-medium text-text-secondary">{title}</h4>
      <p className="mb-2 text-[10px] text-text-muted">{tr('joinKeepAliasPrompt')}</p>
      <label className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-text-secondary">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allChecked}
          onChange={onToggleAll}
          className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
        />
        {tr('selectAllFields')}
      </label>
      <div className="scrollbar-hover max-h-48 space-y-1 overflow-y-auto">
        {fields.map((field) => {
          const qualifiedField = qualifyJoinField(alias, field);
          const isChecked = selected.has(qualifiedField);
          const fieldAlias = aliases.get(qualifiedField) ?? '';
          return (
            <div key={field} className="flex items-center gap-1.5 text-[12px] text-text-primary">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggleField(qualifiedField)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-border-muted accent-accent"
                />
                <span className="truncate">{field}</span>
              </label>
              {/* Always mounted (hidden when unchecked) so toggling selection
                  does not change the row height or resize the dialog. */}
              <input
                type="text"
                value={fieldAlias}
                onChange={(event) => onAliasChange(qualifiedField, event.target.value)}
                placeholder={field}
                tabIndex={isChecked ? undefined : -1}
                className={`h-5 w-28 shrink-0 rounded border border-border-muted/50 bg-background/30 px-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted/50 focus:border-accent ${
                  isChecked ? '' : 'invisible'
                }`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Draft state held only while the dialog is mounted; seeded from the node
 *  config on open so cancel discards everything in one unmount. */
type JoinFieldSettingsDraft = JoinKeepDraft & { conflict: JoinConflictUi };

export interface JoinFieldSettingsDialogProps {
  keepItems: KeepItem[];
  conflict: JoinConflictUi;
  leftFields: string[];
  rightFields: string[];
  leftAlias: string;
  rightAlias: string;
  leftTitle: string;
  rightTitle: string;
  onConfirm: (keep: KeepItem[] | undefined, conflict: JoinConflictConfig) => void;
  onCancel: () => void;
}

export function JoinFieldSettingsDialog({
  keepItems,
  conflict,
  leftFields,
  rightFields,
  leftAlias,
  rightAlias,
  leftTitle,
  rightTitle,
  onConfirm,
  onCancel,
}: JoinFieldSettingsDialogProps) {
  const tr = useFormTranslation('join');

  // Escape closes the dialog without applying the draft selection.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const [draft, setDraft] = useState<JoinFieldSettingsDraft>(() => ({
    ...createJoinKeepDraft(keepItems, leftFields, rightFields, leftAlias, rightAlias),
    conflict: { ...conflict },
  }));

  function toggleField(side: 'left' | 'right', field: string) {
    setDraft((prev) => {
      const selected = new Set(side === 'left' ? prev.leftSelected : prev.rightSelected);
      const aliases = new Map(side === 'left' ? prev.leftAliases : prev.rightAliases);
      if (selected.has(field)) {
        selected.delete(field);
        aliases.delete(field);
      } else {
        selected.add(field);
      }
      return side === 'left'
        ? { ...prev, leftWildcard: false, leftSelected: selected, leftAliases: aliases }
        : { ...prev, rightWildcard: false, rightSelected: selected, rightAliases: aliases };
    });
  }

  function toggleAll(side: 'left' | 'right') {
    setDraft((prev) => {
      const fields =
        side === 'left'
          ? leftFields.map((field) => qualifyJoinField(leftAlias, field))
          : rightFields.map((field) => qualifyJoinField(rightAlias, field));
      const selected = side === 'left' ? prev.leftSelected : prev.rightSelected;
      const next = toggleSelectAll(selected, fields);
      return side === 'left'
        ? { ...prev, leftWildcard: false, leftSelected: next }
        : { ...prev, rightWildcard: false, rightSelected: next };
    });
  }

  function updateAlias(side: 'left' | 'right', field: string, alias: string) {
    setDraft((prev) => {
      const aliases = new Map(side === 'left' ? prev.leftAliases : prev.rightAliases);
      if (alias) aliases.set(field, alias);
      else aliases.delete(field);
      return side === 'left'
        ? { ...prev, leftWildcard: false, leftAliases: aliases }
        : { ...prev, rightWildcard: false, rightAliases: aliases };
    });
  }

  function updateConflict(patch: Partial<JoinConflictUi>) {
    setDraft((prev) => ({ ...prev, conflict: { ...prev.conflict, ...patch } }));
  }

  const leftAllChecked = draft.leftSelected.size === leftFields.length;
  const rightAllChecked = draft.rightSelected.size === rightFields.length;
  const leftIndeterminate =
    draft.leftSelected.size > 0 && draft.leftSelected.size < leftFields.length;
  const rightIndeterminate =
    draft.rightSelected.size > 0 && draft.rightSelected.size < rightFields.length;

  const conflictGroups = useMemo(
    () => [
      {
        key: 'conflict',
        items: [
          { value: 'right_prefix', label: tr('conflictPrefix') },
          { value: 'suffix', label: tr('conflictSuffix') },
        ],
      },
    ],
    [tr]
  );

  function confirm() {
    const items = serializeJoinKeepDraft({
      leftTotal: leftFields.length,
      rightTotal: rightFields.length,
      leftWildcard: draft.leftWildcard,
      rightWildcard: draft.rightWildcard,
      leftSelected: draft.leftSelected,
      rightSelected: draft.rightSelected,
      leftAliases: draft.leftAliases,
      rightAliases: draft.rightAliases,
    });
    // Conflict edits live in the same draft so cancel reverts them together
    // with the keep selection.
    onConfirm(items.length > 0 ? items : undefined, buildJoinConflictConfig(draft.conflict));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/28 px-4 py-6"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        autoFocus
        tabIndex={-1}
        className="flex max-h-full w-[680px] flex-col rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-border-muted/50 px-4 py-3">
          <h3 className="text-[13px] font-semibold text-text-primary">{tr('joinFieldSettings')}</h3>
        </div>
        <div className="scrollbar-hover flex gap-4 overflow-y-auto p-4">
          <JoinKeepFieldColumn
            side="left"
            title={leftTitle}
            fields={leftFields}
            alias={leftAlias}
            selected={draft.leftSelected}
            aliases={draft.leftAliases}
            allChecked={leftAllChecked}
            allIndeterminate={leftIndeterminate}
            onToggleAll={() => toggleAll('left')}
            onToggleField={(field) => toggleField('left', field)}
            onAliasChange={(field, alias) => updateAlias('left', field, alias)}
          />
          <JoinKeepFieldColumn
            side="right"
            title={rightTitle}
            fields={rightFields}
            alias={rightAlias}
            selected={draft.rightSelected}
            aliases={draft.rightAliases}
            allChecked={rightAllChecked}
            allIndeterminate={rightIndeterminate}
            onToggleAll={() => toggleAll('right')}
            onToggleField={(field) => toggleField('right', field)}
            onAliasChange={(field, alias) => updateAlias('right', field, alias)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-muted/50 px-4 py-3">
          <span className="shrink-0 text-[12px] text-text-primary">{tr('conflict')}</span>
          <GlassOptionSingleSelect
            value={draft.conflict.strategy}
            groups={conflictGroups}
            onChange={(v) => updateConflict({ strategy: v })}
            className="h-8 w-40 text-[12px] [&>span]:text-left"
          />
          {draft.conflict.strategy === 'suffix' ? (
            <>
              <label className="flex items-center gap-1 text-[12px] text-text-secondary">
                {tr('conflictLeftSuffix')}
                <GlassFormTextInput
                  value={draft.conflict.leftSuffix}
                  onChange={(v) => updateConflict({ leftSuffix: v })}
                  placeholder={JOIN_CONFLICT_DEFAULTS.leftSuffix}
                  className="h-8 w-24 text-[12px]"
                />
              </label>
              <label className="flex items-center gap-1 text-[12px] text-text-secondary">
                {tr('conflictRightSuffix')}
                <GlassFormTextInput
                  value={draft.conflict.rightSuffix}
                  onChange={(v) => updateConflict({ rightSuffix: v })}
                  placeholder={JOIN_CONFLICT_DEFAULTS.rightSuffix}
                  className="h-8 w-24 text-[12px]"
                />
              </label>
            </>
          ) : (
            <label className="flex items-center gap-1 text-[12px] text-text-secondary">
              {tr('prefix')}
              <GlassFormTextInput
                value={draft.conflict.rightPrefix}
                onChange={(v) => updateConflict({ rightPrefix: v })}
                placeholder={JOIN_CONFLICT_DEFAULTS.rightPrefix}
                className="h-8 w-24 text-[12px]"
              />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border-muted bg-background/42 px-3 py-1 text-[12px] text-text-secondary hover:border-accent/30 hover:text-accent transition-colors"
          >
            {tr('cancel')}
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-md bg-accent px-3 py-1 text-[12px] text-white hover:bg-accent/90 transition-colors"
          >
            {tr('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
