/**
 * Gradient map adjustment section — composes the preset browser, the stop
 * editor, and the import flow for a single gradient-map adjustment. Owns the
 * gradient preset library (via `useEditor().platform`) and the import review
 * dialog state. All document mutations flow through the parent `onChange`
 * patch (so they participate in the existing undo/transaction system).
 */
import type { GradientMapAdjustment } from '@varve/engine';
import { encodeGradientPresets } from '@varve/import';
import type { Document, GradientPreset } from '@varve/scene';
import {
  addGradientPresetsToDocument,
  displayName,
  embeddedGradientToGradientPreset,
  getDocumentGradientPresets,
  gradientPresetContentHash,
  gradientPresetIsReferenced,
  gradientPresetToEmbeddedGradient,
  gradientPresetToGradientMapStops,
  makeGradientPreset,
  removeGradientPresetsFromDocument,
  renameDocumentGradientPreset,
} from '@varve/scene';
import { useCallback, useState } from 'react';
import { useEditor } from '../../../context';
import { openGradientFilePicker, parseGradientFile } from '../../../gradientPresets/importFile';
import { useGradientPresetLibrary } from '../../../gradientPresets/library';
import { GradientMapTonalDistribution } from '../../AdjustmentLayer/GradientMapTonalDistribution';
import { confirmDialog } from '../../PromptDialog';
import { GradientImportDialog, type GradientImportScope } from './GradientImportDialog';
import { GradientMapEditor } from './GradientMapEditor';
import { GradientMapPresetBrowser } from './GradientMapPresetBrowser';

export interface GradientMapAdjustmentSectionProps {
  adjustment: GradientMapAdjustment;
  onChange: (patch: Partial<GradientMapAdjustment>) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  sourceHistogram?: import('@varve/engine').Histogram | null;
}

interface ImportState {
  fileName: string;
  presets: GradientPreset[];
  warnings: string[];
  duplicateCount: number;
}

function tupleToSceneColor(color: GradientMapAdjustment['stops'][number]['color']) {
  return { space: 'rgb' as const, r: color[0], g: color[1], b: color[2], a: color[3] };
}

function sceneStops(stops: GradientMapAdjustment['stops']) {
  return stops.map((stop, index) => ({
    id: stop.id ?? `gradient-stop-${index + 1}`,
    position: stop.position,
    midpoint: stop.midpoint,
    color: tupleToSceneColor(stop.color),
  }));
}

function derivePreset(adjustment: GradientMapAdjustment): GradientPreset {
  const embedded = adjustment.embeddedGradient
    ? embeddedGradientToGradientPreset(adjustment.embeddedGradient)
    : undefined;
  const mapSettings = {
    ...(embedded?.mapSettings ?? {}),
    mode: adjustment.mode ?? embedded?.mapSettings?.mode ?? 'luminance',
    channelStops: adjustment.channelStops
      ? {
          ...(adjustment.channelStops.r ? { r: sceneStops(adjustment.channelStops.r) } : {}),
          ...(adjustment.channelStops.g ? { g: sceneStops(adjustment.channelStops.g) } : {}),
          ...(adjustment.channelStops.b ? { b: sceneStops(adjustment.channelStops.b) } : {}),
        }
      : embedded?.mapSettings?.channelStops,
    reverse: adjustment.reverse ?? embedded?.mapSettings?.reverse ?? false,
    intensity: adjustment.intensity ?? embedded?.mapSettings?.intensity ?? 1,
    luminanceMode:
      adjustment.luminanceMode ?? embedded?.mapSettings?.luminanceMode ?? 'relative-luminance',
    preserveSourceAlpha:
      adjustment.preserveSourceAlpha ?? embedded?.mapSettings?.preserveSourceAlpha ?? true,
    preserveLuminosity:
      adjustment.preserveLuminosity ?? embedded?.mapSettings?.preserveLuminosity ?? false,
    dither: adjustment.dither ?? embedded?.mapSettings?.dither ?? true,
    ditherSize: adjustment.ditherSize ?? embedded?.mapSettings?.ditherSize ?? 8,
    lutSize: adjustment.lutSize ?? embedded?.mapSettings?.lutSize,
    algorithmVersion: adjustment.algorithmVersion ?? embedded?.mapSettings?.algorithmVersion ?? 2,
  } as const;
  return makeGradientPreset({
    ...(embedded ?? {}),
    id: embedded?.id ?? adjustment.presetId,
    name: embedded?.name ?? 'Gradient map',
    colorStops: sceneStops(adjustment.stops),
    opacityStops: adjustment.opacityStops
      ? adjustment.opacityStops.map((o) => ({
          id: o.id,
          position: o.position,
          midpoint: o.midpoint,
          opacity: o.opacity,
        }))
      : embedded?.opacityStops,
    interpolation: adjustment.interpolation ?? embedded?.interpolation ?? 'oklab',
    mapSettings,
  });
}

function completePresetSettings(preset: GradientPreset) {
  return {
    mode: 'luminance' as const,
    reverse: false,
    intensity: 1,
    luminanceMode: 'relative-luminance' as const,
    preserveSourceAlpha: true,
    preserveLuminosity: false,
    dither: true,
    ditherSize: 8 as const,
    algorithmVersion: 2 as const,
    ...(preset.mapSettings ?? {}),
  };
}

export function GradientMapAdjustmentSection({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
  sourceHistogram,
}: GradientMapAdjustmentSectionProps) {
  const editor = useEditor();
  const library = useGradientPresetLibrary(editor.platform);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const currentPreset = derivePreset(adjustment);
  const documentPresets = getDocumentGradientPresets(editor.state.document);
  const presets = [...documentPresets, ...library.presets].filter(
    (preset, index, all) =>
      all.findIndex(
        (candidate) => gradientPresetContentHash(candidate) === gradientPresetContentHash(preset),
      ) === index,
  );
  const selectedLibraryPreset = adjustment.presetId
    ? presets.find((preset) => preset.id === adjustment.presetId)
    : undefined;
  const selectedPresetSnapshot = selectedLibraryPreset
    ? makeGradientPreset({
        ...selectedLibraryPreset,
        mapSettings: completePresetSettings(selectedLibraryPreset),
      })
    : undefined;
  const isCustomized =
    !!selectedPresetSnapshot &&
    gradientPresetContentHash(selectedPresetSnapshot) !== gradientPresetContentHash(currentPreset);
  const browserPresets = isCustomized
    ? [
        makeGradientPreset({
          ...currentPreset,
          id: `gradient-custom-${gradientPresetContentHash(currentPreset)}`,
          name: 'Customized',
          source: { origin: 'manual' },
        }),
        ...presets,
      ]
    : presets;

  const applyPreset = useCallback(
    (preset: GradientPreset) => {
      const settings = completePresetSettings(preset);
      const snapshot = makeGradientPreset({ ...preset, mapSettings: settings });
      onChange({
        presetId: preset.id,
        embeddedGradient: gradientPresetToEmbeddedGradient(snapshot),
        stops: gradientPresetToGradientMapStops(preset),
        opacityStops: preset.opacityStops.map((o) => ({
          id: o.id,
          position: o.position,
          midpoint: o.midpoint,
          opacity: o.opacity,
        })),
        interpolation: preset.interpolation,
        mode: settings.mode,
        channelStops: settings.channelStops
          ? {
              ...(settings.channelStops.r
                ? {
                    r: gradientPresetToGradientMapStops({
                      ...preset,
                      colorStops: settings.channelStops.r,
                    }),
                  }
                : {}),
              ...(settings.channelStops.g
                ? {
                    g: gradientPresetToGradientMapStops({
                      ...preset,
                      colorStops: settings.channelStops.g,
                    }),
                  }
                : {}),
              ...(settings.channelStops.b
                ? {
                    b: gradientPresetToGradientMapStops({
                      ...preset,
                      colorStops: settings.channelStops.b,
                    }),
                  }
                : {}),
            }
          : undefined,
        reverse: settings.reverse,
        intensity: settings.intensity,
        luminanceMode: settings.luminanceMode,
        preserveSourceAlpha: settings.preserveSourceAlpha,
        preserveLuminosity: settings.preserveLuminosity,
        dither: settings.dither,
        ditherSize: settings.ditherSize,
        lutSize: settings.lutSize,
        algorithmVersion: settings.algorithmVersion,
      });
      library.recordRecent(preset.id);
    },
    [onChange, library],
  );

  const handleChange = useCallback(
    (patch: Partial<GradientMapAdjustment>) => {
      const next = { ...adjustment, ...patch } as GradientMapAdjustment;
      onChange({
        ...patch,
        embeddedGradient: gradientPresetToEmbeddedGradient(derivePreset(next)),
      });
    },
    [adjustment, onChange],
  );

  const handleSelectPreset = applyPreset;

  const handleExport = useCallback((preset: GradientPreset) => {
    const json = encodeGradientPresets([preset]);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${
      preset.name
        .replace(/[^a-z0-9-_ ]+/gi, '')
        .trim()
        .replace(/\s+/g, '-') || 'gradient'
    }.varve-gradient.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleDeletePreset = useCallback(
    async (id: string) => {
      const doc = editor.state.document;
      if (gradientPresetIsReferenced(doc, id)) {
        const name = presets.find((p) => p.id === id)?.name ?? 'This preset';
        if (
          !(await confirmDialog(
            'Delete referenced preset',
            `${name} is used in this document. Delete it anyway? The document keeps its own embedded copy.`,
            { confirmLabel: 'Delete', variant: 'destructive' },
          ))
        ) {
          return;
        }
      }
      if (documentPresets.some((preset) => preset.id === id)) {
        editor.updateDoc(
          (current) => removeGradientPresetsFromDocument(current as Document, [id]) as Document,
        );
      } else if (library.userPresets.some((preset) => preset.id === id)) {
        library.deletePreset(id);
      }
    },
    [documentPresets, editor, library, presets],
  );

  const handleRenamePreset = useCallback(
    (id: string, name: string) => {
      if (documentPresets.some((preset) => preset.id === id)) {
        editor.updateDoc(
          (current) => renameDocumentGradientPreset(current as Document, id, name) as Document,
        );
      } else if (library.userPresets.some((preset) => preset.id === id)) {
        library.updatePreset(id, { name });
      }
    },
    [documentPresets, editor, library],
  );

  const handleDuplicatePreset = useCallback(
    (id: string) => {
      const source = presets.find((preset) => preset.id === id);
      if (!source) return;
      const copy = makeGradientPreset({
        ...source,
        id: undefined,
        name: `${displayName(source)} copy`,
        source: { origin: 'manual' },
      });
      if (documentPresets.some((preset) => preset.id === id)) {
        editor.updateDoc(
          (current) => addGradientPresetsToDocument(current as Document, [copy]).doc as Document,
        );
      } else {
        library.addPresets([copy]);
      }
    },
    [documentPresets, editor, library, presets],
  );

  const handleImportClick = useCallback(async () => {
    const file = await openGradientFilePicker();
    if (!file) return;
    const parsed = parseGradientFile(file);
    if (!parsed.ok) {
      setImportError(parsed.message);
      return;
    }
    const existing = new Set(
      [...library.presets, ...documentPresets].map((p) => gradientPresetContentHash(p)),
    );
    const duplicateCount = parsed.result.presets.filter((p) =>
      existing.has(gradientPresetContentHash(p)),
    ).length;
    setImportState({
      fileName: file.name,
      presets: parsed.result.presets,
      warnings: parsed.result.warnings,
      duplicateCount,
    });
  }, [library.userPresets]);

  const handleImport = useCallback(
    (selected: GradientPreset[], scope: GradientImportScope, applyFirst = false) => {
      if (scope === 'library' || scope === 'both') {
        library.addPresets(selected);
      }
      if (scope === 'document' || scope === 'both') {
        editor.updateDoc((doc) => addGradientPresetsToDocument(doc, selected).doc as Document);
      }
      if (applyFirst && selected.length > 0) {
        handleSelectPreset(selected[0]!);
      }
      setImportState(null);
    },
    [library, editor, documentPresets, handleSelectPreset],
  );

  const selectedPresetId = isCustomized
    ? `gradient-custom-${gradientPresetContentHash(currentPreset)}`
    : adjustment.presetId && presets.some((p) => p.id === adjustment.presetId)
      ? adjustment.presetId
      : currentPreset.id;

  return (
    <div className="gmp-section">
      <GradientMapPresetBrowser
        presets={browserPresets}
        favoriteIds={library.favoriteIds}
        recentIds={library.recentIds}
        selectedId={selectedPresetId}
        onSelect={handleSelectPreset}
        onToggleFavorite={library.toggleFavorite}
        onImport={handleImportClick}
        onRename={handleRenamePreset}
        onDuplicate={handleDuplicatePreset}
        onDelete={handleDeletePreset}
        onExport={handleExport}
        scopeForPreset={(preset) =>
          documentPresets.some((candidate) => candidate.id === preset.id)
            ? 'Document'
            : preset.source?.origin === 'builtin'
              ? 'Built-in'
              : 'Library'
        }
        canEditPreset={(preset) =>
          documentPresets.some((candidate) => candidate.id === preset.id) ||
          library.userPresets.some((candidate) => candidate.id === preset.id)
        }
      />
      <GradientMapTonalDistribution
        histogram={sourceHistogram}
        stops={adjustment.stops}
        interpolation={adjustment.interpolation}
        reverse={adjustment.reverse}
      />
      {currentPreset.compatibility?.status !== 'ok' && (
        <p className="gmp-section__compat" role="status">
          {currentPreset.compatibility?.message ??
            (currentPreset.compatibility?.status === 'unsupported'
              ? 'This gradient is read-only (imported as a noise gradient).'
              : 'This gradient was approximated during import.')}
        </p>
      )}
      <GradientMapEditor
        stops={adjustment.stops}
        dither={adjustment.dither}
        preserveLuminosity={adjustment.preserveLuminosity}
        mode={adjustment.mode}
        channelStops={adjustment.channelStops}
        opacityStops={adjustment.opacityStops}
        reverse={adjustment.reverse}
        intensity={adjustment.intensity}
        luminanceMode={adjustment.luminanceMode}
        preserveSourceAlpha={adjustment.preserveSourceAlpha}
        interpolation={adjustment.interpolation}
        onChange={(patch) => handleChange(patch as Partial<GradientMapAdjustment>)}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
      />
      <p className="gmp-section__current">
        Preset: <strong>{isCustomized ? 'Customized' : displayName(currentPreset)}</strong>{' '}
        <button
          type="button"
          className="varve-btn varve-btn--ghost"
          onClick={() => {
            const saved = makeGradientPreset({
              ...currentPreset,
              id: undefined,
              name: `${isCustomized ? 'Customized' : displayName(currentPreset)} copy`,
              source: { origin: 'manual' },
            });
            library.addPresets([saved]);
            handleSelectPreset(saved);
          }}
        >
          Save current preset
        </button>
      </p>
      {importError && (
        <div className="gmp-section__error" role="alert">
          {importError}
        </div>
      )}
      {importState && (
        <GradientImportDialog
          open
          fileName={importState.fileName}
          presets={importState.presets}
          warnings={importState.warnings}
          duplicateCount={importState.duplicateCount}
          onClose={() => setImportState(null)}
          onImport={handleImport}
        />
      )}
    </div>
  );
}
