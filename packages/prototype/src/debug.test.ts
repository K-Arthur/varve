import { describe, expect, it } from 'vitest';
import { PrototypeDebugConsole } from './debug';

describe('PrototypeDebugConsole', () => {
  it('logs trigger events', () => {
    const console = new PrototypeDebugConsole();
    console.logTrigger({ type: 'click', nodeId: 'btn-1' }, 'i1', 'btn-1');
    expect(console.entries).toHaveLength(1);
    expect(console.entries[0]?.category).toBe('trigger');
    expect(console.entries[0]?.message).toContain('click');
  });

  it('logs navigation actions', () => {
    const console = new PrototypeDebugConsole();
    console.logAction(
      {
        kind: 'navigateTo',
        targetId: 'screen-2',
        transition: { kind: 'instant', duration: 0, easing: { kind: 'linear' } },
      },
      'i1',
    );
    expect(console.entries).toHaveLength(1);
    expect(console.entries[0]?.message).toContain('screen-2');
  });

  it('logs variable set actions', () => {
    const console = new PrototypeDebugConsole();
    console.logAction({ kind: 'setVariable', variableId: 'count', value: 10 }, 'i1');
    expect(console.entries[0]?.details?.value).toBe(10);
  });

  it('logs navigation events', () => {
    const console = new PrototypeDebugConsole();
    console.logNavigation('screen-1', 'screen-2');
    expect(console.entries[0]?.category).toBe('navigation');
  });

  it('logs state changes', () => {
    const console = new PrototypeDebugConsole();
    console.logStateChange('count', 5, 10);
    expect(console.entries[0]?.category).toBe('state');
  });

  it('logs validation issues', () => {
    const console = new PrototypeDebugConsole();
    console.logValidation({ code: 'broken-target', serverity: 'error', message: 'Target missing' });
    expect(console.entries[0]?.level).toBe('error');
  });

  it('clears entries', () => {
    const console = new PrototypeDebugConsole();
    console.logTrigger({ type: 'click', nodeId: 'btn-1' }, 'i1', 'btn-1');
    console.clear();
    expect(console.entries).toHaveLength(0);
  });

  it('respects max entries limit', () => {
    const console = new PrototypeDebugConsole(5);
    for (let i = 0; i < 10; i++) {
      console.log('info', `entry ${i}`);
    }
    expect(console.entries).toHaveLength(5);
    expect(console.entries[0]?.message).toBe('entry 5');
  });

  it('exports JSON', () => {
    const console = new PrototypeDebugConsole();
    console.log('info', 'test');
    const json = console.exportJSON();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
  });
});
