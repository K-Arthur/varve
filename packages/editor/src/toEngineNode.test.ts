// @vitest-environment jsdom
//
// Regression: text nodes MUST reach the engine with a valid `shape`.
//
// The native + wasm engines deserialize each node into Rust's strict
// `strata-bridge::IpcSceneNode`, where `shape` is a required field and text is
// `IpcShape::Text { text, fontSize, fontFamily, fontWeight, fontStyle,
// textAlign, x, y, w, h, … }`. `toEngineNode` previously emitted text with only
// a top-level `kind: 'text'` and no `shape`, so `build_ir_json` threw
// `missing field \`shape\``. That rejected the WHOLE buildIr batch and left the
// canvas blank for every node — text, shapes, images alike — whenever a single
// text node was present. These tests lock the wire contract in place.

import type { NodeId } from '@strata/scene';
import { makeTextNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { toEngineNode } from './CanvasArea';

const REQUIRED_TEXT_SHAPE_FIELDS = [
  'text',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'textAlign',
  'x',
  'y',
  'w',
  'h',
] as const;

describe('toEngineNode text contract', () => {
  it('emits a shape:{kind:"text"} with every field the Rust deserializer requires', () => {
    const node = makeTextNode('t1' as NodeId, 'Hello', { fontSize: 24 });
    const engineNode = toEngineNode(node);

    const shape = engineNode.shape as unknown as Record<string, unknown> | undefined;
    expect(shape, 'text nodes must carry a shape').toBeDefined();
    expect(shape?.kind).toBe('text');
    for (const field of REQUIRED_TEXT_SHAPE_FIELDS) {
      expect(shape?.[field], `shape.${field} must be present`).not.toBeUndefined();
    }
    // Rust wants numbers/strings, never undefined, for the required fields.
    expect(typeof shape?.fontSize).toBe('number');
    expect(typeof shape?.fontFamily).toBe('string');
    expect(typeof shape?.fontWeight).toBe('number');
    expect(typeof shape?.w).toBe('number');
    expect(typeof shape?.h).toBe('number');
  });

  it('produces JSON with a shape field for a bare text node (no explicit font props)', () => {
    // A text node created with only defaults must still serialize a full shape —
    // this is the exact node shape that used to crash the engine.
    const node = makeTextNode('t2' as NodeId, '');
    const json = JSON.stringify(toEngineNode(node));
    const parsed = JSON.parse(json) as { shape?: { kind?: string } };
    expect(parsed.shape).toBeDefined();
    expect(parsed.shape?.kind).toBe('text');
    // No missing required field can be absent from the serialized wire form.
    const shape = parsed.shape as unknown as Record<string, unknown>;
    for (const field of REQUIRED_TEXT_SHAPE_FIELDS) {
      expect(shape[field], `serialized shape.${field}`).not.toBeUndefined();
    }
  });
});
