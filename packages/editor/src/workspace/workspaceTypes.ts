/**
 * Workspace mode types — versioned, typed configuration over the same editor shell.
 *
 * A workspace mode controls which panels are shown, their order and collapsed
 * state, toolbar composition, default tools, canvas overlays, status-bar
 * sections, inspector tabs, shortcut layers, and performance preferences.
 *
 * A workspace mode does NOT:
 * - Fork the scene model or document
 * - Duplicate commands or tools
 * - Mutate artwork merely by being activated
 * - Recreate the renderer
 * - Reset document state, undo/redo, or selection
 * - Hide save, recovery, undo, or workspace-exit actions
 * - Make useful tools permanently inaccessible
 */

import type { WorkspaceMode } from '@varve/shared';
import type { IconName } from '@varve/ui';
import type { ToolId } from '../tools/types';

// ---------------------------------------------------------------------------
// Workspace mode identity
// ---------------------------------------------------------------------------

/**
 * Canonical definition lives in @varve/shared (the lowest layer both scene
 * and editor depend on) — re-exported here so existing
 * `from '../workspace/workspaceTypes'` imports keep working. Do not
 * redeclare this locally; it drifted out of sync with scene's copy once
 * before ('codegen' missing there) and caused real cross-package typecheck
 * failures.
 */
export type { WorkspaceMode };

// ---------------------------------------------------------------------------
// Panel configuration
// ---------------------------------------------------------------------------

export type PanelId =
  | 'layers'
  | 'inspector'
  | 'timeline'
  | 'pagenav'
  | 'library'
  | 'codegen'
  | 'logo'
  | 'history';

export interface PanelConfig {
  /** Whether this panel is visible by default in this mode. */
  visible: boolean;
  /** Whether this panel starts collapsed (zero-width). */
  collapsed: boolean;
  /** Panel position in the sidebar ordering (lower = closer to canvas). */
  order: number;
  /** Preferred width as a CSS value (e.g. '16rem', '240px'). */
  preferredWidth?: string;
}

export type PanelLayout = Record<PanelId, PanelConfig>;

// ---------------------------------------------------------------------------
// Toolbar composition
// ---------------------------------------------------------------------------

export interface ToolbarItem {
  toolId: ToolId;
  /** Whether this tool starts a visual group (separator before it). */
  groupStart?: boolean;
}

export interface ToolbarConfig {
  /** Tools shown in the floating toolbar for this mode. */
  tools: ToolbarItem[];
  /** Tool groups for flyout menus (e.g. shapes, boolean ops). */
  flyouts?: {
    id: string;
    label: string;
    tools: ToolId[];
  }[];
}

// ---------------------------------------------------------------------------
// Inspector tab configuration
// ---------------------------------------------------------------------------

export type InspectorTabGroup = 'primary' | 'workflow' | 'output';

export type InspectorTabId =
  | 'properties'
  | 'appearance'
  | 'adjustments'
  | 'prototype'
  | 'export'
  | 'audit'
  | 'codegen'
  | 'fonts';

/** Legacy tab IDs that may appear in stored preferences — mapped on migration. */
export type DeprecatedInspectorTabId = 'document' | 'spec';

export interface InspectorTabConfig {
  id: InspectorTabId;
  label: string;
  visible: boolean;
  /** Visual group for tab bar separators. Defaults to 'workflow'. */
  group?: InspectorTabGroup;
  /** Whether this tab is the default when switching to this mode. */
  default?: boolean;
  /**
   * Overflow priority — when tabs exceed container width, tabs with higher
   * overflow priority are moved to the overflow menu first. 0 = pinned
   * (never overflows). Defaults to 1.
   */
  overflowPriority?: number;
}

// ---------------------------------------------------------------------------
// Status bar configuration
// ---------------------------------------------------------------------------

export type StatusSectionId =
  | 'toolName'
  | 'cursorPos'
  | 'zoom'
  | 'selectionInfo'
  | 'unit'
  | 'preflight'
  | 'debt'
  | 'layoutScore'
  | 'colorMode'
  | 'imageInfo'
  | 'pageInfo'
  | 'shortcutTip';

export interface StatusSectionConfig {
  id: StatusSectionId;
  visible: boolean;
  /** Display order (lower = left). */
  order: number;
}

// ---------------------------------------------------------------------------
// Canvas overlay configuration
// ---------------------------------------------------------------------------

export interface CanvasOverlayConfig {
  rulers: boolean;
  guides: boolean;
  pixelGrid: boolean;
  dotGrid: boolean;
  /** Show bleed/trim/slug guides (print mode). */
  bleedGuides: boolean;
  /** Show layout grid overlays. */
  layoutGrid: boolean;
  /** Show baseline grid. */
  baselineGrid: boolean;
}

// ---------------------------------------------------------------------------
// Removed fields — read this before adding them back
// ---------------------------------------------------------------------------

// `shortcuts: { extra, disabled }` was removed. `extra` declared per-mode key
// bindings ('G' → toggleGraphEditor in Motion, and so on) that were never
// registered with anything: `ShortcutManager` is a flat registry of action id
// → one global binding, with no per-workspace layer to receive them. The
// config therefore advertised shortcuts that did nothing when pressed.
// `disabled` fed the shortcut-tip recommender, but was `[]` in all seven
// built-ins; that suppression is now *derived* from the workspace's own
// toolbar (tips for tools a workspace hides are suppressed — see
// `suppressedTipShortcutIds` in workspaceShortcutLabel.ts), which cannot fall
// out of date the way a hand-maintained list did.
//
// `performance: { useWorkerRenderer, useSubtreeCache, viewportCulling,
// imageCacheSize, layerThumbnails, realTimePreview }` was removed. It had no
// runtime consumer — only tests asserted on it, which made it read as a live
// policy. Renderer behaviour is owned by the global render/performance
// settings (`settings.ts`) and the adaptive memory budget
// (`canvas/memoryBudget.ts`), which account for hardware capability, memory
// pressure, and scene complexity. Letting a workspace switch silently
// reconfigure the renderer would change rendering behaviour as a side effect
// of a layout change, with none of that context.

// ---------------------------------------------------------------------------
// Mode-specific onboarding
// ---------------------------------------------------------------------------

export interface OnboardingConfig {
  /** Short description shown in workspace switcher tooltip. */
  description: string;
  /** Tips shown on first switch to this mode. */
  tips?: string[];
}

// ---------------------------------------------------------------------------
// Full workspace configuration
// ---------------------------------------------------------------------------

export interface WorkspaceConfig {
  /** Schema version for safe migration. */
  version: number;
  /** Which panels are visible and how they're arranged. */
  panels: PanelLayout;
  /** Tool to activate when switching to this mode (undefined = preserve current). */
  defaultTool?: ToolId;
  /** Toolbar composition for this mode. */
  toolbar: ToolbarConfig;
  /** Inspector tab configuration. */
  inspectorTabs: InspectorTabConfig[];
  /** Status bar section configuration. */
  statusSections: StatusSectionConfig[];
  /** Canvas overlays active by default. */
  canvasOverlays: CanvasOverlayConfig;
  /** Onboarding and mode metadata. */
  onboarding: OnboardingConfig;
  /** Show the floating toolbar. */
  floatingToolbar: boolean;
  /** Show the status bar. */
  statusBar: boolean;
  /** Show the menubar tab strip (multi-doc tabs). */
  tabStrip: boolean;
}

// ---------------------------------------------------------------------------
// Workspace preference (user-customizable, persisted)
// ---------------------------------------------------------------------------

export interface WorkspacePreference {
  /** Mode-specific panel overrides. */
  panelOverrides?: Partial<Record<PanelId, Partial<PanelConfig>>>;
  /** Mode-specific inspector tab visibility overrides (tab id → visible). */
  inspectorTabOverrides?: Partial<Record<InspectorTabId, boolean>>;
  /** Mode-specific status section visibility overrides (section id → visible). */
  statusSectionOverrides?: Partial<Record<StatusSectionId, boolean>>;
  /** Per-workspace panel widths (keyed by panel id, value in pixels). */
  panelWidths?: Partial<Record<PanelId, number>>;
  /** Mode-specific toolbar tool visibility overrides (tool id → visible). */
  toolbarToolOverrides?: Partial<Record<string, boolean>>;
  /** Whether the user has customized this mode. */
  customized: boolean;
  /** Timestamp of last customization. */
  lastCustomized?: number;
}

export type WorkspacePreferences = Record<WorkspaceMode, WorkspacePreference>;

// ---------------------------------------------------------------------------
// Built-in workspace configurations
// ---------------------------------------------------------------------------

export const WORKSPACE_CONFIGS: Record<WorkspaceMode, WorkspaceConfig> = {
  // ─── Design Mode (UI/UX, components, prototyping) ──────────────────────
  design: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0 },
      inspector: { visible: true, collapsed: false, order: 0 },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: true, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
      logo: { visible: false, collapsed: false, order: 6 },
      history: { visible: false, collapsed: false, order: 7 },
    },
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'rect', groupStart: true },
        { toolId: 'ellipse' },
        { toolId: 'polygon' },
        { toolId: 'star' },
        { toolId: 'line', groupStart: true },
        { toolId: 'arrow' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'text', groupStart: true },
        { toolId: 'frame' },
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'slice' },
        { toolId: 'eyedropper' },
        { toolId: 'scale' },
        { toolId: 'inspect' },
      ],
      flyouts: [
        { id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse', 'polygon', 'star'] },
        {
          id: 'boolean',
          label: 'Boolean',
          tools: ['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanExclude'],
        },
      ],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'prototype', label: 'Prototype', visible: true, group: 'workflow' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'audit', label: 'Audit', visible: true, group: 'output', overflowPriority: 5 },
      { id: 'fonts', label: 'Fonts', visible: true, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'layoutScore', visible: true, order: 11 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'debt', visible: true, order: 21 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    onboarding: {
      description:
        'UI/UX design, components, tokens, responsive layouts, prototyping, and developer handoff.',
      tips: [
        'Use Frame (F) to create artboards and responsive containers.',
        'Create components from the context menu, then use variants for state changes.',
        'Switch to Prototype mode (Ctrl+Alt+P) to add interactions.',
        'Use Inspect (hold Ctrl) to measure and copy design specs.',
      ],
    },
  },

  // ─── Print Mode (multi-page, typography, preflight, production) ─────────
  print: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0 },
      inspector: { visible: true, collapsed: false, order: 0 },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: true, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
      logo: { visible: false, collapsed: false, order: 6 },
      history: { visible: false, collapsed: false, order: 7 },
    },
    defaultTool: 'select',
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'rect', groupStart: true },
        { toolId: 'ellipse' },
        { toolId: 'polygon' },
        { toolId: 'star' },
        { toolId: 'line', groupStart: true },
        { toolId: 'arrow' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'text', groupStart: true },
        { toolId: 'frame' },
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'slice' },
        { toolId: 'eyedropper' },
        { toolId: 'scale' },
        { toolId: 'inspect' },
      ],
      flyouts: [
        { id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse', 'polygon', 'star'] },
        {
          id: 'boolean',
          label: 'Boolean',
          tools: ['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanExclude'],
        },
      ],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'audit', label: 'Audit', visible: true, group: 'output', overflowPriority: 5 },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'fonts', label: 'Fonts', visible: true, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'pageInfo', visible: true, order: 5 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'preflight', visible: true, order: 12 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'colorMode', visible: true, order: 22 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: true,
      layoutGrid: false,
      baselineGrid: false,
    },
    onboarding: {
      description:
        'Multi-page layouts, typography, preflight, colour management, and production output.',
      tips: [
        'Use Page Nav (bottom strip) to add, reorder, and navigate pages.',
        'Toggle Facing Pages in the View menu for book/magazine layouts.',
        'Master pages (Page menu) let you reuse headers, footers, and page numbers.',
        'Preflight warnings appear in the status bar when issues are detected.',
        'Export to PDF/X for print production via File → Export.',
      ],
    },
  },

  // ─── Drawing/Painting Mode (canvas-first, brushes, stylus) ──────────────
  drawing: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0 },
      inspector: { visible: true, collapsed: false, order: 0 },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: false, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
      logo: { visible: false, collapsed: false, order: 6 },
      history: { visible: false, collapsed: false, order: 7 },
    },
    defaultTool: 'paint',
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'paint', groupStart: true },
        { toolId: 'eraser' },
        { toolId: 'smudge' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'line' },
        { toolId: 'arrow' },
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'text' },
        { toolId: 'eyedropper' },
        { toolId: 'frame' },
      ],
      flyouts: [
        {
          id: 'retouch',
          label: 'Retouch',
          tools: ['cloneStamp', 'healBrush', 'spotHeal', 'patch'],
        },
      ],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'fonts', label: 'Fonts', visible: false, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'debt', visible: true, order: 21 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: false,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    onboarding: {
      description:
        'Raster painting, vector freehand drawing, stylus input, brushes, masks, and drawing assists.',
      tips: [
        'Press B for the Brush tool. Use [ and ] to resize.',
        'Hold Shift while drawing for straight lines.',
        'Right-click (or Alt+click) for the color picker.',
        'Toggle distraction-free mode with Ctrl+Shift+Period.',
        'Pressure and tilt are mapped when using a stylus.',
      ],
    },
  },

  // ─── Image Editing Mode (photo editing, retouching, adjustments) ────────
  image: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0 },
      inspector: { visible: true, collapsed: false, order: 0 },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: false, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
      logo: { visible: false, collapsed: false, order: 6 },
      history: { visible: false, collapsed: false, order: 7 },
    },
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'crop', groupStart: true },
        { toolId: 'eyedropper' },
        { toolId: 'paint', groupStart: true },
        { toolId: 'eraser' },
        { toolId: 'smudge' },
        { toolId: 'cloneStamp', groupStart: true },
        { toolId: 'healBrush' },
        { toolId: 'spotHeal' },
        { toolId: 'patch' },
        { toolId: 'refineMask', groupStart: true },
        { toolId: 'trimapEdit' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'line' },
        { toolId: 'text' },
        { toolId: 'scale' },
        { toolId: 'inspect' },
      ],
      flyouts: [
        {
          id: 'retouch',
          label: 'Retouch',
          tools: ['cloneStamp', 'healBrush', 'spotHeal', 'patch'],
        },
        { id: 'mask', label: 'Mask', tools: ['refineMask', 'trimapEdit'] },
      ],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'adjustments', label: 'Adjustments', visible: true, group: 'workflow' },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'audit', label: 'Audit', visible: true, group: 'output', overflowPriority: 5 },
      { id: 'fonts', label: 'Fonts', visible: false, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'imageInfo', visible: true, order: 5 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'colorMode', visible: true, order: 22 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: true,
      dotGrid: false,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    onboarding: {
      description:
        'Nondestructive photo editing, retouching, selections, adjustments, masking, and compositing.',
      tips: [
        'Use adjustment layers (nondestructive) instead of direct edits.',
        'Use the Mask section in the Inspector to build and edit selections as masks.',
        'Ctrl+Shift+Y toggles soft proofing for print colour accuracy.',
        'Press \\ for before/after comparison.',
        'Background removal uses AI subject detection.',
      ],
    },
  },

  // ─── Motion Mode (animation, timeline, keyframes, prototyping) ──────────
  // ─── Codegen & Audit Mode (design-to-code, design audit, spec output) ────
  codegen: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0, preferredWidth: '16rem' },
      inspector: { visible: true, collapsed: false, order: 0, preferredWidth: '20rem' },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: true, collapsed: false, order: 3 },
      library: { visible: true, collapsed: false, order: 4 },
      codegen: { visible: true, collapsed: false, order: 5, preferredWidth: '100%' },
      logo: { visible: false, collapsed: false, order: 6 },
      history: { visible: false, collapsed: false, order: 7 },
    },
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'inspect', groupStart: true },
        { toolId: 'frame', groupStart: true },
        { toolId: 'rect' },
        { toolId: 'ellipse' },
        { toolId: 'text' },
        { toolId: 'line', groupStart: true },
        { toolId: 'arrow' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'scale', groupStart: true },
        { toolId: 'eyedropper' },
      ],
      flyouts: [
        { id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse'] },
        {
          id: 'boolean',
          label: 'Boolean',
          tools: ['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanExclude'],
        },
      ],
    },
    inspectorTabs: [
      {
        id: 'codegen',
        label: 'Codegen',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        group: 'primary',
        overflowPriority: 1,
      },
      { id: 'audit', label: 'Audit', visible: true, group: 'output' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'fonts', label: 'Fonts', visible: false, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'layoutScore', visible: true, order: 11 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'debt', visible: true, order: 21 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    onboarding: {
      description:
        'Design-to-code export, design audit, accessibility checks, and specification output.',
      tips: [
        'Select a node to view its code in HTML, Tailwind, or SVG.',
        'Use the Audit tab to check contrast, typography, and accessibility.',
        'The Design Audit report lists all issues with severity levels.',
        'Switch between codegen targets to compare output formats.',
        'Flattened regions show fidelity warnings where effects are rasterized.',
      ],
    },
  },

  // ─── Logo Mode (wordmarks, marks, monograms, brand systems) ─────────────
  logo: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0 },
      inspector: { visible: true, collapsed: false, order: 0 },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: false, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
      logo: { visible: true, collapsed: false, order: 6 },
      history: { visible: false, collapsed: false, order: 7 },
    },
    defaultTool: 'select',
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'nodeEdit' },
        { toolId: 'text', groupStart: true },
        { toolId: 'frame', groupStart: true },
        { toolId: 'rect' },
        { toolId: 'ellipse' },
        { toolId: 'line', groupStart: true },
        { toolId: 'arrow' },
        { toolId: 'scale', groupStart: true },
        { toolId: 'eyedropper' },
      ],
      flyouts: [
        { id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse'] },
        {
          id: 'boolean',
          label: 'Boolean',
          tools: ['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanExclude'],
        },
      ],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'audit', label: 'Audit', visible: true, group: 'output', overflowPriority: 5 },
      { id: 'fonts', label: 'Fonts', visible: true, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'layoutScore', visible: true, order: 11 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'debt', visible: true, order: 21 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    onboarding: {
      description:
        'Logo design: wordmarks, marks, monograms, badges, clear-space, and brand systems on a transparent canvas.',
      tips: [
        'Logo canvases start transparent — export keeps alpha.',
        'Use Convert Text to Outlines (Text menu) before delivering final wordmarks.',
        'Boolean tools (Ctrl+Alt+U/S/I/X) combine shapes into a single mark.',
        'Generate clear-space guides from Object menu to protect the logo.',
        'Audit tab flags thin strokes, unclosed paths, and small-size risks.',
      ],
    },
  },

  motion: {
    version: 2,
    panels: {
      layers: { visible: true, collapsed: false, order: 0, preferredWidth: '18rem' },
      inspector: { visible: true, collapsed: false, order: 0, preferredWidth: '18rem' },
      timeline: { visible: true, collapsed: false, order: 2, preferredWidth: '100%' },
      pagenav: { visible: true, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
      logo: { visible: false, collapsed: false, order: 6 },
      history: { visible: false, collapsed: false, order: 7 },
    },
    defaultTool: 'select',
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'select', groupStart: true },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'frame', groupStart: true },
        { toolId: 'rect' },
        { toolId: 'ellipse' },
        { toolId: 'text' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'line' },
        { toolId: 'arrow' },
        { toolId: 'scale', groupStart: true },
        { toolId: 'eyedropper' },
        { toolId: 'inspect' },
      ],
      flyouts: [{ id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse'] }],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'prototype', label: 'Prototype', visible: true, group: 'workflow' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'audit', label: 'Audit', visible: true, group: 'output', overflowPriority: 5 },
      { id: 'fonts', label: 'Fonts', visible: false, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'layoutScore', visible: true, order: 11 },
      { id: 'selectionInfo', visible: true, order: 12 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'debt', visible: true, order: 21 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    onboarding: {
      description:
        'Timeline-based animation, keyframe editing, easing curves, motion paths, and interactive prototyping.',
      tips: [
        'Press I to add a keyframe at the playhead for the selected property.',
        'Press Alt+O to toggle onion skinning — see previous/next frame ghosts.',
        'Press G to open the Graph Editor for easing curves.',
        'Space toggles play/pause of the active timeline.',
        'Auto-keyframe mode (Alt+K) inserts keyframes when you edit properties during playback.',
        'Motion path shows on canvas — drag keyframe points to adjust timing.',
        'Right-click a keyframe to change easing (linear, ease, spring, bezier).',
        'Create multiple timelines to organize complex animations.',
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Schema version for safe migration. */
export const WORKSPACE_CONFIG_VERSION = 1;

export function getWorkspaceConfig(mode: WorkspaceMode): WorkspaceConfig {
  return WORKSPACE_CONFIGS[mode] ?? WORKSPACE_CONFIGS.design;
}

export const WORKSPACE_LABELS: Record<WorkspaceMode, string> = {
  design: 'Design',
  print: 'Print',
  drawing: 'Draw',
  image: 'Photo',
  motion: 'Motion',
  codegen: 'Codegen & Audit',
  logo: 'Logo',
};

export const WORKSPACE_ICONS: Record<WorkspaceMode, IconName> = {
  design: 'PenTool',
  print: 'Printer',
  drawing: 'Paintbrush',
  image: 'Image',
  motion: 'Play',
  codegen: 'Code',
  logo: 'Stamp',
};

/** All available workspace modes. */
export const ALL_WORKSPACE_MODES: readonly WorkspaceMode[] = [
  'design',
  'print',
  'drawing',
  'image',
  'motion',
  'codegen',
  'logo',
] as const;

/**
 * Top-bar display order for workspace tabs — data-driven, single source of
 * truth for how many modes the menubar shows at any width. Order reflects
 * product intent: the primary modes (Design, Draw, Photo) stay on screen;
 * Print, Motion, Codegen, and Logo are the first to move into the "More"
 * overflow menu at narrow widths.
 */
export const WORKSPACE_OVERFLOW_ORDER: readonly WorkspaceMode[] = [
  'design',
  'drawing',
  'image',
  'print',
  'motion',
  'codegen',
  'logo',
] as const;

/**
 * Overflow priority per mode — higher values leave the visible tab strip
 * first when space runs out (0 = never overflows). Design never overflows;
 * Logo and Codegen overflow first.
 */
export const WORKSPACE_OVERFLOW_PRIORITY: Record<WorkspaceMode, number> = {
  design: 0,
  drawing: 2,
  image: 2,
  print: 3,
  motion: 4,
  codegen: 5,
  logo: 6,
};

// Workspace switching shortcuts are NOT declared here. They live in the
// shortcut registry (`shortcuts/ShortcutManager.ts`) and are resolved for
// display via `workspaceShortcutLabel(mode)`. A literal table here rotted
// once already — it still claimed Ctrl+Shift+D/P/R/I/M long after those keys
// were reassigned to Repeat Duplicate, Present, Invert Selection and Preview
// Mode, so every tooltip built from it advertised a shortcut that did
// something else entirely.

// ---------------------------------------------------------------------------
// Panel layout helpers
// ---------------------------------------------------------------------------

/** Get panels sorted by their order value for a given mode. */
export function getOrderedPanels(mode: WorkspaceMode): PanelId[] {
  const config = getWorkspaceConfig(mode);
  return (Object.entries(config.panels) as [PanelId, PanelConfig][])
    .filter(([_, p]) => p.visible)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([id]) => id);
}

/** Get visible status sections sorted by order. */
export function getVisibleStatusSections(
  mode: WorkspaceMode,
  config?: WorkspaceConfig,
): StatusSectionId[] {
  const cfg = config ?? getWorkspaceConfig(mode);
  return cfg.statusSections
    .filter((s) => s.visible)
    .sort((a, b) => a.order - b.order)
    .map((s) => s.id);
}

/** Get visible inspector tabs for a mode. */
export function getVisibleInspectorTabs(
  mode: WorkspaceMode,
  config?: WorkspaceConfig,
): InspectorTabId[] {
  const cfg = config ?? getWorkspaceConfig(mode);
  return cfg.inspectorTabs.filter((t) => t.visible).map((t) => t.id);
}

/** Get the default inspector tab for a mode. */
export function getDefaultInspectorTab(
  mode: WorkspaceMode,
  config?: WorkspaceConfig,
): InspectorTabId {
  const cfg = config ?? getWorkspaceConfig(mode);
  return cfg.inspectorTabs.find((t) => t.default)?.id ?? 'properties';
}

/** Get inspector tab configs grouped by visual group, preserving per-group order. */
export function getGroupedInspectorTabs(
  mode: WorkspaceMode,
): Partial<Record<InspectorTabGroup, InspectorTabConfig[]>> {
  const config = getWorkspaceConfig(mode);
  const groups: Partial<Record<InspectorTabGroup, InspectorTabConfig[]>> = {};
  for (const tab of config.inspectorTabs) {
    if (!tab.visible) continue;
    const g = tab.group ?? 'workflow';
    if (!groups[g]) groups[g] = [];
    groups[g]!.push(tab);
  }
  return groups;
}

/** Tab group display labels. */
export const TAB_GROUP_LABELS: Record<InspectorTabGroup, string> = {
  primary: 'Properties',
  workflow: 'Workflow',
  output: 'Output',
};

/** Order of tab groups in the tab bar. */
export const TAB_GROUP_ORDER: InspectorTabGroup[] = ['primary', 'workflow', 'output'];

/**
 * Labelled fallback for deprecated tab IDs that still appear in stored prefs or
 * external callers. These should be resolved by migration but can appear in
 * transient state (e.g. a stored activeTab from a previous session).
 */
export const DEPRECATED_TAB_FALLBACKS: Record<string, InspectorTabId> = {
  document: 'properties',
  spec: 'export',
};

/** Get tools that should be hidden in a given mode. */
export function getHiddenTools(mode: WorkspaceMode): Set<ToolId> {
  const config = getWorkspaceConfig(mode);
  const toolbarToolIds = new Set(config.toolbar.tools.map((t) => t.toolId));
  // Tools in the full tool set that aren't in the mode's toolbar are hidden
  const ALL_TOOLS: ToolId[] = [
    'select',
    'frame',
    'rect',
    'ellipse',
    'polygon',
    'star',
    'line',
    'arrow',
    'pen',
    'pencil',
    'nodeEdit',
    'text',
    'hand',
    'zoom',
    'scale',
    'image',
    'slice',
    'eyedropper',
    'inspect',
    'booleanUnion',
    'booleanSubtract',
    'booleanIntersect',
    'booleanExclude',
    'cloneStamp',
    'healBrush',
    'spotHeal',
    'patch',
    'refineMask',
    'trimapEdit',
    'crop',
    'paint',
    'eraser',
    'smudge',
    'lasso',
    'page',
  ];
  const hidden = new Set<ToolId>();
  for (const id of ALL_TOOLS) {
    if (!toolbarToolIds.has(id)) hidden.add(id);
  }
  return hidden;
}

/** Check if a mode config is valid (has required fields). */
export function isValidWorkspaceConfig(config: unknown): config is WorkspaceConfig {
  if (typeof config !== 'object' || config === null) return false;
  const c = config as Record<string, unknown>;
  return (
    typeof c.version === 'number' &&
    typeof c.floatingToolbar === 'boolean' &&
    typeof c.statusBar === 'boolean' &&
    typeof c.tabStrip === 'boolean' &&
    typeof c.panels === 'object' &&
    c.panels !== null &&
    typeof c.toolbar === 'object' &&
    c.toolbar !== null &&
    Array.isArray(c.inspectorTabs) &&
    Array.isArray(c.statusSections) &&
    typeof c.canvasOverlays === 'object' &&
    c.canvasOverlays !== null
  );
}

/** Migrate an older config to the current version. */
export function migrateWorkspaceConfig(
  config: Record<string, unknown>,
  _targetVersion: number = WORKSPACE_CONFIG_VERSION,
): WorkspaceConfig {
  // Version 0 → 1: upgrade from the old WorkspaceConfig shape
  if (!config.version || (config.version as number) < 1) {
    const old = config as unknown as {
      visiblePanels?: {
        layers?: boolean;
        inspector?: boolean;
        timeline?: boolean;
        pagenav?: boolean;
        library?: boolean;
      };
      defaultTool?: string;
      floatingToolbar?: boolean;
      statusBar?: boolean;
      tabStrip?: boolean;
      canvasOverlays?: {
        rulers?: boolean;
        guides?: boolean;
        pixelGrid?: boolean;
        dotGrid?: boolean;
      };
      statusSections?: {
        toolName?: boolean;
        cursorPos?: boolean;
        zoom?: boolean;
        selectionInfo?: boolean;
        unit?: boolean;
        preflight?: boolean;
        debt?: boolean;
      };
    };

    const mode = (config._mode as WorkspaceMode) ?? 'design';
    const base = getWorkspaceConfig(mode);

    const panels: PanelLayout = {
      layers: { visible: old.visiblePanels?.layers ?? true, collapsed: false, order: 0 },
      inspector: { visible: old.visiblePanels?.inspector ?? true, collapsed: false, order: 0 },
      timeline: { visible: old.visiblePanels?.timeline ?? false, collapsed: false, order: 2 },
      pagenav: { visible: old.visiblePanels?.pagenav ?? true, collapsed: false, order: 3 },
      library: { visible: old.visiblePanels?.library ?? false, collapsed: false, order: 4 },
      // Didn't exist in the pre-v1 format (like bleedGuides/layoutGrid/baselineGrid below) --
      // fall back to the target mode's own default rather than inventing a literal.
      codegen: base.panels.codegen,
      logo: base.panels.logo,
      history: base.panels.history,
    };

    return {
      ...base,
      version: 1,
      panels,
      defaultTool: old.defaultTool as ToolId | undefined,
      floatingToolbar: old.floatingToolbar ?? true,
      statusBar: old.statusBar ?? true,
      tabStrip: old.tabStrip ?? true,
      canvasOverlays: {
        rulers: old.canvasOverlays?.rulers ?? true,
        guides: old.canvasOverlays?.guides ?? true,
        pixelGrid: old.canvasOverlays?.pixelGrid ?? false,
        dotGrid: old.canvasOverlays?.dotGrid ?? true,
        bleedGuides: base.canvasOverlays.bleedGuides,
        layoutGrid: base.canvasOverlays.layoutGrid,
        baselineGrid: base.canvasOverlays.baselineGrid,
      },
      statusSections: base.statusSections.map((s) => {
        const oldKey = s.id === 'layoutScore' ? 'debt' : s.id;
        const oldVal = (old.statusSections as Record<string, boolean> | undefined)?.[oldKey];
        return { ...s, visible: oldVal ?? s.visible };
      }),
    };
  }

  // Already at target version
  return config as unknown as WorkspaceConfig;
}
