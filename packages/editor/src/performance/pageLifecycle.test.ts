import { DerivedWorkAdmission } from '@varve/platform';
import { describe, expect, it } from 'vitest';
import { installPageLifecycleAdmission } from './pageLifecycle';

function makeDocument(hidden = false): EventTarget & {
  hidden: boolean;
  visibilityState: string;
} {
  const target = new EventTarget() as EventTarget & {
    hidden: boolean;
    visibilityState: string;
  };
  target.hidden = hidden;
  target.visibilityState = hidden ? 'hidden' : 'visible';
  return target;
}

describe('page lifecycle derived-work admission', () => {
  it('pauses hidden work and resumes it on visibility return', () => {
    const admission = new DerivedWorkAdmission();
    const documentTarget = makeDocument();
    const windowTarget = new EventTarget();
    const remove = installPageLifecycleAdmission({ admission, documentTarget, windowTarget });

    expect(admission.snapshot().paused).toBe(false);
    documentTarget.hidden = true;
    documentTarget.visibilityState = 'hidden';
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(admission.snapshot().paused).toBe(true);

    documentTarget.hidden = false;
    documentTarget.visibilityState = 'visible';
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(admission.snapshot().paused).toBe(false);
    remove();
  });

  it('pauses for freeze/pagehide and resumes for resume/pageshow', () => {
    const admission = new DerivedWorkAdmission();
    const documentTarget = makeDocument();
    const windowTarget = new EventTarget();
    const remove = installPageLifecycleAdmission({ admission, documentTarget, windowTarget });

    documentTarget.dispatchEvent(new Event('freeze'));
    expect(admission.snapshot().paused).toBe(true);
    documentTarget.dispatchEvent(new Event('resume'));
    expect(admission.snapshot().paused).toBe(false);
    windowTarget.dispatchEvent(new Event('pagehide'));
    expect(admission.snapshot().paused).toBe(true);
    windowTarget.dispatchEvent(new Event('pageshow'));
    expect(admission.snapshot().paused).toBe(false);
    remove();
    documentTarget.dispatchEvent(new Event('freeze'));
    expect(admission.snapshot().paused).toBe(false);
  });
});
