import {
  type BrushDab,
  type BrushPreset,
  generateDabs,
  type StrokePoint,
  seedJitter,
  smoothStrokePoints,
  strokeBounds,
} from '@strata/scene';

export interface BrushWorkerCommand {
  type: 'generateDabs';
  strokeId: string;
  points: StrokePoint[];
  preset: BrushPreset;
  jitterSeed: number;
  requestId: number;
}

export interface BrushWorkerResponse {
  type: 'dabsGenerated';
  strokeId: string;
  dabs: BrushDab[];
  bounds: { x: number; y: number; w: number; h: number };
  requestId: number;
}

self.onmessage = (e: MessageEvent<BrushWorkerCommand>) => {
  const cmd = e.data;
  if (cmd.type !== 'generateDabs') return;

  const { strokeId, points, preset, jitterSeed, requestId } = cmd;

  seedJitter(jitterSeed);

  const smoothed = smoothStrokePoints(points, preset.smoothing);
  const dabs = generateDabs(smoothed, preset);
  const bounds = strokeBounds(dabs);

  const response: BrushWorkerResponse = {
    type: 'dabsGenerated',
    strokeId,
    dabs,
    bounds,
    requestId,
  };

  self.postMessage(response);
};
