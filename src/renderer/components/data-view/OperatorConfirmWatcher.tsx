import { useCallback, useEffect, useRef } from 'react';
import { useConfirmDialog } from '../ConfirmDialog';

interface OperatorConfirmPayload {
  channel: string;
  title?: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function OperatorConfirmWatcher() {
  const { confirm } = useConfirmDialog();
  const processingRef = useRef(false);

  const handleConfirm = useCallback(
    async (payload: OperatorConfirmPayload) => {
      if (processingRef.current) return;
      processingRef.current = true;
      try {
        const confirmed = await confirm({
          title: payload.title ?? '操作确认',
          message: (
            <div>
              <p>{payload.message}</p>
              {payload.detail && (
                <pre className="mt-2 whitespace-pre-wrap text-[12px]">{payload.detail}</pre>
              )}
            </div>
          ),
          confirmLabel: payload.confirmLabel ?? '继续执行',
          cancelLabel: payload.cancelLabel ?? '取消',
        });
        window.electronAPI?.data?.respondOperatorConfirm?.(payload.channel, confirmed);
      } finally {
        processingRef.current = false;
      }
    },
    [confirm]
  );

  useEffect(() => {
    const cleanup = window.electronAPI?.data?.onOperatorConfirm?.(handleConfirm);
    return () => cleanup?.();
  }, [handleConfirm]);

  return null;
}
