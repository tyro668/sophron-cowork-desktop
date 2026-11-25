/** XXH32（LZ4 Frame 头校验 HC 与可选的块/内容校验使用）。 */
const PRIME1 = 0x9e3779b1;
const PRIME2 = 0x85ebca77;
const PRIME3 = 0xc2b2ae3d;
const PRIME4 = 0x27d4eb2f;
const PRIME5 = 0x165667b1;

function rotl(x: number, r: number): number {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

function readU32(buf: Uint8Array, i: number): number {
  return (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0;
}

function round(acc: number, input: number): number {
  acc = (acc + Math.imul(input, PRIME2)) >>> 0;
  acc = rotl(acc, 13);
  return Math.imul(acc, PRIME1) >>> 0;
}

export function xxhash32(
  buf: Uint8Array,
  seed = 0,
  offset = 0,
  length = buf.length - offset
): number {
  let i = offset;
  const end = offset + length;
  let h: number;
  if (length >= 16) {
    let v1 = (seed + PRIME1 + PRIME2) >>> 0;
    let v2 = (seed + PRIME2) >>> 0;
    let v3 = seed >>> 0;
    let v4 = (seed - PRIME1) >>> 0;
    const limit = end - 16;
    while (i <= limit) {
      v1 = round(v1, readU32(buf, i));
      v2 = round(v2, readU32(buf, i + 4));
      v3 = round(v3, readU32(buf, i + 8));
      v4 = round(v4, readU32(buf, i + 12));
      i += 16;
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h = (seed + PRIME5) >>> 0;
  }
  h = (h + length) >>> 0;
  while (i + 4 <= end) {
    h = (h + Math.imul(readU32(buf, i), PRIME3)) >>> 0;
    h = Math.imul(rotl(h, 17), PRIME4) >>> 0;
    i += 4;
  }
  while (i < end) {
    h = (h + Math.imul(buf[i], PRIME5)) >>> 0;
    h = Math.imul(rotl(h, 11), PRIME1) >>> 0;
    i++;
  }
  h ^= h >>> 15;
  h = Math.imul(h, PRIME2) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, PRIME3) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
