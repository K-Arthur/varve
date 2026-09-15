import vm from 'node:vm';
import {
  addNode,
  addSMState,
  addSMTransition,
  createDocument,
  createStateMachine,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportInteractivePrototype, type InteractiveExportResult } from './animation-interactive';

function makeDocWithSM(): ReturnType<typeof createDocument> {
  let doc = createDocument('test');
  doc = createStateMachine(doc, 'sm-1', 'Test SM');
  const { stateId: idle, doc: d1 } = addSMState(doc, 'sm-1', 'Idle', 'tl-idle', true);
  const { stateId: active, doc: d2 } = addSMState(d1, 'sm-1', 'Active', 'tl-active');
  doc = addSMTransition(d2, 'sm-1', idle, active, 'onClick', {
    duration: 300,
    easing: { kind: 'ease' },
    priority: 1,
  }).doc;
  return doc;
}

describe('exportInteractivePrototype', () => {
  it('produces a self-contained HTML document', () => {
    const doc = makeDocWithSM();
    const result: InteractiveExportResult = exportInteractivePrototype(doc);
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('<script>');
    expect(result.html).toContain('State Machine Runtime');
    expect(result.html).toContain('height: 812px');
    const script = result.html.match(/<script>\n([\s\S]*?)\n {2}<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new vm.Script(script!)).not.toThrow();
    expect(result.html).toContain('</html>');
  });

  it('emits node identifiers for exported interaction binding', () => {
    const shape = makeShapeNode('button-1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 });
    let doc = createDocument('test');
    doc = addNode(doc, shape);
    doc = addNode(doc, makeFrameNode('screen-1', { children: ['button-1'] }));
    const result = exportInteractivePrototype(doc);
    expect(result.html).toContain('data-node-id="button-1"');
  });

  it('includes state machine transitions as JSON', () => {
    const doc = makeDocWithSM();
    const result = exportInteractivePrototype(doc);
    expect(result.html).toContain('smTransitions');
    expect(result.html).toContain('"trigger":"onClick"');
    expect(result.html).toContain('"priority":1');
  });

  it('includes the entry state', () => {
    const doc = makeDocWithSM();
    const result = exportInteractivePrototype(doc);
    expect(result.html).toContain("smCurrentState = 'st-");
  });

  it('reports summary with counts', () => {
    const doc = makeDocWithSM();
    const result = exportInteractivePrototype(doc);
    expect(result.summary.stateMachineCount).toBe(1);
    expect(result.summary.stateCount).toBe(2);
    expect(result.summary.transitionCount).toBe(1);
    expect(result.summary.features).toContain('state-machines');
  });

  it('warns when no frames exist', () => {
    const doc = createDocument('test');
    const result = exportInteractivePrototype(doc);
    expect(result.summary.warnings.length).toBeGreaterThan(0);
    expect(result.summary.warnings[0]).toContain('No frame');
  });

  it('respects includeStateMachines=false', () => {
    const doc = makeDocWithSM();
    const result = exportInteractivePrototype(doc, { includeStateMachines: false });
    expect(result.html).not.toContain('State Machine Runtime');
  });

  it('includes variable initialization', () => {
    const doc = makeDocWithSM();
    const result = exportInteractivePrototype(doc);
    expect(result.html).toContain('variables');
  });

  it('escapes HTML in titles', () => {
    const doc = makeDocWithSM();
    const result = exportInteractivePrototype(doc, { title: '<script>alert(1)</script>' });
    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).toContain('&lt;script&gt;');
  });
});
