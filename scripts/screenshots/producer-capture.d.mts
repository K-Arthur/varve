import type { Locator, Page, TestInfo } from '@playwright/test';

export declare function captureProducerScreenshot(
  page: Page,
  testInfo: TestInfo,
  filename: string,
  options?: {
    target?: Page | Locator;
    screenshot?: Omit<NonNullable<Parameters<Page['screenshot']>[0]>, 'path'>;
  },
): Promise<Buffer>;
