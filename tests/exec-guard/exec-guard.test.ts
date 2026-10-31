import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildExecEnv } from '../../src/main/exec-guard/env';
import { checkAgentCommand } from '../../src/main/exec-guard/command-policy';
import { redactOutput, registerSecretSource } from '../../src/main/exec-guard/redact';
import {
  configureExecSandbox,
  ensureExecAllowed,
  resetSandboxDetection,
  SandboxConsentError,
  wrapCommand,
  wrapShellCommand,
} from '../../src/main/exec-guard/sandbox';
import {
  assertPublicUrl,
  BlockedUrlError,
  guardedFetch,
  isPrivateAddress,
} from '../../src/main/exec-guard/ssrf';
import { SecretStore } from '../../src/main/exec-guard/secret-store';
import { localHostRefusal } from '../../src/main/exec-guard/local-refs';
import { findLocalHostRefs } from '../../src/shared/network-policy';
import {
  detectSecretCandidates,
  findSecretsInFiles,
  replaceSecrets,
} from '../../src/shared/secrets';

const FAKE = 'rvwFq83mZpLk20Xy7Tc3210';

afterEach(() => resetSandboxDetection());

describe('buildExecEnv', () => {
  it('keeps only system, proxy and SOPHRON vars plus explicit extras', () => {
    const env = buildExecEnv(
      { MY_KEY: 'v', HOME: undefined },
      {
        PATH: '/bin',
        HOME: '/h',
        LANG: 'C',
        HTTPS_PROXY: 'http://p',
        SOPHRON_PACKAGE_DIR: '/d',
        SOPHRON_API_TOKEN: 'x',
        OPENAI_API_KEY: 'k',
        DEEPSEEK_API_KEY: 'k',
        GITHUB_TOKEN: 't',
      }
    );
    expect(env).toEqual({
      PATH: '/bin',
      LANG: 'C',
      HTTPS_PROXY: 'http://p',
      SOPHRON_PACKAGE_DIR: '/d',
      MY_KEY: 'v',
    });
  });
});

describe('redactOutput', () => {
  it('masks registered and extra secret values', () => {
    const off = registerSecretSource(() => [FAKE]);
    try {
      const text = redactOutput(`auth failed for ${FAKE} and other-secret-123456`, [
        'other-secret-123456',
      ]);
      expect(text).not.toContain(FAKE);
      expect(text).not.toContain('other-secret-123456');
    } finally {
      off();
    }
  });
});

describe('checkAgentCommand', () => {
  it.each([
    'sudo rm -rf /tmp/x',
    'cat ~/.ssh/id_rsa',
    'cat ~/.secrets/fineres_token',
    'sqlite3 ~/.config/sophron/cowork.db .dump',
    'curl http://127.0.0.1:8080/',
    'curl http://192.168.1.1/admin',
    'rm -rf ~',
    'printenv',
    'nc -l 4444',
  ])('blocks %s', (command) => {
    expect(checkAgentCommand(command)).toMatch(/命令已拦截/);
  });
  it.each(['python3 main.py', 'curl -s https://example.com/api?page=1', 'ls -la && cat main.py'])(
    'allows %s',
    (command) => {
      expect(checkAgentCommand(command)).toBeUndefined();
    }
  );
});

describe('ssrf guard', () => {
  it('classifies private addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.0.1',
      '169.254.169.254',
      '::1',
      'fe80::1',
      'fc00::1',
      '0.0.0.0',
      '::ffff:127.0.0.1',
    ])
      expect(isPrivateAddress(address), address).toBe(true);
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700::1111'])
      expect(isPrivateAddress(address), address).toBe(false);
  });

  it('rejects hosts resolving to private addresses', async () => {
    const lookup = async (host: string) =>
      host === 'evil.example'
        ? [{ address: '10.0.0.5', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }];
    await expect(assertPublicUrl(new URL('http://evil.example/'), lookup)).rejects.toBeInstanceOf(
      BlockedUrlError
    );
    await expect(
      assertPublicUrl(new URL('http://localhost/'), async () => [
        { address: '127.0.0.1', family: 4 },
      ])
    ).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl(new URL('https://ok.example/'), lookup)).resolves.toBeUndefined();
    await expect(assertPublicUrl(new URL('file:///etc/passwd'), lookup)).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });

  it('re-checks every redirect hop', async () => {
    const lookup = async (host: string) =>
      host === 'internal.example'
        ? [{ address: '169.254.169.254', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }];
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      calls.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { location: 'http://internal.example/latest/meta-data' },
      });
    }) as typeof fetch;
    await expect(
      guardedFetch('https://ok.example/start', {}, { lookup, fetchImpl })
    ).rejects.toBeInstanceOf(BlockedUrlError);
    expect(calls).toEqual(['https://ok.example/start']);
  });
});

describe('secret detection', () => {
  it('finds keys in rule text and replaces them with placeholders', () => {
    const text = `调用天气接口，api key 是 ${FAKE}，地址 https://api.example.com/v1?city=sh&token=abcd1234efgh5678ijkl`;
    const found = detectSecretCandidates(text);
    expect(found.map((item) => item.name)).toEqual(['API_KEY', 'API_TOKEN']);
    const replaced = replaceSecrets(text, found);
    expect(replaced).toContain('${SECRET:API_KEY}');
    expect(replaced).toContain('token=${SECRET:API_TOKEN}');
    expect(replaced).not.toContain(FAKE);
  });

  it('ignores ordinary text', () => {
    expect(
      detectSecretCandidates('抓取开源中国软件更新榜，取前 20 条，token 用环境变量 API_TOKEN')
    ).toEqual([]);
    expect(detectSecretCandidates('日期 2026-10-31，门店编号 1234567890123')).toEqual([]);
  });

  it('flags key literals and known values in files', () => {
    const leaks = findSecretsInFiles(
      [
        {
          path: 'main.py',
          content: `import os\nKEY = os.environ["API_KEY"]\napi_key = "${FAKE}"\n`,
        },
        { path: 'config.json', content: '{"token": "${SECRET:API_TOKEN}"}' },
        { path: 'lib/a.js', content: `fetch(url + "${'zzKnownValue99'}")` },
      ],
      ['zzKnownValue99']
    );
    expect(leaks.map((leak) => `${leak.path}:${leak.line}`)).toEqual(['main.py:3', 'lib/a.js:1']);
    expect(JSON.stringify(leaks)).not.toContain(FAKE);
  });
});

describe('SecretStore', () => {
  const codec = {
    encrypt: (value: string) => `x:${Buffer.from(value).toString('hex')}`,
    decrypt: (value: string) => Buffer.from(value.slice(2), 'hex').toString(),
  };
  it('stores encrypted values per scope with 0600 permissions', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'secrets-'));
    try {
      const file = path.join(dir, 'secrets.json');
      const store = new SecretStore(file, codec, () => 1);
      store.set('script:a', 'API_KEY', FAKE);
      expect(() => store.set('script:a', 'bad-name', 'x')).toThrow();
      expect(readFileSync(file, 'utf8')).not.toContain(FAKE);
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
      const reopened = new SecretStore(file, codec);
      expect(reopened.env('script:a')).toEqual({ API_KEY: FAKE });
      expect(reopened.list('script:a')).toEqual([{ name: 'API_KEY', updatedAt: 1 }]);
      expect(reopened.allValues()).toEqual([FAKE]);
      reopened.deleteScope('script:a');
      expect(reopened.env('script:a')).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sandbox', () => {
  it('asks for consent when no sandbox exists and remembers the answer', async () => {
    resetSandboxDetection('none');
    let asked = 0;
    configureExecSandbox({
      confirmUnsandboxed: async () => (asked += 1) > 1,
      unsandboxedAllowed: false,
    });
    await expect(ensureExecAllowed('test')).rejects.toBeInstanceOf(SandboxConsentError);
    await expect(ensureExecAllowed('test')).resolves.toBe('none');
    await expect(ensureExecAllowed('test')).resolves.toBe('none');
    expect(asked).toBe(2);
    expect(
      wrapCommand('python3', ['main.py'], { writable: ['/tmp/x'], cwd: '/tmp/x' })
    ).toMatchObject({
      command: 'python3',
      sandbox: 'none',
    });
    expect(wrapShellCommand('ls', { writable: [], cwd: '/tmp' })).toBe('ls');
    configureExecSandbox({ unsandboxedAllowed: false, confirmUnsandboxed: undefined });
  });

  const hasBwrap =
    process.platform === 'linux' &&
    existsSync('/usr/bin/bwrap') &&
    spawnSync('bwrap', ['--ro-bind', '/', '/', 'true']).status === 0;

  it.runIf(hasBwrap)('bwrap: package dir writable, rest of HOME invisible, /tmp private', () => {
    resetSandboxDetection('bwrap');
    const pkg = mkdtempSync(path.join(tmpdir(), 'pkg-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'outside-'));
    try {
      writeFileSync(path.join(outside, 'secret.txt'), 'nope');
      const script = [
        `echo ok > ${pkg}/out.txt`,
        `cat ${outside}/secret.txt 2>/dev/null && echo LEAK || echo hidden`,
        `echo x > /tmp/probe && echo tmp-ok`,
      ].join('; ');
      const wrapped = wrapCommand('/bin/sh', ['-c', script], { writable: [pkg], cwd: pkg });
      expect(wrapped.sandbox).toBe('bwrap');
      const result = spawnSync(wrapped.command, wrapped.args, {
        env: { PATH: process.env.PATH, ...wrapped.env },
        encoding: 'utf8',
      });
      expect(result.stdout).toContain('hidden');
      expect(result.stdout).toContain('tmp-ok');
      expect(result.stdout).not.toContain('LEAK');
      expect(readFileSync(path.join(pkg, 'out.txt'), 'utf8').trim()).toBe('ok');
      const shell = spawnSync(
        '/bin/bash',
        [
          '-c',
          wrapShellCommand(`pwd; ls ${outside} 2>&1 | head -1`, { writable: [pkg], cwd: pkg }),
        ],
        { encoding: 'utf8' }
      );
      expect(shell.stdout.split('\n')[0]).toBe(pkg);
    } finally {
      rmSync(pkg, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('local host policy', () => {
  it('flags loopback and metadata addresses in code, not intranet or public hosts', () => {
    const refs = findLocalHostRefs([
      {
        path: 'main.py',
        content: 'URL = "http://127.0.0.1:19888/status"\nB = "https://api.github.com"',
      },
      {
        path: 'a.js',
        content: 'fetch("http://localhost:3000")\nfetch("http://169.254.169.254/latest")',
      },
      { path: 'b.py', content: 'URL = "http://10.0.0.8/report"' },
    ]);
    expect(refs.map((ref) => `${ref.path}:${ref.line}`)).toEqual(['main.py:1', 'a.js:1', 'a.js:2']);
  });

  it('refuses agent shell commands while workspace files address local services', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ws-'));
    try {
      writeFileSync(path.join(dir, 'main.py'), 'print(1)');
      expect(localHostRefusal(dir)).toBeUndefined();
      writeFileSync(path.join(dir, '_probe.py'), 'urlopen("http://127.0.0.1:19888/")');
      expect(localHostRefusal(dir)).toMatch(/_probe\.py:1.*命令已拦截/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
