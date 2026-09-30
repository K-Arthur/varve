import type { ConceptArtReferenceMetadata } from '@varve/scene';
import { normalizeConceptArtReferenceMetadata } from '@varve/scene';
import { Switch } from '@varve/ui';
import './ConceptArtReferenceControls.css';

export interface ConceptArtReferenceControlsProps {
  metadata: ConceptArtReferenceMetadata | undefined;
  /** Existing image-node name; normalization stores its basename only. */
  sourceFileName: string;
  onChange: (metadata: ConceptArtReferenceMetadata | undefined) => void;
}

/** Reference role and independent use-in-artwork policies for one image. */
export function ConceptArtReferenceControls({
  metadata,
  sourceFileName,
  onChange,
}: ConceptArtReferenceControlsProps) {
  const isReference = metadata !== undefined;

  const toggleReference = (enabled: boolean) => {
    if (!enabled) {
      onChange(undefined);
      return;
    }
    onChange(
      normalizeConceptArtReferenceMetadata({
        sourceFileName,
        includeInSampling: false,
        includeInExport: false,
      }),
    );
  };

  const toggleSampling = (includeInSampling: boolean) => {
    if (metadata) onChange({ ...metadata, includeInSampling });
  };

  const toggleExport = (includeInExport: boolean) => {
    if (metadata) onChange({ ...metadata, includeInExport });
  };

  return (
    <fieldset className="concept-reference-options">
      <legend>Concept-art reference</legend>
      <Switch
        label="Use as concept reference"
        aria-label="Use as concept reference"
        checked={isReference}
        onChange={(event) => toggleReference(event.currentTarget.checked)}
      />
      <p className="concept-reference-options__description">
        A reference stays visible on the canvas; sampling and artwork exports stay off until
        enabled.
      </p>
      {metadata && (
        <div className="concept-reference-options__details">
          {metadata.sourceFileName && (
            <p className="concept-reference-options__source">
              <span>Source</span>
              <bdi>{metadata.sourceFileName}</bdi>
            </p>
          )}
          <Switch
            label="Include in artwork sampling"
            aria-label="Include in artwork sampling"
            checked={metadata.includeInSampling}
            onChange={(event) => toggleSampling(event.currentTarget.checked)}
          />
          <Switch
            label="Include in artwork exports"
            aria-label="Include in artwork exports"
            checked={metadata.includeInExport}
            onChange={(event) => toggleExport(event.currentTarget.checked)}
          />
        </div>
      )}
    </fieldset>
  );
}
