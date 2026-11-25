import { describe, expect, it } from 'vitest';

import {
  LocalAgentConfigError,
  buildSocketOptions,
  buildSocketUrl,
  isDemoAgentId,
  parseLocalAgentConfig,
  verifyAgentId,
} from '../../src/main/local-agent/config';

const AGENT_ID = 'a'.repeat(32);

const YAML = `
server:
  protocol: "https"
  port: 443
  version: "v4.0"
  agentId: "${AGENT_ID}"
  token: "file-token"
  host: "agent.example.com"
  path: "/gw"
socket.io:
  reconnectionAttempts: 0
  reconnectionDelay: 1500
  timeout: 15000
`;

describe('local-agent config', () => {
  it('parses server and socket.io sections like Java AgentConfig', () => {
    const cfg = parseLocalAgentConfig(YAML, {});
    expect(cfg.server).toMatchObject({
      agentId: AGENT_ID,
      token: 'file-token',
      protocol: 'https',
      host: 'agent.example.com',
      port: 443,
      path: '/gw',
    });
    expect(cfg.socketIO).toEqual({
      reconnectionAttempts: 0,
      reconnectionDelay: 1500,
      timeout: 15000,
    });
  });

  it('lets LOCAL_AGENT_TOKEN override the file token (Java -Dtoken)', () => {
    const cfg = parseLocalAgentConfig(YAML, { LOCAL_AGENT_TOKEN: 'env-token' });
    expect(cfg.server.token).toBe('env-token');
  });

  it('applies defaults when socket.io section and path are missing', () => {
    const cfg = parseLocalAgentConfig(
      `server:\n  agentId: x\n  token: t\n  host: h\n  protocol: http\n  path:\n`,
      {}
    );
    expect(cfg.server.port).toBe(80);
    expect(cfg.server.path).toBeUndefined();
    expect(cfg.socketIO).toEqual({
      reconnectionAttempts: 0,
      reconnectionDelay: 1000,
      timeout: 20000,
    });
  });

  it('rejects config without server.host', () => {
    expect(() => parseLocalAgentConfig('server:\n  agentId: x\n', {})).toThrow(
      LocalAgentConfigError
    );
  });

  it('builds url with /database namespace and handshake query', () => {
    const cfg = parseLocalAgentConfig(YAML, {});
    expect(buildSocketUrl(cfg.server)).toBe('https://agent.example.com:443/database');
    const opts = buildSocketOptions(cfg, {
      agentId: AGENT_ID,
      version: '3.0.0',
      instanceId: 'iid',
    });
    expect(opts.path).toBe('/gw/socket.io');
    expect(opts.transports).toEqual(['websocket']);
    expect(opts.query).toEqual({
      token: 'file-token',
      agentId: AGENT_ID,
      version: '3.0.0',
      apiLevel: '5',
      instanceId: 'iid',
    });
    // Java 2.x: 0 = 无限重试；JS: 0 = 不重试，所以要换成 Infinity
    expect(opts.reconnectionAttempts).toBe(Infinity);
    expect(opts.reconnectionDelay).toBe(1500);
    expect(opts.timeout).toBe(15000);
    expect(opts.autoConnect).toBe(false);
  });

  it('keeps positive reconnectionAttempts as is', () => {
    const cfg = parseLocalAgentConfig(
      YAML.replace('reconnectionAttempts: 0', 'reconnectionAttempts: 7'),
      {}
    );
    expect(
      buildSocketOptions(cfg, { agentId: AGENT_ID, version: 'v', instanceId: 'i' })
        .reconnectionAttempts
    ).toBe(7);
  });

  it('verifies agentId like VerifyUtil', () => {
    expect(verifyAgentId(AGENT_ID)).toBe(AGENT_ID);
    expect(isDemoAgentId('DEMO_AGENTID')).toBe(true);
    expect(verifyAgentId('DEMO_AGENTID')).toHaveLength(32);
    expect(() => verifyAgentId('short')).toThrow(/32/);
  });
});
