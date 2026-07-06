import { afterEach, describe, expect, it } from 'vitest';
import { cancelAllWorkerJobs, terminateWorkerPool } from './workerPool';

describe('workerPool', () => {
  afterEach(() => {
    terminateWorkerPool();
  });

  it('cancelAllWorkerJobs clears pending without throwing', () => {
    expect(() => cancelAllWorkerJobs()).not.toThrow();
  });

  it('terminateWorkerPool resets pool state', () => {
    terminateWorkerPool();
    expect(() => terminateWorkerPool()).not.toThrow();
  });
});
