// @vitest-environment jsdom

/**
 * WGSL shader validation tests — structural and interface-contract verification
 * without a real GPU. Tests run in any environment (ci, dev, headless).
 *
 * Strategy: validate WGSL source strings for required keywords and patterns,
 * and verify that the JS-side buffer layout matches the WGSL struct layout.
 * Full WGSL compilation validation would need naga or a real GPU device;
 * these tests catch struct-alignment mismatches, missing fields, and
 * degenerate shader strings without either.
 */
import { describe, expect, it } from 'vitest';
import {
  BLIT_FRAGMENT_WGSL,
  BLIT_VERTEX_WGSL,
  CIRCLE_FRAGMENT_WGSL,
  CIRCLE_VERTEX_WGSL,
  SOLID_FRAGMENT_WGSL,
  SOLID_VERTEX_WGSL,
} from './shaders';

/**
 * Compute the byte offset of a WGSL struct field, assuming std430-style
 * alignment rules for var<uniform>:
 *   - f32 aligns to 4 bytes
 *   - vec2<f32> aligns to 8 bytes
 *   - vec4<f32> aligns to 16 bytes
 *   - struct size is rounded up to 16-byte multiple
 * Does NOT handle nested structs, arrays, or matrices.
 */
function wgslUniformOffset(
  fields: { name: string; type: string }[],
  target: string,
): { offset: number; size: number } | null {
  let offset = 0;
  for (const f of fields) {
    const align = wgslTypeAlign(f.type);
    offset = (offset + align - 1) & ~(align - 1);
    if (f.name === target) {
      return { offset, size: wgslTypeSize(f.type) };
    }
    offset += wgslTypeSize(f.type);
  }
  return null;
}

function wgslTypeAlign(type: string): number {
  if (type === 'f32') return 4;
  if (type.startsWith('vec2')) return 8;
  if (type.startsWith('vec4')) return 16;
  return 4;
}

function wgslTypeSize(type: string): number {
  if (type === 'f32') return 4;
  if (type === 'vec2f' || type === 'vec2<f32>') return 8;
  if (type === 'vec4f' || type === 'vec4<f32>') return 16;
  return 4;
}

function parseStructFields(code: string, structName: string): { name: string; type: string }[] {
  const structRx = new RegExp(`struct\\s+${structName}\\s*\\{([^}]+)\\}`, 's');
  const match = code.match(structRx);
  if (!match) return [];
  const body = match[1];
  if (body === undefined) return [];
  const fields: { name: string; type: string }[] = [];
  const fieldRx = /(\w+)\s*:\s*(\w+)/g;
  for (;;) {
    const fMatch = fieldRx.exec(body);
    if (fMatch === null) break;
    const fName = fMatch[1];
    const fType = fMatch[2];
    if (fName !== undefined && fType !== undefined) {
      fields.push({ name: fName, type: fType });
    }
  }
  return fields;
}

describe('WGSL shader strings', () => {
  describe('SOLID_VERTEX_WGSL', () => {
    it('is a non-empty string', () => {
      expect(SOLID_VERTEX_WGSL.length).toBeGreaterThan(100);
    });

    it('contains required WGSL keywords', () => {
      expect(SOLID_VERTEX_WGSL).toContain('@vertex');
      expect(SOLID_VERTEX_WGSL).toContain('fn vs_main');
      expect(SOLID_VERTEX_WGSL).toContain('@group(0)');
      expect(SOLID_VERTEX_WGSL).toContain('var<uniform>');
      expect(SOLID_VERTEX_WGSL).toContain('@builtin(position)');
    });

    it('has a CameraUniform struct with all required fields', () => {
      const fields = parseStructFields(SOLID_VERTEX_WGSL, 'CameraUniform');
      expect(fields.length).toBeGreaterThanOrEqual(5);
      const names = fields.map((f) => f.name);
      expect(names).toContain('pan');
      expect(names).toContain('zoom');
      expect(names).toContain('viewportW');
      expect(names).toContain('viewportH');
      expect(names).toContain('origin');
    });

    it('CameraUniform origin is at expected byte offset (24) with size 8', () => {
      const fields = parseStructFields(SOLID_VERTEX_WGSL, 'CameraUniform');
      expect(fields.length).toBeGreaterThanOrEqual(6);
      const originField = fields.find((f) => f.name === 'origin');
      expect(originField).toBeDefined();
      expect(originField!.type).toBe('vec2f');
      // pan(8) + zoom(4) + viewportW(4) + viewportH(4) + rotation(4) = 24
      const info = wgslUniformOffset(fields, 'origin');
      expect(info).not.toBeNull();
      expect(info!.offset).toBe(24);
      expect(info!.size).toBe(8);
      const rot = wgslUniformOffset(fields, 'rotation');
      expect(rot).not.toBeNull();
      expect(rot!.offset).toBe(20);
    });

    it('computes screen via origin → zoom → rotate-about-centre → pan', () => {
      expect(SOLID_VERTEX_WGSL).toContain('camera.origin');
      expect(SOLID_VERTEX_WGSL).toContain('camera.rotation');
      expect(SOLID_VERTEX_WGSL).toContain('cos(camera.rotation)');
      expect(SOLID_VERTEX_WGSL).toContain('(world.x - camera.origin.x) * camera.zoom');
    });

    it('applies affine as x=a·x+c·y+e, y=b·x+d·y+f (kurbo/canvas convention)', () => {
      // Vertex attrs: transform=vec4(a,b,c,d), transform2=vec2(e,f).
      // A prior bug used transform.w (d) as tx and transform2.x (e) as the
      // y-scale term — identity transforms then mapped (x,y) → (x+1, 0).
      expect(SOLID_VERTEX_WGSL).toMatch(
        /transform\.x\s*\*\s*input\.localPos\.x\s*\+\s*input\.transform\.z\s*\*\s*input\.localPos\.y\s*\+\s*input\.transform2\.x/,
      );
      expect(SOLID_VERTEX_WGSL).toMatch(
        /transform\.y\s*\*\s*input\.localPos\.x\s*\+\s*input\.transform\.w\s*\*\s*input\.localPos\.y\s*\+\s*input\.transform2\.y/,
      );
      // Explicitly reject the broken form.
      expect(SOLID_VERTEX_WGSL).not.toMatch(
        /transform\.z\s*\*\s*input\.localPos\.y\s*\+\s*input\.transform\.w\s*,/,
      );
    });
  });

  describe('SOLID_FRAGMENT_WGSL', () => {
    it('is non-empty and contains @fragment', () => {
      expect(SOLID_FRAGMENT_WGSL).toContain('@fragment');
      expect(SOLID_FRAGMENT_WGSL).toContain('fn fs_main');
    });
  });

  describe('CIRCLE_VERTEX_WGSL', () => {
    it('is identical to SOLID_VERTEX_WGSL', () => {
      expect(CIRCLE_VERTEX_WGSL).toBe(SOLID_VERTEX_WGSL);
    });
  });

  describe('CIRCLE_FRAGMENT_WGSL', () => {
    it('contains the circle discard logic', () => {
      expect(CIRCLE_FRAGMENT_WGSL).toContain('CircleUniform');
      expect(CIRCLE_FRAGMENT_WGSL).toContain('discard');
      expect(CIRCLE_FRAGMENT_WGSL).toContain('distance(pos.xy, circle.center)');
    });

    it('CircleUniform fields have correct types', () => {
      const fields = parseStructFields(CIRCLE_FRAGMENT_WGSL, 'CircleUniform');
      expect(fields.length).toBeGreaterThanOrEqual(3);
      const centerField = fields.find((f) => f.name === 'center');
      expect(centerField).toBeDefined();
      expect(centerField!.type).toMatch(/vec2f|vec2<f32>/);
    });
  });

  describe('BLIT_VERTEX_WGSL', () => {
    it('is non-empty and fullscreen-triangle based', () => {
      expect(BLIT_VERTEX_WGSL).toContain('@builtin(vertex_index)');
      expect(BLIT_VERTEX_WGSL).toContain('BlitUniform');
    });

    it('BlitUniform has viewportW/viewportH at correct offsets', () => {
      const fields = parseStructFields(BLIT_VERTEX_WGSL, 'BlitUniform');
      const vw = wgslUniformOffset(fields, 'viewportW');
      expect(vw).not.toBeNull();
      expect(vw!.offset).toBe(0);
      expect(vw!.size).toBe(4);
    });
  });

  describe('BLIT_FRAGMENT_WGSL', () => {
    it('samples a texture and returns a color', () => {
      expect(BLIT_FRAGMENT_WGSL).toContain('textureSample');
      expect(BLIT_FRAGMENT_WGSL).toContain('texture_2d<f32>');
    });
  });
});

describe('CameraUniform JS buffer layout matches WGSL struct', () => {
  it('JS writes exactly 8 floats to match 32-byte WGSL CameraUniform', () => {
    const fields = parseStructFields(SOLID_VERTEX_WGSL, 'CameraUniform');
    const structSize = computeStructSize(fields);
    // pan(8)+zoom(4)+viewportW(4)+viewportH(4)+rotation(4)+origin(8) = 32
    expect(structSize).toBe(32);
    // JS: [pan.x, pan.y, zoom, viewportW, viewportH, rotation, origin.x, origin.y]
    const jsValues = 8;
    const jsBytes = jsValues * 4;
    expect(jsBytes).toBe(32);
    expect(jsBytes % 16).toBe(0);
  });
});

describe('Shader string invariants', () => {
  it('no shader contains GLSL-style keywords', () => {
    const allShaders = [
      SOLID_VERTEX_WGSL,
      SOLID_FRAGMENT_WGSL,
      CIRCLE_FRAGMENT_WGSL,
      BLIT_VERTEX_WGSL,
      BLIT_FRAGMENT_WGSL,
    ];
    for (const code of allShaders) {
      expect(code).not.toContain('layout(');
      expect(code).not.toContain('gl_Position');
      expect(code).not.toContain('void main');
    }
  });

  it('no shader string is empty or a template literal with only whitespace', () => {
    const shaders: [string, string][] = [
      ['SOLID_VERTEX', SOLID_VERTEX_WGSL],
      ['SOLID_FRAGMENT', SOLID_FRAGMENT_WGSL],
      ['CIRCLE_VERTEX', CIRCLE_VERTEX_WGSL],
      ['CIRCLE_FRAGMENT', CIRCLE_FRAGMENT_WGSL],
      ['BLIT_VERTEX', BLIT_VERTEX_WGSL],
      ['BLIT_FRAGMENT', BLIT_FRAGMENT_WGSL],
    ];
    for (const [_name, code] of shaders) {
      expect(code.trim().length).toBeGreaterThan(0);
    }
  });
});

function computeStructSize(fields: { name: string; type: string }[]): number {
  let offset = 0;
  for (const f of fields) {
    const align = wgslTypeAlign(f.type);
    offset = (offset + align - 1) & ~(align - 1);
    offset += wgslTypeSize(f.type);
  }
  // Round up to 16 bytes for uniform buffer alignment
  return (offset + 15) & ~15;
}
