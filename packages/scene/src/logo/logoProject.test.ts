/**
 * Unit tests for the logo project model — concept/variant registration,
 * brief updates, normalization, artboard creation, and duplication.
 */
import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { createDocument } from '../document';
import {
  addLogoConcept,
  addLogoVariant,
  createLogoArtboard,
  createLogoProject,
  duplicateLogoConcept,
  getLogoProject,
  normalizeLogoProject,
  patchLogoBrief,
  removeLogoConcept,
  removeLogoVariant,
  setLogoConceptStatus,
  updateLogoVariant,
} from './logoProject';

function baseDoc(): Document {
  return createDocument('Logo Test', true);
}

describe('logo project model', () => {
  it('creates an empty serializable project', () => {
    const project = createLogoProject('Acme');
    expect(project.version).toBe(1);
    expect(project.name).toBe('Acme');
    expect(project.concepts).toEqual([]);
    expect(project.variants).toEqual([]);
    expect(project.brief.keywords).toEqual([]);
  });

  it('normalizes malformed projects into safe shapes', () => {
    const normalized = normalizeLogoProject({
      version: 1,
      id: 'p1',
      name: '',
      createdAt: 0,
      updatedAt: 0,
      brief: undefined as unknown as import('./logoProject').LogoBrief,
      concepts: [null] as unknown as import('./logoProject').LogoConcept[],
      variants: [
        {
          id: 'v1',
          name: 'Bad ref',
          kind: 'primary',
          artboardId: null,
          sourceConceptId: 'missing',
          derivedFromVariantId: null,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
    expect(normalized?.name).toBe('Logo Project');
    expect(normalized?.brief.keywords).toEqual([]);
    expect(normalized?.concepts).toEqual([]);
    expect(normalized?.variants[0]?.sourceConceptId).toBeNull();
  });
});

describe('concepts', () => {
  it('adds and updates concepts', () => {
    let doc = baseDoc();
    doc = addLogoConcept(doc, { name: 'Concept A', artboardId: null });
    const project = getLogoProject(doc)!;
    expect(project.concepts).toHaveLength(1);
    const id = project.concepts[0]!.id;

    doc = setLogoConceptStatus(doc, id, 'pinned');
    expect(getLogoProject(doc)!.concepts[0]!.status).toBe('pinned');

    doc = removeLogoConcept(doc, id);
    expect(getLogoProject(doc)!.concepts).toHaveLength(0);
  });

  it('removing a concept detaches variants that referenced it', () => {
    let doc = baseDoc();
    doc = addLogoConcept(doc, { name: 'Concept A', artboardId: null });
    const conceptId = getLogoProject(doc)!.concepts[0]!.id;
    doc = addLogoVariant(doc, {
      name: 'Icon',
      kind: 'icon',
      artboardId: null,
      sourceConceptId: conceptId,
    });
    doc = removeLogoConcept(doc, conceptId);
    const variants = getLogoProject(doc)!.variants;
    expect(variants).toHaveLength(1);
    expect(variants[0]!.sourceConceptId).toBeNull();
  });

  it('duplicates a concept including its artboard artwork', () => {
    let doc = baseDoc();
    const { doc: d1, artboardId } = createLogoArtboard(doc, {
      name: 'Primary',
      width: 400,
      height: 400,
    });
    doc = d1;
    doc = addLogoConcept(doc, { name: 'Primary', artboardId });
    const conceptId = getLogoProject(doc)!.concepts[0]!.id;
    doc = duplicateLogoConcept(doc, conceptId);

    const project = getLogoProject(doc)!;
    expect(project.concepts).toHaveLength(2);
    const copy = project.concepts[1]!;
    expect(copy.name).toBe('Primary Copy');
    expect(copy.artboardId).not.toBe(artboardId);
    expect(copy.provenance).toBe('derived');
    const clonedFrame = doc.nodes[copy.artboardId!];
    expect(clonedFrame).toBeDefined();
    expect(clonedFrame!.kind).toBe('frame');
    // Z-order: the copy sits directly after the original.
    expect(doc.rootChildren).toEqual([artboardId, copy.artboardId]);
  });
});

describe('variants', () => {
  it('adds, updates, and removes variants', () => {
    let doc = baseDoc();
    doc = addLogoVariant(doc, {
      name: 'Monochrome',
      kind: 'monochrome',
      artboardId: null,
      sourceConceptId: null,
    });
    const project = getLogoProject(doc)!;
    expect(project.variants).toHaveLength(1);
    const variantId = project.variants[0]!.id;

    doc = updateLogoVariant(doc, variantId, { kind: 'reversed' });
    expect(getLogoProject(doc)!.variants[0]!.kind).toBe('reversed');

    doc = removeLogoVariant(doc, variantId);
    expect(getLogoProject(doc)!.variants).toHaveLength(0);
  });
});

describe('brief', () => {
  it('patches brief fields and timestamps', () => {
    let doc = baseDoc();
    doc = patchLogoBrief(doc, {
      brandName: 'Acme',
      industry: 'Beverages',
      keywords: ['minimal', 'premium'],
    });
    const brief = getLogoProject(doc)!.brief;
    expect(brief.brandName).toBe('Acme');
    expect(brief.industry).toBe('Beverages');
    expect(brief.keywords).toEqual(['minimal', 'premium']);
    expect(brief.preferredColors).toEqual([]);
  });

  it('does not invent facts: unset fields stay undefined', () => {
    const doc = patchLogoBrief(baseDoc(), { keywords: ['x'] });
    const brief = getLogoProject(doc)!.brief;
    expect(brief.tagline).toBeUndefined();
    expect(brief.audience).toBeUndefined();
    expect(brief.notes).toBeUndefined();
  });
});

describe('artboards', () => {
  it('creates a transparent logo artboard frame', () => {
    const { doc, artboardId } = createLogoArtboard(baseDoc(), {
      name: 'Mark',
      width: 512,
      height: 512,
      x: 100,
      y: 100,
    });
    const frame = doc.nodes[artboardId] as Extract<Document['nodes'][string], { kind: 'frame' }>;
    expect(frame.kind).toBe('frame');
    expect(frame.w).toBe(512);
    expect(frame.h).toBe(512);
    expect(frame.transform).toEqual([1, 0, 0, 1, 100, 100]);
    expect(doc.rootChildren).toContain(artboardId);
    // Logo artboards default to a transparent fill.
    expect(frame.fill).toEqual({ space: 'rgb', r: 255, g: 255, b: 255, a: 0 });
  });
});
