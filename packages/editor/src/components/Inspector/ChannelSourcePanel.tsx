import { combineAreaSelections } from '@varve/engine';
import { getImageFill, isImageShape } from '@varve/scene';
import { Button, Select, Switch } from '@varve/ui';
import { useEffect, useRef, useState } from 'react';
import { getActionRegistry } from '../../actions/ActionRegistry';
import { useEditor } from '../../context';
import { channelCoverage } from '../../tools/channelCoverage';
import { areaSelectionFromMaskCoverage, decodeRasterMaskDataUrl } from '../../tools/selectionMask';
import { SourceChannels } from '../AdjustmentLayer/SourceChannels';
import { SourcePixelDetail } from '../AdjustmentLayer/SourcePixelDetail';

/** Inspection is transient. Coverage snapshots use the existing area-selection
 * owner, whose Save/Load/rename/duplicate and Selection to Mask actions follow. */
export function ChannelSourcePanel() {
  const {
    state,
    commitAreaSelection,
    announce,
    beginTransaction,
    commitTransaction,
    abortTransaction,
  } = useEditor();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<ImageData | null>(null);
  const [channel, setChannel] = useState('composite');
  const [operation, setOperation] = useState('replace');
  const [invert, setInvert] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = useRef(state.document);
  live.current = state.document;
  const id = state.selection.length === 1 ? state.selection[0] : undefined;
  const node = id ? state.document.nodes[id] : undefined;
  const image =
    node?.kind === 'shape' && isImageShape(node) ? getImageFill(node)?.image : undefined;
  const locator = image?.assetId
    ? (state.document.assets?.[image.assetId]?.dataUrl ?? image.src)
    : image?.src;
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    if (!open || !locator) return;
    const w = image?.imageWidth ?? 256,
      h = image?.imageHeight ?? 256;
    const scale = Math.min(1, 256 / Math.max(w, h));
    void decodeRasterMaskDataUrl(locator, {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
    }).then((decoded) => {
      if (!cancelled && decoded)
        setSource(
          new ImageData(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height),
        );
    });
    return () => {
      cancelled = true;
    };
  }, [open, locator, image?.imageWidth, image?.imageHeight]);
  if (!image || !id || !locator) return null;
  const snapshot = async () => {
    const doc = state.document;
    setBusy(true);
    try {
      const decoded = await decodeRasterMaskDataUrl(locator);
      if (live.current !== doc) {
        announce('Source changed. Make the channel snapshot again.');
        return;
      }
      if (!decoded) {
        announce('Full-resolution channel snapshot unavailable. The mask budget is 16 megapixels.');
        return;
      }
      const plane = channelCoverage(decoded, channel as 'red' | 'green' | 'blue' | 'alpha', invert);
      const selection = areaSelectionFromMaskCoverage(
        doc,
        id,
        plane,
        decoded.width,
        decoded.height,
        'source-image-pixels',
      );
      if (!selection) {
        announce('Channel coverage could not be mapped to this image.');
        return;
      }
      const next =
        operation === 'replace'
          ? selection
          : combineAreaSelections(
              state.areaSelection ?? null,
              selection,
              operation as 'add' | 'subtract' | 'intersect',
              (state.areaSelection?.generation ?? 0) + 1,
            );
      if (next) {
        commitAreaSelection?.(next);
        announce(
          `Created ${channel} coverage selection. Save it below to reuse or apply Selection to Mask.`,
        );
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tonal-editor">
      <Button variant="secondary" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
        Channels · selected image source
      </Button>
      {open && (
        <>
          <SourceChannels
            source={source}
            label="Selected image · original RGB source"
            onChannelChange={setChannel}
          />
          <SourcePixelDetail locator={locator} />
          <p className="tonal-editor__hint">
            Full-resolution, one-time coverage snapshot. RGB coverage includes source alpha. Save
            and manage named selections below; Create Mask from Selection keeps the image editable.
          </p>
          <Select
            label="Channel selection operation"
            value={operation}
            onChange={setOperation}
            options={['replace', 'add', 'subtract', 'intersect'].map((value) => ({
              value,
              label: value[0]!.toUpperCase() + value.slice(1),
            }))}
          />
          <Switch
            label="Invert channel snapshot"
            checked={invert}
            onChange={(e) => setInvert(e.target.checked)}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || channel === 'composite' || !commitAreaSelection}
            onClick={() => void snapshot()}
          >
            Channel to selection
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!state.areaSelection}
            onClick={() => {
              beginTransaction();
              try {
                getActionRegistry().dispatch('createMaskFromSelection');
                commitTransaction();
              } catch (error) {
                abortTransaction();
                throw error;
              }
            }}
          >
            Create mask from selection
          </Button>
        </>
      )}
    </div>
  );
}
