/**
 * Section composition — the single membership surface for the Design tab.
 *
 * The registry (sectionRegistry.ts) owns availability predicates, ordering,
 * labels, and hide state. This module owns only MEMBERSHIP: which registered
 * sections render in which composition (single selection, table selection,
 * multi selection, active-tool context) and which props each section element
 * receives. PropertiesPanel feeds these members through `composeSections`,
 * which applies the registry's availability/visibility/order rules — so
 * availability is never decided here.
 *
 * Before this module existed, membership was three hardcoded JSX sequences in
 * PropertiesPanel, which let registered sections go unrendered
 * (frame-resize, ai-tools-hint) and unregistered sections reach the panel
 * (Align & Distribute, Boolean). Adding a section to the Inspector now means
 * registering it in sectionRegistry.ts and adding its one member entry here.
 */
import type { GroupNode, SceneNode, TableNode } from '@varve/scene';
import type { ReactNode } from 'react';
import type { EditorState } from '../../context/types';
import { LayerStatesSection } from '../LayersPanel/LayerStatesSection';
import type { SectionId } from './sectionRegistry';
import { AdjustmentLayerAccessSection } from './sections/AdjustmentLayerAccessSection';
import { AiToolsHintSection } from './sections/AiToolsHintSection';
import { AlignDistributeBar } from './sections/AlignDistributeBar';
import { AnimationSection } from './sections/AnimationSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { BooleanSection } from './sections/BooleanSection';
import { ComponentSection } from './sections/ComponentSection';
import { CornerRadiusSection } from './sections/CornerRadiusSection';
import { EffectsSection } from './sections/EffectsSection';
import { FillSection } from './sections/FillSection';
import { FramePresetsSection } from './sections/FramePresetsSection';
import { IconSection } from './sections/IconSection';
import { ImageCropSection } from './sections/ImageCropSection';
import { ImagePlacementSection } from './sections/ImagePlacementSection';
import { ImageResolutionSection } from './sections/ImageResolutionSection';
import { LayoutChildSection } from './sections/LayoutChildSection';
import { LayoutSection } from './sections/LayoutSection';
import { MaskSection } from './sections/MaskSection';
import { MockupsSection } from './sections/MockupsSection';
import { PaintLibrarySection } from './sections/PaintLibrarySection';
import { PaletteSection } from './sections/PaletteSection';
import { PathTextSection } from './sections/PathTextSection';
import { PerspectiveSection } from './sections/PerspectiveSection';
import { PositionSizeSection } from './sections/PositionSizeSection';
import { SelectionColorsSection } from './sections/SelectionColorsSection';
import { SmartFiltersSection } from './sections/SmartFiltersSection';
import { StrokeSection } from './sections/StrokeSection';
import { TableCellsSection, TableTracksSection } from './sections/TableCellsSection';
import { TableSection } from './sections/TableSection';
import { TypographySection } from './sections/TypographySection';
import { WarpSection } from './sections/WarpSection';

export type CompositionKind = 'single' | 'single-table' | 'multi' | 'tool';

export interface CompositionContext {
  state: EditorState;
  nodes: SceneNode[];
  /** First node of a single selection; undefined for multi selections. */
  node?: SceneNode;
}

interface CompositionMember {
  id: SectionId;
  render: (ctx: CompositionContext) => ReactNode;
}

/**
 * Single (non-table) selection. Availability nuance that used to live as JSX
 * guards here (corner radius shapes, image sections, smart filters, warp
 * activation) is expressed by the registry predicates themselves.
 */
const SINGLE_MEMBERS: CompositionMember[] = [
  { id: 'align-distribute', render: () => <AlignDistributeBar /> },
  {
    id: 'component',
    render: ({ node }) => <ComponentSection node={node as import('@varve/scene').FrameNode} />,
  },
  { id: 'icon', render: ({ node }) => (node ? <IconSection node={node} /> : null) },
  {
    id: 'mockups',
    render: ({ node }) => <MockupsSection node={node as import('@varve/scene').FrameNode} />,
  },
  { id: 'position-size', render: ({ nodes }) => <PositionSizeSection nodes={nodes} /> },
  { id: 'layout-child', render: ({ nodes }) => <LayoutChildSection nodes={nodes} /> },
  { id: 'corner-radius', render: ({ nodes }) => <CornerRadiusSection nodes={nodes} /> },
  {
    id: 'layout',
    render: ({ node }) => <LayoutSection node={node as import('@varve/scene').FrameNode} />,
  },
  { id: 'appearance', render: ({ nodes }) => <AppearanceSection nodes={nodes} /> },
  {
    id: 'boolean',
    render: ({ node }) => <BooleanSection node={node as GroupNode} />,
  },
  { id: 'mask', render: ({ nodes }) => <MaskSection nodes={nodes} /> },
  {
    id: 'adjustment-layer-access',
    render: ({ nodes }) => <AdjustmentLayerAccessSection nodes={nodes} />,
  },
  { id: 'selection-colors', render: ({ nodes }) => <SelectionColorsSection nodes={nodes} /> },
  { id: 'fills', render: ({ nodes }) => <FillSection nodes={nodes} /> },
  { id: 'paint-library', render: () => <PaintLibrarySection /> },
  { id: 'palette', render: () => <PaletteSection /> },
  { id: 'smart-filters', render: ({ nodes }) => <SmartFiltersSection nodes={nodes} /> },
  {
    id: 'effects',
    render: ({ nodes }) => <EffectsSection nodes={nodes} sectionId="effects" />,
  },
  { id: 'animation', render: ({ nodes }) => <AnimationSection nodes={nodes} /> },
  { id: 'image-placement', render: ({ nodes }) => <ImagePlacementSection nodes={nodes} /> },
  {
    id: 'image-perspective',
    render: ({ nodes }) => <PerspectiveSection nodes={nodes} sectionId="image-perspective" />,
  },
  { id: 'image-resolution', render: ({ nodes }) => <ImageResolutionSection nodes={nodes} /> },
  {
    id: 'image-crop',
    render: ({ nodes }) => <ImageCropSection nodes={nodes} sectionId="image-crop" />,
  },
  { id: 'stroke', render: ({ nodes }) => <StrokeSection nodes={nodes} /> },
  { id: 'typography', render: ({ nodes }) => <TypographySection nodes={nodes} /> },
  { id: 'text-on-path', render: ({ nodes }) => <PathTextSection nodes={nodes} /> },
  {
    id: 'warp',
    render: ({ nodes, node }) => <WarpSection nodes={nodes} node={node ?? nodes[0]} />,
  },
  { id: 'layer-states', render: () => <LayerStatesSection /> },
  // Restored: the Photo-workspace pointer for image selections outside Photo.
  { id: 'ai-tools-hint', render: () => <AiToolsHintSection /> },
];

/** A selected table: scoped table workflow plus shared appearance. */
const SINGLE_TABLE_MEMBERS: CompositionMember[] = [
  {
    id: 'table',
    render: ({ node }) => <TableSection node={node as TableNode} />,
  },
  { id: 'table-cells', render: ({ node }) => <TableCellsSection tableId={node!.id} /> },
  { id: 'table-columns', render: ({ node }) => <TableTracksSection tableId={node!.id} /> },
  { id: 'appearance', render: ({ nodes }) => <AppearanceSection nodes={nodes} /> },
  {
    id: 'adjustment-layer-access',
    render: ({ nodes }) => <AdjustmentLayerAccessSection nodes={nodes} />,
  },
];

/** Heterogeneous or same-kind multi-selection: shared intersection controls. */
const MULTI_MEMBERS: CompositionMember[] = [
  { id: 'align-distribute', render: () => <AlignDistributeBar /> },
  { id: 'position-size', render: ({ nodes }) => <PositionSizeSection nodes={nodes} /> },
  { id: 'corner-radius', render: ({ nodes }) => <CornerRadiusSection nodes={nodes} /> },
  { id: 'layout-child', render: ({ nodes }) => <LayoutChildSection nodes={nodes} /> },
  { id: 'appearance', render: ({ nodes }) => <AppearanceSection nodes={nodes} /> },
  { id: 'paint-library', render: () => <PaintLibrarySection /> },
  {
    id: 'adjustment-layer-access',
    render: ({ nodes }) => <AdjustmentLayerAccessSection nodes={nodes} />,
  },
  { id: 'fills', render: ({ nodes }) => <FillSection nodes={nodes} /> },
  { id: 'stroke', render: ({ nodes }) => <StrokeSection nodes={nodes} /> },
  {
    id: 'effects',
    render: ({ nodes }) => <EffectsSection nodes={nodes} sectionId="effects" />,
  },
  { id: 'selection-colors', render: ({ nodes }) => <SelectionColorsSection nodes={nodes} /> },
  { id: 'image-placement', render: ({ nodes }) => <ImagePlacementSection nodes={nodes} /> },
  { id: 'typography', render: ({ nodes }) => <TypographySection nodes={nodes} /> },
  {
    id: 'warp',
    render: ({ nodes, node }) => <WarpSection nodes={nodes} node={node ?? nodes[0]} />,
  },
  { id: 'layer-states', render: () => <LayerStatesSection /> },
];

/**
 * Empty selection with a drawing tool active. Tools that own Inspector
 * sections render them here; tools whose settings live beside the toolbar are
 * routed by ToolContextState instead.
 */
const TOOL_MEMBERS: CompositionMember[] = [
  {
    id: 'frame-presets',
    render: () => <FramePresetsSection mode="create" sectionId="frame-presets" />,
  },
];

const MEMBERS_BY_KIND: Record<CompositionKind, readonly CompositionMember[]> = {
  single: SINGLE_MEMBERS,
  'single-table': SINGLE_TABLE_MEMBERS,
  multi: MULTI_MEMBERS,
  tool: TOOL_MEMBERS,
};

export function getCompositionMembers(kind: CompositionKind): readonly CompositionMember[] {
  return MEMBERS_BY_KIND[kind];
}

/** Every section id that participates in any composition (diagnostics/tests). */
export function getComposedSectionIds(): Set<SectionId> {
  const ids = new Set<SectionId>();
  for (const members of Object.values(MEMBERS_BY_KIND)) {
    for (const member of members) ids.add(member.id);
  }
  return ids;
}
