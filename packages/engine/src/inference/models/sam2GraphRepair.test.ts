import { describe, expect, it } from 'vitest';
import { needsSam2GraphRepair, repairSam2EncoderGraph } from './sam2GraphRepair';

/**
 * Build a minimal ONNX ModelProto with the same structure the real SAM2
 * encoder has: a graph whose value_info list contains the two empty-shape
 * entries (plus ordinary populated entries that must survive).
 */
function buildFakeEncoder(): Uint8Array {
  const tensorShape = (dims: number[]): number[] => {
    const body = dims.flatMap((d) => [0x0a, ...varint(d)]);
    return [0x12, ...varint(body.length), ...body];
  };
  const tensorType = (dims: number[]): number[] => {
    const shape = tensorShape(dims);
    return [0x0a, ...varint(shape.length), ...shape];
  };
  const valueInfo = (name: string, dims: number[] | null): number[] => {
    const nameBytes = [...new TextEncoder().encode(name)];
    const type = dims ? tensorType(dims) : [0x0a, 0x00];
    const body = [
      0x0a,
      ...varint(nameBytes.length),
      ...nameBytes,
      0x12,
      ...varint(type.length),
      ...type,
    ];
    return [0x6a, ...varint(body.length), ...body];
  };

  // graph: input 'image' (field 11), output (field 12), value_info (field 13)
  const inputName = [...new TextEncoder().encode('image')];
  const input = [0x5a, ...varint(inputName.length), ...inputName];
  const outputName = [...new TextEncoder().encode('image_embed')];
  const output = [0x62, ...varint(outputName.length), ...outputName];
  const vis = [
    valueInfo('layer1', [1, 32, 256, 256]),
    valueInfo('/conv_s0/Conv_output_0', null),
    valueInfo('layer2', [1, 64, 128, 128]),
    valueInfo('/conv_s1/Conv_output_0', null),
    valueInfo('image_embed', [1, 256, 64, 64]),
  ];
  const graphBody = [...input, ...output, ...vis.flat()];
  const graph = [0x3a, ...varint(graphBody.length), ...graphBody];

  // ir_version (field 1) + graph (field 7) + opset_import (field 8)
  const opset = [0x42, 0x02, 0x08, 0x11];
  const model = [0x08, 0x0d, ...graph, ...opset];
  return new Uint8Array(model.flat());

  function varint(value: number): number[] {
    const bytes: number[] = [];
    let v = value;
    while (v >= 0x80) {
      bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    bytes.push(v);
    return bytes;
  }
}

describe('sam2GraphRepair', () => {
  it('detects the empty value_info entries', () => {
    expect(needsSam2GraphRepair(buildFakeEncoder())).toBe(true);
  });

  it('repairs the graph and preserves everything else', () => {
    const repaired = repairSam2EncoderGraph(buildFakeEncoder());
    expect(needsSam2GraphRepair(repaired)).toBe(false);
    expect(repaired.length).toBeLessThan(buildFakeEncoder().length);
  });

  it('is idempotent', () => {
    const once = repairSam2EncoderGraph(buildFakeEncoder());
    const twice = repairSam2EncoderGraph(once);
    expect(Buffer.from(twice).equals(Buffer.from(once))).toBe(true);
  });

  it('is a no-op for a clean graph', () => {
    const clean = buildFakeEncoder();
    // Remove the two empty entries by repairing once — now clean.
    const cleanBytes = repairSam2EncoderGraph(clean);
    const again = repairSam2EncoderGraph(cleanBytes);
    expect(Buffer.from(again).equals(Buffer.from(cleanBytes))).toBe(true);
  });

  it('matches the standalone repair script output for the real artifact', async (ctx) => {
    // Network-dependent: requires the pinned upstream artifact from Hugging
    // Face. Enabled explicitly (the release gate runs it).
    ctx.skip(!process.env.VARVE_SAM2_ARTIFACT_TEST);
    // The standalone script's verified output hash (tiny encoder) — the
    // transform here must produce the same artifact from the same input.
    const upstream = new Uint8Array(
      await (
        await fetch(
          'https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main/sam2_hiera_tiny.encoder.onnx',
        )
      ).arrayBuffer(),
    );
    const repaired = repairSam2EncoderGraph(upstream);
    const hash = await crypto.subtle.digest('SHA-256', repaired.slice().buffer);
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('b4cfd6c8bec2ef3674536419d731e61d15840367bd004d65095ae6a2b88b41cf');
    expect(repaired.length).toBe(134261247);
  }, 180000);
});
