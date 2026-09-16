// @vitest-environment node
/**
 * Real-photograph candidate contact sheets for human ranking annotation (G2).
 *
 * The synthetic corpus measures oracle IoU, but it cannot express *intent*:
 * "the whole animal" and "its head" can both be correct masks for the same
 * click. The brief requires acceptable-alternative annotations for ambiguous
 * cases, so this gated harness runs the real MobileSAM provider on
 * rights-cleared real photographs, writes one candidate mask set per
 * intent-specific case, and renders a contact sheet so a person can inspect
 * every candidate before annotating it.
 *
 * It writes a DRAFT fixture (no annotations). The reviewed fixture is
 * committed separately; nothing here invents an annotation, and nothing in
 * the evaluation path trusts this draft.
 *
 * Enable with:
 *   VARVE_MOBILE_SAM_MODEL_DIR=<dir with mobile_sam_image_encoder.onnx and sam_mask_decoder_multi.onnx>
 *   VARVE_RANKING_ANNOTATION_OUT=<dir>            (default /tmp/opencode/ranking-annotation)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { Tensor } from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import {
  decodeMobileSamDecoderOutput,
  encodeMobileSamPrompts,
  preprocessMobileSamImageData,
} from '../../inference/models/mobileSam';
import { encodeMaskRle } from './evidenceRecord';

const MODEL_DIR = process.env.VARVE_MOBILE_SAM_MODEL_DIR ?? '';
const OUTPUT_DIR = process.env.VARVE_RANKING_ANNOTATION_OUT ?? '/tmp/opencode/ranking-annotation';
const FIXTURE_ROOT = resolve(process.cwd(), 'tests/e2e/fixtures');

if (typeof globalThis.ImageData === 'undefined') {
  class NodeImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as unknown as { ImageData: typeof NodeImageData }).ImageData = NodeImageData;
}

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs') as {
  PNG: {
    new (options: {
      width: number;
      height: number;
    }): {
      data: Uint8Array;
      width: number;
      height: number;
    };
    sync: { write(image: { data: Uint8Array; width: number; height: number }): Uint8Array };
  };
};
const jpeg = require('jpeg-js') as {
  decode: (
    data: Uint8Array,
    options: { useTArray: boolean },
  ) => { data: Uint8Array; width: number; height: number };
};

interface AnnotationCase {
  id: string;
  /** Fixture file under tests/e2e/fixtures. */
  fixture: string;
  /** Intent this prompt represents; written into the reviewed fixture. */
  intent: string;
  /** Prompt point in normalized source coordinates. */
  point: { x: number; y: number; label: 0 | 1 };
  /** Optional negative correction point. */
  negativePoint?: { x: number; y: number };
  /** Integer downscale factor applied before running the model. */
  downscale: 1 | 2;
  /** Why the case is ambiguous/interesting; goes into the reviewed fixture. */
  ambiguity: string;
}

/**
 * Cases are chosen for boundary and intent ambiguity, not for easy wins:
 * whole/part, hair/skin, one-among-many, and repeated low-contrast texture.
 * Each prompt is deliberately a single click, so candidate disagreement is
 * model behaviour rather than prompt complexity.
 */
const CASES: AnnotationCase[] = [
  {
    id: 'elephant-whole-animal',
    fixture: 'real-life-elephant.jpg',
    intent: 'the whole animal',
    point: { x: 0.52, y: 0.62, label: 1 },
    downscale: 2,
    ambiguity:
      'A click on the flank also matches the head/legs; candidates disagree between whole-body and part masks.',
  },
  {
    id: 'elephant-head-part',
    fixture: 'real-life-elephant.jpg',
    intent: 'the head only',
    point: { x: 0.42, y: 0.34, label: 1 },
    negativePoint: { x: 0.6, y: 0.8 },
    downscale: 2,
    ambiguity:
      'Part intent with a negative correction on the body; the model may still return the whole animal.',
  },
  {
    id: 'braided-portrait-hair',
    fixture: 'real-life-braided-portrait.jpg',
    intent: 'the hair',
    point: { x: 0.45, y: 0.3, label: 1 },
    downscale: 2,
    ambiguity:
      'Hair and backdrop share a boundary; candidates can split at the braid, at the hairline, or return the studio backdrop.',
  },
  {
    id: 'crab-subject-whole',
    fixture: 'real-life-galapagos-crab.jpg',
    intent: 'the whole crab',
    point: { x: 0.5, y: 0.55, label: 1 },
    downscale: 2,
    ambiguity:
      'The click lands on the eye, so the correct answer depends on intent. This case declares whole-animal intent and shares its prompt with the eye case.',
  },
  {
    id: 'crab-subject-eye',
    fixture: 'real-life-galapagos-crab.jpg',
    intent: 'the eye',
    point: { x: 0.5, y: 0.55, label: 1 },
    downscale: 2,
    ambiguity:
      'Same click as the whole-crab case, part intent: the tiny masks a precise click produces are correct here, not a failure.',
  },
  {
    id: 'yellowstone-pool',
    fixture: 'real-life-yellowstone-spring.jpg',
    intent: 'the mineral terrace under the click',
    point: { x: 0.5, y: 0.45, label: 1 },
    downscale: 2,
    ambiguity:
      'The click sits on the boundary between the thin blue water strip and the orange mineral crust. A declared intent is required: the crust is one candidate set, the water strip is another. Intent determines which is acceptable.',
  },
];

function decodeDownscaled(file: string, factor: number): ImageData {
  const decoded = jpeg.decode(readFileSync(file), { useTArray: true });
  const width = Math.floor(decoded.width / factor);
  const height = Math.floor(decoded.height / factor);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const sx = x * factor + dx;
          const sy = y * factor + dy;
          const index = (sy * decoded.width + sx) * 4;
          r += decoded.data[index] ?? 0;
          g += decoded.data[index + 1] ?? 0;
          b += decoded.data[index + 2] ?? 0;
          count += 1;
        }
      }
      const index = (y * width + x) * 4;
      out[index] = r / count;
      out[index + 1] = g / count;
      out[index + 2] = b / count;
      out[index + 3] = 255;
    }
  }
  return new ImageData(out, width, height);
}

/** Boundary-tinted contact sheet: source, mask in teal, edge in white. */
function renderSheet(
  image: ImageData,
  masks: Uint8Array[],
  scores: number[],
  columns: number,
): Uint8Array {
  return renderPanels(image, masks, scores, columns, true);
}

/**
 * Binary contact sheet: the mask shape alone, white on black. A reviewer needs
 * both views — the overlay to judge whether the boundary follows the object,
 * and the binary shape to read small or low-contrast candidates that a tint
 * cannot make legible.
 */
function renderMaskSheet(
  image: ImageData,
  masks: Uint8Array[],
  scores: number[],
  columns: number,
): Uint8Array {
  return renderPanels(image, masks, scores, columns, false);
}

/**
 * Source with the prompt markers drawn on it, so a reviewer can confirm the
 * click is actually on the intended object before blaming the model for the
 * candidates it produced. Positive prompts are white crosses, negative
 * prompts are dark crosses with a white outline.
 */
function renderPromptMarker(
  image: ImageData,
  points: Array<{ x: number; y: number; label: 0 | 1 }>,
): Uint8Array {
  const { width, height } = image;
  const sheet = new PNG({ width, height });
  sheet.data.set(image.data);
  const drawCross = (cx: number, cy: number, positive: boolean) => {
    const arm = 12;
    const thickness = 3;
    for (let dy = -arm; dy <= arm; dy += 1) {
      for (let dx = -arm; dx <= arm; dx += 1) {
        const onArm = Math.abs(dx) <= thickness || Math.abs(dy) <= thickness;
        if (!onArm) continue;
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const index = (y * width + x) * 4;
        const onOutline = Math.abs(dx) > arm - 2 || Math.abs(dy) > arm - 2;
        const value = positive ? (onOutline ? 0 : 255) : onOutline ? 255 : 0;
        sheet.data[index] = value;
        sheet.data[index + 1] = value;
        sheet.data[index + 2] = value;
        sheet.data[index + 3] = 255;
      }
    }
  };
  for (const point of points) {
    drawCross(point.x * width, point.y * height, point.label === 1);
  }
  return PNG.sync.write(sheet);
}

function renderPanels(
  image: ImageData,
  masks: Uint8Array[],
  scores: number[],
  columns: number,
  overlay: boolean,
): Uint8Array {
  const { width, height } = image;
  const rows = Math.ceil(masks.length / columns);
  const gap = 6;
  const sheetWidth = columns * width + (columns + 1) * gap;
  const sheetHeight = rows * height + (rows + 1) * gap;
  const sheet = new PNG({ width: sheetWidth, height: sheetHeight });
  sheet.data.fill(24);
  for (let i = 0; i < masks.length; i += 1) {
    const mask = masks[i] as Uint8Array;
    const column = i % columns;
    const row = Math.floor(i / columns);
    const originX = gap + column * (width + gap);
    const originY = gap + row * (height + gap);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceIndex = (y * width + x) * 4;
        const targetIndex = ((originY + y) * sheetWidth + originX + x) * 4;
        const inside = (mask[y * width + x] ?? 0) !== 0;
        let r: number;
        let g: number;
        let b: number;
        if (!overlay) {
          const value = inside ? 235 : 16;
          r = value;
          g = value;
          b = value;
        } else {
          r = image.data[sourceIndex] ?? 0;
          g = image.data[sourceIndex + 1] ?? 0;
          b = image.data[sourceIndex + 2] ?? 0;
          if (inside) {
            // Keep the mask interior close to the source so a reviewer can
            // judge whether the boundary follows the object; darken everything
            // outside so the mask shape is readable at contact-sheet scale.
            r = r * 0.85 + 0x2d * 0.15;
            g = g * 0.85 + 0xb8 * 0.15;
            b = b * 0.85 + 0xa6 * 0.15;
          } else {
            r *= 0.22;
            g *= 0.22;
            b *= 0.22;
          }
        }
        if (overlay) {
          const rightEdge = x + 1 < width ? (mask[y * width + x + 1] ?? 0) !== 0 : false;
          const downEdge = y + 1 < height ? (mask[(y + 1) * width + x] ?? 0) !== 0 : false;
          if (inside !== rightEdge || inside !== downEdge) {
            r = 255;
            g = 255;
            b = 255;
          }
        }
        sheet.data[targetIndex] = r;
        sheet.data[targetIndex + 1] = g;
        sheet.data[targetIndex + 2] = b;
        sheet.data[targetIndex + 3] = 255;
      }
    }
    // Panel index strip: a deterministic brightness band encodes the score so
    // a reviewer can map a panel back to its score without OCR.
    const band = Math.round(Math.max(0, Math.min(1, scores[i] ?? 0)) * 32);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const targetIndex = ((originY + y) * sheetWidth + originX + x) * 4;
        const value = x < band ? 255 : 40;
        sheet.data[targetIndex] = value;
        sheet.data[targetIndex + 1] = value;
        sheet.data[targetIndex + 2] = value;
        sheet.data[targetIndex + 3] = 255;
      }
    }
  }
  return PNG.sync.write(sheet);
}

describe('real-photograph ranking annotation sheets (gated)', () => {
  const ready =
    MODEL_DIR.length > 0 &&
    existsSync(join(MODEL_DIR, 'mobile_sam_image_encoder.onnx')) &&
    existsSync(join(MODEL_DIR, 'sam_mask_decoder_multi.onnx'));

  it.skipIf(!ready)(
    'runs each intent case and writes candidate sheets plus a draft fixture',
    async () => {
      const ort = await import('onnxruntime-node');
      const encoder = await ort.InferenceSession.create(
        join(MODEL_DIR, 'mobile_sam_image_encoder.onnx'),
        { executionProviders: ['cpu'], graphOptimizationLevel: 'all' },
      );
      const decoder = await ort.InferenceSession.create(
        join(MODEL_DIR, 'sam_mask_decoder_multi.onnx'),
        { executionProviders: ['cpu'], graphOptimizationLevel: 'all' },
      );
      mkdirSync(OUTPUT_DIR, { recursive: true });

      const cases: Array<Record<string, unknown>> = [];
      for (const testCase of CASES) {
        const fixturePath = join(FIXTURE_ROOT, testCase.fixture);
        if (!existsSync(fixturePath)) {
          throw new Error(`Missing fixture ${fixturePath}`);
        }
        const image = decodeDownscaled(fixturePath, testCase.downscale);
        const points = [
          { x: testCase.point.x, y: testCase.point.y, label: testCase.point.label },
          ...(testCase.negativePoint
            ? [{ x: testCase.negativePoint.x, y: testCase.negativePoint.y, label: 0 as const }]
            : []),
        ];
        const preprocessed = preprocessMobileSamImageData(image);
        const encoderOutputs = (await encoder.run({
          [encoder.inputNames[0]!]: new ort.Tensor('float32', preprocessed.tensor, [
            preprocessed.height,
            preprocessed.width,
            3,
          ]),
        })) as unknown as Record<string, Tensor>;
        const encoded = encodeMobileSamPrompts({ points }, image.width, image.height);
        const outputs = (await decoder.run({
          image_embeddings: encoderOutputs.image_embeddings!,
          point_coords: new ort.Tensor(
            'float32',
            encoded.point_coords!.data,
            encoded.point_coords!.dims,
          ),
          point_labels: new ort.Tensor(
            'float32',
            encoded.point_labels!.data,
            encoded.point_labels!.dims,
          ),
          mask_input: new ort.Tensor('float32', encoded.mask_input!.data, encoded.mask_input!.dims),
          has_mask_input: new ort.Tensor(
            'float32',
            encoded.has_mask_input!.data,
            encoded.has_mask_input!.dims,
          ),
          orig_im_size: new ort.Tensor(
            'float32',
            encoded.orig_im_size!.data,
            encoded.orig_im_size!.dims,
          ),
        })) as unknown as Record<string, Tensor>;
        const decoded = decodeMobileSamDecoderOutput(
          outputs.masks!.data as Float32Array,
          [...outputs.masks!.dims],
          outputs.iou_predictions!.data as Float32Array,
          [...outputs.iou_predictions!.dims],
          image.width,
          image.height,
          outputs.low_res_masks?.data as Float32Array | undefined,
          outputs.low_res_masks ? [...outputs.low_res_masks.dims] : undefined,
        );
        const masks = decoded.masks.map((candidate) => candidate.mask);
        const scores = decoded.masks.map((candidate) => candidate.score);
        const sheetName = `${testCase.id}.png`;
        const maskSheetName = `${testCase.id}.mask.png`;
        const promptSheetName = `${testCase.id}.prompt.png`;
        writeFileSync(join(OUTPUT_DIR, sheetName), renderSheet(image, masks, scores, 2));
        writeFileSync(join(OUTPUT_DIR, maskSheetName), renderMaskSheet(image, masks, scores, 2));
        writeFileSync(join(OUTPUT_DIR, promptSheetName), renderPromptMarker(image, points));
        cases.push({
          caseId: testCase.id,
          category: testCase.intent,
          fixture: testCase.fixture,
          fixtureSha256: createHash('sha256').update(readFileSync(fixturePath)).digest('hex'),
          width: image.width,
          height: image.height,
          downscale: testCase.downscale,
          prompts: {
            points: points.map((point) => ({
              x: Math.round(point.x * image.width),
              y: Math.round(point.y * image.height),
              label: point.label,
            })),
          },
          normalizedPrompts: { points },
          scores,
          candidateRle: masks.map((mask) => encodeMaskRle(mask)),
          selectedIndex: decoded.selectedIndex,
          // A reviewer fills these in after inspecting the sheet. Both stay
          // empty in the draft so an unannotated case cannot be mistaken for a
          // reviewed one.
          acceptableIndices: [],
          bestIndex: null,
          sheet: sheetName,
          intent: testCase.intent,
          ambiguity: testCase.ambiguity,
        });
        console.log(
          `ANNOTATION SHEET ${testCase.id} cases=${masks.length} scores=${scores.map((s) => s.toFixed(3)).join(',')} selected=${decoded.selectedIndex} -> ${sheetName}`,
        );
      }

      writeFileSync(
        join(OUTPUT_DIR, 'draft.json'),
        `${JSON.stringify(
          {
            fixtureVersion: 1,
            status: 'draft-awaiting-human-annotation',
            note: 'Acceptable/best indices are intentionally empty. The reviewed fixture is committed separately after a person inspects every sheet.',
            modelArtifacts: Object.fromEntries(
              ['mobile_sam_image_encoder.onnx', 'sam_mask_decoder_multi.onnx'].map((name) => [
                name,
                createHash('sha256')
                  .update(readFileSync(join(MODEL_DIR, name)))
                  .digest('hex'),
              ]),
            ),
            cases,
          },
          null,
          2,
        )}\n`,
      );
      console.log(`ANNOTATION DRAFT: ${join(OUTPUT_DIR, 'draft.json')}`);
      expect(cases.length).toBe(CASES.length);
    },
    1_800_000,
  );
});
