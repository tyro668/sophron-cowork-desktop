import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const WECOM_PADDING_BLOCK_SIZE = 32;
const RANDOM_PREFIX_BYTES = 16;
const MESSAGE_LENGTH_BYTES = 4;

export interface WecomEncryptedEnvelope {
  encrypt: string;
  msgsignature: string;
  timestamp: number;
  nonce: string;
}

/**
 * Implements the WXBizMsgCrypt wire format used by WeCom AI Bot callbacks.
 * Internal AI bots use an empty ReceiveId, as required by the callback docs.
 */
export class WecomWebhookCrypto {
  private readonly aesKey: Buffer;
  private readonly iv: Buffer;

  constructor(
    private readonly token: string,
    encodingAESKey: string
  ) {
    if (!token || token.length > 32 || !/^[A-Za-z0-9]+$/.test(token)) {
      throw new Error('WeCom Webhook Token must contain 1-32 letters or digits');
    }
    if (!/^[A-Za-z0-9]{43}$/.test(encodingAESKey)) {
      throw new Error('WeCom EncodingAESKey must contain exactly 43 letters or digits');
    }

    this.aesKey = Buffer.from(`${encodingAESKey}=`, 'base64');
    if (this.aesKey.length !== 32) {
      throw new Error('Invalid WeCom EncodingAESKey');
    }
    this.iv = this.aesKey.subarray(0, 16);
  }

  verifySignature(signature: string, timestamp: string, nonce: string, encrypted: string): boolean {
    if (!signature || !timestamp || !nonce || !encrypted) return false;
    const expected = this.sign(timestamp, nonce, encrypted);
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(signature, 'utf8');
    return (
      expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }

  decrypt(encrypted: string): string {
    let ciphertext: Buffer;
    try {
      ciphertext = Buffer.from(encrypted, 'base64');
    } catch {
      throw new Error('Invalid WeCom encrypted payload');
    }
    if (!ciphertext.length || ciphertext.length % 16 !== 0) {
      throw new Error('Invalid WeCom encrypted payload');
    }

    const decipher = createDecipheriv('aes-256-cbc', this.aesKey, this.iv);
    decipher.setAutoPadding(false);
    const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plaintext = this.removePadding(padded);
    if (plaintext.length < RANDOM_PREFIX_BYTES + MESSAGE_LENGTH_BYTES) {
      throw new Error('Invalid WeCom decrypted payload');
    }

    const messageLength = plaintext.readUInt32BE(RANDOM_PREFIX_BYTES);
    const messageStart = RANDOM_PREFIX_BYTES + MESSAGE_LENGTH_BYTES;
    const messageEnd = messageStart + messageLength;
    if (messageEnd > plaintext.length) {
      throw new Error('Invalid WeCom message length');
    }

    const receiveId = plaintext.subarray(messageEnd).toString('utf8');
    if (receiveId !== '') {
      throw new Error('Unexpected WeCom ReceiveId');
    }
    return plaintext.subarray(messageStart, messageEnd).toString('utf8');
  }

  encrypt(message: string, timestamp: string, nonce: string): WecomEncryptedEnvelope {
    const messageBuffer = Buffer.from(message, 'utf8');
    const lengthBuffer = Buffer.alloc(MESSAGE_LENGTH_BYTES);
    lengthBuffer.writeUInt32BE(messageBuffer.length, 0);
    const plaintext = Buffer.concat([
      randomBytes(RANDOM_PREFIX_BYTES),
      lengthBuffer,
      messageBuffer,
    ]);
    const padded = this.addPadding(plaintext);

    const cipher = createCipheriv('aes-256-cbc', this.aesKey, this.iv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
    return {
      encrypt: encrypted,
      msgsignature: this.sign(timestamp, nonce, encrypted),
      timestamp: Number(timestamp),
      nonce,
    };
  }

  private sign(timestamp: string, nonce: string, encrypted: string): string {
    return createHash('sha1')
      .update([this.token, timestamp, nonce, encrypted].sort().join(''), 'utf8')
      .digest('hex');
  }

  private addPadding(value: Buffer): Buffer {
    const paddingLength = WECOM_PADDING_BLOCK_SIZE - (value.length % WECOM_PADDING_BLOCK_SIZE);
    return Buffer.concat([value, Buffer.alloc(paddingLength, paddingLength)]);
  }

  private removePadding(value: Buffer): Buffer {
    if (!value.length) throw new Error('Invalid WeCom padding');
    const paddingLength = value[value.length - 1];
    if (paddingLength < 1 || paddingLength > WECOM_PADDING_BLOCK_SIZE) {
      throw new Error('Invalid WeCom padding');
    }
    for (let index = value.length - paddingLength; index < value.length; index++) {
      if (value[index] !== paddingLength) throw new Error('Invalid WeCom padding');
    }
    return value.subarray(0, value.length - paddingLength);
  }
}
