import { describe, expect, it } from 'vitest';
import {
  distanceToPathEndpoint,
  pathEndpointWorld,
  pathPointsLocalToWorld,
  pathPointsWorldToLocal,
  rebasePathPointsToLocal,
} from '../pathCoords';

describe('pathCoords', () => {
  it('rebasePathPointsToLocal subtracts origin from anchors', () => {
    const world = [
      { x: 100, y: 100, handleIn: null, handleOut: null },
      { x: 200, y: 150, handleIn: null, handleOut: [10, 5] as [number, number] },
    ];
    const local = rebasePathPointsToLocal(world, { x: 100, y: 100 });
    expect(local[0]).toMatchObject({ x: 0, y: 0 });
    expect(local[1]).toMatchObject({ x: 100, y: 50, handleOut: [10, 5] });
  });

  it('pathPointsLocalToWorld and pathPointsWorldToLocal round-trip', () => {
    const local = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      {
        x: 50,
        y: 30,
        handleIn: [-5, 0] as [number, number],
        handleOut: [5, 0] as [number, number],
      },
    ];
    const wm: import('@varve/shared').Affine = [1, 0, 0, 1, 100, 200];
    const world = pathPointsLocalToWorld(local, wm);
    expect(world[0]).toMatchObject({ x: 100, y: 200 });
    expect(world[1]).toMatchObject({ x: 150, y: 230 });
    const back = pathPointsWorldToLocal(world, wm);
    expect(back[0]?.x).toBeCloseTo(0);
    expect(back[0]?.y).toBeCloseTo(0);
    expect(back[1]?.x).toBeCloseTo(50);
    expect(back[1]?.y).toBeCloseTo(30);
  });

  it('pathEndpointWorld returns last anchor in world space', () => {
    const local = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 40, y: 60, handleIn: null, handleOut: null },
    ];
    const ep = pathEndpointWorld(local, [1, 0, 0, 1, 50, 50], 'last');
    expect(ep).toEqual({ x: 90, y: 110 });
  });

  it('distanceToPathEndpoint measures world-space distance', () => {
    const local = [{ x: 0, y: 0, handleIn: null, handleOut: null }];
    const d = distanceToPathEndpoint({ x: 103, y: 104 }, local, [1, 0, 0, 1, 100, 100], 'first');
    expect(d).toBeCloseTo(5);
  });
});
