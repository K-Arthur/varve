/**
 * TDD tests for the design governance system.
 *
 * Tests: style usage validation, naming conventions,
 * orphan detection, contrast validation, component validation.
 */
import { describe, expect, it } from 'vitest';
import { createComponent } from './component';
import { addNode, createDocument, makeFrameNode, makeShapeNode, makeTextNode } from './document';
import {
  findOrphanedStyles,
  generateStyleUsageReport,
  type StyleUsageReport,
  type ValidationResult,
  validateComponentProperties,
  validateNamingConventions,
} from './governance';
import { applyStyleToNode, createColorStyle, createTextStyle } from './styles';
import type { Fill } from './types';

describe('Governance — Naming Conventions', () => {
  it('validates PascalCase component names', () => {
    const result = validateNamingConventions('button', 'component');
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain('PascalCase');
  });

  it('accepts PascalCase component names', () => {
    const result = validateNamingConventions('Button', 'component');
    expect(result.valid).toBe(true);
  });

  it('accepts kebab-case style names', () => {
    const result = validateNamingConventions('primary-teal', 'style');
    expect(result.valid).toBe(true);
  });

  it('rejects spaces in style names', () => {
    const result = validateNamingConventions('My Color Style', 'style');
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('kebab-case');
  });

  it('validates semantic prefix conventions', () => {
    const result = validateNamingConventions('color-primary', 'style');
    expect(result.valid).toBe(true);
  });
});

describe('Governance — Orphan Detection', () => {
  it('detects orphaned styles (not used by any node)', () => {
    let doc = createDocument('test');
    const fill: Fill = {
      type: 'solid',
      color: [57, 208, 198, 255],
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { style, doc: d1 } = createColorStyle(doc, 'Teal', fill);
    doc = d1;
    const { style: s2, doc: d2 } = createColorStyle(doc, 'Unused', {
      type: 'solid',
      color: [255, 0, 0, 255],
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    });
    doc = d2;

    // Apply Teal to a node
    const shape = makeShapeNode('n1', { kind: 'rect', w: 100, h: 100 });
    doc = addNode(doc, shape);
    doc = applyStyleToNode(doc, 'n1', style.id);

    const orphans = findOrphanedStyles(doc);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.id).toBe(s2.id);
  });

  it('returns empty array when all styles are used', () => {
    let doc = createDocument('test');
    const fill: Fill = {
      type: 'solid',
      color: [57, 208, 198, 255],
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { style, doc: d1 } = createColorStyle(doc, 'Teal', fill);
    doc = d1;

    const shape = makeShapeNode('n1', { kind: 'rect', w: 100, h: 100 });
    doc = addNode(doc, shape);
    doc = applyStyleToNode(doc, 'n1', style.id);

    const orphans = findOrphanedStyles(doc);
    expect(orphans).toHaveLength(0);
  });
});

describe('Governance — Component Validation', () => {
  it('validates component has properties defined', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, master);
    const { component } = createComponent(doc, 'Button', 'm1', []);

    const result = validateComponentProperties(component);
    expect(result.valid).toBe(true); // No properties is valid (just empty)
  });

  it('validates variant property values match defined properties', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, master);
    const { component: c } = createComponent(doc, 'Button', 'm1', []);
    const component = {
      ...c,
      properties: [{ id: 'p1', name: 'Size', type: 'text' as const, defaultValue: 'md' }],
      variants: [{ id: 'v1', name: 'Large', propertyValues: { Size: 'lg' } }],
    };

    const result = validateComponentProperties(component);
    expect(result.valid).toBe(true);
  });
});

describe('Governance — Usage Report', () => {
  it('generates a usage report for the document', () => {
    let doc = createDocument('test');
    const fill: Fill = {
      type: 'solid',
      color: [57, 208, 198, 255],
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { style, doc: d1 } = createColorStyle(doc, 'Teal', fill);
    doc = d1;
    const { style: s2, doc: d2 } = createTextStyle(doc, 'Body', { fontSize: 16 });
    doc = d2;

    const shape = makeShapeNode('n1', { kind: 'rect', w: 100, h: 100 });
    doc = addNode(doc, shape);
    doc = applyStyleToNode(doc, 'n1', style.id);

    const report = generateStyleUsageReport(doc);
    expect(report.totalStyles).toBe(2);
    expect(report.usedStyles).toBe(1);
    expect(report.orphanedStyles).toBe(1);
    expect(report.styleTypeBreakdown).toHaveProperty('color');
    expect(report.styleTypeBreakdown).toHaveProperty('text');
  });

  it('returns zero usage for empty document', () => {
    const doc = createDocument('test');
    const report = generateStyleUsageReport(doc);
    expect(report.totalStyles).toBe(0);
    expect(report.usedStyles).toBe(0);
    expect(report.orphanedStyles).toBe(0);
  });
});
