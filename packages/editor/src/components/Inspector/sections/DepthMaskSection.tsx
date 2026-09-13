import type { DepthHistogram, DepthMap, DepthMapResource } from '@varve/engine';
import { alignDepthMapToSource, depthToHeatmapImageData, sampleDepth } from '@varve/engine';
import type {
  DepthMaskRecipe,
  Document,
  RasterMaskAsset,
  SceneNode,
  ShapeNode,
} from '@varve/scene';
import { cryptoId, imageShapeSrc, isImageShape, resolveNodePaints } from '@varve/scene';
import { Button, NativeSelect, Switch } from '@varve/ui';
import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { commitRasterMask } from '../../../backgroundRemoval/commitRasterMask';
import { useEditor } from '../../../context';
import {
  combineDepthCoverage,
  coverageToRgba,
  decodeDepthResource,
  depthCoverageForRecipe,
  depthMapHistogram,
  makeDepthMaskRecipe,
} from '../../../depth/depthMaskWorkflow';
import { containDepthPreview, depthPreviewPointToMap } from '../../../depth/depthPreviewLayout';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { RangeValueControl } from '../controls/RangeValueControl';
import '../../../depth/depthMask.css';

const MAX_IMPORT_BYTES = 128 * 1024 * 1024;

interface SourceInfo {
  locator: string;
  fillAssetId?: string;
  sourceHash?: string;
  width: number;
  height: number;
}

interface DepthCandidate {
  resource: DepthMapResource;
  compatible: boolean;
  reason?: string;
}

interface MaskRangeState {
  near: number;
  far: number;
  nearTransition: number;
  farTransition: number;
  invert: boolean;
  combine: DepthMaskRecipe['combine'];
}

function sourceInfo(doc: Document, node: ShapeNode): SourceInfo {
  const image = resolveNodePaints(
    node as unknown as Parameters<typeof resolveNodePaints>[0],
    doc,
  ).find((fill) => fill.type === 'image')?.image;
  const asset = image?.assetId ? doc.assets?.[image.assetId] : undefined;
  return {
    locator: image?.src ?? imageShapeSrc(node),
    ...(image?.assetId ? { fillAssetId: image.assetId } : {}),
    ...(asset?.hash ? { sourceHash: asset.hash } : {}),
    width: image?.imageWidth ?? asset?.naturalWidth ?? 0,
    height: image?.imageHeight ?? asset?.naturalHeight ?? 0,
  };
}

function candidatesForSource(
  doc: Document,
  target: SceneNode,
  sourceNode: SceneNode,
  source: SourceInfo,
): DepthCandidate[] {
  const recipeMapId = target.mask?.rasterMask?.depthRecipe?.depthMapId;
  const effectMapIds =
    'effects' in sourceNode
      ? (sourceNode.effects ?? [])
          .filter((effect) => effect.type === 'depthBlur')
          .map((effect) => effect.depthMapId)
      : [];
  const orderedIds = [recipeMapId, ...effectMapIds, ...Object.keys(doc.depthMaps ?? {})].filter(
    (id): id is string => Boolean(id),
  );
  const seen = new Set<string>();
  const result: DepthCandidate[] = [];
  for (const id of orderedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const resource = doc.depthMaps?.[id];
    if (!resource) continue;
    const dimensionsMatch = resource.width === source.width && resource.height === source.height;
    const registeredSourceMatch =
      resource.registration?.sourceWidth === source.width &&
      resource.registration?.sourceHeight === source.height;
    const alignmentMatch = dimensionsMatch || registeredSourceMatch;
    const assetMatch =
      !resource.sourceAssetId ||
      Boolean(source.fillAssetId && resource.sourceAssetId === source.fillAssetId);
    const hashMatch =
      !resource.sourceHash ||
      Boolean(source.sourceHash && resource.sourceHash === source.sourceHash);
    const compatible = alignmentMatch && assetMatch && hashMatch;
    result.push({
      resource,
      compatible,
      reason: !alignmentMatch
        ? `Map is ${resource.width} x ${resource.height}; source registration is ${source.width} x ${source.height}`
        : !assetMatch || !hashMatch
          ? 'Map belongs to a different source revision'
          : undefined,
    });
  }
  return result;
}

function formatDepthStatus(map: DepthMap, histogram: DepthHistogram): string {
  if (histogram.validCount === 0 || map.metadata.normalization?.noValidSamples) {
    return 'No valid depth samples';
  }
  if (histogram.min === histogram.max) return 'Constant valid depth plane';
  return `${histogram.validCount.toLocaleString()} valid samples - ${map.width} x ${map.height}`;
}

function mapLabel(candidate: DepthCandidate): string {
  const resource = candidate.resource;
  const origin = resource.provenance?.origin ?? (resource.modelId ? 'generated' : 'imported');
  const meaning =
    resource.depthType === 'metric'
      ? `metric ${resource.unit}`
      : `relative ${resource.unit === 'unknown' ? 'unitless' : 'ordinal'}`;
  return `${origin === 'generated' ? 'Generated' : 'Imported'} - ${meaning} - ${resource.width} x ${resource.height}${candidate.compatible ? '' : ' - unavailable'}`;
}

function decodeRasterMask(asset: RasterMaskAsset): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = asset.width;
      canvas.height = asset.height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Mask preview is unavailable in this browser'));
        return;
      }
      context.drawImage(image, 0, 0, asset.width, asset.height);
      const pixels = context.getImageData(0, 0, asset.width, asset.height).data;
      const alpha = new Uint8Array(asset.width * asset.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3]!;
      resolve(alpha);
    };
    image.onerror = () => reject(new Error('Existing mask asset could not be decoded'));
    image.src = asset.dataUrl;
  });
}

function encodeCoverage(coverage: Float32Array, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Mask export is unavailable in this browser');
  const image = context.createImageData(width, height);
  image.data.set(coverageToRgba(coverage));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function downloadResource(resource: DepthMapResource, nodeName: string): void {
  const blob = new Blob([JSON.stringify(resource, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${nodeName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'depth-map'}.vdepth.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface DepthMaskSectionProps {
  nodes: SceneNode[];
  /** Adjustment layers use a selected image as the registered mask source. */
  targetNode?: SceneNode;
}

export function DepthMaskSection({ nodes, targetNode }: DepthMaskSectionProps) {
  const { state, updateDoc, announce } = useEditor();
  const target =
    targetNode ??
    (nodes.length === 1 && (isImageShape(nodes[0]!) || nodes[0]?.kind === 'adjustment')
      ? nodes[0]
      : undefined);
  const imageSources = useMemo(
    () => Object.values(state.document.nodes).filter(isImageShape),
    [state.document.nodes],
  );
  const [sourceNodeId, setSourceNodeId] = useState('');
  const sourceNode =
    target?.kind === 'adjustment'
      ? imageSources.find((candidate) => candidate.id === sourceNodeId)
      : target;
  const node = sourceNode && isImageShape(sourceNode) ? (sourceNode as ShapeNode) : undefined;
  const source = node ? sourceInfo(state.document, node) : null;
  const recipe = target?.mask?.rasterMask?.depthRecipe;
  const candidates = useMemo(
    () =>
      target && node && source ? candidatesForSource(state.document, target, node, source) : [],
    [node, source, state.document, target],
  );
  const [selectedMapId, setSelectedMapId] = useState<string>('');
  const [depthData, setDepthData] = useState<DepthMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickTarget, setPickTarget] = useState<'near' | 'far' | null>(null);
  const [replaceNonRasterMask, setReplaceNonRasterMask] = useState(false);
  const [range, setRange] = useState<MaskRangeState>({
    near: 0,
    far: 100,
    nearTransition: 4,
    farTransition: 4,
    invert: false,
    combine: 'replace',
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const initializedRecipeRef = useRef<string | null>(null);

  useEffect(() => {
    if (target?.kind !== 'adjustment') return;
    const preferred = recipe?.sourceBinding.nodeId;
    setSourceNodeId((current) => {
      if (imageSources.some((candidate) => candidate.id === current)) return current;
      if (preferred && imageSources.some((candidate) => candidate.id === preferred)) {
        return preferred;
      }
      return imageSources[0]?.id ?? '';
    });
  }, [imageSources, recipe?.sourceBinding.nodeId, target?.kind]);

  const selectedCandidate = candidates.find(({ resource }) => resource.id === selectedMapId);
  const selectedResource = selectedCandidate?.resource;
  const previewLayout = depthData ? containDepthPreview(depthData.width, depthData.height) : null;
  const histogram = depthData ? depthMapHistogram(depthData) : null;
  const hasExistingNonRasterMask = Boolean(target?.mask && !target.mask.rasterMask);
  const hasCompatibleMap = Boolean(selectedCandidate?.compatible && source?.width && source.height);

  useEffect(() => {
    setReplaceNonRasterMask(false);
  }, [target?.id]);

  useEffect(() => {
    const preferred = recipe?.depthMapId;
    setSelectedMapId((current) => {
      if (candidates.some(({ resource }) => resource.id === current)) return current;
      if (preferred && candidates.some(({ resource }) => resource.id === preferred))
        return preferred;
      return (
        candidates.find((candidate) => candidate.compatible)?.resource.id ??
        candidates[0]?.resource.id ??
        ''
      );
    });
  }, [candidates, recipe?.depthMapId]);

  useEffect(() => {
    if (!pickTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPickTarget(null);
      announce('Depth range sampling cancelled');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [announce, pickTarget]);

  useEffect(() => {
    if (!selectedResource) {
      setDepthData(null);
      return;
    }
    try {
      const decoded = decodeDepthResource(selectedResource);
      setDepthData(
        source && source.width > 0 && source.height > 0
          ? alignDepthMapToSource(decoded, source.width, source.height)
          : decoded,
      );
      setError(null);
    } catch (cause) {
      setDepthData(null);
      setError(cause instanceof Error ? cause.message : 'Depth map could not be decoded');
    }
  }, [selectedResource, source?.height, source?.width]);

  useEffect(() => {
    if (!recipe || recipe.depthMapId !== selectedResource?.id) return;
    const key = `${recipe.depthMapId}:${target?.id}:${node?.id}`;
    if (initializedRecipeRef.current === key) return;
    initializedRecipeRef.current = key;
    setRange({
      near: recipe.range.near * 100,
      far: recipe.range.far * 100,
      nearTransition: recipe.range.nearTransition * 100,
      farTransition: recipe.range.farTransition * 100,
      invert: recipe.invert,
      combine: recipe.combine,
    });
  }, [node?.id, recipe, selectedResource?.id, target?.id]);

  useEffect(() => {
    if (!depthData || !previewRef.current || !previewLayout) return;
    const canvas = previewRef.current;
    canvas.width = previewLayout.canvasWidth;
    canvas.height = previewLayout.canvasHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    const values = new Uint8Array(depthData.values.length);
    for (let i = 0; i < values.length; i++) {
      values[i] = depthData.valid[i] ? Math.round(depthData.values[i]! * 255) : 0;
    }
    const source = document.createElement('canvas');
    source.width = depthData.width;
    source.height = depthData.height;
    const sourceContext = source.getContext('2d');
    if (!sourceContext) return;
    const heatmap = depthToHeatmapImageData(values, depthData.width, depthData.height);
    for (let i = 0; i < depthData.valid.length; i++) {
      if (!depthData.valid[i]) heatmap.data[i * 4 + 3] = 0;
    }
    sourceContext.putImageData(heatmap, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(127, 127, 127, 0.16)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.drawImage(
      source,
      previewLayout.drawX,
      previewLayout.drawY,
      previewLayout.drawWidth,
      previewLayout.drawHeight,
    );
  }, [depthData, previewLayout]);

  const handleImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      if (file.size > MAX_IMPORT_BYTES) {
        setError('Depth import is limited to 128 MB before decoding');
        return;
      }
      try {
        const parsed = JSON.parse(await file.text()) as Partial<DepthMapResource>;
        if (
          parsed.schemaVersion !== 1 ||
          parsed.nearFarConvention !== 'nearIsLow' ||
          typeof parsed.id !== 'string' ||
          typeof parsed.byteLength !== 'number'
        ) {
          throw new Error('Choose a Varve .vdepth.json resource with canonical near-is-low values');
        }
        const decoded = decodeDepthResource(parsed as DepthMapResource);
        const aligned =
          source && source.width > 0 && source.height > 0
            ? alignDepthMapToSource(decoded, source.width, source.height)
            : decoded;
        const id = !state.document.depthMaps?.[parsed.id]
          ? parsed.id
          : `depth-import-${cryptoId()}`;
        const resource = { ...(parsed as DepthMapResource), id };
        updateDoc((doc) => ({
          ...doc,
          depthMaps: { ...(doc.depthMaps ?? {}), [id]: resource },
        }));
        setSelectedMapId(id);
        setDepthData(aligned);
        setError(null);
        announce(
          `Imported a ${decoded.width} x ${decoded.height} ${decoded.metadata.depthType} depth map; verify its source alignment before applying`,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Depth map import failed');
      }
    },
    [announce, source, state.document.depthMaps, updateDoc],
  );

  const handlePreviewClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!pickTarget || !depthData || !previewLayout) return;
      const point = depthPreviewPointToMap(
        event.clientX,
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
        previewLayout,
      );
      if (!point) return;
      const value = sampleDepth(depthData, point.x, point.y, 1);
      if (value === null) {
        setError('The sampled region contains no valid depth');
        return;
      }
      setRange((current) => ({ ...current, [pickTarget]: value * 100 }));
      announce(
        `${pickTarget === 'near' ? 'Near' : 'Far'} depth sampled at ${Math.round(value * 100)}%`,
      );
      setPickTarget(null);
    },
    [announce, depthData, pickTarget, previewLayout],
  );

  const handleApply = useCallback(async () => {
    if (
      !target ||
      !node ||
      !source ||
      !selectedResource ||
      !depthData ||
      !selectedCandidate?.compatible
    )
      return;
    if (range.near > range.far) {
      setError('Near must be less than or equal to Far; crossed handles produce an empty mask');
      return;
    }
    if (hasExistingNonRasterMask && (!replaceNonRasterMask || range.combine !== 'replace')) {
      setError(
        'This node already has a non-raster mask. Choose Replace and explicitly enable replacement before applying.',
      );
      return;
    }
    const depthRecipe = makeDepthMaskRecipe({
      depthMapId: selectedResource.id,
      nodeId: node.id,
      ...(source.fillAssetId ? { fillAssetId: source.fillAssetId } : {}),
      processingRevision: selectedResource.sourceRevision ?? 1,
      sourceIdentity: {
        kind: 'source-metadata',
        locator: source.locator,
        pixelWidth: depthData.width,
        pixelHeight: depthData.height,
        revision: selectedResource.sourceRevision ?? 1,
      },
      near: range.near / 100,
      far: range.far / 100,
      nearTransition: range.nearTransition / 100,
      farTransition: range.farTransition / 100,
      invert: range.invert,
      combine: range.combine,
    });
    try {
      const incoming = depthCoverageForRecipe(depthData, depthRecipe);
      const currentMask = target.mask?.rasterMask;
      const currentAsset = currentMask
        ? state.document.rasterMaskAssets?.[currentMask.assetId]
        : undefined;
      const priorCorrectionAsset = currentMask?.depthRecipe?.correction?.assetId
        ? state.document.rasterMaskAssets?.[currentMask.depthRecipe.correction.assetId]
        : undefined;
      let existing: Uint8Array | undefined;
      let correctionAsset: RasterMaskAsset | undefined;
      const baselineAsset = priorCorrectionAsset ?? currentAsset;
      if (range.combine !== 'replace' && baselineAsset) {
        existing = await decodeRasterMask(baselineAsset);
        if (existing.length !== incoming.length)
          throw new Error('Existing mask dimensions do not match the depth map');
        correctionAsset = { ...baselineAsset, id: `mask-depth-correction-${cryptoId()}` };
      }
      const coverage = combineDepthCoverage(incoming, existing, range.combine);
      const dataUrl = encodeCoverage(coverage, depthData.width, depthData.height);
      const recipeWithCorrection = correctionAsset
        ? {
            ...depthRecipe,
            correction: { assetId: correctionAsset.id, revision: 1, target: 'coverage' as const },
          }
        : depthRecipe;
      let committed = false;
      updateDoc((doc) => {
        const currentNode = doc.nodes[target.id];
        const currentResource = doc.depthMaps?.[selectedResource.id];
        const currentSourceNode = doc.nodes[node.id];
        const currentSourceAsset = source.fillAssetId
          ? doc.assets?.[source.fillAssetId]
          : undefined;
        if (
          currentNode !== target ||
          currentSourceNode !== node ||
          currentResource !== selectedResource ||
          (selectedResource.sourceAssetId !== undefined &&
            selectedResource.sourceAssetId !== source.fillAssetId) ||
          (selectedResource.sourceHash !== undefined &&
            currentSourceAsset?.hash !== selectedResource.sourceHash)
        )
          return doc;
        const withCorrection = correctionAsset
          ? {
              ...doc,
              rasterMaskAssets: {
                ...(doc.rasterMaskAssets ?? {}),
                [correctionAsset.id]: correctionAsset,
              },
            }
          : doc;
        const next = commitRasterMask(withCorrection, target.id, {
          dataUrl,
          width: depthData.width,
          height: depthData.height,
          sourceLocator: source.locator,
          sourceIdentity: depthRecipe.sourceIdentity,
          depthRecipe: recipeWithCorrection,
        });
        committed = next !== doc;
        return next;
      });
      if (!committed) throw new Error('The source or depth resource changed; apply was discarded');
      setError(null);
      announce('Depth mask applied; source pixels and the accepted depth map remain unchanged');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Depth mask could not be applied');
    }
  }, [
    announce,
    depthData,
    hasExistingNonRasterMask,
    node,
    range,
    replaceNonRasterMask,
    selectedCandidate?.compatible,
    selectedResource,
    source,
    state.document.rasterMaskAssets,
    target,
    updateDoc,
  ]);

  const handleExport = useCallback(() => {
    if (!selectedResource || !target) return;
    downloadResource(selectedResource, target.name);
    announce('Depth map exported as a scalar Varve resource');
  }, [announce, selectedResource, target]);

  if (!target) return null;
  if (!node || !source) {
    return (
      <DisclosureSection title="Depth Mask" sectionId="depth-mask">
        <div className="insp-field-group">
          <p className="insp-hint insp-hint--error" role="alert">
            This depth mask has no available source image. Select or restore the bound image before
            importing, editing, or exporting source-aligned coverage.
          </p>
        </div>
      </DisclosureSection>
    );
  }

  const options = candidates.map((candidate) => ({
    value: candidate.resource.id,
    label: mapLabel(candidate),
    disabled: !candidate.compatible,
  }));
  const rangeInvalid = range.near > range.far;

  return (
    <DisclosureSection title="Depth Mask" sectionId="depth-mask">
      <div className="insp-field-group">
        <p className="insp-hint">
          Select a reusable scalar depth map, refine its range, and apply coverage as the existing
          non-destructive layer mask. Relative maps are ordinal (0 near, 100 far); metric maps
          retain calibrated values while their normalized UI range remains explicit.
        </p>
        {target.kind === 'adjustment' && (
          <NativeSelect
            label="Depth source image"
            value={sourceNodeId}
            options={imageSources.map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
            }))}
            placeholder={imageSources.length > 0 ? undefined : 'No image source available'}
            onValueChange={setSourceNodeId}
            disabled={imageSources.length === 0}
            description={`Coverage will localize ${target.name} in the selected image's source coordinates.`}
          />
        )}
        <p className="insp-hint">
          Target: {target.name}. Source: {node.name} ({source.width} x {source.height}).
        </p>
        <NativeSelect
          label="Depth source"
          value={selectedMapId}
          options={options}
          placeholder={options.length > 0 ? undefined : 'Generate or import a depth map'}
          onValueChange={setSelectedMapId}
          disabled={options.length === 0}
          description="Only a source-aligned map can be applied."
        />
        <div className="insp-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".vdepth.json,application/json"
            onChange={handleImport}
            hidden
            aria-label="Import Varve scalar depth map"
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            Import scalar map
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleExport}
            disabled={!selectedResource}
          >
            Export scalar map
          </Button>
        </div>
        {!selectedResource && (
          <p className="insp-hint">
            Generate and save a map from Depth Blur, or import a .vdepth.json resource. Applying a
            mask never enables blur.
          </p>
        )}
        {selectedCandidate && !selectedCandidate.compatible && (
          <p className="insp-hint insp-hint--error" role="alert">
            {selectedCandidate.reason}
          </p>
        )}
        {depthData && histogram && (
          <>
            <div className="insp-depth-heatmap">
              <canvas
                ref={previewRef}
                className="insp-depth-heatmap__canvas"
                aria-label="Scalar depth preview; blue is near and red is far"
                onClick={handlePreviewClick}
                style={{ cursor: pickTarget ? 'crosshair' : 'default' }}
              />
            </div>
            <div className="insp-depth-legend" aria-hidden="true">
              <span>Near</span>
              <span className="insp-depth-legend__swatch" />
              <span>Far</span>
            </div>
            <p className="insp-hint">{formatDepthStatus(depthData, histogram)}</p>
            <div
              className="insp-depth-histogram"
              role="img"
              aria-label={`Depth histogram: ${formatDepthStatus(depthData, histogram)}`}
            >
              {Array.from(histogram.bins, (bin, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: histogram bins are a fixed ordered axis.
                  key={`depth-bin-${index}`}
                  style={{
                    height: `${histogram.validCount ? Math.max(2, (bin / Math.max(...histogram.bins)) * 100) : 0}%`,
                  }}
                />
              ))}
            </div>
            <div className="insp-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPickTarget('near')}
                aria-pressed={pickTarget === 'near'}
              >
                {pickTarget === 'near' ? 'Click near in preview…' : 'Sample near'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPickTarget('far')}
                aria-pressed={pickTarget === 'far'}
              >
                {pickTarget === 'far' ? 'Click far in preview…' : 'Sample far'}
              </Button>
              {pickTarget && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPickTarget(null)}>
                  Cancel sample
                </Button>
              )}
            </div>
            <FieldRow label="Near" htmlFor="depth-mask-near">
              <RangeValueControl
                id="depth-mask-near"
                label="Near"
                value={range.near}
                min={0}
                max={100}
                step={0.1}
                unit="%"
                rangeClassName="insp-range"
                rangeAriaLabel="Depth mask near endpoint"
                onChange={(value) => setRange((current) => ({ ...current, near: value }))}
              />
            </FieldRow>
            <FieldRow label="Far" htmlFor="depth-mask-far">
              <RangeValueControl
                id="depth-mask-far"
                label="Far"
                value={range.far}
                min={0}
                max={100}
                step={0.1}
                unit="%"
                rangeClassName="insp-range"
                rangeAriaLabel="Depth mask far endpoint"
                onChange={(value) => setRange((current) => ({ ...current, far: value }))}
              />
            </FieldRow>
            <FieldRow label="Near transition" htmlFor="depth-mask-near-transition">
              <RangeValueControl
                id="depth-mask-near-transition"
                label="Near transition"
                value={range.nearTransition}
                min={0}
                max={50}
                step={0.1}
                unit="% depth"
                rangeClassName="insp-range"
                rangeAriaLabel="Depth mask near transition"
                onChange={(value) => setRange((current) => ({ ...current, nearTransition: value }))}
              />
            </FieldRow>
            <FieldRow label="Far transition" htmlFor="depth-mask-far-transition">
              <RangeValueControl
                id="depth-mask-far-transition"
                label="Far transition"
                value={range.farTransition}
                min={0}
                max={50}
                step={0.1}
                unit="% depth"
                rangeClassName="insp-range"
                rangeAriaLabel="Depth mask far transition"
                onChange={(value) => setRange((current) => ({ ...current, farTransition: value }))}
              />
            </FieldRow>
            <Switch
              className="insp-switch"
              label="Select outside depth range"
              checked={range.invert}
              onChange={(event) =>
                setRange((current) => ({ ...current, invert: event.target.checked }))
              }
            />
            <NativeSelect
              label="Combine with existing raster mask"
              value={range.combine}
              options={[
                { value: 'replace', label: 'Replace' },
                { value: 'intersect', label: 'Intersect' },
                { value: 'union', label: 'Add / union' },
                { value: 'subtract', label: 'Subtract' },
              ]}
              onValueChange={(value) =>
                setRange((current) => ({ ...current, combine: value as MaskRangeState['combine'] }))
              }
              description="Soft coverage uses product, probabilistic union, or subtraction."
            />
            {recipe?.correction && (
              <p className="insp-hint insp-hint--warn">
                Manual coverage correction is saved with this recipe. Replace starts a fresh range;
                choose Intersect, Add, or Subtract to rebase against the saved correction.
              </p>
            )}
            {rangeInvalid && (
              <p className="insp-hint insp-hint--error" role="alert">
                Near is beyond Far. Correct the endpoints before applying.
              </p>
            )}
            {hasExistingNonRasterMask && (
              <>
                <p className="insp-hint insp-hint--warn">
                  An existing vector, live, or structural mask is protected. Only an explicit
                  Replace can discard that mask; Intersect, Add, and Subtract require an existing
                  raster coverage asset.
                </p>
                <Switch
                  className="insp-switch"
                  label="Confirm replacing the existing mask"
                  checked={replaceNonRasterMask}
                  onChange={(event) => setReplaceNonRasterMask(event.target.checked)}
                />
              </>
            )}
            <div className="insp-actions">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleApply}
                disabled={
                  !hasCompatibleMap ||
                  rangeInvalid ||
                  (hasExistingNonRasterMask &&
                    (!replaceNonRasterMask || range.combine !== 'replace'))
                }
              >
                Apply depth mask
              </Button>
            </div>
          </>
        )}
        {error && (
          <p className="insp-hint insp-hint--error" role="alert">
            {error}
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
