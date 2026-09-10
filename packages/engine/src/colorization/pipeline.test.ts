import { describe, expect, it } from 'vitest';
import { colorizationPipeline } from './pipeline';
import { resolveRuntime } from './runtimeResolver';
import { analyzeImageData, classifyTask } from './taskClassifier';

describe('colorizationPipeline non-AI workflows', () => {
  it('applies reference transfer without a model', async () => {
    const src = new ImageData(8, 8);
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = 100;
      src.data[i + 1] = 100;
      src.data[i + 2] = 100;
      src.data[i + 3] = 255;
    }
    const ref = new ImageData(8, 8);
    for (let i = 0; i < ref.data.length; i += 4) {
      ref.data[i] = 200;
      ref.data[i + 1] = 50;
      ref.data[i + 2] = 50;
      ref.data[i + 3] = 255;
    }

    const result = await colorizationPipeline.execute({
      params: {
        workflow: 'reference-transfer',
        qualityMode: 'automatic',
        sourceNodeId: 'n1',
        sourceRevision: 0,
        luminancePreservation: 1,
        chromaStrength: 1,
        skinProtection: false,
        neutralProtection: false,
      },
      imageData: src,
      referenceData: ref,
    });

    expect(result.imageData.width).toBe(8);
    expect(result.imageData.height).toBe(8);
    expect(result.modelUsed).toBeNull();
    expect(result.provider).toBe('classical');
  });

  it('applies selective recolor within mask', async () => {
    const src = new ImageData(4, 4);
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = 200;
      src.data[i + 1] = 100;
      src.data[i + 2] = 50;
      src.data[i + 3] = 255;
    }
    const mask = new Uint8Array(16);
    mask[0] = 255;

    const result = await colorizationPipeline.execute({
      params: {
        workflow: 'selective-recolor',
        qualityMode: 'automatic',
        sourceNodeId: 'n1',
        sourceRevision: 0,
        targetHue: 90,
        saturationScale: 1.5,
        luminancePreservation: 1,
        skinProtection: false,
        neutralProtection: false,
      },
      imageData: src,
      maskData: mask,
      maskWidth: 4,
      maskHeight: 4,
    });

    expect(result.imageData.width).toBe(4);
    expect(result.imageData.height).toBe(4);
    expect(result.modelUsed).toBeNull();
    expect(result.provider).toBe('classical');
    expect(result.imageData.data[3]).toBe(255);
  });

  it('applies palette colorize', async () => {
    const src = new ImageData(4, 4);
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = 128;
      src.data[i + 1] = 128;
      src.data[i + 2] = 128;
      src.data[i + 3] = 255;
    }

    const result = await colorizationPipeline.execute({
      params: {
        workflow: 'palette-colorize',
        qualityMode: 'automatic',
        sourceNodeId: 'n1',
        sourceRevision: 0,
        luminancePreservation: 1,
        skinProtection: false,
        neutralProtection: false,
        palette: ['#ff0000', '#00ff00', '#0000ff'],
        adherence: 0.8,
      },
      imageData: src,
    });

    expect(result.imageData.width).toBe(4);
    expect(result.imageData.height).toBe(4);
    expect(result.modelUsed).toBeNull();
  });

  it('applies harmonize to match reference', async () => {
    const src = new ImageData(4, 4);
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = 100;
      src.data[i + 1] = 100;
      src.data[i + 2] = 100;
      src.data[i + 3] = 255;
    }
    const ref = new ImageData(4, 4);
    for (let i = 0; i < ref.data.length; i += 4) {
      ref.data[i] = 50;
      ref.data[i + 1] = 200;
      ref.data[i + 2] = 100;
      ref.data[i + 3] = 255;
    }

    const result = await colorizationPipeline.execute({
      params: {
        workflow: 'harmonize',
        qualityMode: 'automatic',
        sourceNodeId: 'n1',
        sourceRevision: 0,
        chromaStrength: 0.5,
        luminancePreservation: 1,
        skinProtection: false,
        neutralProtection: true,
      },
      imageData: src,
      referenceData: ref,
    });

    expect(result.imageData.width).toBe(4);
    expect(result.imageData.height).toBe(4);
    expect(result.modelUsed).toBeNull();
    expect(result.provider).toBe('classical');
  });
});

describe('analyzeImageData + classifyTask', () => {
  it('classifies a low-saturation image as photo', () => {
    const data = new Uint8ClampedArray(64);
    for (let i = 0; i < 64; i += 4) {
      data[i] = 128;
      data[i + 1] = 130;
      data[i + 2] = 126;
      data[i + 3] = 255;
    }
    const imageData = new ImageData(data, 4, 4);
    const stats = analyzeImageData(imageData);
    expect(stats.fractionLowSaturation).toBeGreaterThan(0.9);
    const classification = classifyTask(stats);
    expect(classification.sourceKind).toBe('photo');
  });

  it('classifies a high-saturation image as already-colored', () => {
    const data = new Uint8ClampedArray(64);
    for (let i = 0; i < 64; i += 4) {
      data[i] = 255;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
    const imageData = new ImageData(data, 4, 4);
    const stats = analyzeImageData(imageData);
    const classification = classifyTask(stats);
    expect(classification.sourceKind).toBe('already-colored');
  });
});

describe('resolveRuntime', () => {
  it('picks 256px max dimension for fast mode', () => {
    const stats = {
      meanLuminance: 0.5,
      saturationStd: 0.1,
      fractionNearNeutral: 0.5,
      fractionLowSaturation: 0.5,
      edgeDensity: 0.1,
      width: 1024,
      height: 768,
    };
    const runtime = resolveRuntime('photo-colorize', 'fast', stats, ['ddcolor', 'ddcolor-tiny']);
    expect(runtime.maxDimension).toBe(256);
    expect(runtime.provider).toBe('wasm');
  });

  it('picks 1024px max dimension for quality mode', () => {
    const stats = {
      meanLuminance: 0.5,
      saturationStd: 0.1,
      fractionNearNeutral: 0.5,
      fractionLowSaturation: 0.5,
      edgeDensity: 0.1,
      width: 2048,
      height: 1536,
    };
    const runtime = resolveRuntime('photo-colorize', 'quality', stats, ['ddcolor', 'ddcolor-tiny']);
    expect(runtime.maxDimension).toBe(1024);
  });
});
