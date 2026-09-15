import { describe, expect, it } from 'vitest';
import {
  decodeFaceDetections,
  YU_NET_INPUT_SIZE,
  YU_NET_LANDMARK_NAMES,
  YU_NET_STRIDES,
  YU_NET_TENSOR_SPEC,
} from './faceDetect';

/**
 * Build a minimal-but-real output tensor map. Every stride gets zeroed
 * tensors with the correct shape; the caller can inject a single confident
 * detection into a chosen stride at a chosen (row, col) cell.
 */
function buildOutputs() {
  const outputs: Record<string, { data: Float32Array; dims: number[] }> = {};
  for (const stride of YU_NET_STRIDES) {
    const feat = YU_NET_INPUT_SIZE / stride;
    const cells = feat * feat;
    const make = (channels: number) => ({
      data: new Float32Array(cells * channels),
      dims: [1, cells, channels],
    });
    outputs[`cls_${stride}`] = make(1);
    outputs[`obj_${stride}`] = make(1);
    outputs[`bbox_${stride}`] = make(4);
    outputs[`kps_${stride}`] = make(10);
  }
  return outputs;
}

/** Plant one high-confidence face at grid cell (r, c) of a given stride. */
function plantFace(
  outputs: Record<string, { data: Float32Array; dims: number[] }>,
  stride: number,
  r: number,
  c: number,
  opts: {
    cls?: number;
    obj?: number;
    bbox?: [number, number, number, number];
    kps?: number[];
  } = {},
) {
  const feat = YU_NET_INPUT_SIZE / stride;
  const idx = r * feat + c;
  const cls = outputs[`cls_${stride}`]!.data;
  const obj = outputs[`obj_${stride}`]!.data;
  const bbox = outputs[`bbox_${stride}`]!.data;
  const kps = outputs[`kps_${stride}`]!.data;
  cls[idx] = opts.cls ?? 1;
  obj[idx] = opts.obj ?? 1;
  const [bx, by, bw, bh] = opts.bbox ?? [0, 0, 0, 0];
  bbox[idx * 4] = bx;
  bbox[idx * 4 + 1] = by;
  bbox[idx * 4 + 2] = bw;
  bbox[idx * 4 + 3] = bh;
  const k = opts.kps ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 10; n++) kps[idx * 10 + n] = k[n] ?? 0;
}

describe('faceDetect (YuNet 2023mar)', () => {
  it('exposes the verified fixed input size and square spec', () => {
    expect(YU_NET_INPUT_SIZE).toBe(640);
    expect(YU_NET_STRIDES).toEqual([8, 16, 32]);
    expect(YU_NET_TENSOR_SPEC.inputWidth).toBe(640);
    expect(YU_NET_TENSOR_SPEC.inputHeight).toBe(640);
    // Raw [0,255] range: std = 1/255 recovers the un-normalized pixel.
    expect(YU_NET_TENSOR_SPEC.mean).toEqual([0, 0, 0]);
    expect(YU_NET_TENSOR_SPEC.std).toEqual([1 / 255, 1 / 255, 1 / 255]);
  });

  it('names the five keypoints in subject perspective', () => {
    expect(YU_NET_LANDMARK_NAMES).toEqual([
      'RIGHT_EYE',
      'LEFT_EYE',
      'NOSE_TIP',
      'RIGHT_MOUTH_CORNER',
      'LEFT_MOUTH_CORNER',
    ]);
  });

  it('decodes a confident cell into model-space coordinates (square source)', () => {
    const outputs = buildOutputs();
    // Stride 8, cell (3, 5): cx=(5+0)*8=40, cy=(3+0)*8=24, w=exp(0)*8=8, h=exp(0)*8=8.
    plantFace(outputs, 8, 3, 5);
    const faces = decodeFaceDetections(outputs, 640, 640);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.box.x).toBeCloseTo(40 - 4, 0);
    expect(faces[0]!.box.y).toBeCloseTo(24 - 4, 0);
    expect(faces[0]!.box.width).toBeCloseTo(8, 0);
    expect(faces[0]!.box.height).toBeCloseTo(8, 0);
    expect(faces[0]!.score).toBeCloseTo(1, 3);
  });

  it('applies score = sqrt(cls * obj) with clamping (OpenCV parity)', () => {
    const outputs = buildOutputs();
    plantFace(outputs, 16, 5, 5, { cls: 0.81, obj: 0.64 });
    const faces = decodeFaceDetections(outputs, 640, 640);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.score).toBeCloseTo(Math.sqrt(0.81 * 0.64), 6);

    // Clamped values: cls 1.5 -> 1.0, obj 0.25 -> score sqrt(0.25) = 0.5.
    const outputs2 = buildOutputs();
    plantFace(outputs2, 16, 5, 5, { cls: 1.5, obj: 0.25 });
    const faces2 = decodeFaceDetections(outputs2, 640, 640);
    expect(faces2[0]!.score).toBeCloseTo(0.5, 6);
  });

  it('filters candidates below the score threshold', () => {
    const outputs = buildOutputs();
    plantFace(outputs, 32, 3, 3, { cls: 0.3, obj: 0.2 }); // score ~0.245
    const faces = decodeFaceDetections(outputs, 640, 640, undefined, {
      scoreThreshold: 0.3,
    });
    expect(faces).toHaveLength(0);
  });

  it('decodes bbox offsets and exponential size (OpenCV formula)', () => {
    const outputs = buildOutputs();
    // Stride 16, cell (2, 4): bbox offsets push the box off the cell anchor.
    plantFace(outputs, 16, 2, 4, { bbox: [0.5, -0.25, Math.log(2), Math.log(3)] });
    const faces = decodeFaceDetections(outputs, 640, 640);
    expect(faces).toHaveLength(1);
    const { box } = faces[0]!;
    // cx=(4+0.5)*16=72, cy=(2-0.25)*16=28, w=2*16=32, h=3*16=48
    expect(box.x).toBeCloseTo(72 - 16, 0);
    expect(box.y).toBeCloseTo(28 - 24, 0);
    expect(box.width).toBeCloseTo(32, 0);
    expect(box.height).toBeCloseTo(48, 0);
  });

  it('decodes five keypoints per face (OpenCV formula)', () => {
    const outputs = buildOutputs();
    plantFace(outputs, 8, 1, 2, {
      kps: [0.5, 0.25, -0.5, 0.75, 0, 0, 0.5, -0.5, -0.25, 0.5],
    });
    const faces = decodeFaceDetections(outputs, 640, 640);
    expect(faces).toHaveLength(1);
    const landmarks = faces[0]!.landmarks;
    expect(landmarks).toHaveLength(5);
    // (kps + cell) * stride: kp0 = (0.5+2)*8=20, kp1 = (0.25+1)*8=10
    expect(landmarks[0]!.x).toBeCloseTo(20, 0);
    expect(landmarks[0]!.y).toBeCloseTo(10, 0);
    // kp2 = (-0.5+2)*8=12, kp3 = (0.75+1)*8=14
    expect(landmarks[1]!.x).toBeCloseTo(12, 0);
    expect(landmarks[1]!.y).toBeCloseTo(14, 0);
  });

  it('maps detections through the letterbox transform (non-square source)', () => {
    // Wide 1280x850 source letterboxed into 640x640 (scale 0.5, padded
    // top/bottom by 107.5px each). Plant a face at stride 16 cell (15, 20):
    // box center (320, 240), w/h 16. Assert the source-pixel mapping of the
    // top-left corner.
    const outputs = buildOutputs();
    const stride = 16;
    const r = 15; // cy = 15*16 = 240 in model space
    const c = 20; // cx = 20*16 = 320 in model space
    plantFace(outputs, stride, r, c, { bbox: [0, 0, 0, 0] });
    // Letterbox transform for 1280x850 -> 640x640:
    const scale = Math.min(640 / 1280, 640 / 850);
    const offsetY = (640 - 850 * scale) / 2;
    const offsetX = 0;
    const faces = decodeFaceDetections(outputs, 1280, 850, { offsetX, offsetY });
    expect(faces).toHaveLength(1);
    const contentHeight = 640 - 2 * offsetY;
    const scaleX = 1280 / 640;
    const scaleY = 850 / contentHeight;
    // Model-space box top-left is (320-8, 240-8) = (312, 232).
    expect(faces[0]!.box.x).toBeCloseTo(312 * scaleX, 0);
    expect(faces[0]!.box.y).toBeCloseTo((232 - offsetY) * scaleY, 0);
    expect(faces[0]!.box.width).toBeCloseTo(16 * scaleX, 0);
    expect(faces[0]!.box.height).toBeCloseTo(16 * scaleY, 0);
  });

  it('runs NMS, keeping the highest-scoring overlapping face', () => {
    const outputs = buildOutputs();
    // Two faces in the same stride/cell region — one much stronger.
    plantFace(outputs, 8, 3, 5, { cls: 0.5, obj: 0.5 }); // score 0.5
    plantFace(outputs, 8, 3, 5, { cls: 1, obj: 1 }); // score 1.0
    const faces = decodeFaceDetections(outputs, 640, 640);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.score).toBeCloseTo(1, 3);
  });

  it('keeps non-overlapping faces after NMS', () => {
    const outputs = buildOutputs();
    plantFace(outputs, 8, 3, 5); // cell 3,5
    plantFace(outputs, 8, 3, 35); // far cell 3,35 (320px apart)
    const faces = decodeFaceDetections(outputs, 640, 640);
    expect(faces).toHaveLength(2);
  });

  it('sorts by descending score', () => {
    const outputs = buildOutputs();
    plantFace(outputs, 32, 1, 1, { cls: 0.4, obj: 0.4 }); // score 0.4
    plantFace(outputs, 32, 10, 10, { cls: 0.9, obj: 0.9 }); // score 0.9
    const faces = decodeFaceDetections(outputs, 640, 640);
    expect(faces[0]!.score).toBeCloseTo(0.9, 3);
    expect(faces[1]!.score).toBeCloseTo(0.4, 3);
  });

  it('clamps boxes to the source image bounds', () => {
    const outputs = buildOutputs();
    // Cell 0,0 stride 32 with a box extending into negative space.
    plantFace(outputs, 32, 0, 0, { bbox: [-1, -1, Math.log(4), Math.log(4)] });
    const faces = decodeFaceDetections(outputs, 320, 320);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.box.x).toBeGreaterThanOrEqual(0);
    expect(faces[0]!.box.y).toBeGreaterThanOrEqual(0);
    expect(faces[0]!.box.width).toBeLessThanOrEqual(320);
    expect(faces[0]!.box.height).toBeLessThanOrEqual(320);
  });

  it('returns an empty array for all-zero outputs', () => {
    const outputs = buildOutputs();
    expect(decodeFaceDetections(outputs, 640, 640)).toHaveLength(0);
  });
});
