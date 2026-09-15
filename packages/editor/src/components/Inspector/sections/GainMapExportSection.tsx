import type { RangeRaster } from '@varve/shared';
import { Button } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';
import { buildUltraHdrExport, type UltraHdrExportResult } from './gainMapExport';
import { rangeRasterToHdrDisplayLinear } from './photoSourceWorkflow';

export interface GainMapExportSectionProps {
  masterRaster: RangeRaster;
  /** Persisted SDR rendition the user reviewed; never regenerated here. */
  sdrRenditionDataUrl: string | null;
  /** Output-exposure values recorded on the applied SDR rendition. */
  appliedExposureStops: number;
  appliedWhitePoint: number;
  /** Live slider values; a mismatch means the stored base is stale. */
  currentExposureStops: number;
  currentWhitePoint: number;
  onAnnounce: (message: string) => void;
}

function channelMax(value: number | readonly [number, number, number]): number {
  return typeof value === 'number' ? value : Math.max(value[0], value[1], value[2]);
}

export function GainMapExportSection({
  masterRaster,
  sdrRenditionDataUrl,
  appliedExposureStops,
  appliedWhitePoint,
  currentExposureStops,
  currentWhitePoint,
  onAnnounce,
}: GainMapExportSectionProps) {
  const [quality, setQuality] = useState(0.9);
  const [status, setStatus] = useState<'idle' | 'building' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<UltraHdrExportResult | null>(null);

  useEffect(() => {
    setResult(null);
    setErrorMessage(null);
    setStatus('idle');
  }, [masterRaster, sdrRenditionDataUrl, appliedExposureStops, appliedWhitePoint]);

  const transformDirty =
    Math.abs(currentExposureStops - appliedExposureStops) > 1e-6 ||
    Math.abs(currentWhitePoint - appliedWhitePoint) > 1e-6;
  const stage = masterRaster.contract.reference;

  const prepare = useCallback(async () => {
    if (!sdrRenditionDataUrl) return;
    setStatus('building');
    setErrorMessage(null);
    try {
      const hdrDisplayLinear = rangeRasterToHdrDisplayLinear(masterRaster, {
        exposureStops: appliedExposureStops,
        whitePoint: appliedWhitePoint,
      });
      const built = await buildUltraHdrExport({
        sdrRenditionDataUrl,
        hdrDisplayLinear,
        gainMapQuality: quality,
      });
      setResult(built);
      setStatus('idle');
      onAnnounce(
        `Gain map JPEG prepared and verified: max reconstruction error ${built.verification.maxStops.toFixed(3)} stops over ${built.verification.samples} samples`,
      );
    } catch (error) {
      setStatus('error');
      setResult(null);
      setErrorMessage(error instanceof Error ? error.message : 'Gain map export failed');
    }
  }, [
    appliedExposureStops,
    appliedWhitePoint,
    masterRaster,
    onAnnounce,
    quality,
    sdrRenditionDataUrl,
  ]);

  return (
    <div className="photo-source-section__gainmap" data-testid="gain-map-export">
      <h4>Share with extended range</h4>
      {stage === 'display-linear' ? (
        <p className="photo-source-section__note">
          This display-linear master is already a final rendition, so there is no extended highlight
          range to encode. Import or merge a scene-linear master first.
        </p>
      ) : (
        <>
          <p className="photo-source-section__note">
            A gain map JPEG (Ultra HDR) keeps this exact SDR rendition as its base image and adds a
            per-channel recovery map for the extended range. The base is never regenerated from the
            master, so the SDR fallback cannot drift.
          </p>
          {transformDirty && (
            <p className="photo-source-section__warning">
              Apply the SDR output transform first so the exported base image is exactly the
              rendition you reviewed.
            </p>
          )}
          {!sdrRenditionDataUrl && (
            <p className="photo-source-section__warning">
              The stored SDR rendition is unavailable; apply the output transform to create one.
            </p>
          )}
          <div className="photo-source-section__grid">
            <label className="photo-source-section__range">
              <span>
                Gain map quality <output>{quality.toFixed(2)}</output>
              </span>
              <input
                type="range"
                min={0.6}
                max={1}
                step={0.01}
                value={quality}
                aria-label="Gain map JPEG quality"
                onChange={(event) => setQuality(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="photo-source-section__actions">
            <Button
              size="sm"
              onClick={() => void prepare()}
              loading={status === 'building'}
              disabled={transformDirty || !sdrRenditionDataUrl}
            >
              Prepare gain map JPEG
            </Button>
            {result && (
              <a
                className="photo-source-section__download"
                href={result.dataUrl}
                download="varve-ultrahdr.jpg"
              >
                Download Ultra HDR gain map JPEG
              </a>
            )}
          </div>
          {status === 'error' && errorMessage && (
            <p className="photo-source-section__error" role="alert">
              {errorMessage}
            </p>
          )}
          {result && (
            <dl
              className="photo-source-section__facts"
              data-testid="gain-map-verification"
              data-status="ready"
            >
              <div>
                <dt>Base image</dt>
                <dd>
                  {result.baseWidth} x {result.baseHeight} from the stored SDR rendition · JPEG byte
                  delta {result.verification.baseByteMaxDelta}
                </dd>
              </div>
              <div>
                <dt>Gain map</dt>
                <dd>
                  {result.gainMapWidth} x {result.gainMapHeight} · {result.diagnostics.channelCount}{' '}
                  channels ·{' '}
                  {channelMax(result.metadata.gainMapMax) > 0
                    ? `${(2 ** channelMax(result.metadata.gainMapMax)).toFixed(2)}x headroom`
                    : 'attenuation only'}
                </dd>
              </div>
              <div>
                <dt>Verified reconstruction</dt>
                <dd>
                  max {result.verification.maxStops.toFixed(3)} stops · p95{' '}
                  {result.verification.p95Stops.toFixed(3)} stops · {result.verification.samples}{' '}
                  samples
                </dd>
              </div>
            </dl>
          )}
          {result?.warnings.map((warning) => (
            <p className="photo-source-section__warning" key={warning}>
              {warning}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
