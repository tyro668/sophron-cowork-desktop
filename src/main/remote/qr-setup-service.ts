import { registerDingtalk } from './channels/dingtalk/dingtalk-registration';
import { registerWecom } from './channels/wecom/wecom-registration';
import { registerWechat } from './channels/wechat/wechat-registration';
import { registerFeishuApp } from './channels/feishu/feishu-registration';
import QRCode from 'qrcode';
import type {
  FeishuChannelConfig,
  WechatChannelConfig,
  DingtalkChannelConfig,
  WecomChannelConfig,
} from '../../shared/contracts/remote';
import type { RemoteQrSetupState, RemoteQrChannel } from '../../shared/contracts/remote/qr-setup';

type Session = {
  owner: number;
  channel: RemoteQrChannel;
  verifyCode?: string;
  state: RemoteQrSetupState;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
};

/** Owns a single registration attempt; stale callbacks can never overwrite a newer setup. */
export class RemoteQrSetupService {
  private session?: Session;

  constructor(
    private readonly save: (
      config: FeishuChannelConfig | WechatChannelConfig | DingtalkChannelConfig | WecomChannelConfig
    ) => Promise<void>,
    private readonly register = registerFeishuApp,
    private readonly encode = (url: string) => QRCode.toDataURL(url, { width: 280, margin: 4 })
  ) {}

  begin(owner: number, id: string, channel: RemoteQrChannel): RemoteQrSetupState {
    if (this.session?.state.status === 'saving') throw new Error('Setup is being saved');
    if (this.session) this.stop(this.session, 'cancelled');
    const session: Session = {
      owner,
      channel,
      state: { id, status: 'generating' },
      controller: new AbortController(),
    };
    this.session = session;
    // Bound the full initialization, including encoding and provider requests.
    session.timer = setTimeout(() => this.fail(session, 'registration_failed'), 30_000);
    void this.run(session);
    return this.snapshot(session);
  }

  get(owner: number, id: string): RemoteQrSetupState {
    const session = this.session;
    if (!session || session.owner !== owner || session.state.id !== id) {
      return { id, status: 'cancelled' };
    }
    return this.snapshot(session);
  }

  cancel(owner: number, id?: string): void {
    const session = this.session;
    if (!session || session.owner !== owner || (id && session.state.id !== id)) return;
    // Saving is already committed to by the phone authorization and cannot be undone by closing UI.
    if (session.state.status === 'saving') return;
    this.stop(session, 'cancelled');
    this.session = undefined;
  }

  submitCode(owner: number, id: string, code: string): void {
    const session = this.session;
    if (session?.owner !== owner || session.state.id !== id || session.state.status !== 'verifying')
      return;
    session.verifyCode = code;
    session.state.status = 'scanned';
  }

  private snapshot(session: Session): RemoteQrSetupState {
    return { ...session.state };
  }

  private active(session: Session): boolean {
    return this.session === session && !session.controller.signal.aborted;
  }

  private stop(session: Session, status: RemoteQrSetupState['status']): void {
    clearTimeout(session.timer);
    session.state = { id: session.state.id, status };
    session.controller.abort();
  }

  private fail(session: Session, errorCode: RemoteQrSetupState['errorCode']): void {
    if (!this.active(session)) return;
    this.stop(session, 'failed');
    session.state.errorCode = errorCode;
  }

  private async run(session: Session): Promise<void> {
    try {
      const onQRCodeReady = ({ url, expireIn }: { url: string; expireIn: number }) => {
        if (!this.active(session)) return;
        const target = new URL(url);
        const isWechat = session.channel === 'wechat' || session.channel === 'wecom';
        const trusted = isWechat
          ? target.hostname === 'weixin.qq.com' || target.hostname.endsWith('.weixin.qq.com')
          : session.channel === 'dingtalk'
            ? target.hostname === 'dingtalk.com' || target.hostname.endsWith('.dingtalk.com')
            : [
                'accounts.feishu.cn',
                'open.feishu.cn',
                'accounts.larksuite.com',
                'open.larksuite.com',
              ].includes(target.hostname);
        if (
          target.protocol !== 'https:' ||
          !trusted ||
          target.username ||
          target.password ||
          target.port
        ) {
          this.fail(session, 'registration_failed');
          return;
        }
        // Registration and QR landing pages use different official hosts.
        // Preserve the provider's URL, including Lark's launcher host and query.
        const expiresAt =
          Date.now() +
          (Number.isFinite(expireIn) ? Math.min(Math.max(expireIn, 1), 7200) : 600) * 1000;
        clearTimeout(session.timer);
        session.timer = setTimeout(() => {
          if (this.active(session)) this.stop(session, 'expired');
        }, expiresAt - Date.now());
        void this.encode(target.toString())
          .then((qrCodeDataUrl) => {
            if (
              !this.active(session) ||
              !['generating', 'waiting', 'scanned', 'verifying'].includes(session.state.status)
            )
              return;
            session.state = {
              ...session.state,
              status: session.state.status === 'generating' ? 'waiting' : session.state.status,
              qrCodeDataUrl,
              expiresAt,
            };
          })
          .catch(() => this.fail(session, 'registration_failed'));
      };
      let config:
        | FeishuChannelConfig
        | WechatChannelConfig
        | DingtalkChannelConfig
        | WecomChannelConfig;
      if (session.channel === 'dingtalk') {
        config = await registerDingtalk({ signal: session.controller.signal, onQRCodeReady });
      } else if (session.channel === 'wecom') {
        config = await registerWecom({ signal: session.controller.signal, onQRCodeReady });
      } else if (session.channel === 'wechat') {
        config = await registerWechat({
          signal: session.controller.signal,
          onQRCodeReady,
          onStatus: (status) => {
            if (this.active(session)) session.state.status = status;
          },
          takeVerifyCode: () => {
            const code = session.verifyCode;
            session.verifyCode = undefined;
            return code;
          },
        });
      } else {
        let brand: 'feishu' | 'lark' = session.channel;
        const result = await this.register({
          domain: session.channel === 'lark' ? 'accounts.larksuite.com' : 'accounts.feishu.cn',
          source: 'sophron',
          signal: session.controller.signal,
          createOnly: true,
          addons: {
            scopes: {
              tenant: [
                'im:resource',
                'im:message',
                'im:message:send_as_bot',
                'im:message.group_at_msg:readonly',
                'im:message.p2p_msg:readonly',
                'contact:user.base:readonly',
              ],
            },
            events: { items: { tenant: ['im.message.receive_v1'] } },
            callbacks: { items: ['card.action.trigger'] },
          },
          onQRCodeReady,
          onStatusChange: ({ status }) => {
            if (status === 'domain_switched') brand = 'lark';
          },
        });
        if (!this.active(session)) return;
        if ((result.user_info?.tenant_brand ?? brand) !== session.channel) {
          this.fail(session, 'unsupported_brand');
          return;
        }
        if (!result.client_id || !result.client_secret)
          throw new Error('Incomplete app credentials');
        config = {
          type: session.channel,
          enabled: true,
          appId: result.client_id,
          appSecret: result.client_secret,
          useWebSocket: true,
          dm: { policy: 'pairing' },
          defaultGroupSettings: { requireMention: true },
        };
      }
      if (!this.active(session)) return;
      clearTimeout(session.timer);
      session.state = { id: session.state.id, status: 'saving' };
      await this.save(config);
      session.state = { id: session.state.id, status: 'completed' };
    } catch (error) {
      if (!this.active(session)) return;
      const code = (error as { code?: string } | null)?.code;
      if (code === 'expired_token' || code === 'access_denied') {
        this.stop(session, code === 'expired_token' ? 'expired' : 'denied');
      } else {
        // Never expose SDK errors: HTTP request objects can contain app credentials/device codes.
        this.fail(
          session,
          session.state.status === 'saving' ? 'save_failed' : 'registration_failed'
        );
      }
    }
  }
}
