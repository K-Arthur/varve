import { describe, expect, it } from 'vitest';
import {
  FEATURE_OWNERSHIP,
  getFeaturesForSurface,
  type InspectorSurface,
} from '../featureOwnership';
import { getAllSectionIds, getSectionDefinition } from '../sectionRegistry';

describe('Inspector feature ownership', () => {
  it('assigns every registered section to exactly one durable surface', () => {
    const sectionIds = getAllSectionIds().sort();
    const ownedIds = Object.keys(FEATURE_OWNERSHIP).sort();

    expect(ownedIds).toEqual(sectionIds);
  });

  it('keeps the contextual Properties surface intentionally concise, including selection colors and document settings', () => {
    // Asserted as a set: ownership is membership, not file order.
    expect(getFeaturesForSurface('properties').sort()).toEqual(
      [
        'align-distribute',
        'boolean',
        'position-size',
        'component',
        'icon',
        'corner-radius',
        'table',
        'table-cells',
        'layout',
        'layout-child',
        'frame-presets',
        'appearance',
        'mask',
        'selection-colors',
        'fills',
        'paint-library',
        'stroke',
        'effects',
        'smart-filters',
        'adjustment-layer-access',
        'animation',
        'image-placement',
        'image-resolution',
        'image-perspective',
        'typography',
        'layer-states',
        'text-on-path',
        'warp',
        'palette',
        'page-print',
        'canvas-background',
        'snapping',
        'document-color',
        'document-proof',
        'document-grid',
        'isometric-grid',
        'table-columns',
      ].sort(),
    );
  });

  it('moves temporary tool configuration out of selection properties', () => {
    expect(getFeaturesForSurface('tool-options').sort()).toEqual(
      ['brush-settings', 'image-crop'].sort(),
    );
  });

  it('keeps complex image processing on one workflow surface', () => {
    expect(getFeaturesForSurface('adjustments').sort()).toEqual(
      [
        'ai-tools-hint',
        'image-enhancement',
        'background-removal',
        'colorize',
        'ai-denoise',
        'depth-mask',
        'lens-blur',
        'line-art',
        'content-aware-fill',
        'detect-text',
        'ocr',
        'blend-images',
        'font-detect',
        'image-tuning',
      ].sort(),
    );
  });

  it('describes the RIFE tool as experimental derived-image interpolation', () => {
    expect(FEATURE_OWNERSHIP['blend-images']).toMatchObject({
      status: 'incomplete',
      rationale: expect.stringContaining('RIFE frame interpolation'),
    });
  });

  it('keeps selected-image palette work on the Properties surface beside the Design-tab paint stack', () => {
    // The legacy Appearance tab was merged into Design, so the paint-stack
    // neighbours (fills, effects, palette) all report the properties surface.
    expect(getFeaturesForSurface('properties')).toContain('palette');
    expect(getFeaturesForSurface('properties')).toContain('fills');
    expect(getFeaturesForSurface('properties')).toContain('effects');
  });

  it('uses only known ownership surfaces', () => {
    const surfaces = new Set<InspectorSurface>([
      'properties',
      'appearance',
      'adjustments',
      'prototype',
      'export',
      'tool-options',
      'audit',
    ]);

    for (const feature of Object.values(FEATURE_OWNERSHIP)) {
      expect(surfaces.has(feature.surface)).toBe(true);
    }
  });

  it('keeps every ownership entry complete and linked to a registry definition', () => {
    for (const [id, feature] of Object.entries(FEATURE_OWNERSHIP)) {
      expect(getSectionDefinition(id as keyof typeof FEATURE_OWNERSHIP)).toBeDefined();
      expect(feature.rationale.trim()).not.toBe('');
      expect(['frequent', 'occasional', 'rare']).toContain(feature.frequency);
      expect(['compact', 'moderate', 'large-editor']).toContain(feature.complexity);
      expect(['functional', 'incomplete', 'disconnected']).toContain(feature.status);
    }
  });
});
