/**
 * App wiring of the exec guard: the encrypted secret store (Electron safeStorage), redaction
 * sources and the unsandboxed-run consent dialog.
 */
import { BrowserWindow, dialog, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { collectSecretValues } from '../../shared/fix-error';
import { registerSecretSource } from './redact';
import { configureExecSandbox, detectSandbox } from './sandbox';
import { SecretStore, setSecretStore, type SecretCodec } from './secret-store';

const safeStorageCodec: SecretCodec = {
  encrypt(value) {
    if (safeStorage.isEncryptionAvailable())
      return `v1:${safeStorage.encryptString(value).toString('base64')}`;
    // No keychain (e.g. Linux without a secret service): obfuscated only, still never in git.
    return `b64:${Buffer.from(value, 'utf8').toString('base64')}`;
  },
  decrypt(value) {
    if (value.startsWith('v1:'))
      return safeStorage.decryptString(Buffer.from(value.slice(3), 'base64'));
    if (value.startsWith('b64:')) return Buffer.from(value.slice(4), 'base64').toString('utf8');
    throw new Error('unknown secret encoding');
  },
};

export function setupExecGuard(options: {
  userData: string;
  appConfig: () => unknown;
}): SecretStore {
  const store = new SecretStore(path.join(options.userData, 'secrets.json'), safeStorageCodec);
  setSecretStore(store);
  registerSecretSource(() => store.allValues());
  registerSecretSource(() => collectSecretValues(options.appConfig()));

  const consentFile = path.join(options.userData, 'exec-consent.json');
  let remembered: boolean;
  try {
    remembered = existsSync(consentFile)
      ? (JSON.parse(readFileSync(consentFile, 'utf8')) as { allowUnsandboxed?: boolean })
          .allowUnsandboxed === true
      : false;
  } catch {
    remembered = false;
  }
  let pending: Promise<boolean> | null = null;
  configureExecSandbox({
    homeDir: path.join(options.userData, 'exec-home'),
    unsandboxedAllowed: remembered,
    confirmUnsandboxed: () => {
      pending ??= (async () => {
        const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const dialogOptions = {
          type: 'warning' as const,
          title: '无法隔离运行',
          message: '本机没有可用的隔离环境，AI 生成的代码将直接在本机运行',
          detail: '它能读写你的文件。只在你信任数据来源时允许。允许后会记住这个选择。',
          buttons: ['允许', '拒绝'],
          defaultId: 1,
          cancelId: 1,
        };
        const result = window
          ? await dialog.showMessageBox(window, dialogOptions)
          : await dialog.showMessageBox(dialogOptions);
        const allowed = result.response === 0;
        if (allowed) writeFileSync(consentFile, JSON.stringify({ allowUnsandboxed: true }), 'utf8');
        return allowed;
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
  });
  console.log('[ExecGuard] sandbox:', detectSandbox());
  return store;
}
