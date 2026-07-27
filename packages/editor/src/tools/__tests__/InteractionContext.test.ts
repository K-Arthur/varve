import { describe, expect, it } from 'vitest';
import { InteractionSession } from '../InteractionContext';

describe('InteractionSession', () => {
  it('begins with defaults', () => {
    const s = new InteractionSession();
    s.begin('mouse', 'move', true);
    const snap = s.freeze();
    expect(snap.shiftKey).toBe(false);
    expect(snap.altKey).toBe(false);
    expect(snap.ctrlKey).toBe(false);
    expect(snap.metaKey).toBe(false);
    expect(snap.inputSource).toBe('mouse');
    expect(snap.operation).toBe('move');
    expect(snap.axisLock).toBe('none');
    expect(snap.isDuplicate).toBe(false);
    expect(snap.snapEnabled).toBe(true);
    expect(snap.bypassSnap).toBe(false);
  });

  it('updates modifiers live and snapshots reflect latest state', () => {
    const s = new InteractionSession();
    s.begin('mouse', 'move', true);
    s.updateModifiers(false, false, true, false);
    const snap1 = s.freeze();
    expect(snap1.ctrlKey).toBe(true);
    expect(snap1.bypassSnap).toBe(true);
    s.updateModifiers(false, false, false, false);
    const snap2 = s.freeze();
    expect(snap2.ctrlKey).toBe(false);
    expect(snap2.bypassSnap).toBe(false);
  });

  it('freeze() returns same object when state unchanged', () => {
    const s = new InteractionSession();
    s.begin('mouse', 'move', true);
    expect(s.freeze()).toBe(s.freeze());
  });

  it('reset() clears state', () => {
    const s = new InteractionSession();
    s.begin('touch', 'resize', false);
    s.updateModifiers(true, true, true, true);
    s.setDuplicate(true);
    s.reset();
    s.begin('mouse', 'move', true);
    expect(s.freeze().shiftKey).toBe(false);
    expect(s.freeze().bypassSnap).toBe(false);
  });

  it('cmdKey returns ctrlKey on non-Mac', () => {
    const s = new InteractionSession();
    s.begin('mouse', 'move', true);
    s.updateModifiers(false, false, true, false);
    expect(s.cmdKey).toBe(true);
  });

  it('setDuplicate and axisLock reflected in snapshot', () => {
    const s = new InteractionSession();
    s.begin('mouse', 'move', true);
    s.setDuplicate(true);
    s.setAxisLock('x');
    const snap = s.freeze();
    expect(snap.isDuplicate).toBe(true);
    expect(snap.axisLock).toBe('x');
  });
});
