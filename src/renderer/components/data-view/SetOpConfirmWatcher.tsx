import { useCallback, useEffect, useRef } from 'react';
import { useConfirmDialog } from '../ConfirmDialog';

export function SetOpConfirmWatcher() {
  const { confirm } = useConfirmDialog();
  const processingRef = useRef(false);

  const handleConfirm = useCallback(
    async (payload: { channel: string; warnings: string[] }) => {
      if (processingRef.current) return;
      processingRef.current = true;
      try {
        const confirmed = await confirm({
          title: '列类型不匹配',
          message: (
            <div>
              <p>左右两表的列类型不完全匹配：</p>
              <pre className="mt-2 whitespace-pre-wrap text-[12px]">
                {payload.warnings.join('\n')}
              </pre>
            </div>
          ),
          confirmLabel: '忽略警告，继续执行',
          cancelLabel: '取消执行',
        });
        window.electronAPI?.data?.confirmSetOp?.(payload.channel, confirmed);
      } finally {
        processingRef.current = false;
      }
    },
    [confirm]
  );

  useEffect(() => {
    const cleanup = window.electronAPI?.data?.onSetOpConfirm?.(handleConfirm);
    return () => cleanup?.();
  }, [handleConfirm]);

  return null;
}
