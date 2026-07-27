import type { Theme } from '@strata/ui/tokens';
import type { MenuBuildHelpers, MenuBuildState, MenuItem } from './types';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'high-contrast', label: 'High Contrast' },
];

export function buildViewMenu(_state: MenuBuildState, helpers: MenuBuildHelpers): MenuItem[] {
  return [
    ...THEMES.map((t) => ({
      label: t.label,
      action: `theme:${t.id}`,
    })),
    { label: '---' },
    {
      label: 'Zoom to 100%',
      shortcut: helpers.fmt('zoomReset'),
      ariaKeyshortcut: helpers.ks('zoomReset'),
      action: 'zoomReset',
    },
    {
      label: 'Zoom In',
      shortcut: helpers.fmt('zoomIn'),
      ariaKeyshortcut: helpers.ks('zoomIn'),
      action: 'zoomIn',
    },
    {
      label: 'Zoom Out',
      shortcut: helpers.fmt('zoomOut'),
      ariaKeyshortcut: helpers.ks('zoomOut'),
      action: 'zoomOut',
    },
    { label: '---' },
    {
      label: 'Full Render Mode',
      shortcut: helpers.fmt('canvasModeFull'),
      ariaKeyshortcut: helpers.ks('canvasModeFull'),
      action: 'canvasModeFull',
    },
    {
      label: 'Outline Mode',
      shortcut: helpers.fmt('canvasModeOutline'),
      ariaKeyshortcut: helpers.ks('canvasModeOutline'),
      action: 'canvasModeOutline',
    },
    {
      label: 'Preview Mode',
      shortcut: helpers.fmt('canvasModePreview'),
      ariaKeyshortcut: helpers.ks('canvasModePreview'),
      action: 'canvasModePreview',
    },
    {
      label: 'Inspect Mode',
      shortcut: helpers.fmt('toolInspect'),
      ariaKeyshortcut: helpers.ks('toolInspect'),
      action: 'inspectMode',
    },
    { label: '---' },
    {
      label: 'Fit Active Page',
      shortcut: helpers.fmt('fitActivePage'),
      ariaKeyshortcut: helpers.ks('fitActivePage'),
      action: 'fitActivePage',
    },
    {
      label: 'Fit Active Frame',
      shortcut: helpers.fmt('fitActiveFrame'),
      ariaKeyshortcut: helpers.ks('fitActiveFrame'),
      action: 'fitActiveFrame',
    },
    {
      label: 'Reset View Rotation',
      shortcut: helpers.fmt('resetViewRotation'),
      ariaKeyshortcut: helpers.ks('resetViewRotation'),
      action: 'resetViewRotation',
    },
    {
      label: 'Rotate View Clockwise',
      shortcut: helpers.fmt('rotateViewCW'),
      ariaKeyshortcut: helpers.ks('rotateViewCW'),
      action: 'rotateViewCW',
    },
    {
      label: 'Rotate View Counter-clockwise',
      shortcut: helpers.fmt('rotateViewCCW'),
      ariaKeyshortcut: helpers.ks('rotateViewCCW'),
      action: 'rotateViewCCW',
    },
    { label: '---' },
    {
      label: 'Artboard Ruler Origin',
      action: 'rulerModeArtboard',
      disabled: _state.rulerMode === 'artboard',
    },
    {
      label: 'Global Ruler Origin',
      action: 'rulerModeGlobal',
      disabled: _state.rulerMode === 'global',
    },
    {
      label: _state.documentGrid.visible ? 'Hide Grid' : 'Show Grid',
      shortcut: helpers.fmt('toggleGrid'),
      ariaKeyshortcut: helpers.ks('toggleGrid'),
      action: 'toggleGrid',
    },
    {
      label: 'Baseline Grid Overlay',
      shortcut: helpers.fmt('gridOverlayBaseline'),
      ariaKeyshortcut: helpers.ks('gridOverlayBaseline'),
      action: 'gridOverlayBaseline',
    },
    {
      label: 'Isometric Grid Overlay',
      shortcut: helpers.fmt('gridOverlayIsometric'),
      ariaKeyshortcut: helpers.ks('gridOverlayIsometric'),
      action: 'gridOverlayIsometric',
    },
    { label: '---' },
    {
      label: 'Toggle Snap',
      shortcut: helpers.fmt('toggleSnap'),
      ariaKeyshortcut: helpers.ks('toggleSnap'),
      action: 'toggleSnap',
    },
    {
      label: _state.guidesVisible ? 'Hide Guides' : 'Show Guides',
      shortcut: helpers.fmt('toggleGuidesVisible'),
      ariaKeyshortcut: helpers.ks('toggleGuidesVisible'),
      action: 'toggleGuidesVisible',
    },
    {
      label: 'Lock All Guides',
      shortcut: helpers.fmt('lockAllGuides'),
      ariaKeyshortcut: helpers.ks('lockAllGuides'),
      action: 'lockAllGuides',
    },
    {
      label: 'Clear All Guides',
      action: 'clearGuides',
    },
    { label: '---' },
    {
      label: 'Facing Pages',
      action: 'toggleFacingPages',
    },
    {
      label: 'Soft Proofing',
      shortcut: helpers.fmt('softProof'),
      ariaKeyshortcut: helpers.ks('softProof'),
      action: 'softProof',
    },
    { label: '---' },
    {
      label: 'Timeline Panel',
      shortcut: helpers.fmt('toggleTimelinePanel'),
      ariaKeyshortcut: helpers.ks('toggleTimelinePanel'),
      action: 'toggleTimelinePanel',
    },
    {
      label: 'Graph Editor',
      shortcut: helpers.fmt('toggleGraphEditor'),
      ariaKeyshortcut: helpers.ks('toggleGraphEditor'),
      action: 'toggleGraphEditor',
    },
    {
      label: 'State Machine Panel',
      shortcut: helpers.fmt('toggleStateMachinePanel'),
      ariaKeyshortcut: helpers.ks('toggleStateMachinePanel'),
      action: 'toggleStateMachinePanel',
    },
    {
      label: 'Fonts Panel',
      shortcut: helpers.fmt('openFontsPanel'),
      ariaKeyshortcut: helpers.ks('openFontsPanel'),
      action: 'openFontsPanel',
    },
    { label: '---' },
    {
      label: 'Workspace: Design',
      action: 'workspaceDesign',
      disabled: _state.workspaceMode === 'design',
    },
    {
      label: 'Workspace: Print',
      action: 'workspacePrint',
      disabled: _state.workspaceMode === 'print',
    },
    {
      label: 'Workspace: Draw',
      action: 'workspaceDrawing',
      disabled: _state.workspaceMode === 'drawing',
    },
    {
      label: 'Workspace: Photo',
      action: 'workspaceImage',
      disabled: _state.workspaceMode === 'image',
    },
    {
      label: 'Workspace: Motion',
      action: 'workspaceMotion',
      disabled: _state.workspaceMode === 'motion',
    },
    {
      label: 'Reset Workspace to Default',
      action: 'resetWorkspace',
    },
    { label: '---' },
    {
      label: 'Distraction-Free Mode',
      shortcut: helpers.fmt('toggleDistractionFree'),
      ariaKeyshortcut: helpers.ks('toggleDistractionFree'),
      action: 'toggleDistractionFree',
    },
    {
      label: 'Compare Before/After',
      shortcut: helpers.fmt('toggleBeforeAfterCompare'),
      ariaKeyshortcut: helpers.ks('toggleBeforeAfterCompare'),
      action: 'toggleBeforeAfterCompare',
    },
    { label: '---' },
    {
      label: 'Color Blindness: None',
      action: 'colorBlindnessNone',
      shortcut: helpers.fmt('colorBlindnessNone'),
      ariaKeyshortcut: helpers.ks('colorBlindnessNone'),
    },
    {
      label: 'Color Blindness: Protanopia (red)',
      action: 'colorBlindnessProtanopia',
      shortcut: helpers.fmt('colorBlindnessProtanopia'),
      ariaKeyshortcut: helpers.ks('colorBlindnessProtanopia'),
    },
    {
      label: 'Color Blindness: Deuteranopia (green)',
      action: 'colorBlindnessDeuteranopia',
      shortcut: helpers.fmt('colorBlindnessDeuteranopia'),
      ariaKeyshortcut: helpers.ks('colorBlindnessDeuteranopia'),
    },
    {
      label: 'Color Blindness: Tritanopia (blue)',
      action: 'colorBlindnessTritanopia',
      shortcut: helpers.fmt('colorBlindnessTritanopia'),
      ariaKeyshortcut: helpers.ks('colorBlindnessTritanopia'),
    },
    { label: '---' },
    {
      label: 'Keyboard Shortcuts',
      shortcut: helpers.fmt('shortcutPalette'),
      ariaKeyshortcut: helpers.ks('shortcutPalette'),
      action: 'shortcutPalette',
    },
    {
      label: 'Home',
      shortcut: helpers.fmt('home'),
      ariaKeyshortcut: helpers.ks('home'),
      action: 'home',
    },
  ];
}
