/**
 * ImageCropSection — crop, trim, expand, and reset controls for image nodes.
 *
 * Appears when a single ShapeNode with an image fill is selected.
 * Provides: Edit Crop, fit mode, trim to subject, expand bounds, and reset.
 *
 * Research basis: Figma image crop inspector, Sketch image trimming,
 * Canva background removal bounds.
 */
import type { ImageFit, SceneNode, ShapeNode } from '@strata/scene';
import { getImageFill, isImageShape } from '@strata/scene';
import { Icon } from '@strata/ui';
import { useCallback, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { SegmentedControl } from '../controls/SegmentedControl';
import type { SectionId } from '../sectionRegistry';

const FIT_OPTIONS: readonly { readonly value: ImageFit; readonly label: string }[] = [
  { value: 'fill', label: 'Fill' },
  { value: 'fit', label: 'Fit' },
  { value: 'crop', label: 'Crop' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'tile', label: 'Tile' },
];

const TRIM_SOURCE_OPTIONS = [
  { value: 'mask', label: 'Mask' },
  { value: 'alpha', label: 'Alpha' },
  { value: 'combined', label: 'Combined' },
] as const;

interface ImageCropSectionProps {
  nodes: SceneNode[];
  sectionId?: SectionId;
}

export function ImageCropSection({ nodes, sectionId }: ImageCropSectionProps) {
  const {
    updateDoc,
    setTool,
    trimToSubject,
    expandImageBounds,
    convertToCropAndExpand,
    resetImageBounds,
  } = useEditor();
  const node = nodes[0];

  if (!node || nodes.length !== 1 || !isImageShape(node)) return null;
  const shapeNode = node as ShapeNode;
  const imageFill = getImageFill(shapeNode);
  if (!imageFill?.image) return null;
  const img = imageFill.image;

  const hasMask = Boolean(shapeNode.mask?.rasterMask);
  const isCropMode = img.fit === 'crop';

  return (
    <DisclosureSection title="Crop & Bounds" sectionId={sectionId} defaultExpanded>
      <div className="insp-field-group">
        {/* Edit Crop */}
        <FieldRow label="Crop">
          <button
            type="button"
            className="insp-btn-sm"
            onClick={() => setTool('crop')}
            title="Edit crop (C)"
          >
            <Icon name="Crop" size="0.85em" />
            <span>Edit Crop</span>
          </button>
        </FieldRow>

        {/* Fit Mode */}
        <FieldRow label="Fit">
          <SegmentedControl
            label="Image fit mode"
            options={FIT_OPTIONS}
            value={img.fit}
            onChange={(value) => {
              updateDoc((doc) => {
                const n = doc.nodes[node.id];
                if (n?.kind !== 'shape') return doc;
                const fills = (n.fills ?? []).map((f) => {
                  if (f.type !== 'image' || !f.image) return f;
                  return { ...f, image: { ...f.image, fit: value as ImageFit } };
                });
                return { ...doc, nodes: { ...doc.nodes, [node.id]: { ...n, fills } } };
              });
            }}
          />
        </FieldRow>

        {/* Trim to Subject */}
        <TrimControls hasMask={hasMask} trimToSubject={trimToSubject} />

        {/* Expand Bounds */}
        <ExpandControls
          isCropMode={isCropMode}
          expandImageBounds={expandImageBounds}
          convertToCropAndExpand={convertToCropAndExpand}
        />

        {/* Reset */}
        <div className="insp-crop-section__reset-group">
          <button
            type="button"
            className="insp-btn-sm"
            onClick={() => resetImageBounds()}
            title="Reset to source image dimensions"
          >
            <Icon name="RotateCcw" size="0.85em" />
            <span>Reset Bounds</span>
          </button>
        </div>
      </div>
    </DisclosureSection>
  );
}

// ---------------------------------------------------------------------------
// Trim sub-component
// ---------------------------------------------------------------------------

function TrimControls({
  hasMask,
  trimToSubject,
}: {
  hasMask: boolean;
  trimToSubject: (
    padding?: number,
    options?: { source?: 'mask' | 'alpha' | 'combined'; alphaThreshold?: number },
  ) => Promise<void>;
}) {
  const [padding, setPadding] = useState(0);
  const [source, setSource] = useState<'mask' | 'alpha' | 'combined'>('mask');
  const [trimming, setTrimming] = useState(false);

  const handleTrim = useCallback(async () => {
    setTrimming(true);
    try {
      await trimToSubject(padding, { source });
    } finally {
      setTrimming(false);
    }
  }, [padding, source, trimToSubject]);

  return (
    <DisclosureSection title="Trim to Subject" defaultExpanded={false}>
      <div className="insp-field-group">
        {hasMask && (
          <FieldRow label="Source">
            <SegmentedControl
              label="Trim source"
              options={[...TRIM_SOURCE_OPTIONS]}
              value={source}
              onChange={(v) => setSource(v as typeof source)}
            />
          </FieldRow>
        )}
        <FieldRow label="Padding">
          <NumberField
            label="Trim padding"
            value={padding}
            min={0}
            max={1000}
            step={1}
            onChange={setPadding}
            unit="px"
          />
        </FieldRow>
        <div className="insp-crop-section__trim-actions">
          <button
            type="button"
            className="insp-btn-sm"
            onClick={handleTrim}
            disabled={trimming}
            title="Trim to subject"
          >
            <Icon name="Scissors" size="0.85em" />
            <span>{trimming ? 'Trimming...' : 'Trim to Subject'}</span>
          </button>
        </div>
      </div>
    </DisclosureSection>
  );
}

// ---------------------------------------------------------------------------
// Expand sub-component
// ---------------------------------------------------------------------------

function ExpandControls({
  isCropMode,
  expandImageBounds,
  convertToCropAndExpand,
}: {
  isCropMode: boolean;
  expandImageBounds: (
    padding: number,
    sides?: { top?: number; right?: number; bottom?: number; left?: number },
  ) => void;
  convertToCropAndExpand?: (
    padding: number,
    sides?: { top?: number; right?: number; bottom?: number; left?: number },
  ) => void;
}) {
  const [padding, setPadding] = useState(20);
  const [fromCenter, setFromCenter] = useState(false);

  const handleExpand = useCallback(() => {
    expandImageBounds(padding);
  }, [padding, expandImageBounds]);

  const handleConvertAndExpand = useCallback(() => {
    convertToCropAndExpand?.(padding);
  }, [padding, convertToCropAndExpand]);

  return (
    <DisclosureSection title="Expand Bounds" defaultExpanded={false}>
      <div className="insp-field-group">
        <FieldRow label="Padding">
          <NumberField
            label="Expand padding"
            value={padding}
            min={0}
            max={1000}
            step={1}
            onChange={setPadding}
            unit="px"
          />
        </FieldRow>
        <FieldRow label="From Center">
          <input
            type="checkbox"
            checked={fromCenter}
            onChange={(e) => setFromCenter(e.target.checked)}
            aria-label="Expand from center"
          />
        </FieldRow>
        <div className="insp-crop-section__expand-actions">
          {isCropMode ? (
            <button
              type="button"
              className="insp-btn-sm"
              onClick={handleExpand}
              title="Expand bounds with transparent padding"
            >
              <Icon name="Maximize2" size="0.85em" />
              <span>Expand Bounds</span>
            </button>
          ) : (
            <button
              type="button"
              className="insp-btn-sm"
              onClick={handleConvertAndExpand}
              title="Convert to Crop mode and expand bounds"
            >
              <Icon name="Maximize2" size="0.85em" />
              <span>Convert to Crop &amp; Expand</span>
            </button>
          )}
        </div>
      </div>
    </DisclosureSection>
  );
}
