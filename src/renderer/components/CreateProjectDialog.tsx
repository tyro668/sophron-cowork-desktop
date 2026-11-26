import { useEffect, useId, useState, type FormEvent } from 'react';
import { Folder, FolderPlus, Laptop, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from './ui';

export interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectFolders: () => Promise<string[]>;
  onCreateProject: (
    folders: string[],
    name: string | null
  ) => Promise<{ success: boolean; error?: string }>;
}

function getFolderBaseName(folderPath: string): string {
  const normalized = folderPath.trim().replace(/[\\/]+$/, '');
  if (!normalized) return '';
  return normalized.split(/[/\\]/).filter(Boolean).pop() ?? normalized;
}

function normalizeFolderKey(folderPath: string): string {
  return folderPath.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onSelectFolders,
  onCreateProject,
}: CreateProjectDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const nameInputId = useId();

  const [projectName, setProjectName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [selectingFolder, setSelectingFolder] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProjectName('');
    setNameEdited(false);
    setFolders([]);
    setSelectingFolder(false);
    setSubmitting(false);
    setError(null);
  }, [open]);

  const handleAddFolders = async () => {
    if (selectingFolder || submitting) return;
    setSelectingFolder(true);
    setError(null);
    try {
      const selected = await onSelectFolders();
      const incoming = selected.map((item) => item.trim()).filter(Boolean);
      if (incoming.length === 0) return;

      setFolders((prev) => {
        const seen = new Set(prev.map(normalizeFolderKey));
        const merged = [...prev];
        for (const folder of incoming) {
          const key = normalizeFolderKey(folder);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          merged.push(folder);
        }
        return merged;
      });

      if (!nameEdited && !projectName.trim()) {
        setProjectName(getFolderBaseName(incoming[0]));
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `${t('welcome.selectWorkingFolderFailed')}: ${err.message}`
          : t('welcome.selectWorkingFolderFailed')
      );
    } finally {
      setSelectingFolder(false);
    }
  };

  const handleRemoveFolder = (folderToRemove: string) => {
    setFolders((prev) => prev.filter((item) => item !== folderToRemove));
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (folders.length === 0) {
      setError(t('welcome.projectFolderRequired'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await onCreateProject(folders, projectName.trim() || null);
      if (result.success) {
        onOpenChange(false);
      } else {
        setError(result.error || t('welcome.createProjectFailed'));
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message ? err.message : t('welcome.createProjectFailed')
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      busy={submitting}
      ariaLabelledBy={titleId}
      className="max-w-[500px] gap-4 rounded-2xl p-5"
    >
      <DialogHeader className="items-center">
        <DialogTitle id={titleId} className="text-[17px]">
          {t('welcome.createProjectTitle')}
        </DialogTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
          aria-label={t('common.close')}
          className="h-7 w-7 shrink-0 text-text-muted hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </Button>
      </DialogHeader>

      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <DialogBody className="space-y-4 overflow-visible">
          <div className="flex h-11 items-center overflow-hidden rounded-xl border border-border-muted bg-surface transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
            <div className="flex h-full w-11 shrink-0 items-center justify-center border-r border-border-subtle text-text-secondary">
              <Folder className="h-4 w-4" />
            </div>
            <input
              id={nameInputId}
              data-autofocus
              type="text"
              value={projectName}
              onChange={(event) => {
                setProjectName(event.target.value);
                setNameEdited(true);
              }}
              placeholder={t('welcome.projectNamePlaceholder')}
              aria-label={t('welcome.projectNameLabel')}
              disabled={submitting}
              className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-[14px] text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-text-primary">
                {t('welcome.sourceFoldersLabel')}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-text-muted">
                <Laptop className="h-3.5 w-3.5" />
                <span>{t('welcome.thisComputer')}</span>
              </span>
            </div>

            <div
              className={`overflow-hidden rounded-xl border bg-surface transition-colors ${
                error ? 'border-error' : 'border-border-muted'
              }`}
            >
              {folders.length === 0 ? (
                <div className="flex min-h-[112px] flex-col items-center justify-center px-4 py-6">
                  <button
                    type="button"
                    onClick={() => void handleAddFolders()}
                    disabled={selectingFolder || submitting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-surface-hover px-4 py-2 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-active disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FolderPlus className="h-4 w-4 text-text-secondary" />
                    <span>{t('welcome.addFolder')}</span>
                  </button>
                </div>
              ) : (
                <div>
                  <div className="scrollbar-hover max-h-48 divide-y divide-border-subtle overflow-y-auto">
                    {folders.map((folder) => (
                      <div
                        key={folder}
                        className="flex h-11 items-center gap-2.5 px-3.5 text-[13.5px]"
                        title={folder}
                      >
                        <Folder className="h-4 w-4 shrink-0 text-text-muted" />
                        <span className="min-w-0 flex-1 truncate text-text-primary">
                          {getFolderBaseName(folder)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFolder(folder)}
                          disabled={submitting}
                          aria-label={t('welcome.removeFolder')}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleAddFolders()}
                    disabled={selectingFolder || submitting}
                    className="flex h-11 w-full items-center gap-2.5 border-t border-border-subtle bg-surface-hover/55 px-3.5 text-left text-[13.5px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FolderPlus className="h-4 w-4 shrink-0 text-text-muted" />
                    <span>{t('welcome.addFolder')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-[12px] text-error">
              {error}
            </p>
          )}
        </DialogBody>

        <DialogFooter className="pt-1">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="rounded-xl px-4"
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={folders.length === 0 || submitting}
            className="rounded-xl px-5"
          >
            {t('welcome.createProjectConfirm')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
