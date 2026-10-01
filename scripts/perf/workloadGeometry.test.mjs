import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDragPoint } from './workloadGeometry.mjs';

test('vector fixture target accounts for camera pan and avoids resize and center handles', () => {
  assert.deepEqual(
    fixtureDragPoint(
      { id: 'perf-vector-1k', nodeCount: 1000 },
      { x: 338, y: 16, width: 924, height: 822 },
      { zoom: 1, panX: -338, panY: 0, rotation: 0 },
    ),
    { x: 758, y: 451 },
  );
});

test('dense non-grid fixtures use the visible canvas center', () => {
  assert.deepEqual(
    fixtureDragPoint(
      { id: 'mixed-raster-vector', nodeCount: 1000 },
      { x: 10, y: 20, width: 800, height: 600 },
      { zoom: 0.5, panX: 40, panY: -20, rotation: 0 },
    ),
    { x: 410, y: 320 },
  );
});
