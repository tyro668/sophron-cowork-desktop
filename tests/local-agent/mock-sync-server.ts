/**
 * 测试用的假 Sync webhook + 假 OSS（预签名 PUT）服务。
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  bytes?: Buffer;
}

export interface MockSyncServer {
  baseUrl: string;
  origin: string;
  calls: RecordedCall[];
  /** key: `${objectPath}#${partNumber}` → 最后一次上传的内容 */
  parts: Map<string, Buffer>;
  options: {
    internalAvailable: boolean;
    /** 接下来 N 次外网 PUT 返回 500 */
    failExternalPuts: number;
    /** 指定 webhook 返回的 Resp.code */
    respCodeFor: Record<string, number>;
    /** 预签名过期时间偏移（ms） */
    expirationOffset: number;
    omitInternalUrl: boolean;
  };
  webhookCalls(suffix: string): RecordedCall[];
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function startMockSyncServer(): Promise<MockSyncServer> {
  const calls: RecordedCall[] = [];
  const parts = new Map<string, Buffer>();
  const options: MockSyncServer['options'] = {
    internalAvailable: true,
    failExternalPuts: 0,
    respCodeFor: {},
    expirationOffset: 60_000,
    omitInternalUrl: false,
  };
  let fileSeq = 0;
  let origin = '';

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    const raw = await readBody(req);
    if (url.pathname.startsWith('/oss/')) {
      const kind = url.pathname.split('/')[2];
      const objectPath = decodeURIComponent(url.pathname.split('/').slice(3).join('/'));
      const partNumber = url.searchParams.get('partNumber');
      calls.push({ method: req.method ?? '', path: `/oss/${kind}`, body: null, bytes: raw });
      if (kind === 'int' && !options.internalAvailable) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (kind === 'ext' && options.failExternalPuts > 0) {
        options.failExternalPuts--;
        res.writeHead(500);
        res.end();
        return;
      }
      parts.set(`${objectPath}#${partNumber}`, raw);
      const etag = createHash('md5').update(raw).digest('hex');
      res.writeHead(200, { ETag: `"${etag}"` });
      res.end();
      return;
    }
    const body = raw.length ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>) : null;
    calls.push({ method: req.method ?? '', path: url.pathname, body });
    const suffix = url.pathname.replace(/^\/sync/, '');
    const code = options.respCodeFor[suffix] ?? 200;
    if (code !== 200) {
      json(res, 200, { code, msg: `mock error ${code}` });
      return;
    }
    const presign = (objectPath: string, uploadId: string, partNumber: unknown) => ({
      uploadId,
      path: objectPath,
      httpMethod: 'PUT',
      expiration: Date.now() + options.expirationOffset,
      externalUploadUrl: `${origin}/oss/ext/${encodeURIComponent(objectPath)}?partNumber=${partNumber}&uploadId=${uploadId}&X-Sig=secret`,
      internalUploadUrl: options.omitInternalUrl
        ? undefined
        : `${origin}/oss/int/${encodeURIComponent(objectPath)}?partNumber=${partNumber}&uploadId=${uploadId}&X-Sig=secret`,
    });
    switch (suffix) {
      case '/webhook/agent/s3/parts/url':
        json(res, 200, {
          code: 200,
          data: presign(String(body?.path), String(body?.uploadId), body?.partNumber),
        });
        return;
      case '/webhook/agent/s3/files/url': {
        fileSeq++;
        json(res, 200, {
          code: 200,
          data: {
            path: `tables/file-${body?.index}-${fileSeq}.csv.lz4`,
            uploadId: `up-${fileSeq}`,
            expiration: 0,
          },
        });
        return;
      }
      default:
        json(res, 200, { code: 200, data: null });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  return {
    baseUrl: `${origin}/sync`,
    origin,
    calls,
    parts,
    options,
    webhookCalls: (suffix) => calls.filter((c) => c.path === `/sync${suffix}`),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const noSleep = async (): Promise<void> => {};
