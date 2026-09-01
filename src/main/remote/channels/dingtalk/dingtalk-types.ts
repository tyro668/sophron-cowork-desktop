export interface DingtalkRobotPayload {
  conversationId?: string;
  conversationType?: string;
  msgId?: string;
  msgtype?: string;
  text?: { content?: string };
  senderNick?: string;
  senderStaffId?: string;
  senderId?: string;
  createAt?: number;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
  robotCode?: string;
}

export interface DingtalkSessionContext {
  sessionWebhook?: string;
  expiresAt: number;
  robotCode?: string;
}

export type DingtalkOutboundContent =
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; title: string; text: string };

export type DingtalkTarget = { kind: 'group'; id: string } | { kind: 'dm'; id: string };

export function parseDingtalkTarget(channelId: string): DingtalkTarget {
  if (channelId.startsWith('group:')) {
    return { kind: 'group', id: channelId.slice('group:'.length) };
  }
  if (channelId.startsWith('dm:')) {
    return { kind: 'dm', id: channelId.slice('dm:'.length) };
  }
  throw new Error(`Invalid DingTalk channel target: ${channelId}`);
}
