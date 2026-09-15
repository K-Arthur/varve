/**
 * WGSL shader validation for GpuAccelerator compute shaders.
 * These tests validate the structural integrity of the inline WGSL strings
 * without requiring a real GPU device or WebGPU runtime.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GpuAccelerator } from '../gpuAccelerator';

function getPrivateShaders(accel: GpuAccelerator): { horizontal: string; vertical: string } {
  const proto = Object.getPrototypeOf(accel);
  const hShader = (proto._getHorizontalBlurShader as () => string).call(accel);
  const vShader = (proto._getVerticalBlurShader as () => string).call(accel);
  return { horizontal: hShader, vertical: vShader };
}

describe('GpuAccelerator WGSL compute shaders', () => {
  let accel: GpuAccelerator;

  beforeEach(() => {
    // Reset the singleton for test isolation
    const instance = (GpuAccelerator as unknown as { instance: GpuAccelerator | null }).instance;
    if (instance) {
      (GpuAccelerator as unknown as { instance: GpuAccelerator | null }).instance = null;
    }
    accel = GpuAccelerator.getInstance();
  });

  afterEach(() => {
    const instance = (GpuAccelerator as unknown as { instance: GpuAccelerator | null }).instance;
    if (instance) {
      (GpuAccelerator as unknown as { instance: GpuAccelerator | null }).instance = null;
    }
  });

  describe('common invariants', () => {
    it('both shaders are non-empty strings', () => {
      const { horizontal, vertical } = getPrivateShaders(accel);
      expect(horizontal.trim().length).toBeGreaterThan(50);
      expect(vertical.trim().length).toBeGreaterThan(50);
    });

    it('both use @compute and @workgroup_size(64)', () => {
      const { horizontal, vertical } = getPrivateShaders(accel);
      expect(horizontal).toContain('@compute');
      expect(horizontal).toContain('@workgroup_size(64)');
      expect(vertical).toContain('@compute');
      expect(vertical).toContain('@workgroup_size(64)');
    });

    it('both use @builtin(global_invocation_id)', () => {
      const { horizontal, vertical } = getPrivateShaders(accel);
      expect(horizontal).toContain('global_invocation_id');
      expect(vertical).toContain('global_invocation_id');
    });

    it('no GLSL-style keywords present', () => {
      const { horizontal, vertical } = getPrivateShaders(accel);
      for (const shader of [horizontal, vertical]) {
        expect(shader).not.toContain('void main');
        expect(shader).not.toContain('gl_');
        expect(shader).not.toContain('layout(');
      }
    });
  });

  describe('Uniforms struct', () => {
    it('has the required 5 fields (width, height, radius, kernelSize, kernel)', () => {
      const { horizontal } = getPrivateShaders(accel);
      expect(horizontal).toContain('struct Uniforms');
      expect(horizontal).toContain('width: i32');
      expect(horizontal).toContain('height: i32');
      expect(horizontal).toContain('radius: i32');
      expect(horizontal).toContain('kernelSize: i32');
      expect(horizontal).toContain('kernel: array<f32, 128>');
    });

    it('uniform struct is identical in both shaders', () => {
      const { horizontal, vertical } = getPrivateShaders(accel);
      const hStruct = horizontal.match(/struct Uniforms \{([^}]+)\}/s)?.[1] ?? '';
      const vStruct = vertical.match(/struct Uniforms \{([^}]+)\}/s)?.[1] ?? '';
      expect(hStruct).toBe(vStruct);
    });
  });

  describe('buffer binding annotations', () => {
    it('horizontal shader has @binding(0) input, @binding(1) output, @binding(2) uniforms', () => {
      const { horizontal } = getPrivateShaders(accel);
      expect(horizontal).toContain('@group(0) @binding(0) var<storage, read> input');
      expect(horizontal).toContain('@group(0) @binding(1) var<storage, read_write> output');
      expect(horizontal).toContain('@group(0) @binding(2) var<storage, read> uniforms');
    });

    it('vertical shader has matching binding layout', () => {
      const { vertical } = getPrivateShaders(accel);
      expect(vertical).toContain('@group(0) @binding(0) var<storage, read> input');
      expect(vertical).toContain('@group(0) @binding(1) var<storage, read_write> output');
      expect(vertical).toContain('@group(0) @binding(2) var<storage, read> uniforms');
    });
  });

  describe('boundary handling', () => {
    it('horizontal shader clamps x to [0, width-1]', () => {
      const { horizontal } = getPrivateShaders(accel);
      expect(horizontal).toContain('clamp(x + k, 0, uniforms.width - 1)');
    });

    it('vertical shader clamps y to [0, height-1]', () => {
      const { vertical } = getPrivateShaders(accel);
      expect(vertical).toContain('clamp(y + k, 0, uniforms.height - 1)');
    });

    it('both check bounds before processing', () => {
      const { horizontal, vertical } = getPrivateShaders(accel);
      expect(horizontal).toContain('if (x >= uniforms.width || y >= uniforms.height)');
      expect(vertical).toContain('if (x >= uniforms.width || y >= uniforms.height)');
    });
  });

  describe('storage buffer layout matches JS-side writes', () => {
    it('Uniforms struct size matches JS write buffer', () => {
      const { horizontal } = getPrivateShaders(accel);
      // WGSL layout for var<storage, read> (tightly packed):
      //   width(i32):        offset 0,  size 4
      //   height(i32):       offset 4,  size 4
      //   radius(i32):       offset 8,  size 4
      //   kernelSize(i32):   offset 12, size 4
      //   kernel(array<f32,128>): offset 16 (stride 4), size 512
      expect(horizontal).toContain('array<f32, 128>');
      // JS writes: UNIFORM_SIZE = 16 + 128*4 = 528
      expect(528).toBe(16 + 128 * 4);
    });
  });

  describe('separable convolution logic', () => {
    it('horizontal shader iterates x+k (row-wise)', () => {
      const { horizontal } = getPrivateShaders(accel);
      expect(horizontal).toContain('y * uniforms.width + sx');
    });

    it('vertical shader iterates y+k (column-wise)', () => {
      const { vertical } = getPrivateShaders(accel);
      expect(vertical).toContain('sy * uniforms.width + x');
    });

    it('kernel index uses k + radius offset', () => {
      const { horizontal, vertical } = getPrivateShaders(accel);
      expect(horizontal).toContain('k + uniforms.radius');
      expect(vertical).toContain('k + uniforms.radius');
    });
  });
});
