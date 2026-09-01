import { describe, expect, it } from 'vitest';
import { WecomWebhookCrypto } from '../src/main/remote/channels/wecom/wecom-webhook-crypto';

const TOKEN = 'Token123';
const AES_KEY = 'A'.repeat(43);

describe('WecomWebhookCrypto', () => {
  it('round-trips UTF-8 callback payloads and signs the ciphertext', () => {
    const crypto = new WecomWebhookCrypto(TOKEN, AES_KEY);
    const envelope = crypto.encrypt('{"content":"你好，企业微信"}', '1700000000', 'nonce-1');

    expect(crypto.decrypt(envelope.encrypt)).toBe('{"content":"你好，企业微信"}');
    expect(
      crypto.verifySignature(
        envelope.msgsignature,
        String(envelope.timestamp),
        envelope.nonce,
        envelope.encrypt
      )
    ).toBe(true);
    expect(
      crypto.verifySignature(
        envelope.msgsignature,
        String(envelope.timestamp),
        envelope.nonce,
        `${envelope.encrypt}tampered`
      )
    ).toBe(false);
  });

  it('validates callback credential formats', () => {
    expect(() => new WecomWebhookCrypto('bad-token!', AES_KEY)).toThrow('Token');
    expect(() => new WecomWebhookCrypto(TOKEN, 'short')).toThrow('EncodingAESKey');
  });
});
