import {
  type AreaSelectionRefineOperation,
  combineAreaSelections,
  MAX_REFINE_RADIUS,
  maskArrayToDataUrl,
} from '@varve/engine';
import {
  type ForegroundProposalSet,
  mapProposalMaskToSource,
} from '@varve/engine/foregroundSelect';
import {
  downloadSubjectModel,
  listInstalledSubjectModels,
  proposeSubjects,
  resolveSubjectRuntimeCapabilities,
  type SubjectProposalQuality,
  subjectModelLabel,
} from '@varve/engine/subjectProposal';
import {
  buildParentIndexMap,
  fillCoverageOnNode,
  getImageFill,
  imageShapeSrc,
  isImageShape,
} from '@varve/scene';
import { Icon, Select, Tooltip } from '@varve/ui';
import { useRef, useState, useSyncExternalStore } from 'react';
import { getActionRegistry } from '../../actions/ActionRegistry';
import { commitRasterMask } from '../../backgroundRemoval/commitRasterMask';
import { getToolManager } from '../../canvas/toolDispatcher';
import { type ToolId, useEditor } from '../../context';
import { nodeWorldTransform } from '../../scene/world';
import type { SelectionPaintTool } from '../../tools/SelectionPaintTool';
import { deserializeAreaSelection, serializeAreaSelection } from '../../tools/savedAreaSelections';
import { selectionCoverageForRasterNode } from '../../tools/selectionCoverage';
import { areaSelectionFromMaskCoverage, decodeRasterMaskDataUrl } from '../../tools/selectionMask';
import { DisclosureSection } from './controls/DisclosureSection';
import { FieldRow } from './controls/FieldRow';
import { RangeValueControl } from './controls/RangeValueControl';
import { applySelectionRefine, SELECTION_REFINE_OPERATIONS } from './selectionRefineApply';
import {
  getSubjectProposalState,
  setSubjectProposalState,
  subscribeSubjectProposals,
} from './subjectProposalStore';

import './selectionSources.css';

/** Tools that build or refine pixel coverage, where these sources are the task at hand. */
const AREA_SELECTION_TOOLS = new Set<ToolId>([
  'marquee',
  'ellipseMarquee',
  'pixelLasso',
  'magicWand',
  'selectionPaint',
  'refineMask',
  'trimapEdit',
  'sam2Segment',
]);

const SUBJECT_QUALITY_OPTIONS = [
  { value: 'fast', label: 'Fast (bundled)' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'high', label: 'High quality' },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function runAction(id: string): void {
  getActionRegistry().get(id)?.handler(undefined);
}

export function SelectionSourcesPanel() {
  const {
    state,
    setAreaSelection,
    setTool,
    updateDoc,
    beginTransaction,
    commitTransaction,
    abortTransaction,
    commitAreaSelection,
    announce,
  } = useEditor();
  const saved = state.document.savedAreaSelections ?? [];
  const hasAreaSelection = Boolean(state.areaSelection);
  const [nextName, setNextName] = useState(`Selection ${saved.length + 1}`);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [refineOp, setRefineOp] = useState<AreaSelectionRefineOperation>('feather');
  const [refineAmount, setRefineAmount] = useState(2);
  const [refineSigma, setRefineSigma] = useState(2);
  const [refineThreshold, setRefineThreshold] = useState(0.5);
  const [refineContrast, setRefineContrast] = useState(0.6);
  const [refinePlacement, setRefinePlacement] = useState<'inside' | 'outside' | 'centered'>(
    'centered',
  );
  const [refineMinIsland, setRefineMinIsland] = useState(16);
  const [refineMaxHole, setRefineMaxHole] = useState(16);
  const [refineShift, setRefineShift] = useState(2);
  const [subjectQuality, setSubjectQuality] = useState<SubjectProposalQuality>('fast');
  const [activeSubjectCandidate, setActiveSubjectCandidate] = useState(0);
  const subjectDownloadRef = useRef<AbortController | null>(null);
  const subjectState = useSyncExternalStore(
    subscribeSubjectProposals,
    getSubjectProposalState,
    getSubjectProposalState,
  );
  const selectedNode =
    state.selection.length === 1 ? state.document.nodes[state.selection[0]!] : undefined;
  const hasClosedPath =
    selectedNode?.kind === 'path'
      ? selectedNode.closed
      : selectedNode?.kind === 'shape' && selectedNode.shape.kind === 'path'
        ? selectedNode.shape.closed
        : false;
  const hasImage = selectedNode?.kind === 'shape' && isImageShape(selectedNode);
  const selectedRasterCandidate =
    state.selection.length === 1 ? state.document.nodes[state.selection[0]!] : undefined;
  const selectedRasterNode =
    selectedRasterCandidate?.kind === 'rasterLayer' ? selectedRasterCandidate : undefined;
  const paintingSelection = state.tool === 'selectionPaint';
  const subjectTarget = selectedNode
    ? { documentId: state.document.id, nodeId: selectedNode.id }
    : null;
  const subjectProposalSet =
    subjectState.proposals &&
    subjectTarget &&
    subjectState.target?.documentId === subjectTarget.documentId &&
    subjectState.target.nodeId === subjectTarget.nodeId
      ? subjectState.proposals
      : null;
  const subjectProposalBusy = subjectState.busy && subjectTarget !== null;

  const fillDisabledReason = !hasAreaSelection
    ? 'Create a pixel selection first'
    : !selectedRasterNode
      ? 'Select one visible, unlocked pixel layer as the output target'
      : selectedRasterNode.visible === false
        ? 'Show the selected pixel layer before filling it'
        : selectedRasterNode.locked
          ? 'Unlock the selected pixel layer before filling it'
          : undefined;

  const fillSelection = () => {
    const selection = state.areaSelection;
    const target = selectedRasterNode;
    if (!selection || !target) {
      announce(fillDisabledReason ?? 'Select a pixel layer and make a selection first');
      return;
    }
    const coverage = selectionCoverageForRasterNode(
      selection,
      { width: target.width, height: target.height },
      nodeWorldTransform(state.document, target.id, buildParentIndexMap(state.document)),
    );
    if (!coverage) {
      announce('The selection is too large or cannot be mapped to this pixel layer');
      return;
    }
    const color = [...state.foregroundColor] as [number, number, number, number];
    const preview = fillCoverageOnNode(target, coverage, color);
    if (preview === target) {
      announce('Selection did not cover any pixels');
      return;
    }
    beginTransaction();
    try {
      updateDoc((doc) => {
        const current = doc.nodes[target.id];
        if (current?.kind !== 'rasterLayer' || current.locked || current.visible === false) {
          return doc;
        }
        const filled = fillCoverageOnNode(current, coverage, color);
        return filled === current ? doc : { ...doc, nodes: { ...doc.nodes, [target.id]: filled } };
      });
      commitTransaction();
      announce(`Selection filled on ${target.name}`);
    } catch (error) {
      abortTransaction();
      announce(error instanceof Error ? error.message : 'Could not fill the selection');
    }
  };

  const cancelPaint = () => {
    const tool = getToolManager().getTool<SelectionPaintTool>('selectionPaint');
    setAreaSelection?.(tool?.getOriginalSelection() ?? null);
    setTool('select');
    announce('Selection paint cancelled');
  };

  const applySubjectCandidate = (result: ForegroundProposalSet, index: number) => {
    const candidate = result.candidates[index];
    if (!candidate || selectedNode?.kind !== 'shape' || !isImageShape(selectedNode)) return;
    const sourceMask = mapProposalMaskToSource(
      candidate.mask,
      result.analysisWidth,
      result.analysisHeight,
      result.width,
      result.height,
    );
    if (!sourceMask) {
      announce('The subject estimate could not be mapped to the image');
      return;
    }
    const selection = areaSelectionFromMaskCoverage(
      state.document,
      selectedNode.id,
      sourceMask,
      result.width,
      result.height,
      'source-image-pixels',
    );
    if (!selection) {
      announce('The subject estimate could not be converted into a selection');
      return;
    }
    setAreaSelection?.(selection);
    setActiveSubjectCandidate(index);
    const providerLabel = getSubjectProposalState().provider?.label ?? 'Foreground';
    announce(`${candidate.label ?? `Subject ${index + 1}`} selected (${providerLabel} estimate)`);
  };

  const selectSubject = async () => {
    if (selectedNode?.kind !== 'shape' || !isImageShape(selectedNode)) {
      announce('Select one image to find a subject');
      return;
    }
    const image = getImageFill(selectedNode)?.image;
    const source = image?.assetId
      ? (state.document.assets?.[image.assetId]?.dataUrl ?? image.src)
      : image?.src;
    if (!image || !source) {
      announce('The image source is unavailable');
      return;
    }
    const target = { documentId: state.document.id, nodeId: selectedNode.id };
    setSubjectProposalState({
      target,
      proposals: null,
      provider: null,
      install: null,
      busy: true,
      stage: 'preparing',
      error: null,
      downloadProgress: null,
    });
    try {
      setSubjectProposalState({ stage: 'estimating' });
      const decoded = await decodeRasterMaskDataUrl(source);
      if (!decoded) {
        const message = 'The image could not be decoded for subject selection';
        setSubjectProposalState({ busy: false, stage: 'idle', error: message });
        announce(message);
        return;
      }
      const [runtime, installedModelIds] = await Promise.all([
        resolveSubjectRuntimeCapabilities(),
        listInstalledSubjectModels(),
      ]);
      const imageData = new ImageData(
        new Uint8ClampedArray(decoded.data),
        decoded.width,
        decoded.height,
      );
      const result = await proposeSubjects({
        quality: subjectQuality,
        imageData,
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        installedModelIds,
        runtime,
        allowModelFreeFallback: true,
      });
      if (result.set.candidates.length === 0) {
        const message =
          result.set.emptyReason === 'all-transparent'
            ? 'The image has no visible pixels to select'
            : 'No prominent foreground subject was found; use Magic Wand or Object Selection instead';
        setSubjectProposalState({
          proposals: null,
          provider: null,
          install: result.plan.install ?? null,
          busy: false,
          stage: 'idle',
          error: message,
        });
        announce(message);
        return;
      }
      const chosen = result.plan.attempts.find((attempt) => attempt.modelId === result.source);
      setSubjectProposalState({
        proposals: result.set,
        provider: {
          source: result.source,
          label: subjectModelLabel(result.source),
          modelId: result.modelId,
          quality: subjectQuality,
          steppedDown: result.source !== 'model-free' && Boolean(chosen?.steppedDown),
          failed: result.attempts
            .filter((attempt) => attempt.outcome === 'failed')
            .map((attempt) => ({
              modelId: attempt.modelId,
              reason: attempt.reason ?? 'the model could not run',
            })),
        },
        install: result.plan.install ?? null,
        busy: false,
        stage: 'idle',
        downloadProgress: null,
        error: null,
      });
      setActiveSubjectCandidate(0);
      // One click should produce a usable result. The top-ranked proposal is
      // applied immediately and every alternative stays one click away.
      applySubjectCandidate(result.set, 0);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Subject selection could not complete';
      setSubjectProposalState({ busy: false, stage: 'idle', error: message });
      announce(message);
    }
  };

  const installProposalModel = async () => {
    const offer = getSubjectProposalState().install;
    if (!offer) return;
    const controller = new AbortController();
    subjectDownloadRef.current = controller;
    setSubjectProposalState({
      busy: true,
      stage: 'downloading',
      downloadProgress: 0,
      error: null,
    });
    try {
      await downloadSubjectModel(
        offer.modelId,
        (loaded, total) => {
          setSubjectProposalState({
            downloadProgress: total > 0 ? Math.max(0, Math.min(1, loaded / total)) : null,
          });
        },
        controller.signal,
      );
      setSubjectProposalState({
        install: null,
        busy: false,
        stage: 'idle',
        downloadProgress: null,
      });
      announce(`${offer.displayName} installed`);
      await selectSubject();
    } catch {
      const message = controller.signal.aborted
        ? 'Model download cancelled'
        : `Could not install ${offer.displayName}. Check the connection and try again.`;
      setSubjectProposalState({
        busy: false,
        stage: 'idle',
        downloadProgress: null,
        error: message,
      });
      announce(message);
    } finally {
      subjectDownloadRef.current = null;
    }
  };

  const cancelProposalDownload = () => {
    subjectDownloadRef.current?.abort();
  };

  const applySubjectAsMask = () => {
    const result = subjectProposalSet;
    if (!result || selectedNode?.kind !== 'shape' || !isImageShape(selectedNode)) return;
    const candidate = result.candidates[activeSubjectCandidate];
    if (!candidate) return;
    const sourceMask = mapProposalMaskToSource(
      candidate.alpha ?? candidate.mask,
      result.analysisWidth,
      result.analysisHeight,
      result.width,
      result.height,
    );
    if (!sourceMask?.some((value) => value > 0)) {
      announce('The subject estimate contains no pixels to apply');
      return;
    }
    const provider = getSubjectProposalState().provider;
    const nodeId = selectedNode.id;
    const modelId = provider?.modelId ?? 'foreground-estimate';
    const method: 'quick' | 'ai-balanced' | 'ai-quality' =
      provider?.source === 'birefnet-general-lite'
        ? 'ai-quality'
        : provider && provider.source !== 'model-free'
          ? 'ai-balanced'
          : 'quick';
    const dataUrl = maskArrayToDataUrl(sourceMask, result.width, result.height);
    const sourceLocator = imageShapeSrc(selectedNode);
    // Mirror the reviewed-candidate Object Selection commit with one document
    // updater. The editor's mutation boundary records this as one edit.
    try {
      updateDoc((doc) => {
        const live = doc.nodes[nodeId];
        if (live?.kind !== 'shape') return doc;
        return commitRasterMask(doc, nodeId, {
          dataUrl,
          width: result.width,
          height: result.height,
          method,
          modelId,
          confidence: candidate.score,
          generatedAt: Date.now(),
          sourceLocator,
        });
      });
      announce(`${candidate.label ?? 'Subject'} applied as a mask`);
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Could not apply the subject mask');
    }
  };

  const applyAllSubjectProposals = () => {
    const result = subjectProposalSet;
    if (!result || selectedNode?.kind !== 'shape' || !isImageShape(selectedNode)) return;
    const union = new Uint8Array(result.width * result.height);
    for (const candidate of result.candidates) {
      const sourceMask = mapProposalMaskToSource(
        candidate.mask,
        result.analysisWidth,
        result.analysisHeight,
        result.width,
        result.height,
      );
      if (!sourceMask) continue;
      for (let index = 0; index < union.length; index += 1) {
        if (sourceMask[index] !== 0) union[index] = 255;
      }
    }
    const selection = areaSelectionFromMaskCoverage(
      state.document,
      selectedNode.id,
      union,
      result.width,
      result.height,
      'source-image-pixels',
    );
    if (!selection) {
      announce('The subject estimate could not be converted into a selection');
      return;
    }
    setAreaSelection?.(selection);
    announce(`All ${result.candidates.length} proposals selected`);
  };

  const applyRefine = () => {
    applySelectionRefine(
      {
        areaSelection: state.areaSelection ?? null,
        commit: commitAreaSelection,
        set: setAreaSelection,
        announce,
      },
      {
        operation: refineOp,
        amount: refineOp === 'shift-edge' ? refineShift : refineAmount,
        sigma: refineSigma,
        threshold: refineThreshold,
        contrast: refineContrast,
        placement: refinePlacement,
        minIslandArea: refineMinIsland,
        maxHoleArea: refineMaxHole,
      },
    );
  };

  const remove = (id: string) => {
    updateDoc((doc) => ({
      ...doc,
      savedAreaSelections: (doc.savedAreaSelections ?? []).filter((item) => item.id !== id),
    }));
    announce('Saved area selection deleted');
  };

  const createId = (prefix: string): string =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${prefix}-${Date.now()}-${saved.length}`;

  const saveCurrent = () => {
    const selection = state.areaSelection;
    const name = nextName.trim().slice(0, 256);
    if (!selection || !name) {
      announce('Enter a name and make a pixel selection before saving it');
      return;
    }
    updateDoc((doc) => ({
      ...doc,
      savedAreaSelections: [
        ...(doc.savedAreaSelections ?? []),
        {
          id: createId('saved-area'),
          name,
          pageId: doc.activePageId,
          selection: serializeAreaSelection(selection),
          createdAt: Date.now(),
        },
      ],
    }));
    setNextName(`Selection ${saved.length + 2}`);
    announce(`Saved area selection as ${name}`);
  };

  const applySaved = (
    item: (typeof saved)[number],
    operation: 'replace' | 'add' | 'subtract' | 'intersect',
  ) => {
    const selection = deserializeAreaSelection(item);
    if (!selection || !setAreaSelection) {
      announce('The saved area selection is invalid');
      return;
    }
    const next =
      operation === 'replace'
        ? selection
        : combineAreaSelections(
            state.areaSelection ?? null,
            selection,
            operation,
            Math.max(state.areaSelection?.generation ?? 0, selection.generation) + 1,
          );
    if (!next) {
      announce(`Could not ${operation} ${item.name}`);
      return;
    }
    setAreaSelection({
      ...next,
      generation: Math.max(next.generation, state.areaSelection?.generation ?? 0) + 1,
    });
    const verb =
      operation === 'replace'
        ? 'Loaded'
        : operation === 'add'
          ? 'Added'
          : operation === 'subtract'
            ? 'Subtracted'
            : 'Intersected';
    announce(operation === 'replace' ? `Loaded ${item.name}` : `${verb} ${item.name}`);
  };

  const beginRename = (item: (typeof saved)[number]) => {
    setRenamingId(item.id);
    setRenameValue(item.name);
  };

  const commitRename = (id: string) => {
    const name = renameValue.trim().slice(0, 256);
    if (!name) {
      announce('Saved selection names cannot be empty');
      return;
    }
    updateDoc((doc) => ({
      ...doc,
      savedAreaSelections: (doc.savedAreaSelections ?? []).map((item) =>
        item.id === id ? { ...item, name } : item,
      ),
    }));
    setRenamingId(null);
    announce(`Renamed saved selection to ${name}`);
  };

  const duplicate = (item: (typeof saved)[number]) => {
    const copyName = `${item.name} copy`;
    updateDoc((doc) => ({
      ...doc,
      savedAreaSelections: [
        ...(doc.savedAreaSelections ?? []),
        { ...item, id: createId('saved-area-copy'), name: copyName, createdAt: Date.now() },
      ],
    }));
    announce(`Duplicated ${item.name}`);
  };

  // Every command here needs a pixel selection, saved selections, a closed
  // path, or an image. Without one the section is a stack of disabled
  // buttons, so it stays out of the Inspector until it can act.
  const canAct =
    hasAreaSelection ||
    paintingSelection ||
    saved.length > 0 ||
    hasClosedPath ||
    hasImage ||
    AREA_SELECTION_TOOLS.has(state.tool);
  if (!canAct) return null;

  return (
    <DisclosureSection title="Selection Sources" id="selection-sources" defaultExpanded={false}>
      <div className="insp-selection-sources" data-testid="selection-sources-panel">
        <p className="insp-selection-sources__description">
          Build, refine, reuse, and convert document-space coverage without changing layer
          selection.
        </p>
        <div className="insp-selection-sources__actions">
          <button
            type="button"
            className="insp-selection-sources__button insp-selection-sources__button--primary"
            disabled={!hasAreaSelection}
            onClick={() => setTool('selectionPaint')}
          >
            Paint selection
          </button>
          <Tooltip label="Fill active selection" disabledReason={fillDisabledReason}>
            <button
              type="button"
              className="insp-selection-sources__button insp-selection-sources__button--primary"
              disabled={Boolean(fillDisabledReason)}
              onClick={fillSelection}
            >
              Fill pixel layer
            </button>
          </Tooltip>
          <Tooltip
            label="Path to selection"
            disabledReason={
              !hasClosedPath ? 'Select one closed path to use this command' : undefined
            }
          >
            <button
              type="button"
              className="insp-selection-sources__button"
              disabled={!hasClosedPath}
              onClick={() => runAction('pathToSelection')}
            >
              Path to selection
            </button>
          </Tooltip>
          <button
            type="button"
            className="insp-selection-sources__button"
            disabled={!hasAreaSelection}
            onClick={() => runAction('selectionToPath')}
          >
            Selection to path
          </button>
          <Tooltip
            label="Image alpha"
            disabledReason={!hasImage ? 'Select one image to use this command' : undefined}
          >
            <button
              type="button"
              className="insp-selection-sources__button"
              disabled={!hasImage}
              onClick={() => runAction('selectFromImageAlpha')}
            >
              Image alpha
            </button>
          </Tooltip>
          <Tooltip
            label="Magic wand"
            disabledReason={!hasImage ? 'Select one image to use this command' : undefined}
          >
            <button
              type="button"
              className="insp-selection-sources__button"
              disabled={!hasImage}
              onClick={() => runAction('selectFromImageColorRange')}
            >
              Magic wand
            </button>
          </Tooltip>
          <Tooltip
            label="Luminance"
            disabledReason={!hasImage ? 'Select one image to use this command' : undefined}
          >
            <button
              type="button"
              className="insp-selection-sources__button"
              disabled={!hasImage}
              onClick={() => runAction('selectFromImageLuminance')}
            >
              Luminance
            </button>
          </Tooltip>
          <Tooltip
            label="Select subject (foreground estimate)"
            disabledReason={!hasImage ? 'Select one image to use this command' : undefined}
          >
            <button
              type="button"
              className="insp-selection-sources__button insp-selection-sources__button--primary"
              disabled={!hasImage || subjectProposalBusy}
              onClick={() => void selectSubject()}
            >
              {subjectState.stage === 'preparing'
                ? 'Preparing image…'
                : subjectState.stage === 'estimating'
                  ? 'Estimating subject…'
                  : subjectState.stage === 'downloading'
                    ? 'Downloading model…'
                    : subjectProposalBusy
                      ? 'Finding subjects…'
                      : 'Select subject'}
            </button>
          </Tooltip>
          <FieldRow label="Estimate quality">
            <Select
              label="Subject estimate quality"
              value={subjectQuality}
              options={SUBJECT_QUALITY_OPTIONS}
              onChange={(value) => setSubjectQuality(value as SubjectProposalQuality)}
            />
          </FieldRow>
          <label className="insp-selection-sources__name-field">
            <span>Name</span>
            <input
              value={nextName}
              maxLength={256}
              onChange={(event) => setNextName(event.target.value)}
              aria-label="Saved selection name"
            />
          </label>
          <button
            type="button"
            className="insp-selection-sources__button insp-selection-sources__button--primary"
            disabled={!hasAreaSelection || nextName.trim().length === 0}
            onClick={saveCurrent}
          >
            Save selection
          </button>
        </div>
        {subjectState.install && subjectState.stage !== 'downloading' && (
          <section className="insp-selection-sources__session" aria-label="Optional subject model">
            <span className="insp-selection-sources__session-label">
              Higher-quality estimates need an optional local model
            </span>
            <p className="insp-field__hint">
              {subjectState.install.displayName} ({formatBytes(subjectState.install.downloadBytes)})
              downloads once, is verified against its checksum, and stays on this device. The
              bundled fast model still works without it.
            </p>
            <div className="insp-selection-sources__session-actions">
              <button
                type="button"
                className="insp-selection-sources__button insp-selection-sources__button--primary"
                disabled={subjectProposalBusy}
                onClick={() => void installProposalModel()}
              >
                Download {subjectState.install.displayName}
              </button>
            </div>
          </section>
        )}
        {subjectState.stage === 'downloading' && (
          <section className="insp-selection-sources__session" aria-label="Subject model download">
            <span className="insp-selection-sources__session-label">
              {subjectState.downloadProgress !== null
                ? `Downloading model… ${Math.round(subjectState.downloadProgress * 100)}%`
                : 'Downloading model…'}
            </span>
            <div className="insp-selection-sources__session-actions">
              <button
                type="button"
                className="insp-selection-sources__button"
                onClick={cancelProposalDownload}
              >
                Cancel
              </button>
            </div>
          </section>
        )}
        {subjectState.error && (
          <p className="insp-selection-sources__error" role="status">
            {subjectState.error}
          </p>
        )}
        {subjectProposalSet && subjectProposalSet.candidates.length > 0 && (
          <section className="insp-selection-sources__session" aria-label="Subject proposals">
            <span className="insp-selection-sources__session-label">
              {subjectState.provider
                ? `${subjectState.provider.label} estimate`
                : 'Foreground estimate'}{' '}
              {subjectProposalSet.candidates.length}{' '}
              {subjectProposalSet.candidates.length === 1 ? 'proposal' : 'proposals'}
            </span>
            {subjectState.provider && (
              <p className="insp-field__hint">
                {subjectState.provider.source === 'model-free'
                  ? 'The model-free estimate uses border and centre contrast. It cannot recognise what an object is; use Object Selection for a prompted mask.'
                  : subjectState.provider.steppedDown
                    ? `The requested ${subjectState.provider.quality} model could not run; this proposal came from ${subjectState.provider.label} instead.`
                    : `On-device ${subjectState.provider.quality} estimate from ${subjectState.provider.label}. Review it before applying.`}
                {subjectState.provider.failed.length > 0 &&
                  ` Skipped: ${subjectState.provider.failed
                    .map((failure) => `${failure.modelId} (${failure.reason})`)
                    .join('; ')}.`}
              </p>
            )}
            <div className="insp-selection-sources__session-actions">
              {subjectProposalSet.candidates.map((candidate, index) => (
                <button
                  key={`subject-${candidate.centroid.x.toFixed(4)}-${candidate.centroid.y.toFixed(4)}-${candidate.score.toFixed(4)}`}
                  type="button"
                  className={`insp-selection-sources__button${
                    index === activeSubjectCandidate
                      ? ' insp-selection-sources__button--active'
                      : ''
                  }`}
                  aria-pressed={index === activeSubjectCandidate}
                  aria-label={`${candidate.label ?? `Subject ${index + 1}`}, covers ${Math.round(candidate.coverage * 100)} percent`}
                  onClick={() => applySubjectCandidate(subjectProposalSet, index)}
                >
                  {candidate.label ?? `Subject ${index + 1}`} ·{' '}
                  {Math.round(candidate.coverage * 100)}% area
                </button>
              ))}
              {subjectState.provider?.source === 'model-free' && (
                <button
                  type="button"
                  className="insp-selection-sources__button"
                  onClick={applyAllSubjectProposals}
                >
                  All subjects
                </button>
              )}
            </div>
            <div className="insp-selection-sources__session-actions">
              <button
                type="button"
                className="insp-selection-sources__button insp-selection-sources__button--primary"
                onClick={applySubjectAsMask}
              >
                Apply as mask
              </button>
              <button
                type="button"
                className="insp-selection-sources__button"
                onClick={() =>
                  setSubjectProposalState({
                    proposals: null,
                    provider: null,
                    install: null,
                    error: null,
                  })
                }
              >
                Dismiss
              </button>
            </div>
            <p className="insp-field__hint">
              The active candidate is applied as a pixel selection; refine it below before applying
              it as a mask. Estimates are proposals, not semantic recognition.
            </p>
          </section>
        )}
        {paintingSelection && (
          <section
            className="insp-selection-sources__session"
            aria-label="Selection paint controls"
          >
            <span className="insp-selection-sources__session-label">Quick-mask editing</span>
            <div className="insp-selection-sources__session-actions">
              <button
                type="button"
                className="insp-selection-sources__button insp-selection-sources__button--primary"
                onClick={() => {
                  setTool('select');
                  announce('Selection paint applied');
                }}
              >
                Apply
              </button>
              <button
                type="button"
                className="insp-selection-sources__button"
                onClick={cancelPaint}
              >
                Cancel
              </button>
            </div>
          </section>
        )}
        {hasAreaSelection && (
          <section
            className="insp-selection-sources__session"
            aria-label="Refine selection controls"
          >
            <span className="insp-selection-sources__session-label">Refine selection</span>
            <div className="insp-selection-sources__refine-grid">
              <FieldRow label="Operation">
                <Select
                  label="Refine operation"
                  value={refineOp}
                  options={SELECTION_REFINE_OPERATIONS}
                  onChange={(value) => setRefineOp(value as AreaSelectionRefineOperation)}
                />
              </FieldRow>
              {(refineOp === 'feather' || refineOp === 'smooth') && (
                <RangeValueControl
                  id="selection-refine-sigma"
                  label={refineOp === 'smooth' ? 'Smooth radius' : 'Feather radius'}
                  value={refineSigma}
                  min={0}
                  max={128}
                  step={0.5}
                  unit="px"
                  rangeClassName="insp-range"
                  rangeAriaLabel="Refinement radius in document units"
                  onChange={setRefineSigma}
                />
              )}
              {(refineOp === 'grow' || refineOp === 'shrink' || refineOp === 'border') && (
                <RangeValueControl
                  id="selection-refine-amount"
                  label="Amount"
                  value={refineAmount}
                  min={0}
                  max={MAX_REFINE_RADIUS}
                  unit="px"
                  rangeClassName="insp-range"
                  rangeAriaLabel="Refinement amount in document units"
                  onChange={setRefineAmount}
                />
              )}
              {refineOp === 'shift-edge' && (
                <RangeValueControl
                  id="selection-refine-shift"
                  label="Shift"
                  value={refineShift}
                  min={-64}
                  max={64}
                  unit="px"
                  rangeClassName="insp-range"
                  rangeAriaLabel="Boundary shift in document units; positive expands"
                  onChange={setRefineShift}
                />
              )}
              {refineOp === 'contrast' && (
                <RangeValueControl
                  id="selection-refine-contrast"
                  label="Contrast"
                  value={refineContrast}
                  min={0}
                  max={1}
                  step={0.05}
                  displayScale={100}
                  unit="%"
                  rangeClassName="insp-range"
                  rangeAriaLabel="Coverage contrast; 100% removes grey"
                  onChange={setRefineContrast}
                />
              )}
              {refineOp === 'threshold' && (
                <RangeValueControl
                  id="selection-refine-threshold"
                  label="Cut"
                  value={refineThreshold}
                  min={0}
                  max={1}
                  step={0.05}
                  displayScale={100}
                  unit="%"
                  rangeClassName="insp-range"
                  rangeAriaLabel="Coverage cut for threshold"
                  onChange={setRefineThreshold}
                />
              )}
              {refineOp === 'border' && (
                <FieldRow label="Placement">
                  <Select
                    label="Border placement"
                    value={refinePlacement}
                    options={[
                      { value: 'inside', label: 'Inside' },
                      { value: 'outside', label: 'Outside' },
                      { value: 'centered', label: 'Centered' },
                    ]}
                    onChange={(value) =>
                      setRefinePlacement(value as 'inside' | 'outside' | 'centered')
                    }
                  />
                </FieldRow>
              )}
              {refineOp === 'cleanup' && (
                <>
                  <RangeValueControl
                    id="selection-refine-island"
                    label="Remove islands under"
                    value={refineMinIsland}
                    min={0}
                    max={4096}
                    unit="px"
                    rangeClassName="insp-range"
                    rangeAriaLabel="Remove islands smaller than this area"
                    onChange={setRefineMinIsland}
                  />
                  <RangeValueControl
                    id="selection-refine-hole"
                    label="Fill holes under"
                    value={refineMaxHole}
                    min={0}
                    max={4096}
                    unit="px"
                    rangeClassName="insp-range"
                    rangeAriaLabel="Fill holes smaller than this area"
                    onChange={setRefineMaxHole}
                  />
                </>
              )}
            </div>
            <div className="insp-selection-sources__session-actions">
              <button
                type="button"
                className="insp-selection-sources__button insp-selection-sources__button--primary"
                onClick={applyRefine}
              >
                Apply operation
              </button>
            </div>
            <p className="insp-selection-sources__description">
              Marching ants trace the 50% coverage contour; pixels outside the outline can still be
              partially selected. Each Apply is one undoable operation computed from the current
              selection.
            </p>
          </section>
        )}
        {saved.length > 0 ? (
          <section className="insp-selection-sources__saved" aria-label="Saved area selections">
            <p className="insp-selection-sources__saved-title">Saved selections</p>
            {saved.map((item) => (
              <div className="insp-selection-sources__saved-row" key={item.id}>
                {renamingId === item.id ? (
                  <input
                    className="insp-selection-sources__rename-input"
                    value={renameValue}
                    maxLength={256}
                    aria-label={`Rename ${item.name}`}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename(item.id);
                      if (event.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <Tooltip label={`Select ${item.name}`} truncationOnly>
                    <button
                      type="button"
                      className="insp-selection-sources__saved-name"
                      onClick={() => applySaved(item, 'replace')}
                    >
                      {item.name}
                    </button>
                  </Tooltip>
                )}
                <div className="insp-selection-sources__saved-actions">
                  {renamingId === item.id ? (
                    <button
                      type="button"
                      className="insp-selection-sources__saved-action"
                      aria-label={`Save name for ${item.name}`}
                      onClick={() => commitRename(item.id)}
                    >
                      <Icon name="Check" size={13} />
                    </button>
                  ) : (
                    <>
                      <Tooltip label="Add to selection">
                        <button
                          type="button"
                          className="insp-selection-sources__saved-action"
                          aria-label={`Add ${item.name}`}
                          onClick={() => applySaved(item, 'add')}
                        >
                          +
                        </button>
                      </Tooltip>
                      <Tooltip label="Subtract from selection">
                        <button
                          type="button"
                          className="insp-selection-sources__saved-action"
                          aria-label={`Subtract ${item.name}`}
                          onClick={() => applySaved(item, 'subtract')}
                        >
                          −
                        </button>
                      </Tooltip>
                      <Tooltip label="Intersect with selection">
                        <button
                          type="button"
                          className="insp-selection-sources__saved-action"
                          aria-label={`Intersect ${item.name}`}
                          onClick={() => applySaved(item, 'intersect')}
                        >
                          ∩
                        </button>
                      </Tooltip>
                      <Tooltip label="Rename">
                        <button
                          type="button"
                          className="insp-selection-sources__saved-action"
                          aria-label={`Rename ${item.name}`}
                          onClick={() => beginRename(item)}
                        >
                          <Icon name="Pencil" size={13} />
                        </button>
                      </Tooltip>
                      <Tooltip label="Duplicate">
                        <button
                          type="button"
                          className="insp-selection-sources__saved-action"
                          aria-label={`Duplicate ${item.name}`}
                          onClick={() => duplicate(item)}
                        >
                          <Icon name="Copy" size={13} />
                        </button>
                      </Tooltip>
                      <Tooltip label="Delete">
                        <button
                          type="button"
                          className="insp-selection-sources__saved-action"
                          aria-label={`Delete ${item.name}`}
                          onClick={() => remove(item.id)}
                        >
                          <Icon name="Trash2" size={13} />
                        </button>
                      </Tooltip>
                    </>
                  )}
                </div>
              </div>
            ))}
          </section>
        ) : (
          <p className="insp-selection-sources__empty">No saved selections yet.</p>
        )}
      </div>
    </DisclosureSection>
  );
}
