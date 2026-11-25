/**
 * 云连接配置的加密持久化（electron-store + 仓库统一的密钥派生 / 轮换工具，与远程控制配置
 * 同一套机制）。token 只存在这里。
 */
import Store from 'electron-store';

import { log, logWarn } from '../../utils/logger';
import { createEncryptedStoreWithKeyRotation } from '../../utils/store-encryption';
import {
  DEFAULT_SOURCE_NAME,
  type CloudConnectionPersisted,
  type CloudConnectionStorePort,
} from './service';

type Record_ = CloudConnectionPersisted & Record<string, unknown>;

export class ElectronCloudConnectionStore implements CloudConnectionStorePort {
  private readonly store: Store<Record_>;

  constructor() {
    this.store = createEncryptedStoreWithKeyRotation<Record_>({
      stableKey: 'sophron-cloud-connection-stable-v1',
      legacyKeys: [],
      storeOptions: {
        name: 'cloud-connection',
        projectName: 'sophron',
        defaults: {
          config: null,
          autoConnect: false,
          sourceName: DEFAULT_SOURCE_NAME,
          files: [],
          versions: {},
        },
      },
      logPrefix: '[CloudConnectionStore]',
      log,
      warn: logWarn,
    }) as unknown as Store<Record_>;
  }

  read(): CloudConnectionPersisted {
    return {
      config: this.store.get('config') ?? null,
      autoConnect: this.store.get('autoConnect') ?? false,
      sourceName: this.store.get('sourceName') || DEFAULT_SOURCE_NAME,
      files: this.store.get('files') ?? [],
      versions: this.store.get('versions') ?? {},
    };
  }

  write(patch: Partial<CloudConnectionPersisted>): void {
    for (const [key, value] of Object.entries(patch)) {
      this.store.set(key, value as never);
    }
  }
}
