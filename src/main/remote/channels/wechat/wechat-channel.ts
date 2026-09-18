import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ChannelBase, NonRetryableChannelError } from '../channel-base';
import type { RemoteResponse, WechatChannelConfig } from '../../types';
import { wechatRequest, WechatApiError, WECHAT_BASE_URL } from './wechat-api';

interface WechatUpdate {
  message_id?: string;
  from_user_id?: string;
  context_token?: string;
  message_type?: number;
  message_state?: number;
  group_id?: string;
  create_time_ms?: number;
  item_list?: Array<{
    type?: number;
    text_item?: { text?: string };
    voice_item?: { text?: string };
  }>;
}
interface Updates {
  msgs?: WechatUpdate[];
  get_updates_buf?: string;
}

/** iLink direct text messages (including server-transcribed voice). */
export class WechatChannel extends ChannelBase {
  readonly type = 'wechat' as const;
  private controller?: AbortController;
  private polling?: Promise<void>;
  private cursor = '';
  private contexts = new Map<string, string>();
  private seen = new Set<string>();

  constructor(
    private readonly config: WechatChannelConfig,
    private readonly request = wechatRequest
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.controller) return;
    if (!this.config.botToken || !this.config.botId) throw new Error('WeChat login required');
    const controller = new AbortController();
    this.controller = controller;
    try {
      await this.request(this.config.baseUrl || WECHAT_BASE_URL, 'getconfig', {
        body: { ilink_user_id: this.config.userId },
        token: this.config.botToken,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      this._connected = true;
      this.polling = this.poll(controller);
    } catch (error) {
      this.controller = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    await this.polling;
    this.controller = undefined;
    this.polling = undefined;
    this._connected = false;
    this.contexts.clear();
  }

  private async poll(controller: AbortController): Promise<void> {
    let failures = 0;
    while (!controller.signal.aborted) {
      try {
        const result = await this.request<Updates>(
          this.config.baseUrl || WECHAT_BASE_URL,
          'getupdates',
          {
            body: { get_updates_buf: this.cursor },
            token: this.config.botToken,
            signal: controller.signal,
            timeoutMs: 35_000,
          }
        );
        if (controller.signal.aborted) break;
        failures = 0;
        this._connected = true;
        for (const message of result.msgs || []) this.receive(message);
        if (result.get_updates_buf) this.cursor = result.get_updates_buf;
        await delay(1000, undefined, { signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) break;
        if (error instanceof Error && error.name === 'TimeoutError') continue;
        failures++;
        if (error instanceof WechatApiError && [-14, 401, 403].includes(error.code)) {
          this._connected = false;
          this.emitError(new Error('WeChat session expired; scan again in remote settings'));
          break;
        }
        if (failures === 3) {
          this._connected = false;
          this.emitError(new Error('WeChat connection interrupted'));
        }
        await delay(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)), undefined, {
          signal: controller.signal,
        }).catch(() => {});
      }
    }
  }

  private receive(message: WechatUpdate): void {
    const sender = message.from_user_id;
    if (!sender || message.message_type !== 1 || message.group_id || message.message_state === 1)
      return;
    const text = (message.item_list || [])
      .map((item) =>
        item.type === 1 ? item.text_item?.text : item.type === 3 ? item.voice_item?.text : ''
      )
      .filter(Boolean)
      .join('\n');
    if (!text || !message.context_token || !message.message_id) return;
    const id = message.message_id;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value!);
    this.contexts.set(sender, message.context_token);
    if (this.contexts.size > 1000) this.contexts.delete(this.contexts.keys().next().value!);
    this.emitMessage({
      id,
      channelType: 'wechat',
      channelId: sender,
      sender: { id: sender, isBot: false },
      content: { type: 'text', text },
      timestamp: message.create_time_ms || Date.now(),
      isGroup: false,
      isMentioned: false,
    });
  }

  async send(response: RemoteResponse): Promise<void> {
    const context = this.contexts.get(response.channelId);
    if (!context || !this._connected || !this.controller)
      throw new NonRetryableChannelError('WeChat reply context unavailable');
    const text = response.content.text || response.content.markdown;
    if (!text) throw new NonRetryableChannelError('WeChat supports text replies only');
    // A lost HTTP response cannot prove non-delivery; avoid automatic duplicate sends.
    try {
      for (const chunk of this.splitMessage(text, 2000)) {
        await this.request(this.config.baseUrl || WECHAT_BASE_URL, 'sendmessage', {
          token: this.config.botToken,
          signal: this.controller.signal,
          body: {
            msg: {
              from_user_id: '',
              to_user_id: response.channelId,
              client_id: randomUUID(),
              message_type: 2,
              message_state: 2,
              context_token: context,
              item_list: [{ type: 1, text_item: { text: chunk } }],
            },
          },
        });
      }
    } catch {
      throw new NonRetryableChannelError('WeChat message delivery could not be confirmed');
    }
  }
}
