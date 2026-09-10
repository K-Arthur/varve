import { describe, expect, it, vi } from 'vitest';
import { TerminationCoordinator } from '../coordinator';
import type { TerminationIntent } from '../types';
import { createDialogHarness, createFakeApi, createMemoryMarker } from './testHarness';

function makeCoordinator(options: {
  sessions?: Parameters<typeof createFakeApi>[0];
  onCommit?: (intent: TerminationIntent) => undefined | boolean | Promise<undefined | boolean>;
  onDiscardCommitted?: (docs: unknown[]) => void | Promise<void>;
  finalizers?: { runFor(): Promise<void> };
}) {
  const controls = createFakeApi(options.sessions);
  const harness = createDialogHarness();
  const marker = createMemoryMarker('false');
  const commit = vi.fn(async (intent: TerminationIntent) => {
    const result = await options.onCommit?.(intent);
    return typeof result === 'boolean' ? result : undefined;
  });
  const discard = vi.fn(async (docs: unknown[]) => {
    await options.onDiscardCommitted?.(docs);
  });
  const coordinator = new TerminationCoordinator({
    api: controls.api,
    dialogs: harness,
    marker: marker.marker,
    onCommit: commit,
    onDiscardCommitted: discard,
    finalizers: options.finalizers,
    trace: () => undefined,
  });
  return { controls, harness, marker, coordinator, commit, discard };
}

describe('TerminationCoordinator', () => {
  it('commits a clean close-document immediately, without a dialog', async () => {
    const { controls, harness, coordinator, marker } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Clean.varve', dirty: false, fileId: 'f1' }],
    });
    const result = await coordinator.requestTermination('close-document');
    expect(result).toEqual({ outcome: 'committed' });
    expect(harness.requests).toHaveLength(0);
    expect(controls.closed).toEqual(['a']);
    expect(marker.value()).toBe('true');
    expect(marker.cleanCalls()).toBe(1);
  });

  it('prompts for a dirty document and commits after Save', async () => {
    const { controls, harness, coordinator, marker } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Poster.varve', dirty: true, filePath: '/p/Poster.varve' }],
    });
    const tx = coordinator.requestTermination('close-document');
    const prompt = harness.last();
    expect(prompt?.kind).toBe('unsaved');
    expect(prompt?.docs.map((d) => d.sessionId)).toEqual(['a']);
    expect(prompt?.docs[0]?.untitled).toBe(false);
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'save' }],
    });
    const result = await tx;
    expect(result).toEqual({ outcome: 'committed' });
    expect(controls.saveCalls).toEqual(['a']);
    expect(controls.closed).toEqual(['a']);
    expect(marker.value()).toBe('true');
  });

  it("closes after explicit Don't Save (discard) and commits", async () => {
    const { controls, harness, coordinator, discard } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Untitled', dirty: true }],
    });
    const tx = coordinator.requestTermination('close-document');
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'discard' }],
    });
    const result = await tx;
    expect(result).toEqual({ outcome: 'committed' });
    expect(controls.saveCalls).toHaveLength(0);
    expect(controls.closed).toEqual(['a']);
    expect(discard).toHaveBeenCalledWith([
      expect.objectContaining({ sessionId: 'a', untitled: true }),
    ]);
  });

  it('cancels the transaction when the user cancels the dialog', async () => {
    const { controls, harness, coordinator, marker } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Poster.varve', dirty: true }],
    });
    const tx = coordinator.requestTermination('close-document');
    harness.cancel();
    const result = await tx;
    expect(result).toEqual({ outcome: 'cancelled' });
    expect(controls.saveCalls).toHaveLength(0);
    expect(controls.closed).toHaveLength(0);
    expect(marker.cleanCalls()).toBe(0);
    expect(marker.value()).toBe('false');
  });

  it('joins duplicate requests into one transaction and one dialog', async () => {
    const { harness, coordinator, controls } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Poster.varve', dirty: true }],
    });
    const first = coordinator.requestTermination('close-window');
    const second = coordinator.requestTermination('close-window');
    expect(harness.requests).toHaveLength(1);
    expect(second).toBe(first);
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'save' }],
    });
    await expect(first).resolves.toEqual({ outcome: 'committed' });
    await expect(second).resolves.toEqual({ outcome: 'committed' });
    expect(controls.saveCalls).toHaveLength(1);
  });

  it('upgrades scope mid-dialog: close-document then quit re-prompts with all sessions', async () => {
    const { harness, coordinator, controls } = makeCoordinator({
      sessions: [
        { id: 'a', name: 'Active.varve', dirty: true },
        { id: 'b', name: 'Hidden.varve', dirty: true, fileId: 'f2' },
      ],
    });
    controls.setActive('a');
    const tx = coordinator.requestTermination('close-document');
    expect(harness.last()?.docs.map((d) => d.sessionId)).toEqual(['a']);

    const joined = coordinator.requestTermination('quit-application');
    expect(joined).toBe(tx);
    await harness.flush();
    // The pending prompt was superseded; a new one lists ALL dirty sessions.
    expect(harness.requests).toHaveLength(2);
    expect(
      harness
        .last()
        ?.docs.map((d) => d.sessionId)
        .sort(),
    ).toEqual(['a', 'b']);
    harness.respond({
      kind: 'proceed',
      choices: [
        { sessionId: 'a', choice: 'save' },
        { sessionId: 'b', choice: 'save' },
      ],
    });
    const result = await tx;
    expect(result).toEqual({ outcome: 'committed' });
    expect(controls.saveCalls).toEqual(['a', 'b']);
  });

  it('aborts the whole transaction when a Save As picker is cancelled', async () => {
    const { controls, harness, coordinator, marker } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Untitled', dirty: true }],
    });
    controls.setSaveResult({ ok: false, cancelled: true });
    const tx = coordinator.requestTermination('close-window');
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'save' }],
    });
    const result = await tx;
    expect(result).toEqual({ outcome: 'cancelled' });
    expect(controls.closed).toHaveLength(0);
    expect(marker.cleanCalls()).toBe(0);
  });

  it('surfaces a save failure and commits after an explicit retry succeeds', async () => {
    const { controls, harness, coordinator, marker } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Poster.varve', dirty: true, filePath: '/p/x.varve' }],
    });
    controls.setSaveResult({ ok: false, cancelled: false });
    controls.setLastSaveFailure('permission');
    const tx = coordinator.requestTermination('close-window');
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'save' }],
    });
    await harness.flush();
    const failurePrompt = harness.last();
    expect(failurePrompt?.kind).toBe('save-failed');
    expect(failurePrompt?.docs[0]?.failureCategory).toBe('permission');
    controls.setSaveResult({ ok: true });
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'retry' }],
    });
    const result = await tx;
    expect(result).toEqual({ outcome: 'committed' });
    expect(controls.saveCalls).toHaveLength(2);
    expect(marker.cleanCalls()).toBe(1);
  });

  it('commits with discard after a save failure', async () => {
    const { controls, harness, coordinator, discard } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Poster.varve', dirty: true, filePath: '/p/x.varve' }],
    });
    controls.setSaveResult({ ok: false, cancelled: false });
    const tx = coordinator.requestTermination('quit-application');
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'save' }],
    });
    await harness.flush();
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'discard' }],
    });
    const result = await tx;
    expect(result).toEqual({ outcome: 'committed' });
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('cancels when the user cancels the save-failed dialog', async () => {
    const { controls, harness, coordinator, marker } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Poster.varve', dirty: true, filePath: '/p/x.varve' }],
    });
    controls.setSaveResult({ ok: false, cancelled: false });
    const tx = coordinator.requestTermination('quit-application');
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'save' }],
    });
    await harness.flush();
    harness.cancel();
    const result = await tx;
    expect(result).toEqual({ outcome: 'cancelled' });
    expect(marker.cleanCalls()).toBe(0);
  });

  it('joins a quit request arriving while saves are in flight', async () => {
    const { controls, harness, coordinator } = makeCoordinator({
      sessions: [
        { id: 'a', name: 'A.varve', dirty: true, filePath: '/p/a.varve' },
        { id: 'b', name: 'B.varve', dirty: true, filePath: '/p/b.varve' },
      ],
    });
    const gated = controls.gateSave();
    const tx = coordinator.requestTermination('close-window');
    harness.respond({
      kind: 'proceed',
      choices: [
        { sessionId: 'a', choice: 'save' },
        { sessionId: 'b', choice: 'save' },
      ],
    });
    await harness.flush();
    const duringSave = coordinator.requestTermination('quit-application');
    expect(duringSave).toBe(tx);
    expect(harness.requests).toHaveLength(1);
    controls.releaseSave();
    await gated;
    await expect(tx).resolves.toEqual({ outcome: 'committed' });
    expect(controls.saveCalls).toEqual(['a', 'b']);
  });

  it('does not mark the run clean when finalization fails', async () => {
    const { coordinator, marker, harness } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Poster.varve', dirty: true, filePath: '/p/x.varve' }],
      finalizers: {
        async runFor() {
          throw new Error('flush failed');
        },
      },
    });
    const tx = coordinator.requestTermination('quit-application');
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'save' }],
    });
    const result = await tx;
    expect(result.outcome).toBe('failed');
    expect(marker.cleanCalls()).toBe(0);
    expect(marker.value()).toBe('false');
  });

  it('applies the same save guard to reload/restart intents', async () => {
    const { harness, coordinator, commit } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Poster.varve', dirty: true, filePath: '/p/x.varve' }],
    });
    const tx = coordinator.requestTermination('restart');
    expect(harness.last()?.intent).toBe('restart');
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'save' }],
    });
    const result = await tx;
    expect(result).toEqual({ outcome: 'committed' });
    expect(commit).toHaveBeenCalledWith('restart');
  });

  it('sees dirty sessions hidden behind the Home view when quitting', async () => {
    const { harness, coordinator } = makeCoordinator({
      sessions: [
        { id: 'a', name: 'Visible', dirty: false },
        { id: 'b', name: 'Hidden dirty', dirty: true, filePath: '/p/b.varve' },
      ],
    });
    const tx = coordinator.requestTermination('quit-application');
    expect(harness.last()?.docs.map((d) => d.sessionId)).toEqual(['b']);
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'b', choice: 'save' }],
    });
    await expect(tx).resolves.toEqual({ outcome: 'committed' });
  });

  it('notifies subscribers of phase transitions', async () => {
    const { coordinator, harness } = makeCoordinator({
      sessions: [{ id: 'a', name: 'Poster.varve', dirty: true, filePath: '/p/x.varve' }],
    });
    const phases: string[] = [];
    coordinator.subscribe((state) => phases.push(state.phase));
    const tx = coordinator.requestTermination('close-window');
    expect(phases).toContain('checking');
    expect(phases).toContain('awaiting-user');
    harness.respond({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'save' }],
    });
    await tx;
    expect(phases).toContain('saving');
    expect(phases).toContain('finalizing');
    expect(phases).toContain('committed');
    expect(phases[phases.length - 1]).toBe('idle');
  });
});
