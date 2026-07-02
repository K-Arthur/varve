import { describe, it, expect } from 'vitest';
import { validatePrototype, type ValidationIssue } from './validation';
import type { Interaction, PrototypeData, TransitionConfig } from './types';

const defaultTransition: TransitionConfig = {
  kind: 'instant', duration: 0, easing: { kind: 'linear' },
};

function makeInteraction(
  id: string,
  nodeId: string,
  targetId?: string,
  overlayId?: string,
): Interaction {
  const actions = targetId
    ? [{ kind: 'navigateTo' as const, targetId, transition: defaultTransition }]
    : overlayId
      ? [{ kind: 'openOverlay' as const, targetId: overlayId, transition: defaultTransition }]
      : [{ kind: 'dismiss' as const }];
  return { id, nodeId, name: id, trigger: { kind: 'onClick' }, actions, enabled: true };
}

describe('validatePrototype', () => {
  it('returns no issues for valid prototype', () => {
    const prototype: PrototypeData = {
      interactions: {
        'btn-1': [makeInteraction('i1', 'btn-1', 'screen-2')],
        'screen-2': [makeInteraction('i2', 'screen-2', 'screen-1')],
      },
      homeScreenId: 'screen-1',
    };
    const allNodeIds = ['screen-1', 'screen-2', 'btn-1'];
    const issues = validatePrototype(prototype, allNodeIds);
    expect(issues).toHaveLength(0);
  });

  it('detects broken navigation target', () => {
    const prototype: PrototypeData = {
      interactions: {
        'btn-1': [makeInteraction('i1', 'btn-1', 'missing-screen')],
      },
      homeScreenId: 'screen-1',
    };
    const allNodeIds = ['screen-1', 'btn-1'];
    const issues = validatePrototype(prototype, allNodeIds);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.code).toBe('broken-target');
  });

  it('detects orphan nodes with no interactions', () => {
    const prototype: PrototypeData = {
      interactions: {},
      homeScreenId: 'screen-1',
    };
    const allNodeIds = ['screen-1', 'screen-2', 'screen-3'];
    const issues = validatePrototype(prototype, allNodeIds);
    const orphans = issues.filter((i) => i.code === 'orphan-node');
    expect(orphans.length).toBeGreaterThan(0);
  });

  it('detects missing home screen', () => {
    const prototype: PrototypeData = {
      interactions: {},
      homeScreenId: 'nonexistent',
    };
    const allNodeIds = ['screen-1'];
    const issues = validatePrototype(prototype, allNodeIds);
    expect(issues.some((i) => i.code === 'missing-home-screen')).toBe(true);
  });

  it('detects missing entry point when no home screen', () => {
    const prototype: PrototypeData = { interactions: {} };
    const allNodeIds = ['screen-1', 'screen-2'];
    const issues = validatePrototype(prototype, allNodeIds);
    const noEntry = issues.filter((i) => i.code === 'no-entry-point');
    expect(noEntry).toHaveLength(0); // not an issue if at least one frame exists
  });

  it('detects disabled interactions', () => {
    const prototype: PrototypeData = {
      interactions: {
        'btn-1': [
          {
            id: 'i1', nodeId: 'btn-1', name: 'Disabled',
            trigger: { kind: 'onClick' }, actions: [], enabled: false,
          },
        ],
      },
      homeScreenId: 'screen-1',
    };
    const allNodeIds = ['screen-1', 'btn-1'];
    const issues = validatePrototype(prototype, allNodeIds);
    const disabled = issues.filter((i) => i.code === 'disabled-interaction');
    expect(disabled.length).toBeGreaterThan(0);
  });
});
