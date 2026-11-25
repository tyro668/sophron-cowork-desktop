/**
 * 加密 Excel（ECMA-376 / MS-OFFCRYPTO）解密。SheetJS 社区版遇到加密的 xlsx 会直接抛
 * "File is password-protected"，而 Java 本地宝（EasyExcel → POI `Decryptor`）支持带密码读取，
 * 所以这里用 node:crypto 实现 POI 支持的两种 xlsx 加密：
 *   - Agile Encryption（Excel 2010+ 默认，EncryptionInfo 4.4，XML 描述）；
 *   - Standard Encryption（Excel 2007，EncryptionInfo 3.2 / 4.2，AES-ECB + SHA-1）。
 * 解出的明文就是普通 xlsx 的 zip 包，交给 SheetJS 正常解析。
 *
 * 旧版 .xls 的 RC4 加密不在这里处理（SheetJS 只支持 XOR 混淆），见迁移说明。
 */
import { createDecipheriv, createHash } from 'node:crypto';

import * as XLSX from '../../utils/xlsx';

export class OfficePasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficePasswordError';
  }
}

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

type CfbContainer = ReturnType<typeof XLSX.CFB.read>;

function readCfb(buf: Buffer): CfbContainer | null {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(CFB_MAGIC)) return null;
  try {
    return XLSX.CFB.read(buf, { type: 'buffer' });
  } catch {
    return null;
  }
}

function entry(cfb: CfbContainer, name: string): Buffer | null {
  const found = XLSX.CFB.find(cfb, name);
  if (!found || !found.content) return null;
  return Buffer.from(found.content as Uint8Array);
}

/** 是否为 OLE2 容器里的加密 OOXML（EncryptionInfo + EncryptedPackage）。 */
export function isEncryptedOoxml(buf: Buffer): boolean {
  const cfb = readCfb(buf);
  return Boolean(cfb && entry(cfb, 'EncryptionInfo') && entry(cfb, 'EncryptedPackage'));
}

function hashName(name: string): string {
  const n = name.toUpperCase().replace(/-/g, '');
  switch (n) {
    case 'SHA1':
      return 'sha1';
    case 'SHA256':
      return 'sha256';
    case 'SHA384':
      return 'sha384';
    case 'SHA512':
      return 'sha512';
    case 'MD5':
      return 'md5';
    default:
      throw new Error(`unsupported hash algorithm: ${name}`);
  }
}

function h(alg: string, ...parts: Buffer[]): Buffer {
  const hash = createHash(alg);
  for (const p of parts) hash.update(p);
  return hash.digest();
}

function le32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function fit(buf: Buffer, size: number, pad: number): Buffer {
  if (buf.length >= size) return buf.subarray(0, size);
  return Buffer.concat([buf, Buffer.alloc(size - buf.length, pad)]);
}

function aes(mode: 'cbc' | 'ecb', key: Buffer, iv: Buffer | null, data: Buffer): Buffer {
  const decipher = createDecipheriv(`aes-${key.length * 8}-${mode}`, key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function attrs(xml: string, tag: string): Record<string, string> {
  const m = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)>`).exec(xml);
  if (!m) throw new Error(`EncryptionInfo: missing <${tag}>`);
  const out: Record<string, string> = {};
  for (const a of m[1].matchAll(/(\w+)="([^"]*)"/g)) out[a[1]] = a[2];
  return out;
}

const BLOCK_VERIFIER_INPUT = Buffer.from('fea7d2763b4b9e79', 'hex');
const BLOCK_VERIFIER_VALUE = Buffer.from('d7aa0f6d3061344e', 'hex');
const BLOCK_KEY_VALUE = Buffer.from('146e0be7abacd0d6', 'hex');
const SEGMENT = 4096;

function decryptAgile(info: Buffer, pkg: Buffer, password: string): Buffer {
  const xml = info.subarray(8).toString('utf8');
  const keyData = attrs(xml, 'keyData');
  const pwd = attrs(xml, 'encryptedKey');
  const pwdAlg = hashName(pwd.hashAlgorithm);
  const pwdSalt = Buffer.from(pwd.saltValue, 'base64');
  const spin = Number(pwd.spinCount);
  const keyBytes = Number(pwd.keyBits) / 8;
  const pwdBlock = Number(pwd.blockSize);

  let hash = h(pwdAlg, pwdSalt, Buffer.from(password, 'utf16le'));
  for (let i = 0; i < spin; i++) hash = h(pwdAlg, le32(i), hash);
  const derive = (block: Buffer) => fit(h(pwdAlg, hash, block), keyBytes, 0x36);
  const iv = fit(pwdSalt, pwdBlock, 0x36);

  const verifierInput = aes(
    'cbc',
    derive(BLOCK_VERIFIER_INPUT),
    iv,
    Buffer.from(pwd.encryptedVerifierHashInput, 'base64')
  ).subarray(0, pwdSalt.length);
  const verifierHash = aes(
    'cbc',
    derive(BLOCK_VERIFIER_VALUE),
    iv,
    Buffer.from(pwd.encryptedVerifierHashValue, 'base64')
  );
  const expected = h(pwdAlg, verifierInput);
  if (!verifierHash.subarray(0, expected.length).equals(expected)) {
    throw new OfficePasswordError('password is incorrect');
  }
  const secret = aes(
    'cbc',
    derive(BLOCK_KEY_VALUE),
    iv,
    Buffer.from(pwd.encryptedKeyValue, 'base64')
  ).subarray(0, keyBytes);

  const dataAlg = hashName(keyData.hashAlgorithm);
  const dataSalt = Buffer.from(keyData.saltValue, 'base64');
  const dataBlock = Number(keyData.blockSize);
  const size = Number(pkg.readBigUInt64LE(0));
  const body = pkg.subarray(8);
  const parts: Buffer[] = [];
  for (let offset = 0, index = 0; offset < body.length; offset += SEGMENT, index++) {
    let chunk = body.subarray(offset, Math.min(offset + SEGMENT, body.length));
    if (chunk.length % dataBlock !== 0) {
      chunk = fit(chunk, chunk.length + dataBlock - (chunk.length % dataBlock), 0);
    }
    const segIv = fit(h(dataAlg, dataSalt, le32(index)), dataBlock, 0x36);
    parts.push(aes('cbc', secret, segIv, chunk));
  }
  return Buffer.concat(parts).subarray(0, size);
}

function decryptStandard(info: Buffer, pkg: Buffer, password: string): Buffer {
  const headerSize = info.readUInt32LE(8);
  const header = info.subarray(12, 12 + headerSize);
  const keyBits = header.readUInt32LE(16);
  const verifier = info.subarray(12 + headerSize);
  const saltSize = verifier.readUInt32LE(0);
  const salt = verifier.subarray(4, 4 + saltSize);
  const encVerifier = verifier.subarray(4 + saltSize, 4 + saltSize + 16);
  const encVerifierHash = verifier.subarray(4 + saltSize + 16 + 4, 4 + saltSize + 16 + 4 + 32);

  let hash = h('sha1', salt, Buffer.from(password, 'utf16le'));
  for (let i = 0; i < 50000; i++) hash = h('sha1', le32(i), hash);
  const final = h('sha1', hash, le32(0));
  const x1 = Buffer.alloc(64, 0x36);
  const x2 = Buffer.alloc(64, 0x5c);
  for (let i = 0; i < final.length; i++) {
    x1[i] ^= final[i];
    x2[i] ^= final[i];
  }
  const key = Buffer.concat([h('sha1', x1), h('sha1', x2)]).subarray(0, keyBits / 8);

  const v = aes('ecb', key, null, encVerifier);
  const vh = aes('ecb', key, null, encVerifierHash);
  if (!h('sha1', v).equals(vh.subarray(0, 20))) {
    throw new OfficePasswordError('password is incorrect');
  }
  const size = Number(pkg.readBigUInt64LE(0));
  let body = pkg.subarray(8);
  if (body.length % 16 !== 0) body = fit(body, body.length + 16 - (body.length % 16), 0);
  return aes('ecb', key, null, body).subarray(0, size);
}

/**
 * 加密 OOXML → 明文 xlsx。不是加密 OOXML 时原样返回（与 POI 一样，未加密文件忽略密码）。
 * 没有提供密码或密码错误时抛错。
 */
export function decryptOfficeFile(buf: Buffer, password: string | undefined): Buffer {
  const cfb = readCfb(buf);
  if (!cfb) return buf;
  const info = entry(cfb, 'EncryptionInfo');
  const pkg = entry(cfb, 'EncryptedPackage');
  if (!info || !pkg) return buf;
  if (!password) throw new OfficePasswordError('File is password-protected');
  const major = info.readUInt16LE(0);
  const minor = info.readUInt16LE(2);
  if (major === 4 && minor === 4) return decryptAgile(info, pkg, password);
  if ((major === 3 || major === 4) && minor === 2) return decryptStandard(info, pkg, password);
  throw new Error(`unsupported encryption version ${major}.${minor}`);
}
