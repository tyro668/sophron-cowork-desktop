/**
 * 云连接状态订阅 + 统一的动作执行（busy 标记、失败 toast）。数据页与设置页共用。
 */
import { useCallback, useEffect, useState } from 'react';

import type {
  CloudConnectionActionResult,
  CloudConnectionState,
} from '../../../../shared/contracts';
import {
  CLOUD_CONNECT_TIMEOUT_ERROR,
  CLOUD_CONNECT_TIMEOUT_MS,
} from '../../../../shared/contracts';
import { showToast } from '../../../utils/toast';
import { cloudConnectionClient } from '../api/cloud-connection-client';

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isLiveStatus(state: CloudConnectionState | null): boolean {
  return state ? ['connecting', 'connected', 'reconnecting'].includes(state.status) : false;
}

/** 发起连接之后，把后续状态归为成功、失败或仍在等待。 */
export function settleCloudConnectState(
  state: CloudConnectionState
): 'success' | 'failure' | 'pending' {
  if (state.status === 'connected') return 'success';
  if (state.status === 'connecting' || state.status === 'reconnecting') {
    return state.lastError ? 'failure' : 'pending';
  }
  return 'failure';
}

/**
 * 在已调用 `connect()` 后等待首次连接结果。成功 / 失败 / 超时后结束。
 * 超时文案与主进程保持一致，避免依赖渲染进程自己再拆一次连接。
 */
export function waitForCloudConnectionResult(options?: {
  timeoutMs?: number;
  timeoutError?: string;
}): Promise<{ ok: boolean; error?: string; state: CloudConnectionState | null }> {
  const timeoutMs = options?.timeoutMs ?? CLOUD_CONNECT_TIMEOUT_MS;
  const timeoutError = options?.timeoutError ?? CLOUD_CONNECT_TIMEOUT_ERROR;
  return new Promise((resolve) => {
    let settled = false;
    let off: () => void = () => undefined;
    const finish = (result: {
      ok: boolean;
      error?: string;
      state: CloudConnectionState | null;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      resolve(result);
    };
    const consider = (state: CloudConnectionState) => {
      const settledState = settleCloudConnectState(state);
      if (settledState === 'success') finish({ ok: true, state });
      else if (settledState === 'failure') {
        finish({ ok: false, error: state.lastError ?? timeoutError, state });
      }
    };
    const timer = setTimeout(() => {
      void cloudConnectionClient
        .getState()
        .then((state) => {
          if (state.status === 'connected') finish({ ok: true, state });
          else finish({ ok: false, error: state.lastError ?? timeoutError, state });
        })
        .catch(() => finish({ ok: false, error: timeoutError, state: null }));
    }, timeoutMs);
    off = cloudConnectionClient.onState(consider);
    void cloudConnectionClient
      .getState()
      .then(consider)
      .catch(() => undefined);
  });
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
