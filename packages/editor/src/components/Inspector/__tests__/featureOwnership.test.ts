import { describe, expect, it } from 'vitest';
import {
  FEATURE_OWNERSHIP,
  getFeaturesForSurface,
  type InspectorSurface,
} from '../featureOwnership';
import { getAllSectionIds } from '../sectionRegistry';

describe('Inspector feature ownership', () => {
  it('assigns every registered section to exactly one durable surface', () => {
    const sectionIds = getAllSectionIds().sort();
    const ownedIds = Object.keys(FEATURE_OWNERSHIP).sort();

    expect(ownedIds).toEqual(sectionIds);
  });

  it('keeps the contextual Properties surface intentionally concise, now including document settings', () => {
    expect(getFeaturesForSurface('properties')).toEqual([
      'align-distribute',
      'position-size',
      'component',
      'icon',
      'corner-radius',
      'constraints',
      'table',
      'table-cells',
      'layout',
      'layout-child',
      'appearance',
      'fills',
      'stroke',
      'animation',
      'image-placement',
      'typography',
      'page-print',
      'canvas-background',
      'document-color',
      'document-proof',
      'document-grid',
      'isometric-grid',
      'table-columns',
      'table-rows',
    ]);
  });

  it('moves temporary tool configuration out of selection properties', () => {
    expect(getFeaturesForSurface('tool-options')).toEqual([
      'brush-settings',
      'frame-presets',
      'image-crop',
    ]);
  });

  it('keeps complex image processing on one workflow surface', () => {
    expect(getFeaturesForSurface('adjustments')).toEqual([
      'adjustment',
      'ai-tools-hint',
      'image-enhancement',
      'background-removal',
      'colorize',
      'ai-denoise',
      'lens-blur',
      'line-art',
      'content-aware-fill',
      'detect-text',
      'ocr',
      'blend-images',
      'font-detect',
    ]);
  });

  it('keeps selected-image palette work beside reusable appearance resources', () => {
    expect(getFeaturesForSurface('appearance')).toContain('palette');
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
});
