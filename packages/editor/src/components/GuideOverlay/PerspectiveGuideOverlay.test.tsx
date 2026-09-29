import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTwoPointPerspectiveSegments,
  PerspectiveGuideOverlay,
} from './PerspectiveGuideOverlay';

vi.mock('../../canvas/cameraState', () => ({
  editorScreenToWorld: (_camera: unknown, x: number, y: number) => [x, y],
  editorWorldToScreen: (_camera: unknown, x: number, y: number) => [x, y],
  getEditorViewport: () => ({ width: 800, height: 600 }),
}));

describe('two-point perspective guide overlay', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('returns a bounded grid that converges to opposite vanishing points', () => {
    const segments = createTwoPointPerspectiveSegments(
      800,
      600,
      { x: 120, y: 240 },
      { x: 680, y: 240 },
      100,
      100,
    );

    expect(segments.leftRays).toHaveLength(9);
    expect(segments.rightRays).toHaveLength(9);
    expect(segments.verticals).toHaveLength(9);
    expect(segments.leftRays.every((line) => line.x1 === 120 && line.x2 === 800)).toBe(true);
    expect(segments.rightRays.every((line) => line.x1 === 680 && line.x2 === 0)).toBe(true);
    expect(segments.verticals.every((line) => line.x1 === line.x2)).toBe(true);
  });

  it('rejects invalid viewport dimensions without allocating guide lines', () => {
    expect(createTwoPointPerspectiveSegments(0, 600, { x: 1, y: 1 }, { x: 2, y: 2 })).toEqual({
      leftRays: [],
      rightRays: [],
      verticals: [],
    });
  });

  it('exposes movable vanishing points and maps pointer and keyboard movement to world space', () => {
    const onMovePoint = vi.fn();
    render(
      <PerspectiveGuideOverlay
        camera={{ zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: 0 }}
        left={[120, 240]}
        right={[680, 240]}
        onMovePoint={onMovePoint}
      />,
    );

    const left = screen.getByRole('button', { name: 'Left vanishing point' });
    expect(document.querySelector('.perspective-guide-overlay')).toBeTruthy();
    fireEvent.pointerDown(left, { pointerId: 7, clientX: 120, clientY: 240 });
    fireEvent.pointerMove(left, { pointerId: 7, clientX: 160, clientY: 270 });
    fireEvent.pointerUp(left, { pointerId: 7, clientX: 160, clientY: 270 });
    expect(onMovePoint).toHaveBeenLastCalledWith('left', [160, 270]);

    fireEvent.keyDown(left, { key: 'ArrowRight' });
    expect(onMovePoint).toHaveBeenLastCalledWith('left', [128, 240]);
  });
});
