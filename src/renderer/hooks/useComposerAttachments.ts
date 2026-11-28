import { useCallback, useState } from 'react';
import type { CloudTableChatAttachment, ContentBlock } from '../../shared/contracts';

export interface AttachedFile {
  name: string;
  path: string;
  size: number;
  type: string;
  inlineDataBase64?: string;
}

export interface PastedImage {
  url: string;
  base64: string;
  mediaType: string;
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

// Model API limit is 5MB for base64 encoded images; base64 adds ~33% overhead.
const MAX_IMAGE_BLOB_BYTES = 3.75 * 1024 * 1024;

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader result is not a string'));
        return;
      }
      const parts = result.split(',');
      resolve(parts[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function resizeImageIfNeeded(blob: Blob): Promise<Blob> {
  if (blob.size <= MAX_IMAGE_BLOB_BYTES) {
    return blob;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      const scale = Math.sqrt(MAX_IMAGE_BLOB_BYTES / blob.size);
      const quality = 0.9;

      const attemptCompress = (currentScale: number, currentQuality: number): Promise<Blob> => {
        canvas.width = Math.floor(img.width * currentScale);
        canvas.height = Math.floor(img.height * currentScale);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        return new Promise((resolveBlob) => {
          canvas.toBlob(
            (compressedBlob) => {
              if (!compressedBlob) {
                reject(new Error('Failed to compress image'));
                return;
              }

              if (
                compressedBlob.size > MAX_IMAGE_BLOB_BYTES &&
                (currentQuality > 0.5 || currentScale > 0.3)
              ) {
                const newQuality = Math.max(0.5, currentQuality - 0.1);
                const newScale = currentQuality <= 0.5 ? currentScale * 0.9 : currentScale;
                void attemptCompress(newScale, newQuality).then(resolveBlob);
              } else {
                resolveBlob(compressedBlob);
              }
            },
            blob.type || 'image/jpeg',
            currentQuality
          );
        });
      };

      attemptCompress(scale, quality).then(resolve).catch(reject);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

export function buildComposerContentBlocks({
  prompt,
  pastedImages,
  attachedFiles,
  attachedCloudTables,
}: {
  prompt: string;
  pastedImages: PastedImage[];
  attachedFiles: AttachedFile[];
  attachedCloudTables: CloudTableChatAttachment[];
}): ContentBlock[] {
  const contentBlocks: ContentBlock[] = [];

  for (const img of pastedImages) {
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType as ImageMediaType,
        data: img.base64,
      },
    });
  }

  for (const file of attachedFiles) {
    contentBlocks.push({
      type: 'file_attachment',
      filename: file.name,
      relativePath: file.path,
      size: file.size,
      mimeType: file.type,
      inlineDataBase64: file.inlineDataBase64,
    });
  }

  if (attachedCloudTables.length > 0) {
    contentBlocks.push({
      type: 'cloud_table_attachment',
      tables: attachedCloudTables,
    });
  }

  const trimmed = prompt.trim();
  if (trimmed) {
    contentBlocks.push({
      type: 'text',
      text: trimmed,
    });
  }

  return contentBlocks;
}

interface UseComposerAttachmentsOptions {
  isElectron: boolean;
  onImageProcessError?: () => void;
}

export function useComposerAttachments({
  isElectron,
  onImageProcessError,
}: UseComposerAttachmentsOptions) {
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const encodeImageBlobs = useCallback(
    async (blobs: Blob[]) => {
      const encoded: PastedImage[] = [];
      for (const blob of blobs) {
        try {
          const resizedBlob = await resizeImageIfNeeded(blob);
          const base64 = await blobToBase64(resizedBlob);
          const url = URL.createObjectURL(resizedBlob);
          encoded.push({
            url,
            base64,
            mediaType: resizedBlob.type,
          });
        } catch {
          onImageProcessError?.();
        }
      }
      if (encoded.length > 0) {
        setPastedImages((prev) => [...prev, ...encoded]);
      }
    },
    [onImageProcessError]
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;

      e.preventDefault();
      const blobs = imageItems
        .map((item) => item.getAsFile())
        .filter((blob): blob is File => blob !== null);
      await encodeImageBlobs(blobs);
    },
    [encodeImageBlobs]
  );

  const removeImage = useCallback((index: number) => {
    setPastedImages((prev) => {
      const updated = [...prev];
      const removed = updated[index];
      if (removed) URL.revokeObjectURL(removed.url);
      updated.splice(index, 1);
      return updated;
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => {
      const updated = [...prev];
      updated.splice(index, 1);
      return updated;
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const attachFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      const otherFiles = files.filter((file) => !file.type.startsWith('image/'));

      if (imageFiles.length > 0) {
        await encodeImageBlobs(imageFiles);
      }

      if (otherFiles.length > 0) {
        const newFiles: AttachedFile[] = await Promise.all(
          otherFiles.map(async (file) => {
            const filePath = window.electronAPI?.getPathForFile(file) || '';
            const inlineDataBase64 = filePath ? undefined : await blobToBase64(file);
            return {
              name: file.name,
              path: filePath,
              size: file.size,
              type: file.type || 'application/octet-stream',
              inlineDataBase64,
            };
          })
        );
        setAttachedFiles((prev) => [...prev, ...newFiles]);
      }
    },
    [encodeImageBlobs]
  );

  const handleFileSelect = useCallback(() => {
    if (!isElectron) return;
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.onchange = () => {
      void attachFiles(Array.from(picker.files ?? [])).catch((error) =>
        console.error('[Composer] Error selecting files:', error)
      );
    };
    picker.click();
  }, [attachFiles, isElectron]);

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      await attachFiles(Array.from(event.dataTransfer.files));
    },
    [attachFiles]
  );

  return {
    pastedImages,
    setPastedImages,
    attachedFiles,
    setAttachedFiles,
    isDragging,
    handlePaste,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeImage,
    removeFile,
  };
}
