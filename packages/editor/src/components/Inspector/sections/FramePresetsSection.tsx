/**
 * Frame Presets section — the Figma model for sizing artboards.
 *
 * Shown when the Frame tool is active (create a new preset-sized frame) or a
 * single frame is selected (resize it to the preset). Presets are grouped by
 * device class; each tile shows a proportional preview + size caption.
 *
 * Research basis: Figma frame-preset panel (right sidebar when Frame tool
 * active), APG button semantics.
 */
import { useEditor } from '../../../context';
import { FRAME_PRESET_GROUPS, type FramePreset } from '../../../framePresets';
import { DisclosureSection } from '../controls/DisclosureSection';

/** Max preview box in px; the frame proportion is fit inside this. */
const PREVIEW_BOX = 28;

function previewDims(preset: FramePreset): { w: number; h: number } {
  const ratio = preset.w / preset.h;
  if (ratio >= 1) return { w: PREVIEW_BOX, h: Math.max(6, PREVIEW_BOX / ratio) };
  return { w: Math.max(6, PREVIEW_BOX * ratio), h: PREVIEW_BOX };
}

export function FramePresetsSection({ mode }: { mode: 'create' | 'resize' }) {
  const { applyFramePreset } = useEditor();

  return (
    <DisclosureSection
      title={mode === 'resize' ? 'Resize to preset' : 'Frame presets'}
      defaultExpanded={mode === 'create'}
    >
      <div className="frame-presets">
        {FRAME_PRESET_GROUPS.map((group) => (
          <div key={group.label} className="frame-presets__group">
            <p className="frame-presets__group-label">{group.label}</p>
            <div className="frame-presets__grid">
              {group.presets.map((preset) => {
                const dims = previewDims(preset);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className="frame-presets__item"
                    onClick={() =>
                      applyFramePreset({ name: preset.name, w: preset.w, h: preset.h })
                    }
                    title={`${preset.name} - ${preset.w} x ${preset.h}`}
                  >
                    <span className="frame-presets__preview" aria-hidden>
                      <span
                        className="frame-presets__preview-box"
                        style={{ width: dims.w, height: dims.h }}
                      />
                    </span>
                    <span className="frame-presets__name">{preset.name}</span>
                    <span className="frame-presets__size">
                      {preset.w} &times; {preset.h}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </DisclosureSection>
  );
}
