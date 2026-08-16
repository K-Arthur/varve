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
  gradientPresetContentHash,
  gradientPresetIsReferenced,
  gradientPresetToEmbeddedGradient,
  gradientPresetToGradientMapStops,
  makeGradientPreset,
} from '@varve/scene';
import { useCallback, useState } from 'react';

import { useEditor } from '../../../context';
import { openGradientFilePicker, parseGradientFile } from '../../../gradientPresets/importFile';
import { useGradientPresetLibrary } from '../../../gradientPresets/library';
import { GradientImportDialog, type GradientImportScope } from './GradientImportDialog';
import { GradientMapEditor } from './GradientMapEditor';
import { GradientMapPresetBrowser } from './GradientMapPresetBrowser';

export interface GradientMapAdjustmentSectionProps {
  adjustment: GradientMapAdjustment;
  onChange: (patch: Partial<GradientMapAdjustment>) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

interface ImportState {
  fileName: string;
  presets: GradientPreset[];
  warnings: string[];
  duplicateCount: number;
}

function derivePreset(adjustment: GradientMapAdjustment): GradientPreset {
  if (adjustment.embeddedGradient) {
    return embeddedGradientToGradientPreset(adjustment.embeddedGradient);
  }
  return makeGradientPreset({
    name: 'Gradient map',
    colorStops: adjustment.stops.map((s) => ({
      position: s.position,
      midpoint: s.midpoint,
      color: { space: 'rgb', r: s.color[0], g: s.color[1], b: s.color[2], a: s.color[3] },
    })),
    ...(adjustment.opacityStops
      ? {
          opacityStops: adjustment.opacityStops.map((o) => ({
            position: o.position,
            midpoint: o.midpoint,
            opacity: o.opacity,
          })),
        }
      : {}),
  });
}

export function GradientMapAdjustmentSection({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
}: GradientMapAdjustmentSectionProps) {
  const editor = useEditor();
  const library = useGradientPresetLibrary(editor.platform);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const currentPreset = derivePreset(adjustment);

  const handleSelectPreset = useCallback(
    (preset: GradientPreset) => {
      onChange({
        presetId: preset.id,
        embeddedGradient: gradientPresetToEmbeddedGradient(preset),
        stops: gradientPresetToGradientMapStops(preset),
        opacityStops: preset.opacityStops.map((o) => ({
          position: o.position,
          midpoint: o.midpoint,
          opacity: o.opacity,
        })),
        interpolation: preset.interpolation,
      });
      library.recordRecent(preset.id);
    },
    [onChange, library],
  );

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
    (id: string) => {
      const doc = editor.state.document;
      if (gradientPresetIsReferenced(doc, id)) {
        const name = library.presets.find((p) => p.id === id)?.name ?? 'This preset';
        if (
          !window.confirm(
            `${name} is used in this document. Delete it anyway? The document keeps its own embedded copy.`,
          )
        ) {
          return;
        }
      }
      library.deletePreset(id);
    },
    [editor.state.document, library],
  );

  const handleImportClick = useCallback(async () => {
    const file = await openGradientFilePicker();
    if (!file) return;
    const parsed = parseGradientFile(file);
    if (!parsed.ok) {
      setImportError(parsed.message);
      return;
    }
    const existing = new Set(library.userPresets.map((p) => gradientPresetContentHash(p)));
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
    (selected: GradientPreset[], scope: GradientImportScope) => {
      if (scope === 'library' || scope === 'both') {
        library.addPresets(selected);
      }
      if (scope === 'document' || scope === 'both') {
        editor.updateDoc((doc) => addGradientPresetsToDocument(doc, selected).doc as Document);
      }
      // Apply the first imported preset to the current adjustment for a quick
      // preview (per the import workflow: "Allow immediate application").
      if (selected.length > 0) {
        handleSelectPreset(selected[0]!);
      }
      setImportState(null);
    },
    [library, editor, handleSelectPreset],
  );

  const selectedPresetId =
    adjustment.presetId && library.presets.some((p) => p.id === adjustment.presetId)
      ? adjustment.presetId
      : currentPreset.id;

  return (
    <div className="gmp-section">
      <GradientMapPresetBrowser
        presets={library.presets}
        favoriteIds={library.favoriteIds}
        recentIds={library.recentIds}
        selectedId={selectedPresetId}
        onSelect={handleSelectPreset}
        onToggleFavorite={library.toggleFavorite}
        onImport={handleImportClick}
        onRename={(id, name) => library.updatePreset(id, { name })}
        onDuplicate={library.duplicatePreset}
        onDelete={handleDeletePreset}
        onExport={handleExport}
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
        onChange={(patch) => onChange(patch as unknown as Partial<GradientMapAdjustment>)}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
      />
      <p className="gmp-section__current">
        Preset: <strong>{displayName(currentPreset)}</strong>
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
