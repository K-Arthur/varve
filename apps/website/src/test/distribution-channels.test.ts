import { describe, expect, it } from 'vitest';
import {
  MICROSOFT_STORE_LIVE,
  WINGET_LIVE,
  WINGET_PACKAGE_ID,
  wingetInstallCommand,
} from '../lib/distribution-channels';

describe('Windows distribution channel flags', () => {
  it('keeps winget and Store gated until they are published', () => {
    expect(WINGET_LIVE).toBe(false);
    expect(MICROSOFT_STORE_LIVE).toBe(false);
    expect(WINGET_PACKAGE_ID).toBe('VarveStudio.Varve');
    expect(WINGET_PACKAGE_ID).not.toBe('K-Arthur.Varve');
    expect(wingetInstallCommand()).toBe('winget install VarveStudio.Varve');
  });
});
