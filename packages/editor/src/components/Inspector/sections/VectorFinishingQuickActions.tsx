import { type Adjustment, type AdjustmentKind, filterKindDisplayName } from '@varve/engine';

/**
 * The treatments that give an immediately visible result on a flat rendered
 * object. The full Object Filter catalog remains available below this shortcut.
 */
export const VECTOR_FINISHING_KINDS = [
  'grain',
  'edgeFalloff',
  'softBloom',
] as const satisfies readonly AdjustmentKind[];

export type VectorFinishingKind = (typeof VECTOR_FINISHING_KINDS)[number];

const VECTOR_FINISHING_PRESETS: Readonly<Record<VectorFinishingKind, Partial<Adjustment>>> = {
  // A visible but restrained material texture for flat vector fills.
  grain: { strength: 35, scale: 1, character: 60 },
  // Negative strength is the conventional darkening vignette.
  edgeFalloff: { strength: -35, midpoint: 55, feather: 65 },
  // Use a lower highlight threshold than the photo default so it is useful
  // on mid-tone vector fills as well as photographic highlights.
  softBloom: { strength: 35, radius: 20, threshold: 0.35, softness: 0.45 },
};

const FINISHING_DESCRIPTIONS: Readonly<Record<VectorFinishingKind, string>> = {
  grain: 'Add material texture while preserving the editable fill.',
  edgeFalloff: 'Darken the object edges for focused, vignette-like depth.',
  softBloom: 'Diffuse bright and mid-tone areas into a soft luminous glow.',
};

/** Returns a new preset object so callers can safely merge it into a filter. */
export function vectorFinishingPreset(kind: VectorFinishingKind): Partial<Adjustment> {
  return { ...VECTOR_FINISHING_PRESETS[kind] };
}

export interface VectorFinishingQuickActionsProps {
  onAdd: (kind: VectorFinishingKind, preset: Partial<Adjustment>) => void;
}

/**
 * A deliberately narrow discoverability surface for non-image rendered objects.
 * It routes through the same Object Filter stack as advanced work, rather than
 * creating a second effects model or hiding its ordering/bypass semantics.
 */
export function VectorFinishingQuickActions({ onAdd }: VectorFinishingQuickActionsProps) {
  return (
    <section className="object-finishing" aria-labelledby="object-finishing-title">
      <div className="object-finishing__heading">
        <h3 id="object-finishing-title">Object Finishing</h3>
        <p>
          Apply a non-destructive finish to this vector, text, or container object. Its fill and
          opacity stay editable.
        </p>
      </div>
      <fieldset className="object-finishing__actions">
        <legend className="sr-only">Add object finishing</legend>
        {VECTOR_FINISHING_KINDS.map((kind) => {
          const label = filterKindDisplayName(kind);
          return (
            <button
              className="object-finishing__action"
              data-object-finishing-action={kind}
              key={kind}
              type="button"
              aria-label={`Add ${label} object filter`}
              onClick={() => onAdd(kind, vectorFinishingPreset(kind))}
            >
              <span className="object-finishing__action-label">{label}</span>
              <span className="object-finishing__action-description">
                {FINISHING_DESCRIPTIONS[kind]}
              </span>
            </button>
          );
        })}
      </fieldset>
      <p className="object-finishing__hint">
        The full filter menu remains available below. Photo-local controls may be subtle on a flat
        fill; for photo retouching, select an image and use Image Tuning.
      </p>
    </section>
  );
}
