import { asRenderRevision } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { shouldTransferRenderedFrame } from './renderWorkerGuards';

describe('render worker transfer guard', () => {
  it('rejects obsolete results before bitmap allocation and transfer', () => {
    expect(shouldTransferRenderedFrame(asRenderRevision(4), asRenderRevision(5))).toBe(false);
  });

  it('allows the active render result', () => {
    expect(shouldTransferRenderedFrame(asRenderRevision(5), asRenderRevision(5))).toBe(true);
  });
});
