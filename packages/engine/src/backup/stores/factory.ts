import type { BackupStore } from '../storage';
import { createIndexedDbBackupStore } from './indexeddb';
import { createMemoryBackupStore } from './memory';

export interface BackupEnvironment {
  hasIndexedDb: boolean;
  platform: 'tauri' | 'web' | 'memory' | 'test';
  basePath?: string;
}

export function createBackupStore(env: BackupEnvironment): BackupStore {
  if (env.hasIndexedDb) {
    try {
      const store = createIndexedDbBackupStore();
      return store;
    } catch {}
  }
  return createMemoryBackupStore();
}
