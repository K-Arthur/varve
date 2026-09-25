import { describe, expect, it } from 'vitest';
import { parseGuestOutput, type SelectedNodeSnapshot } from './contract';
import type { PluginCommandManifest } from './package';

const selected: SelectedNodeSnapshot[] = [
  {
    id: 'one',
    name: 'Card',
    kind: 'shape',
    locked: false,
    style: { opacity: 1, blendMode: 'normal', paintCount: 1, strokeCount: 0 },
  },
  {
    id: 'two',
    name: 'Locked',
    kind: 'text',
    locked: true,
    style: { opacity: 1, blendMode: 'normal', paintCount: 1, strokeCount: 0 },
  },
];
const analysis: PluginCommandManifest = { id: 'audit', title: 'Audit', kind: 'analysis' };
const rename: PluginCommandManifest = { id: 'rename', title: 'Rename', kind: 'rename' };

describe('guest result authorization', () => {
  it('accepts bounded read-only analysis text', () => {
    expect(
      parseGuestOutput(
        JSON.stringify({ summary: 'One result', lines: ['Opacity: 100%'] }),
        analysis,
        selected,
      ),
    ).toEqual({ summary: 'One result', lines: ['Opacity: 100%'], renames: [] });
  });

  it('never accepts an edit from a read-only command', () => {
    expect(() =>
      parseGuestOutput(
        JSON.stringify({
          summary: 'Unauthorized',
          lines: [],
          renames: [{ id: 'one', expectedName: 'Card', name: 'Changed' }],
        }),
        analysis,
        selected,
      ),
    ).toThrow('Read-only command');
  });

  it.each([
    [{ id: 'missing', expectedName: 'Card', name: 'Changed' }, 'inaccessible'],
    [{ id: 'two', expectedName: 'Locked', name: 'Changed' }, 'inaccessible'],
    [{ id: 'one', expectedName: 'Old', name: 'Changed' }, 'stale'],
  ])('rejects inaccessible and stale target proposals', (proposal) => {
    expect(() =>
      parseGuestOutput(
        JSON.stringify({ summary: 'Preview', lines: [], renames: [proposal] }),
        rename,
        selected,
      ),
    ).toThrow(/inaccessible or stale/);
  });

  it('rejects duplicate targets and unbounded or spoofed UI data', () => {
    const proposal = { id: 'one', expectedName: 'Card', name: 'Changed' };
    expect(() =>
      parseGuestOutput(
        JSON.stringify({ summary: 'Preview', lines: [], renames: [proposal, proposal] }),
        rename,
        selected,
      ),
    ).toThrow('invalid');
    expect(() =>
      parseGuestOutput(JSON.stringify({ summary: 'x'.repeat(301), lines: [] }), analysis, selected),
    ).toThrow('summary');
    expect(() =>
      parseGuestOutput(
        JSON.stringify({ summary: 'Fine', lines: [], html: '<b>Host</b>' }),
        analysis,
        selected,
      ),
    ).toThrow('unsupported');
  });
});
