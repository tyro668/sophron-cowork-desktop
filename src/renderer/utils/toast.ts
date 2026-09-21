import { useAppStore, type GlobalNotice, type GlobalNoticeType } from '../store';

let toastSeq = 0;

/**
 * Show a transient overlay toast (fixed at the top of the window, auto-dismissed
 * by GlobalNoticeToast). Use this for action feedback instead of inline banners
 * that occupy layout space.
 */
export function showToast(
  type: GlobalNoticeType,
  message: string,
  options?: Partial<Pick<GlobalNotice, 'action' | 'actionLabel' | 'onAction'>>
) {
  useAppStore.getState().setGlobalNotice({
    id: `toast-${Date.now()}-${++toastSeq}`,
    type,
    message,
    ...options,
  });
}
