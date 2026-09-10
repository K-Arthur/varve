import { describe, expect, it } from 'vitest';
import { RingBreadcrumbBuffer } from './breadcrumbs';
import { LIMITS } from './schema';

describe('RingBreadcrumbBuffer', () => {
  it('records known typed events only', () => {
    const buffer = new RingBreadcrumbBuffer();
    buffer.record('document.open.started', 'document');
    buffer.record('webgpu.device.lost', 'renderer');
    buffer.record('layer renamed to logo-final', 'layer');
    buffer.record('opened https://cloud.example.com/documents/abc', 'file');
    buffer.record('user typed hello', 'input');
    const crumbs = buffer.drain();
    expect(crumbs.map((c) => c.event)).toEqual(['document.open.started', 'webgpu.device.lost']);
  });

  it('caps the ring size', () => {
    const buffer = new RingBreadcrumbBuffer(3);
    for (let i = 0; i < 10; i++) buffer.record(`command.failed.${i}`, 'command');
    expect(buffer.size()).toBe(3);
    const crumbs = buffer.drain();
    expect(crumbs.map((c) => c.event)).toEqual([
      'command.failed.7',
      'command.failed.8',
      'command.failed.9',
    ]);
  });

  it('rejects overlong events', () => {
    const buffer = new RingBreadcrumbBuffer();
    buffer.record(`command.failed.${'x'.repeat(LIMITS.maxCrumbLength + 10)}`, 'command');
    expect(buffer.size()).toBe(0);
  });

  it('drain empties the buffer', () => {
    const buffer = new RingBreadcrumbBuffer();
    buffer.record('worker.started');
    buffer.drain();
    expect(buffer.size()).toBe(0);
  });
});
