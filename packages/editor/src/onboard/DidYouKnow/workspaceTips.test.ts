import { describe, expect, it } from 'vitest';
import {
  ALL_WORKSPACE_MODES,
  getWorkspaceConfig,
  WORKSPACE_LABELS,
} from '../../workspace/workspaceTypes';
import { workspaceTipId, workspaceTips } from './workspaceTips';

describe('workspaceTips', () => {
  it.each(ALL_WORKSPACE_MODES)('surfaces every tip %s declares', (mode) => {
    // Regression: `onboarding.tips` had no runtime consumer, so all seven
    // workspaces shipped authored tips the user could never see.
    const declared = getWorkspaceConfig(mode).onboarding.tips ?? [];
    const tips = workspaceTips(mode);
    expect(tips).toHaveLength(declared.length);
    expect(tips.map((tip) => tip.body)).toEqual(declared.map((tip) => tip.trim()));
  });

  it('labels a tip with its workspace', () => {
    const [tip] = workspaceTips('design');
    expect(tip?.title).toBe(`${WORKSPACE_LABELS.design} workspace`);
  });

  it('gives every tip a unique, workspace-scoped id', () => {
    const ids = ALL_WORKSPACE_MODES.flatMap((mode) => workspaceTips(mode).map((tip) => tip.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('workspace:'))).toBe(true);
  });

  it('keeps a tip id stable across reordering but not rewording', () => {
    // Dismissals are keyed by id, so reordering a workspace's tips must not
    // silently reassign which tip the user dismissed.
    const first = workspaceTipId('design', 'Use Frame (F) to create artboards.');
    expect(workspaceTipId('design', 'Use Frame (F) to create artboards.')).toBe(first);
    expect(workspaceTipId('design', 'Use Frame (F) to create artboards!')).not.toBe(first);
    expect(workspaceTipId('print', 'Use Frame (F) to create artboards.')).not.toBe(first);
  });

  it('produces ids that survive a JSON round-trip through the dismissed set', () => {
    const id = workspaceTips('logo')[0]?.id ?? '';
    expect(JSON.parse(JSON.stringify([id]))[0]).toBe(id);
  });
});
