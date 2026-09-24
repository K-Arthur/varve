import { describe, expect, it, vi } from 'vitest';
import { handlePageHideBoundary } from '../pageHideBoundary';

function setup(shouldWarn = false) {
  const coordinator = {
    bestEffortFlush: vi.fn(),
    shouldWarnOnUnload: vi.fn(() => shouldWarn),
  };
  const marker = { markClean: vi.fn() };
  return { coordinator, marker };
}

describe('handlePageHideBoundary', () => {
  it('marks an ordinary clean browser close as clean after flushing', () => {
    const { coordinator, marker } = setup();

    handlePageHideBoundary(false, coordinator, marker);

    expect(coordinator.bestEffortFlush).toHaveBeenCalledOnce();
    expect(coordinator.shouldWarnOnUnload).toHaveBeenCalledOnce();
    expect(marker.markClean).toHaveBeenCalledOnce();
  });

  it('keeps dirty or active sessions marked unclean', () => {
    const { coordinator, marker } = setup(true);

    handlePageHideBoundary(false, coordinator, marker);

    expect(coordinator.bestEffortFlush).toHaveBeenCalledOnce();
    expect(marker.markClean).not.toHaveBeenCalled();
  });

  it('does not mark a back-forward-cache transition clean', () => {
    const { coordinator, marker } = setup();

    handlePageHideBoundary(true, coordinator, marker);

    expect(coordinator.bestEffortFlush).toHaveBeenCalledOnce();
    expect(coordinator.shouldWarnOnUnload).not.toHaveBeenCalled();
    expect(marker.markClean).not.toHaveBeenCalled();
  });

  it('does nothing when the lifecycle coordinator has not mounted', () => {
    const marker = { markClean: vi.fn() };

    handlePageHideBoundary(false, null, marker);

    expect(marker.markClean).not.toHaveBeenCalled();
  });
});
