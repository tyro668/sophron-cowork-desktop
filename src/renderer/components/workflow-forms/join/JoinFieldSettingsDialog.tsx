import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '../../ui/button';
import { Dialog } from '../../ui/dialog';
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

interface JoinKeepFieldSectionProps {
  title: string;
  fields: string[];
  alias: string;
  selected: ReadonlySet<string>;
  aliases: ReadonlyMap<string, string>;
  allChecked: boolean;
  allIndeterminate?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleAll: () => void;
  onToggleField: (field: string) => void;
  onAliasChange: (field: string, alias: string) => void;
}

function JoinKeepFieldSection({
  title,
  fields,
  alias,
  selected,
  aliases,
  allChecked,
  allIndeterminate,
  expanded,
  onToggleExpand,
  onToggleAll,
  onToggleField,
  onAliasChange,
}: JoinKeepFieldSectionProps) {
  const tr = useFormTranslation('join');

  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = Boolean(allIndeterminate);
    }
  }, [allIndeterminate]);

  return (
    <div
      className={`flex min-h-0 flex-col border-b border-border-muted/50 last:border-b-0 ${
        expanded ? 'flex-1' : 'shrink-0'
      }`}
    >
      <div className="flex shrink-0 items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
          <span className="truncate text-[12px] font-medium text-text-secondary">{title}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
            {selected.size}/{fields.length}
          </span>
        </button>
        <label
          onClick={(event) => event.stopPropagation()}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary"
        >
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allChecked}
            onChange={onToggleAll}
            className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
          />
          {tr('selectAllFields')}
        </label>
      </div>
      {expanded && (
        <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          <div className="grid grid-cols-2 gap-x-4">
            {fields.map((field) => {
              const qualifiedField = qualifyJoinField(alias, field);
              const isChecked = selected.has(qualifiedField);
              const fieldAlias = aliases.get(qualifiedField) ?? '';
              return (
                <div
                  key={field}
                  className="flex h-7 items-center gap-2 rounded-md px-1 text-[12px] text-text-primary hover:bg-surface-hover"
                >
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
                    className={`h-6 w-32 shrink-0 rounded-md border border-border-muted/60 bg-surface px-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted/50 focus:border-accent ${
                      isChecked ? '' : 'invisible'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
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
  const [expanded, setExpanded] = useState({ left: true, right: true });

  function toggleExpand(side: 'left' | 'right') {
    setExpanded((prev) => ({ ...prev, [side]: !prev[side] }));
  }

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
    <Dialog
      open
      onOpenChange={onCancel}
      closeOnOverlayClick
      ariaLabel={tr('joinFieldSettings')}
      overlayClassName="bg-black/28 px-4 py-6"
      className="h-[560px] w-[800px] max-w-[92vw] gap-0 rounded-xl p-0 shadow-card"
    >
      <div className="flex items-center justify-between border-b border-border-muted/50 px-4 py-3">
        <h3 className="text-[13px] font-semibold text-text-primary">{tr('joinFieldSettings')}</h3>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <JoinKeepFieldSection
          title={leftTitle}
          fields={leftFields}
          alias={leftAlias}
          selected={draft.leftSelected}
          aliases={draft.leftAliases}
          allChecked={leftAllChecked}
          allIndeterminate={leftIndeterminate}
          expanded={expanded.left}
          onToggleExpand={() => toggleExpand('left')}
          onToggleAll={() => toggleAll('left')}
          onToggleField={(field) => toggleField('left', field)}
          onAliasChange={(field, alias) => updateAlias('left', field, alias)}
        />
        <JoinKeepFieldSection
          title={rightTitle}
          fields={rightFields}
          alias={rightAlias}
          selected={draft.rightSelected}
          aliases={draft.rightAliases}
          allChecked={rightAllChecked}
          allIndeterminate={rightIndeterminate}
          expanded={expanded.right}
          onToggleExpand={() => toggleExpand('right')}
          onToggleAll={() => toggleAll('right')}
          onToggleField={(field) => toggleField('right', field)}
          onAliasChange={(field, alias) => updateAlias('right', field, alias)}
        />
      </div>
      <div className="flex items-center gap-x-2.5 whitespace-nowrap border-t border-border-muted/50 px-4 py-3">
        <span className="shrink-0 text-[12px] text-text-primary">{tr('conflict')}</span>
        <GlassOptionSingleSelect
          value={draft.conflict.strategy}
          groups={conflictGroups}
          onChange={(v) => updateConflict({ strategy: v })}
          className="h-8 w-36 text-[12px] [&>span]:text-left"
        />
        {draft.conflict.strategy === 'suffix' ? (
          <>
            <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
              {tr('conflictLeftSuffix')}
              <GlassFormTextInput
                value={draft.conflict.leftSuffix}
                onChange={(v) => updateConflict({ leftSuffix: v })}
                placeholder={JOIN_CONFLICT_DEFAULTS.leftSuffix}
                className="h-8 w-20 text-[12px]"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
              {tr('conflictRightSuffix')}
              <GlassFormTextInput
                value={draft.conflict.rightSuffix}
                onChange={(v) => updateConflict({ rightSuffix: v })}
                placeholder={JOIN_CONFLICT_DEFAULTS.rightSuffix}
                className="h-8 w-20 text-[12px]"
              />
            </label>
          </>
        ) : (
          <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
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
        <Button variant="secondary" size="sm" onClick={onCancel} className="text-[12px]">
          {tr('cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={confirm} className="text-[12px]">
          {tr('confirm')}
        </Button>
      </div>
    </Dialog>
  );
}
