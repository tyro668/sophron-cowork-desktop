export type RemoteQrChannel = 'feishu' | 'lark' | 'wechat' | 'dingtalk' | 'wecom';
/** Public setup state. Credentials and device codes never cross the setup IPC boundary. */
export interface RemoteQrSetupState {
  id: string;
  status:
    | 'generating'
    | 'waiting'
    | 'scanned'
    | 'verifying'
    | 'saving'
    | 'completed'
    | 'expired'
    | 'denied'
    | 'failed'
    | 'cancelled';
  qrCodeDataUrl?: string;
  expiresAt?: number;
  errorCode?: 'unavailable' | 'registration_failed' | 'save_failed' | 'unsupported_brand';
}
