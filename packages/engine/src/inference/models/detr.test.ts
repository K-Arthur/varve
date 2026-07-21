import { describe, expect, it } from 'vitest';
import { COCO_CLASSES, DETR_INPUT_SIZE, decodeDetrOutput } from './detr';

const NUM_QUERIES = 100;
const NUM_CLASSES = 92;

/** Build a logits row that is a confident one-hot prediction for `classId`. */
function oneHotLogits(classId: number): number[] {
  const row = new Array(NUM_CLASSES).fill(-10);
  row[classId] = 10;
  return row;
}

function buildLogits(perQueryClassId: (q: number) => number): Float32Array {
  const data = new Float32Array(NUM_QUERIES * NUM_CLASSES);
  for (let q = 0; q < NUM_QUERIES; q++) {
    const row = oneHotLogits(perQueryClassId(q));
    data.set(row, q * NUM_CLASSES);
  }
  return data;
}

function buildBoxes(perQueryBox: (q: number) => [number, number, number, number]): Float32Array {
  const data = new Float32Array(NUM_QUERIES * 4);
  for (let q = 0; q < NUM_QUERIES; q++) {
    data.set(perQueryBox(q), q * 4);
  }
  return data;
}

describe('detr', () => {
  it('exposes the verified fixed input size', () => {
    expect(DETR_INPUT_SIZE).toBe(800);
  });

  it('has 91 real COCO classes (index 91 "no object" is excluded from the list)', () => {
    expect(COCO_CLASSES.length).toBe(91);
    expect(COCO_CLASSES[1]).toBe('person');
  });

  describe('decodeDetrOutput', () => {
    it('filters out the "no object" class (index 91) even when confident', () => {
      const logits = buildLogits(() => 91);
      const boxes = buildBoxes(() => [0.5, 0.5, 0.2, 0.2]);
      const results = decodeDetrOutput(logits, boxes, 100, 100);
      expect(results).toHaveLength(0);
    });

    it('filters out N/A placeholder classes', () => {
      const logits = buildLogits((q) => (q === 0 ? 0 : 91)); // class 0 = 'N/A'
      const boxes = buildBoxes(() => [0.5, 0.5, 0.2, 0.2]);
      const results = decodeDetrOutput(logits, boxes, 100, 100);
      expect(results).toHaveLength(0);
    });

    it('filters out detections below the confidence threshold', () => {
      // Two near-equal logits push softmax confidence below 0.7.
      const data = new Float32Array(NUM_QUERIES * NUM_CLASSES);
      for (let q = 0; q < NUM_QUERIES; q++) {
        const row = new Array(NUM_CLASSES).fill(0);
        row[1] = 1; // person, but weakly separated from other classes
        data.set(row, q * NUM_CLASSES);
      }
      const boxes = buildBoxes(() => [0.5, 0.5, 0.2, 0.2]);
      const results = decodeDetrOutput(data, boxes, 100, 100, undefined, 0.7);
      expect(results).toHaveLength(0);
    });

    it('decodes a confident "person" detection into original pixel coordinates (no letterbox)', () => {
      const logits = buildLogits((q) => (q === 0 ? 1 : 91));
      const boxes = buildBoxes((q) => (q === 0 ? [0.5, 0.5, 0.2, 0.4] : [0.5, 0.5, 0.01, 0.01]));
      const results = decodeDetrOutput(logits, boxes, 800, 800);
      expect(results).toHaveLength(1);
      expect(results[0]!.label).toBe('person');
      expect(results[0]!.classId).toBe(1);
      expect(results[0]!.confidence).toBeGreaterThan(0.7);
      // cx=0.5*800=400, cy=0.5*800=400, w=0.2*800=160, h=0.4*800=320
      // x = cx - w/2 = 320, y = cy - h/2 = 240
      expect(results[0]!.box.x).toBeCloseTo(320, 0);
      expect(results[0]!.box.y).toBeCloseTo(240, 0);
      expect(results[0]!.box.width).toBeCloseTo(160, 0);
      expect(results[0]!.box.height).toBeCloseTo(320, 0);
    });

    it('maps a detection through the letterbox transform for a non-square source', () => {
      // Wide 1600x800 source letterboxed into 800x800 (scale 0.5, padded
      // top/bottom by 200px each) — same bug class as SAM2/line-art.
      const logits = buildLogits((q) => (q === 0 ? 1 : 91));
      // Box sits exactly in the un-padded content region: content spans
      // y in [200,600] of the 800x800 letterboxed square.
      const boxes = buildBoxes((q) => (q === 0 ? [0.5, 0.5, 0.1, 0.1] : [0.5, 0.5, 0.01, 0.01]));
      const letterbox = { offsetX: 0, offsetY: 200 };
      const results = decodeDetrOutput(logits, boxes, 1600, 800, letterbox);
      expect(results).toHaveLength(1);
      // cx=400 (of 800), scaledH = 800-400=400, scaleY = 800/400 = 2
      // y = (cy - h/2 - offsetY) * scaleY = (400 - 40 - 200) * 2 = 320
      const box = results[0]!.box;
      expect(box.y).toBeCloseTo(320, 0);
      // scaleX = 1600/800 = 2 (no x offset), x = (400-40)*2 = 720
      expect(box.x).toBeCloseTo(720, 0);
    });

    it('clamps boxes to stay within the original image bounds', () => {
      const logits = buildLogits((q) => (q === 0 ? 1 : 91));
      // A box centered near the edge with a huge width should be clamped.
      const boxes = buildBoxes((q) => (q === 0 ? [0.95, 0.95, 0.8, 0.8] : [0.5, 0.5, 0.01, 0.01]));
      const results = decodeDetrOutput(logits, boxes, 100, 100);
      expect(results).toHaveLength(1);
      expect(results[0]!.box.x).toBeGreaterThanOrEqual(0);
      expect(results[0]!.box.y).toBeGreaterThanOrEqual(0);
      expect(results[0]!.box.width).toBeLessThanOrEqual(100);
      expect(results[0]!.box.height).toBeLessThanOrEqual(100);
    });

    it('sorts multiple detections by descending confidence', () => {
      const data = new Float32Array(NUM_QUERIES * NUM_CLASSES).fill(-10);
      // Query 0: weakly confident "car" (classId 3)
      const q0 = new Array(NUM_CLASSES).fill(-10);
      q0[3] = 3;
      data.set(q0, 0 * NUM_CLASSES);
      // Query 1: strongly confident "dog" (classId 18)
      const q1 = new Array(NUM_CLASSES).fill(-10);
      q1[18] = 12;
      data.set(q1, 1 * NUM_CLASSES);
      for (let q = 2; q < NUM_QUERIES; q++) {
        data.set(oneHotLogits(91), q * NUM_CLASSES);
      }
      const boxes = buildBoxes(() => [0.5, 0.5, 0.2, 0.2]);
      const results = decodeDetrOutput(data, boxes, 800, 800, undefined, 0.6);
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.confidence).toBeGreaterThanOrEqual(results[i]!.confidence);
      }
    });
  });
});
