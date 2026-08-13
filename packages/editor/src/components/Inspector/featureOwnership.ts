/**
 * Durable ownership for every feature historically mounted by PropertiesPanel.
 *
 * Availability answers "can this feature operate on the current context?".
 * Ownership answers the separate information-architecture question "where
 * should a user look for it?". Keeping those concerns separate prevents the
 * Properties surface from becoming the fallback home for every new feature.
 */
import { getSectionDefinition, type SectionId } from './sectionRegistry';

export type InspectorSurface =
  | 'properties'
  | 'appearance'
  | 'adjustments'
  | 'prototype'
  | 'export'
  | 'tool-options'
  | 'audit';

export type FeatureScope =
  | 'selection'
  | 'mixed-selection'
  | 'document'
  | 'active-tool'
  | 'temporary-workflow';

export type FeatureFrequency = 'frequent' | 'occasional' | 'rare';
export type FeatureComplexity = 'compact' | 'moderate' | 'large-editor';
export type FeatureStatus = 'functional' | 'incomplete' | 'disconnected';

export interface FeatureOwnership {
  surface: InspectorSurface;
  scope: FeatureScope;
  frequency: FeatureFrequency;
  complexity: FeatureComplexity;
  status: FeatureStatus;
  /** Short design rationale used by audits and future section reviews. */
  rationale: string;
  /** Another UI that currently exposes materially overlapping controls. */
  duplicates?: string;
}

export const FEATURE_OWNERSHIP: Record<SectionId, FeatureOwnership> = {
  'page-print': {
    surface: 'properties',
    scope: 'active-tool',
    frequency: 'occasional',
    complexity: 'compact',
    status: 'functional',
    rationale: 'Page-level bleed/slug/safe-area overrides while the Page tool is active',
  },
  table: {
    surface: 'properties',
    scope: 'selection',
    frequency: 'frequent',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Native table structure, headers, frozen regions, density',
  },
  'table-cells': {
    surface: 'properties',
    scope: 'selection',
    frequency: 'frequent',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Cell text, alignment, merge/split during table edit sessions',
  },
  'table-columns': {
    surface: 'properties',
    scope: 'selection',
    frequency: 'frequent',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Column width modes and row height modes',
  },
  'table-rows': {
    surface: 'properties',
    scope: 'selection',
    frequency: 'frequent',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Row height modes (alias of table-columns track editor)',
  },
  'position-size': {
    surface: 'properties',
    scope: 'mixed-selection',
    frequency: 'frequent',
    complexity: 'compact',
    status: 'functional',
    rationale: 'Core geometry with immediate canvas feedback.',
  },
  'corner-radius': {
    surface: 'properties',
    scope: 'selection',
    frequency: 'frequent',
    complexity: 'compact',
    status: 'functional',
    rationale: 'Common shape geometry.',
  },
  layout: {
    surface: 'properties',
    scope: 'selection',
    frequency: 'frequent',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Selected frame layout directly affects its children.',
  },
  constraints: {
    surface: 'properties',
    scope: 'mixed-selection',
    frequency: 'frequent',
    complexity: 'compact',
    status: 'functional',
    rationale: 'Selection-specific responsive behavior.',
  },
  appearance: {
    surface: 'properties',
    scope: 'mixed-selection',
    frequency: 'frequent',
    complexity: 'compact',
    status: 'functional',
    rationale: 'Visibility, opacity, and blend are routine selection edits.',
  },
  mask: {
    surface: 'appearance',
    scope: 'selection',
    frequency: 'occasional',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Mask creation and refinement form a persistent appearance workflow.',
  },
  fills: {
    surface: 'properties',
    scope: 'mixed-selection',
    frequency: 'frequent',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Primary paint is adjusted constantly and gives immediate feedback.',
  },
  'paint-library': {
    surface: 'appearance',
    scope: 'mixed-selection',
    frequency: 'occasional',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Reusable paints are a durable appearance/library workflow.',
  },
  stroke: {
    surface: 'properties',
    scope: 'mixed-selection',
    frequency: 'frequent',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Primary outline controls are routine selection edits.',
  },
  effects: {
    surface: 'appearance',
    scope: 'mixed-selection',
    frequency: 'occasional',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'A potentially long reorderable stack needs dedicated vertical space.',
  },
  typography: {
    surface: 'properties',
    scope: 'mixed-selection',
    frequency: 'frequent',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'Basic text formatting remains contextual; advanced controls may split later.',
  },
  component: {
    surface: 'properties',
    scope: 'selection',
    frequency: 'frequent',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Instance identity and overrides belong to the selected instance.',
  },
  adjustment: {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'occasional',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'Adjustment stacks are a persistent image-editing workflow.',
  },
  'frame-presets': {
    surface: 'tool-options',
    scope: 'active-tool',
    frequency: 'occasional',
    complexity: 'compact',
    status: 'functional',
    rationale: 'Presets configure frame creation or resizing, not document appearance.',
  },
  icon: {
    surface: 'properties',
    scope: 'selection',
    frequency: 'occasional',
    complexity: 'compact',
    status: 'functional',
    rationale:
      'Selected-icon provenance (licence, attribution), replace, and detach are selection properties.',
    duplicates: 'Icon browser dialog offers replace and insert for non-icon selections.',
  },
  'image-placement': {
    surface: 'properties',
    scope: 'selection',
    frequency: 'frequent',
    complexity: 'compact',
    status: 'functional',
    rationale: 'Fit and placement are basic selected-image properties.',
    duplicates: 'ImageFillControls and Crop & Bounds also expose fit.',
  },
  'image-crop': {
    surface: 'tool-options',
    scope: 'temporary-workflow',
    frequency: 'occasional',
    complexity: 'large-editor',
    status: 'incomplete',
    rationale: 'Crop, trim, and expand configure a focused temporary operation.',
    duplicates: 'Image Placement and ImageFillControls expose fit.',
  },
  animation: {
    surface: 'properties',
    scope: 'selection',
    frequency: 'occasional',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Animated-media playback controls: play, scrub, loop, trim, speed, poster.',
  },
  'image-enhancement': {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'rare',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'Upscale and vector tracing are focused processing workflows.',
  },
  'background-removal': {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'occasional',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'Model selection, masks, and previews need a dedicated workflow.',
  },
  colorize: {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'rare',
    complexity: 'large-editor',
    status: 'incomplete',
    rationale: 'AI colorization is a focused image operation with model dependencies.',
  },
  'ai-denoise': {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'rare',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'Denoise quality and model options are focused image processing.',
  },
  'ai-tools-hint': {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'rare',
    complexity: 'compact',
    status: 'functional',
    rationale:
      'Points users to Photo mode for image AI/ML tools when an image is selected outside Photo mode.',
  },
  'lens-blur': {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'rare',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'Depth and blur editing requires preview-oriented space.',
  },
  'line-art': {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'rare',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'Line-art conversion is a focused image operation.',
  },
  'content-aware-fill': {
    surface: 'adjustments',
    scope: 'temporary-workflow',
    frequency: 'rare',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'Source selection and preview form a focused repair workflow.',
  },
  'detect-text': {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'rare',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'Text-region detection is an image-analysis operation.',
  },
  ocr: {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'rare',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'OCR output and conversion need more space than routine properties.',
  },
  'font-detect': {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'rare',
    complexity: 'large-editor',
    status: 'functional',
    rationale: 'Font identification is an image-analysis operation that needs results space.',
  },
  warp: {
    surface: 'appearance',
    scope: 'selection',
    frequency: 'occasional',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Warp modifier stack is a shape-level appearance property edited per selection.',
  },
  mockups: {
    surface: 'prototype',
    scope: 'selection',
    frequency: 'occasional',
    complexity: 'large-editor',
    status: 'functional',
    rationale:
      'Mockup composition is a multi-step prototyping workflow that needs its own surface.',
  },
  'blend-images': {
    surface: 'adjustments',
    scope: 'selection',
    frequency: 'rare',
    complexity: 'large-editor',
    status: 'incomplete',
    rationale: 'Multi-image blending is a focused compositing workflow.',
  },
  palette: {
    surface: 'appearance',
    scope: 'selection',
    frequency: 'rare',
    complexity: 'moderate',
    status: 'functional',
    rationale:
      'Palette extraction turns selected-image appearance into reusable paints and tokens; it belongs beside Paint Library, not pixel adjustments.',
  },
  'adaptive-contrast': {
    surface: 'audit',
    scope: 'mixed-selection',
    frequency: 'occasional',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Contrast analysis and remediation belong with accessibility audits.',
  },
  'align-distribute': {
    surface: 'properties',
    scope: 'mixed-selection',
    frequency: 'frequent',
    complexity: 'compact',
    status: 'functional',
    rationale: 'High-frequency geometry actions belong next to selection transforms.',
  },
  'cognitive-load': {
    surface: 'audit',
    scope: 'mixed-selection',
    frequency: 'rare',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'A diagnostic score belongs with other design audits.',
  },
  interaction: {
    surface: 'prototype',
    scope: 'selection',
    frequency: 'occasional',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Interaction authoring is a durable prototype workflow.',
  },
  'prototype-flow': {
    surface: 'prototype',
    scope: 'document',
    frequency: 'occasional',
    complexity: 'large-editor',
    status: 'disconnected',
    rationale: 'The document-wide flow graph needs a wider prototype surface.',
  },
  'brush-settings': {
    surface: 'tool-options',
    scope: 'active-tool',
    frequency: 'frequent',
    complexity: 'moderate',
    status: 'functional',
    rationale: 'Brush behavior configures the active tool, not the selection.',
    duplicates: 'FloatingToolbar already exposes brush size and opacity.',
  },
  'canvas-background': {
    surface: 'properties',
    scope: 'document',
    frequency: 'occasional',
    complexity: 'compact',
    status: 'functional',
    rationale:
      'Canvas background applies to the document rather than a selection. Shown inline in Properties empty state.',
  },
  'document-color': {
    surface: 'properties',
    scope: 'document',
    frequency: 'rare',
    complexity: 'moderate',
    status: 'functional',
    rationale:
      'Color mode conversion is document-wide and potentially destructive. Shown inline in Properties empty state.',
  },
  'document-proof': {
    surface: 'properties',
    scope: 'document',
    frequency: 'occasional',
    complexity: 'moderate',
    status: 'functional',
    rationale:
      'Display-only output-condition simulation; never mutates colors and never affects export.',
  },
  'document-grid': {
    surface: 'properties',
    scope: 'document',
    frequency: 'occasional',
    complexity: 'moderate',
    status: 'functional',
    rationale:
      'Document grid provides visual alignment guides and snapping for precision work. Shown inline in Properties empty state.',
  },
  'isometric-grid': {
    surface: 'properties',
    scope: 'document',
    frequency: 'occasional',
    complexity: 'moderate',
    status: 'functional',
    rationale:
      'Isometric grid provides angular alignment guides for isometric drawing. Shown inline in Properties empty state.',
  },
};

/** Features for a surface in the registry's stable default order. */
export function getFeaturesForSurface(surface: InspectorSurface): SectionId[] {
  return (Object.keys(FEATURE_OWNERSHIP) as SectionId[])
    .filter((id) => FEATURE_OWNERSHIP[id].surface === surface)
    .sort(
      (a, b) =>
        (getSectionDefinition(a)?.order ?? Number.MAX_SAFE_INTEGER) -
        (getSectionDefinition(b)?.order ?? Number.MAX_SAFE_INTEGER),
    );
}
