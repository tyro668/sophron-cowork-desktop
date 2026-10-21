/**
 * Shared grouping UI for the data lists (pipelines / input tables / output
 * tables): section chunking, collapsible group header rows, and the
 * move-to-group / rename dialogs. All pieces are presentational — IPC stays
 * in the page's action layer.
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Folder, MoreVertical } from 'lucide-react';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
  const groupOrder = new Map(groups.map((group, index) => [group.id, index]));

  // Sort by group order (known groups first, unknown groups after, ungrouped last)
  // so all ungrouped rows form a single section and group headers render consistently.
  const sortedRows = [...rows].sort((a, b) => {
    const aId = getGroupId(a);
    const bId = getGroupId(b);
    if (aId === bId) return 0;
    if (!aId) return 1;
    if (!bId) return -1;
    const aOrder = groupOrder.get(aId) ?? groups.length;
    const bOrder = groupOrder.get(bId) ?? groups.length;
    return aOrder - bOrder;
  });

  const sections: GroupSection<T>[] = [];
  for (const row of sortedRows) {
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

/** Whether any section (including the ungrouped section) exists. */
export function hasNamedSections<T>(sections: GroupSection<T>[]): boolean {
  return sections.length > 0;
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
  page = 1,
  totalPages = 1,
  onPageChange,
}: {
  colSpan: number;
  group: DataListGroup | null;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onRename?: (group: DataListGroup) => void;
  onDelete?: (group: DataListGroup) => void;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
}) {
  const { t } = useTranslation();
  const hasPagination = totalPages > 1;
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <tr className="border-b border-border-muted/85 bg-surface-muted/50">
      <td colSpan={colSpan} className="px-3">
        <div className="flex h-8 items-center gap-1.5">
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
          <div className="flex flex-shrink-0 items-center gap-1">
            {hasPagination && (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={!canPrev}
                  onClick={() => onPageChange?.(page - 1)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={t('data.groups.prevPage', '上一页')}
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <span className="min-w-[2rem] text-center text-xs text-text-muted">
                  {page}/{totalPages}
                </span>
                <button
                  type="button"
                  disabled={!canNext}
                  onClick={() => onPageChange?.(page + 1)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={t('data.groups.nextPage', '下一页')}
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            )}
            {group && (onRename || onDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-accent-muted hover:text-accent"
                    aria-label={t('data.groups.actions', '分组操作')}
                  >
                    <MoreVertical className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onRename && (
                    <DropdownMenuItem onClick={() => onRename(group)}>
                      {t('data.groups.rename', '重命名')}
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <DropdownMenuItem
                      onClick={() => onDelete(group)}
                      className="text-error focus:text-error"
                    >
                      {t('data.groups.delete', '删除')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

export function GroupSectionRows<T>({
  colSpan,
  section,
  grouped,
  collapsed,
  onToggle,
  onRename,
  onDelete,
  count,
  page,
  pageSize,
  onPageChange,
  renderRow,
}: {
  colSpan: number;
  section: GroupSection<T>;
  grouped: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onRename?: (group: DataListGroup) => void;
  onDelete?: (group: DataListGroup) => void;
  count: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  renderRow: (row: T, index: number, indented: boolean) => ReactNode;
}) {
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  return (
    <Fragment key={section.key}>
      {grouped && (
        <GroupHeaderRow
          colSpan={colSpan}
          group={section.group}
          count={count}
          collapsed={collapsed}
          onToggle={onToggle}
          onRename={onRename}
          onDelete={onDelete}
          page={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      )}
      {!collapsed && section.rows.map((row, index) => renderRow(row, index, grouped))}
    </Fragment>
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
