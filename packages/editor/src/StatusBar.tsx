import { getActiveDesignCanvas, getImageFill, isImageShape } from '@varve/scene';
import { MAX_ZOOM, MIN_ZOOM } from '@varve/shared';
import { Icon, NumberInput, Select, Tooltip, TooltipProvider } from '@varve/ui';
import { Fragment, type ReactNode, useRef, useState, useSyncExternalStore } from 'react';
import { useDocumentAccent } from './appearance/useDocumentAccent';
import { AIStatusIndicator } from './components/AIStatusIndicator/AIStatusIndicator';
import { PreflightWarnings } from './components/PreflightWarnings';
import { DocumentInfoDialog } from './components/Shell';
import { CursorPositionReadout } from './components/StatusBar/CursorPositionReadout';
import { DocumentHealthBadge } from './components/StatusBar/DocumentHealthBadge';
import { SaveStatusIndicator } from './components/StatusBar/SaveStatusIndicator';
import { useEditor } from './context';
import { ShortcutTipChip } from './intelligence/ShortcutTipChip';
import { useShortcutTips } from './intelligence/useShortcutTips';
import {
  formatCompositorStatus,
  getCompositorDiagnosticsSnapshot,
  subscribeCompositorDiagnostics,
} from './render/compositorDiagnosticsStore';
import { isPublishingPageFitTarget } from './scene/activeWorkspace';
import { formatShortcut, getEffectiveBinding } from './shortcuts/ShortcutManager';
import { useEffectiveWorkspaceConfig } from './workspace/useWorkspaceConfig';
import { getVisibleStatusSections, type StatusSectionId } from './workspace/workspaceTypes';

interface StatusBarProps {
  onOpenPalette?: (shortcutId?: string) => void;
}

/**
 * Which half of the row a section belongs to.
 *
 * The status bar reads left-to-right as instrumentation, then blank space,
 * then controls. Section `order` therefore sorts *within* a cluster rather
 * than across the whole row: a section cannot be dragged onto the wrong side
 * of the boundary, and the boundary itself is a flex spacer rather than two
 * hand-placed dashes that marked nothing in particular.
 *
 * The record is exhaustive on purpose — adding a `StatusSectionId` without
 * deciding where it renders is a type error, not a silently orphaned section.
 */
const SECTION_CLUSTERS: Record<StatusSectionId, 'info' | 'control'> = {
  renderer: 'info',
  pageInfo: 'info',
  colorMode: 'info',
  imageInfo: 'info',
  cursorPos: 'info',
  preflight: 'info',
  documentHealth: 'info',
  saveStatus: 'info',
  shortcutTip: 'info',
  unit: 'control',
  viewToggles: 'control',
  zoom: 'control',
  fit: 'control',
};

function formatZoomPercent(zoom: number): string {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, safeZoom));
  return String(Math.round(clamped * 100 * 100) / 100);
}

function parseZoomPercent(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const percent = Number(trimmed);
  if (!Number.isFinite(percent) || percent <= 0) return null;
  return Math.min(MAX_ZOOM * 100, Math.max(MIN_ZOOM * 100, percent)) / 100;
}

function ZoomInput({ zoom, setZoom }: { zoom: number; setZoom: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const commit = (value: string) => {
    const nextZoom = parseZoomPercent(value);
    setDraft(null);
    if (nextZoom !== null) setZoom(nextZoom);
  };

  return (
    <input
      id="status-zoom"
      type="number"
      min={MIN_ZOOM * 100}
      max={MAX_ZOOM * 100}
      step={0.1}
      inputMode="decimal"
      value={draft ?? formatZoomPercent(zoom)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        cancelRef.current = false;
        setDraft((current) => current ?? formatZoomPercent(zoom));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelRef.current = true;
          setDraft(null);
          e.currentTarget.blur();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        if (cancelRef.current) {
          cancelRef.current = false;
          return;
        }
        commit(e.currentTarget.value);
      }}
      aria-label={`Zoom ${formatZoomPercent(zoom)}%`}
      className="editor-status__zoom-value"
    />
  );
}

export function StatusBar({ onOpenPalette }: StatusBarProps) {
  const {
    state,
    setZoom,
    setUnitType,
    setPixelGridEnabled,
    setSnapEnabled,
    setSnapGrid,
    setRulerMode,
    setGridOverlayMode,
    revealSelection,
    zoomIn,
    zoomOut,
    fitAll,
    fitActivePage,
    resetViewRotation,
    selectedNodes,
    clearAllGuides,
  } = useEditor();
  const effectiveConfig = useEffectiveWorkspaceConfig(state.workspaceMode);
  const fitsPage = isPublishingPageFitTarget(state.document, state.workspaceMode);
  const canvasRoot = state.document.nodes[getActiveDesignCanvas(state.document)?.contentRoot ?? ''];
  const canFitSurface = fitsPage
    ? state.document.pages?.some((page) => page.id === state.document.activePageId)
    : canvasRoot && 'children' in canvasRoot && canvasRoot.children.length > 0;
  // Publishes the active page surface to the opt-in document-accent
  // controller; inert unless appearance.accentSource is 'document'.
  useDocumentAccent(state.document, state.currentPageId);
  const compositorDiag = useSyncExternalStore(
    subscribeCompositorDiagnostics,
    getCompositorDiagnosticsSnapshot,
    () => null,
  );
  const rendererStatus = compositorDiag ? formatCompositorStatus(compositorDiag) : null;
  const sel = selectedNodes();
  const singleSel = sel.length === 1;

  const statusSectionIds = getVisibleStatusSections(state.workspaceMode, effectiveConfig);
  const { currentTip, dismiss } = useShortcutTips(
    state.workspaceMode,
    statusSectionIds.includes('shortcutTip'),
    effectiveConfig,
  );

  const sc = (id: string) => formatShortcut(getEffectiveBinding(id));

  // Page info: the active page's position and name (print work).
  const pages = state.document.pages ?? [];
  const pageIndex = state.currentPageId ? pages.findIndex((p) => p.id === state.currentPageId) : -1;
  const activePage = pageIndex >= 0 ? pages[pageIndex] : undefined;
  const pageInfoLabel = activePage
    ? `Page ${pageIndex + 1} of ${pages.length}${activePage.name ? ` · ${activePage.name}` : ''}`
    : '';

  // Color mode: the document's working color configuration (print, photo).
  const colorConfig = state.document.colorConfig;
  const colorModeLabel = colorConfig
    ? `${colorConfig.mode.toUpperCase()} · ${colorConfig.bitDepth}`
    : '';

  // Image info: natural source dimensions of a single selected raster node.
  let imageInfoLabel = '';
  if (singleSel) {
    const node = sel[0];
    if (node && isImageShape(node)) {
      const img = getImageFill(node as import('@varve/scene').ShapeNode)?.image;
      if (img?.imageWidth && img?.imageHeight) {
        imageInfoLabel = `${img.imageWidth} \u00d7 ${img.imageHeight} px`;
      }
    }
  }

  const rotated = state.cameraRotation !== 0;
  const rotationDegrees = Math.round((state.cameraRotation * 180) / Math.PI);
  const guides = state.document.guides ?? [];
  const showGridSpacing = state.snapEnabled || state.pixelGridEnabled;

  const sections: Partial<Record<StatusSectionId, ReactNode>> = {
    renderer: rendererStatus ? (
      <>
        <span
          className={`editor-status__meta ${rendererStatus.warning ? 'editor-status__meta--warning' : 'editor-status__diagnostic'}`}
          title={rendererStatus.detail}
        >
          {rendererStatus.label}
        </span>
        <span
          className="sr-only"
          role={rendererStatus.warning ? 'status' : undefined}
          aria-live={rendererStatus.warning ? 'polite' : undefined}
        >
          {rendererStatus.detail}
        </span>
      </>
    ) : null,

    pageInfo: pageInfoLabel ? <span className="editor-status__meta">{pageInfoLabel}</span> : null,
    colorMode: colorModeLabel ? (
      <span className="editor-status__meta">{colorModeLabel}</span>
    ) : null,
    imageInfo: imageInfoLabel ? (
      <span className="editor-status__meta">{imageInfoLabel}</span>
    ) : null,
    cursorPos: <CursorPositionReadout />,
    preflight: <PreflightWarnings />,
    documentHealth: <DocumentHealthBadge />,
    saveStatus: <SaveStatusIndicator />,
    shortcutTip: currentTip ? (
      <ShortcutTipChip
        tip={currentTip}
        onDismiss={dismiss}
        onOpenPalette={(id) => onOpenPalette?.(id)}
      />
    ) : null,

    unit: (
      <Select
        label="Units"
        value={state.unitType}
        options={[
          { value: 'px', label: 'px' },
          { value: 'pt', label: 'pt' },
          { value: 'cm', label: 'cm' },
          { value: 'mm', label: 'mm' },
          { value: 'in', label: 'in' },
          { value: '%', label: '%' },
        ]}
        onChange={(v) => setUnitType(v as typeof state.unitType)}
      />
    ),

    // The bar's view controls. They duplicate View-menu commands *deliberately*
    // — a toggle you flip while looking at the artwork should not require
    // three menu levels — but they are one configurable section, so a user who
    // works from shortcuts can remove the whole cluster from the row.
    viewToggles: (
      <span className="editor-status__view-group">
        <Tooltip label="Toggle pixel grid" shortcut={sc('togglePixelGrid')}>
          <button
            type="button"
            aria-pressed={state.pixelGridEnabled}
            onClick={() => setPixelGridEnabled(!state.pixelGridEnabled)}
            aria-label="Toggle pixel grid"
            className="editor-status__toggle"
          >
            <Icon name="Grid3x3" size={12} />
          </button>
        </Tooltip>
        <Tooltip
          label={state.snapEnabled ? 'Disable snapping' : 'Enable snapping'}
          shortcut={sc('toggleSnap')}
        >
          <button
            type="button"
            aria-pressed={state.snapEnabled}
            onClick={() => setSnapEnabled(!state.snapEnabled)}
            aria-label={state.snapEnabled ? 'Disable snapping' : 'Enable snapping'}
            className="editor-status__toggle"
          >
            <Icon name="Magnet" size={12} />
          </button>
        </Tooltip>
        {/* Labelled, and present only while it can affect something. The field
            used to be a bare number whose only name was an aria-label and whose
            value did nothing while snapping was off. */}
        {showGridSpacing && (
          <span className="editor-status__snap-grid">
            <span className="editor-status__snap-grid-label" aria-hidden="true">
              Grid
            </span>
            <NumberInput
              value={state.snapGrid}
              min={1}
              max={256}
              step={1}
              onChange={setSnapGrid}
              label="Grid spacing in pixels"
            />
          </span>
        )}
        <Tooltip label="Artboard ruler" shortcut={sc('toggleRulerMode')}>
          <button
            type="button"
            aria-pressed={state.rulerMode === 'artboard'}
            onClick={() => setRulerMode(state.rulerMode === 'artboard' ? 'global' : 'artboard')}
            aria-label="Toggle artboard ruler origin"
            className="editor-status__toggle"
          >
            {/* The old literal "AB" text was not guessable and sat out of
             * alignment with the icon toggles beside it. */}
            <Icon name="Ruler" size={12} />
          </button>
        </Tooltip>
        <Tooltip label="Baseline grid" shortcut={sc('gridOverlayBaseline')}>
          <button
            type="button"
            aria-pressed={state.gridOverlayMode === 'baseline'}
            onClick={() =>
              setGridOverlayMode(state.gridOverlayMode === 'baseline' ? 'none' : 'baseline')
            }
            aria-label="Toggle baseline grid overlay"
            className="editor-status__toggle"
          >
            <Icon name="AlignVerticalSpaceAround" size={12} />
          </button>
        </Tooltip>
        {guides.length > 0 && (
          <Tooltip label="Clear all guides">
            <button
              type="button"
              onClick={() => clearAllGuides()}
              aria-label="Clear all guides"
              className="editor-status__toggle"
            >
              <Icon name="RemoveFormatting" size={12} />
            </button>
          </Tooltip>
        )}
      </span>
    ),

    zoom: (
      <div className="editor-status__zoom-chip">
        <Tooltip label="Zoom out" shortcut={sc('zoomOut')}>
          <button
            type="button"
            onClick={zoomOut}
            aria-label="Zoom out"
            className="editor-status__toggle"
          >
            <Icon name="Minus" size={10} />
          </button>
        </Tooltip>
        <label htmlFor="status-zoom" className="sr-only">
          Zoom
        </label>
        <ZoomInput zoom={state.zoom} setZoom={setZoom} />
        <span aria-hidden>%</span>
        <Tooltip label="Zoom in" shortcut={sc('zoomIn')}>
          <button
            type="button"
            onClick={zoomIn}
            aria-label="Zoom in"
            className="editor-status__toggle"
          >
            <Icon name="Plus" size={10} />
          </button>
        </Tooltip>
      </div>
    ),

    fit: (
      <span className="editor-status__fit-group">
        <Tooltip
          label={
            canFitSurface
              ? fitsPage
                ? 'Fit page trim'
                : 'Fit canvas artwork'
              : fitsPage
                ? 'Add a publishing page to fit'
                : 'Add artwork to fit this unbounded canvas'
          }
          shortcut={sc('fitActivePage')}
        >
          <button
            type="button"
            onClick={fitActivePage}
            disabled={!canFitSurface}
            aria-label={fitsPage ? 'Fit active page' : 'Fit active canvas'}
            className="editor-status__fit-btn"
          >
            {fitsPage ? 'Fit page' : 'Fit canvas'}
          </button>
        </Tooltip>
        <Tooltip label="Fit all" shortcut={sc('fitAll')}>
          <button
            type="button"
            onClick={fitAll}
            aria-label="Fit all to viewport"
            className="editor-status__fit-btn"
          >
            Fit all
          </button>
        </Tooltip>
        {/* With nothing selected this control cannot do anything, so it is not
            rendered rather than sitting in the row inert. "Fit sel" was also
            the only user-visible abbreviation in the app. */}
        {sel.length > 0 && (
          <Tooltip label="Fit selection" shortcut={sc('fitSelection')}>
            <button
              type="button"
              onClick={() => revealSelection({ fit: true })}
              aria-label="Fit selection to viewport"
              className="editor-status__fit-btn"
            >
              Fit selection
            </button>
          </Tooltip>
        )}
      </span>
    ),
  };

  const sectionNodes = statusSectionIds
    .map((id) => ({ id, rendered: sections[id] }))
    .filter((entry) => entry.rendered !== null && entry.rendered !== undefined);
  const infoNodes = sectionNodes.filter((entry) => SECTION_CLUSTERS[entry.id] === 'info');
  const controlNodes = sectionNodes.filter((entry) => SECTION_CLUSTERS[entry.id] === 'control');

  return (
    <TooltipProvider>
      {/* Document Info renders from the status bar: a native <dialog> sits in
          the top layer, so DOM position is irrelevant and Shell.tsx (a hub
          file over its import budget) stays untouched. */}
      <DocumentInfoDialog />
      <div className="editor-status">
        {infoNodes.map((entry) => (
          <Fragment key={entry.id}>{entry.rendered}</Fragment>
        ))}
        <span className="editor-status__spacer" aria-hidden="true" />
        {/* Not a section: the chip exists only while the view is rotated, so
            there is no persistent surface to configure. It replaces the old
            pair of an anonymous degrees readout plus a separate
            "Reset rot" button with one labelled control that shows the angle
            and resets it. */}
        {rotated && (
          <Tooltip
            label={`View rotated ${rotationDegrees}°. Reset view rotation.`}
            shortcut={sc('resetViewRotation')}
          >
            <button
              type="button"
              onClick={() => resetViewRotation()}
              aria-label={`Reset view rotation (currently ${rotationDegrees} degrees)`}
              className="editor-status__rotation"
            >
              <Icon name="RotateCcw" size={12} />
              {rotationDegrees}°
            </button>
          </Tooltip>
        )}
        {controlNodes.map((entry) => (
          <Fragment key={entry.id}>{entry.rendered}</Fragment>
        ))}
        {/* Also not a section, for the same reason as the rotation chip: an
            on-device inference lease is transient state with nothing
            persistent to configure. It renders only while a job is queued or
            running — the idle pill it used to keep was a claim that is always
            true, i.e. decorative chrome. */}
        <AIStatusIndicator />
      </div>
    </TooltipProvider>
  );
}
