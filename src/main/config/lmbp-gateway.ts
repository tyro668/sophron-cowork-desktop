import { app } from 'electron';
import type { LMBPServer as GatewaySdk } from '../../../vendor/lmbp/src';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import type { LmbpPairingStatus } from '../../shared/contracts';
import { getAppNameForLanguage } from '../../shared/branding';
import { harnessMessage } from '../utils/harness-messages';
import { log } from '../utils/logger';
import { LmbpSchemeQueue } from './lmbp-scheme-queue';

const HOST = '127.0.0.1';
const TENANT = 'sophron';
const END_USER = 'local-user';
const PORT_KEY = 'sophron.loopback.port';
const DB_NAME = 'gateway.sqlite';
const SCHEME_HEADER = 'x-sophron-lmbp-scheme';

async function bindLoopback(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

function attachGateway(server: Server, sdk: GatewaySdk, host: string, apiKey: string) {
  const requests = new LmbpSchemeQueue();
  server.on('request', (request, response) => {
    if (
      request.headers.host !== host ||
      request.headers.origin ||
      request.url?.startsWith('/lmbp/v1/tenant/')
    ) {
      response.writeHead(403).end();
      return;
    }
    const scheme = request.headers[SCHEME_HEADER];
    if (
      request.method === 'POST' &&
      typeof scheme === 'string' &&
      request.headers['x-api-key'] === apiKey
    ) {
      requests.dispatch(scheme, response, () => sdk.handler(request, response));
    } else {
      sdk.handler(request, response);
    }
  });
  server.on('upgrade', (req, socket) => {
    if (req.headers.host !== host || req.url !== '/lmbp/v1/connect') socket.destroy();
  });
  sdk.attach(server);
  return requests;
}

function getPairingStatus(sdk: GatewaySdk): LmbpPairingStatus {
  const devices = sdk.pairing.listDevices(TENANT, END_USER).filter((d) => d.status === 'active');
  return {
    link: sdk.pairing.link(TENANT),
    devices: devices.map(({ deviceId, name, online }) => ({ id: deviceId, name, online })),
    models: devices.flatMap((device) =>
      device.models.map((id) => ({
        id: device.deviceId + '/' + id,
        name: [device.modelNames?.[id] || id, device.name].filter(Boolean).join(' · '),
        capabilities: device.modelCapabilities[id] ?? [],
      }))
    ),
  };
}

function approvePairing(sdk: GatewaySdk, code: string) {
  try {
    sdk.pairing.approve(TENANT, END_USER, code);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      throw new Error(
        harnessMessage(error.code === 'RATE_LIMITED' ? 'lmbpCodeRateLimited' : 'lmbpInvalidCode'),
        { cause: error }
      );
    }
    throw error;
  }
}

export async function startLmbpGateway(directory: string) {
  const { LMBPServer, SqliteStore } = await import('../../../vendor/lmbp/src');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const store = new SqliteStore(join(directory, DB_NAME));
  const server = createServer();
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  let savedPort = 0;
  try {
    savedPort = Number(store.getSecret(PORT_KEY)?.toString() || 0);
    const port = await bindLoopback(server, savedPort);
    const host = HOST + ':' + port;
    const origin = 'http://' + host;
    const apiKey = LMBPServer.generateTenantKey();
    const sdk = new LMBPServer({
      issuer: origin,
      store,
      tenants: [
        {
          id: TENANT,
          apiKey,
          profile: {
            display_name: getAppNameForLanguage(app.getLocale()),
            requested_scopes: ['lmbp.chat', 'lmbp.tools', 'lmbp.vision'],
          },
        },
      ],
      retention: 10 * 60_000,
      log: (...args) => log('[LMBP]', ...args),
    });
    const requests = attachGateway(server, sdk, host, apiKey);
    // Avora binds its identity to this issuer, including the port.
    if (!savedPort) store.putSecret(PORT_KEY, Buffer.from(String(port)));

    return {
      getStatus: () => getPairingStatus(sdk),
      approve: (code: string) => approvePairing(sdk, code),
      revoke(id: string) {
        sdk.pairing.revokeDevice(TENANT, END_USER, id);
      },
      resolveModel(id: string) {
        const model = getPairingStatus(sdk).models.find((item) => item.id === id);
        if (!model) throw new Error(harnessMessage('lmbpUnavailable'));
        return {
          origin,
          apiKey,
          headers: { 'X-End-User': END_USER, [SCHEME_HEADER]: id.split('/').slice(0, 2).join('/') },
          capabilities: model.capabilities ?? [],
        };
      },
      async close() {
        requests.clear();
        const closed = new Promise<void>((resolve) => server.close(() => resolve()));
        try {
          await sdk.close();
        } finally {
          for (const socket of sockets) socket.destroy();
          await closed;
        }
      },
    };
  } catch (error) {
    server.close();
    store.close();
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(harnessMessage('lmbpPortInUse', { port: savedPort }), { cause: error });
    }
    throw error;
  }
}

let gateway: ReturnType<typeof startLmbpGateway> | undefined;
let stopping: Promise<void> | undefined;
function gatewayDirectory() {
  return join(app.getPath('userData'), 'lmbp');
}

export function getLmbpGateway(): ReturnType<typeof startLmbpGateway> {
  if (stopping) return stopping.then(getLmbpGateway);
  gateway ??= startLmbpGateway(gatewayDirectory()).catch((error) => {
    gateway = undefined;
    throw error;
  });
  return gateway;
}

export async function resumeLmbpGateway() {
  if (existsSync(join(gatewayDirectory(), DB_NAME))) await getLmbpGateway();
}

export function stopLmbpGateway(): Promise<void> {
  if (!gateway) return Promise.resolve();
  stopping ??= gateway
    .then((running) => running.close())
    .finally(() => {
      gateway = undefined;
      stopping = undefined;
    });
  return stopping;
}
