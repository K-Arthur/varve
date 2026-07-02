import { describe, it, expect } from 'vitest';
import {
  createBreakpointConfig,
  findActiveBreakpoint,
  getDeviceForViewport,
  sortBreakpoints,
} from './responsive';
import type { BreakpointConfig, DeviceConfig } from './types';

const phone: DeviceConfig = {
  type: 'phone', name: 'iPhone 15', width: 393, height: 852, dpr: 3,
};

const tablet: DeviceConfig = {
  type: 'tablet', name: 'iPad Air', width: 820, height: 1180, dpr: 2,
};

const desktop: DeviceConfig = {
  type: 'desktop', name: 'MacBook', width: 1440, height: 900, dpr: 2,
};

const breakpoints: BreakpointConfig[] = [
  { name: 'Mobile', minWidth: 0, maxWidth: 767, device: phone },
  { name: 'Tablet', minWidth: 768, maxWidth: 1023, device: tablet },
  { name: 'Desktop', minWidth: 1024, maxWidth: Infinity, device: desktop },
];

describe('Responsive system', () => {
  describe('createBreakpointConfig', () => {
    it('creates a breakpoint', () => {
      const bp = createBreakpointConfig('Tablet', 768, 1023);
      expect(bp.name).toBe('Tablet');
      expect(bp.minWidth).toBe(768);
      expect(bp.maxWidth).toBe(1023);
    });
  });

  describe('findActiveBreakpoint', () => {
    it('finds mobile breakpoint for narrow viewport', () => {
      const bp = findActiveBreakpoint(breakpoints, 375);
      expect(bp?.name).toBe('Mobile');
    });

    it('finds tablet breakpoint for medium viewport', () => {
      const bp = findActiveBreakpoint(breakpoints, 820);
      expect(bp?.name).toBe('Tablet');
    });

    it('finds desktop breakpoint for wide viewport', () => {
      const bp = findActiveBreakpoint(breakpoints, 1440);
      expect(bp?.name).toBe('Desktop');
    });

    it('returns null for empty breakpoints', () => {
      expect(findActiveBreakpoint([], 800)).toBeNull();
    });

    it('returns first matching when multiple overlap', () => {
      const overlapping: BreakpointConfig[] = [
        { name: 'A', minWidth: 0, maxWidth: 500 },
        { name: 'B', minWidth: 300, maxWidth: 800 },
      ];
      const bp = findActiveBreakpoint(overlapping, 400);
      expect(bp?.name).toBe('A');
    });
  });

  describe('getDeviceForViewport', () => {
    it('returns device for matching breakpoint', () => {
      const device = getDeviceForViewport(breakpoints, 375);
      expect(device?.name).toBe('iPhone 15');
    });

    it('returns null for no breakpoints', () => {
      expect(getDeviceForViewport([], 800)).toBeNull();
    });
  });

  describe('sortBreakpoints', () => {
    it('sorts breakpoints by minWidth ascending', () => {
      const unsorted: BreakpointConfig[] = [
        { name: 'Desktop', minWidth: 1024, maxWidth: Infinity },
        { name: 'Mobile', minWidth: 0, maxWidth: 767 },
        { name: 'Tablet', minWidth: 768, maxWidth: 1023 },
      ];
      const sorted = sortBreakpoints(unsorted);
      expect(sorted[0]!.name).toBe('Mobile');
      expect(sorted[1]!.name).toBe('Tablet');
      expect(sorted[2]!.name).toBe('Desktop');
    });
  });
});
