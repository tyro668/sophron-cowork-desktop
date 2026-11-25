/**
 * 云连接状态订阅 + 统一的动作执行（busy 标记、失败 toast）。数据页与设置页共用。
 */
import { useCallback, useEffect, useState } from 'react';

import type {
  CloudConnectionActionResult,
  CloudConnectionState,
} from '../../../../shared/contracts';
import { showToast } from '../../../utils/toast';
import { cloudConnectionClient } from '../api/cloud-connection-client';

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isLiveStatus(state: CloudConnectionState | null): boolean {
  return state ? ['connecting', 'connected', 'reconnecting'].includes(state.status) : false;
}

export function useCloudConnection() {
  const [state, setState] = useState<CloudConnectionState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudConnectionClient.isAvailable()) return undefined;
    let active = true;
    void cloudConnectionClient.getState().then((s) => {
      if (active) setState(s);
    });
    const off = cloudConnectionClient.onState((s) => setState(s));
    return () => {
      active = false;
      off();
    };
  }, []);

  /** 执行一个动作；成功返回 true。 */
  const run = useCallback(
    async (key: string, action: () => Promise<CloudConnectionActionResult>): Promise<boolean> => {
      setBusy(key);
      try {
        const result = await action();
        setState(result.state);
        if (!result.success && result.error) showToast('error', result.error);
        return result.success;
      } catch (error) {
        showToast('error', errorText(error));
        return false;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  return { state, busy, run };
}
