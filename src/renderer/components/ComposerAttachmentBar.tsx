import { Table2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CloudTableChatAttachment } from '../../shared/contracts';
import type { AttachedFile, PastedImage } from '../hooks/useComposerAttachments';

interface ComposerAttachmentBarProps {
  pastedImages: PastedImage[];
  attachedFiles: AttachedFile[];
  attachedCloudTables: CloudTableChatAttachment[];
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
  onRemoveCloudTable: (index: number) => void;
}

export function ComposerAttachmentBar({
  pastedImages,
  attachedFiles,
  attachedCloudTables,
  onRemoveImage,
  onRemoveFile,
  onRemoveCloudTable,
}: ComposerAttachmentBarProps) {
  const { t } = useTranslation();

  return (
    <>
      {pastedImages.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {pastedImages.map((img, index) => (
            <div key={img.url || `pasted-image-${index}`} className="group relative">
              <img
                src={img.url}
                alt={t('common.pastedImageAlt', { index: index + 1 })}
                className="block aspect-square w-full rounded-lg border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => onRemoveImage(index)}
                aria-label={t('common.removeImage', { index: index + 1 })}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-error text-error-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {attachedFiles.length > 0 && (
        <div className="mb-3 space-y-2">
          {attachedFiles.map((file, index) => (
            <div
              key={file.path || `attached-file-${index}`}
              className="group flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-muted px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-text-primary">{file.name}</p>
              </div>
              <button
                type="button"
                onClick={() => onRemoveFile(index)}
                aria-label={t('common.removeAttachment', { name: file.name })}
                className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted opacity-0 transition-opacity hover:bg-error/10 hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {attachedCloudTables.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachedCloudTables.map((table, index) => (
            <div
              key={table.id}
              className="group inline-flex max-w-full items-center gap-2 rounded-lg bg-accent-muted px-3 py-1.5 text-[13px] text-accent-text"
            >
              <Table2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 truncate font-medium">{table.tableName}</span>
              {table.projectName && (
                <span className="hidden flex-shrink-0 text-[11px] text-text-muted sm:inline">
                  {table.projectName}
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemoveCloudTable(index)}
                aria-label={t('common.removeCloudTable', { name: table.tableName })}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-error/10 hover:text-error"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
