/** Deterministic pointer targets for the production interaction workloads. */

export function fixtureDragPoint(
  seeded,
  box,
  camera,
  { gridSpacing = 140, cell = { w: 64, h: 48 } } = {},
) {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  if (!/^perf-vector-/.test(seeded?.id ?? '')) return { x: centerX, y: centerY };

  const nodeCount = Number(seeded.nodeCount) || 1;
  const columns = Math.ceil(Math.sqrt(nodeCount * 1.6));
  const rows = Math.ceil(nodeCount / columns);
  const zoom = Number.isFinite(camera?.zoom) && camera.zoom > 0 ? camera.zoom : 1;
  const panX = Number.isFinite(camera?.panX) ? camera.panX : 0;
  const panY = Number.isFinite(camera?.panY) ? camera.panY : 0;
  const rotation = Number.isFinite(camera?.rotation) ? camera.rotation : 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // Invert the camera transform at the viewport center so a panned or rotated
  // view still chooses an actually visible fixture cell.
  const centerWorldX = cos * (-panX / zoom) + sin * (-panY / zoom);
  const centerWorldY = -sin * (-panX / zoom) + cos * (-panY / zoom);
  const column = Math.max(
    0,
    Math.min(columns - 1, Math.round((centerWorldX - cell.w / 2) / gridSpacing)),
  );
  const row = Math.max(
    0,
    Math.min(rows - 1, Math.round((centerWorldY - cell.h / 2) / gridSpacing)),
  );

  // Stay 16px inside the left edge and vertically centered. The node-center
  // move handle and the resize handles all intercept pointer events.
  const worldX = column * gridSpacing + 16;
  const worldY = row * gridSpacing + cell.h / 2;
  return {
    x: centerX + panX + zoom * (cos * worldX - sin * worldY),
    y: centerY + panY + zoom * (sin * worldX + cos * worldY),
  };
}
