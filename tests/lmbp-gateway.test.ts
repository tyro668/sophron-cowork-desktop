import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerResponse, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { startLmbpGateway } from '../src/main/config/lmbp-gateway';
import { LmbpSchemeQueue } from '../src/main/config/lmbp-scheme-queue';

it('bundles the SDK, pairing QR generator and protocol schemas into the gateway', async () => {
  const { metafile } = await build({
    entryPoints: ['src/main/config/lmbp-gateway.ts'],
    bundle: true,
    platform: 'node',
    packages: 'external',
    format: 'esm',
    metafile: true,
    write: false,
  });
  const inputs = Object.values(metafile.outputs)[0].inputs;
  const schemaDir = 'vendor/lmbp/schemas';
  const schemas = (await readdir(schemaDir)).filter((name) => name.endsWith('.json'));
  for (const file of [
    'vendor/lmbp/src/index.ts',
    'vendor/lmbp/vendor/qrcode.cjs',
    ...schemas.map((name) => `${schemaDir}/${name}`),
  ]) {
    expect(inputs[file]?.bytesInOutput, file).toBeGreaterThan(0);
  }
});

it('waits for a whole stream on the same scheme and drops a cancelled waiter', () => {
  const queue = new LmbpSchemeQueue();
  const started: string[] = [];
  const request = (scheme: string, name: string) => {
    const response = new ServerResponse(new IncomingMessage(new Socket()));
    queue.dispatch(scheme, response, () => started.push(name));
    return response;
  };
  const memory = request('device/codex', 'memory');
  const cancelled = request('device/codex', 'cancelled');
  const chat = request('device/codex', 'chat');
  request('device/openai', 'independent');
  request('device/codex', 'next');
  expect(started).toEqual(['memory', 'independent']);
  cancelled.emit('close');
  memory.emit('finish');
  memory.emit('close');
  expect(started).toEqual(['memory', 'independent', 'chat']);
  chat.emit('close');
  expect(started).toEqual(['memory', 'independent', 'chat', 'next']);
});

it('keeps the loopback issuer, signing key and approved devices across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sophron-lmbp-'));
  let gateway = await startLmbpGateway(directory);
  try {
    const link = new URL(gateway.getStatus().link);
    const origin = link.searchParams.get('gateway')!;
    expect(new URL(origin).hostname).toBe('127.0.0.1');
    const keys = await (
      await fetch(origin + '/.well-known/jwks.json', { headers: { connection: 'close' } })
    ).json();
    const publicKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x!;
    const response = await fetch(origin + '/lmbp/v1/device/authorize', {
      method: 'POST',
      headers: { connection: 'close' },
      body: new URLSearchParams({
        tenant: link.searchParams.get('tenant')!,
        public_key: publicKey,
        device_name: 'Avora test',
      }),
    });
    expect(response.status).toBe(200);
    const { user_code } = await response.json();
    gateway.approve(user_code);
    const { devices } = gateway.getStatus();
    expect(devices).toEqual([
      { id: expect.stringMatching(/^dev_/), name: 'Avora test', online: false },
    ]);
    expect(gateway.getStatus().models).toEqual([]);
    expect(() => gateway.resolveModel(devices[0].id + '/offline')).toThrow();

    await gateway.close();
    gateway = await startLmbpGateway(directory);
    expect(gateway.getStatus().link).toBe(link.href);
    expect(await (await fetch(origin + '/.well-known/jwks.json')).json()).toEqual(keys);
    expect(gateway.getStatus().devices).toEqual(devices);

    expect((await fetch(origin + '/lmbp/v1/tenant/devices')).status).toBe(403);
    expect((await fetch(origin + '/v1/models')).status).toBe(401);
    expect(
      (await fetch(origin + '/healthz', { headers: { origin: 'https://example.org' } })).status
    ).toBe(403);
    gateway.revoke(devices[0].id);
    expect(gateway.getStatus().devices).toEqual([]);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});
