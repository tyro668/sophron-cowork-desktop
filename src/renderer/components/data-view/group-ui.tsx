/**
 * Shared grouping UI for the data lists (tasks / input tables / output
 * tables): section chunking, collapsible group header rows, and the
 * move-to-group / rename dialogs. All pieces are presentational — IPC stays
 * in the page's action layer.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Folder, Pencil, Trash2 } from 'lucide-react';
/** Minimal group shape — DataGroup and AutomationGroup both satisfy it. */
export interface DataListGroup {
  id: string;
  name: string;
}
import {
  Button,
  cn,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '../ui';

export interface GroupSection<T> {
  key: string;
  group: DataListGroup | null;
  rows: T[];
}

/**
 * Chunks a page of rows (already ordered grouped-first by the dashboard
 * query) into consecutive sections. Rows whose groupId no longer resolves
 * fall into the ungrouped section.
 */
export function buildGroupSections<T>(
  rows: T[],
  groups: DataListGroup[],
  getGroupId: (row: T) => string | null
): GroupSection<T>[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const sections: GroupSection<T>[] = [];
  for (const row of rows) {
    const groupId = getGroupId(row);
    const group = groupId ? (byId.get(groupId) ?? null) : null;
    const key = group ? `g:${group.id}` : 'ungrouped';
    const last = sections[sections.length - 1];
    if (last && last.key === key) {
      last.rows.push(row);
    } else {
      sections.push({ key, group, rows: [row] });
    }
  }
  return sections;
}

/** Whether any section header should render at all (flat list otherwise). */
export function hasNamedSections<T>(sections: GroupSection<T>[]): boolean {
  return sections.some((section) => section.group !== null);
}

export function toggleCollapsed(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

export function GroupHeaderRow({
  colSpan,
  group,
  count,
  collapsed,
  onToggle,
  onRename,
  onDelete,
}: {
  colSpan: number;
  group: DataListGroup | null;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onRename?: (group: DataListGroup) => void;
  onDelete?: (group: DataListGroup) => void;
}) {
  const { t } = useTranslation();
  return (
    <tr className="border-b border-border-muted/85 bg-surface-muted/50">
      <td colSpan={colSpan} className="px-4">
        <div className="flex h-[3.25rem] items-center gap-1.5">
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            aria-expanded={!collapsed}
          >
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform',
                !collapsed && 'rotate-90'
              )}
            />
            <Folder className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
            <span className="truncate text-xs font-medium text-text-primary">
              {group ? group.name : t('data.groups.ungrouped')}
            </span>
            <span className="flex-shrink-0 text-xs text-text-muted">{count}</span>
          </button>
          {group && onRename && onDelete && (
            <div className="flex flex-shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => onRename(group)}
                title={t('data.groups.rename')}
                aria-label={t('data.groups.rename')}
                className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-accent-muted hover:text-accent"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(group)}
                title={t('data.groups.delete')}
                aria-label={t('data.groups.delete')}
                className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-error/10 hover:text-error"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

const NEW_GROUP_VALUE = '__new__';

export interface AssignGroupTarget {
  /** Resolved existing group id, or null for the ungrouped section. */
  groupId: string | null;
  /** When set, the caller creates the group first and assigns into it. */
  newGroupName?: string;
}

export function AssignGroupDialog({
  open,
  onOpenChange,
  groups,
  currentGroupId,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: DataListGroup[];
  currentGroupId: string | null;
  busy?: boolean;
  onSubmit: (target: AssignGroupTarget) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(currentGroupId ?? '');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (open) {
      setSelected(currentGroupId ?? '');
      setNewName('');
    }
  }, [open, currentGroupId]);

  const isNew = selected === NEW_GROUP_VALUE;
  const canSubmit = !isNew || newName.trim().length > 0;

  const optionClass = (value: string) =>
    cn(
      'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors',
      selected === value
        ? 'border-accent/40 bg-accent-muted text-text-primary'
        : 'border-border-subtle text-text-secondary hover:bg-surface-hover/40'
    );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      ariaLabel={t('data.groups.assignTitle')}
      className="max-w-sm"
    >
      <DialogHeader>
        <DialogTitle>{t('data.groups.assignTitle')}</DialogTitle>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-1.5">
        <label className={optionClass('')}>
          <input
            type="radio"
            name="assign-group"
            checked={selected === ''}
            onChange={() => setSelected('')}
            className="h-3.5 w-3.5 accent-accent"
          />
          {t('data.groups.ungrouped')}
        </label>
        {groups.map((group) => (
          <label key={group.id} className={optionClass(group.id)}>
            <input
              type="radio"
              name="assign-group"
              checked={selected === group.id}
              onChange={() => setSelected(group.id)}
              className="h-3.5 w-3.5 accent-accent"
            />
            <Folder className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
            <span className="truncate">{group.name}</span>
          </label>
        ))}
        <label className={optionClass(NEW_GROUP_VALUE)}>
          <input
            type="radio"
            name="assign-group"
            checked={isNew}
            onChange={() => setSelected(NEW_GROUP_VALUE)}
            className="h-3.5 w-3.5 accent-accent"
          />
          {t('data.groups.newGroup')}
        </label>
        {isNew && (
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t('data.groups.namePlaceholder')}
            data-autofocus
            className="mt-1 text-[13px]"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) {
                onSubmit({ groupId: null, newGroupName: newName.trim() });
              }
            }}
          />
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!canSubmit || busy}
          onClick={() =>
            onSubmit(
              isNew
                ? { groupId: null, newGroupName: newName.trim() }
                : { groupId: selected || null }
            )
          }
        >
          {t('data.groups.move')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export function GroupNameDialog({
  open,
  onOpenChange,
  initialName,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  busy?: boolean;
  onSubmit: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) {
      setName(initialName);
    }
  }, [open, initialName]);

  const trimmed = name.trim();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      ariaLabel={t('data.groups.rename')}
      className="max-w-sm"
    >
      <DialogHeader>
        <DialogTitle>{t('data.groups.rename')}</DialogTitle>
      </DialogHeader>
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t('data.groups.namePlaceholder')}
        data-autofocus
        className="text-[13px]"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && trimmed) {
            onSubmit(trimmed);
          }
        }}
      />
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={!trimmed || busy} onClick={() => onSubmit(trimmed)}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
