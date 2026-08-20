/**
 * Brush Library panel — the Brush Browser and Brush Editor wired to editor
 * state and to persistent user storage.
 *
 * Choosing a brush writes its parameters into `brushSettings`, which is the
 * single place the paint tools read from, so a brush picked here behaves
 * identically to one configured field by field in the inspector.
 */
import type { BrushPreset } from '@varve/scene';
import {
  BUILT_IN_BRUSH_PRESETS,
  exportBrushPackage,
  importBrushPackage,
  serializeBrushPackage,
} from '@varve/scene';
import { Button } from '@varve/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { BrushEditor } from '../BrushEditor/BrushEditor';
import { BrushBrowser, type BrushBrowserItem } from './BrushBrowser';
import { useBrushLibrary } from './useBrushLibrary';

export function BrushLibraryPanel() {
  const { state, setBrushSetting } = useEditor();
  const library = useBrushLibrary(state.platform);
  const [editing, setEditing] = useState<BrushPreset | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customItems = useMemo<BrushBrowserItem[]>(
    () =>
      library.entries.flatMap((entry) => {
        const preset = library.presets[entry.id];
        if (!preset) return [];
        return [
          {
            id: entry.id,
            name: entry.name,
            category: entry.category,
            tags: entry.tags,
            preset,
            isBuiltIn: false,
          },
        ];
      }),
    [library.entries, library.presets],
  );

  /** Push a preset into the editor's brush settings, which the tools read. */
  const applyPreset = useCallback(
    (preset: BrushPreset) => {
      setBrushSetting('presetId', preset.id);
      setBrushSetting('radius', preset.radius);
      setBrushSetting('opacity', preset.opacity);
      setBrushSetting('flow', preset.flow);
      setBrushSetting('hardness', preset.hardness);
      setBrushSetting('smoothing', preset.smoothing);
      setBrushSetting('spacing', preset.spacing);
      setBrushSetting('grainId', preset.grainId ?? null);
      setBrushSetting('grainScale', preset.grainScale);
      setBrushSetting('grainRotation', preset.grainRotation);
      setBrushSetting('grainContrast', preset.grainContrast);
      setBrushSetting('grainInvert', preset.grainInvert);
      setBrushSetting('blendMode', preset.blendMode);
      setBrushSetting('wetEnabled', preset.wetEnabled);
      setBrushSetting('wetEdge', preset.wetEdge);
      setBrushSetting('wetMixStrength', preset.wetMixStrength);
      setBrushSetting('wetDryingRate', preset.wetDryingRate);
    },
    [setBrushSetting],
  );

  const handleSelect = useCallback(
    (item: BrushBrowserItem) => {
      applyPreset(item.preset);
      library.recordRecent(item.id);
    },
    [applyPreset, library],
  );

  const handleExport = useCallback((item: BrushBrowserItem) => {
    const pkg = exportBrushPackage([item.preset]);
    const blob = new Blob([serializeBrushPackage(pkg)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${item.name.replace(/[^\w.-]+/g, '-').toLowerCase()}.varvebrush`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportFile = useCallback(
    async (file: File) => {
      const result = importBrushPackage(await file.text());
      if (!result.ok) {
        // Surface why, rather than failing silently or importing a half brush.
        setNotice(result.issues[0]?.message ?? 'Brush file could not be read.');
        return;
      }
      library.importPresets(result.presets);
      const warnings = result.issues.length;
      setNotice(
        warnings > 0
          ? `Imported ${result.presets.length} brush${result.presets.length === 1 ? '' : 'es'} with ${warnings} warning${warnings === 1 ? '' : 's'}: ${result.issues[0]!.message}`
          : `Imported ${result.presets.length} brush${result.presets.length === 1 ? '' : 'es'}.`,
      );
    },
    [library],
  );

  if (editing) {
    return (
      <BrushEditor
        preset={editing}
        onClose={() => setEditing(null)}
        onSave={(preset) => {
          library.saveBrush(preset);
          applyPreset(preset);
        }}
      />
    );
  }

  return (
    <div className="brush-library-panel">
      <BrushBrowser
        customItems={customItems}
        selectedId={state.brushSettings.presetId}
        favoriteIds={library.favoriteIds}
        recentIds={library.recentIds}
        onSelect={handleSelect}
        onToggleFavorite={library.toggleFavorite}
        onEdit={(item) => setEditing(item.preset)}
        onDelete={library.deleteBrush}
        onExport={handleExport}
        onImport={() => fileInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".varvebrush,application/json"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void handleImportFile(file);
        }}
      />
      {notice ? (
        <p className="brush-library-panel__notice" role="status">
          {notice}
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </p>
      ) : null}
    </div>
  );
}

/** Built-in presets as browser items, for callers rendering without a library. */
export function builtInBrushItems(): BrushBrowserItem[] {
  return Object.values(BUILT_IN_BRUSH_PRESETS).map((preset) => ({
    id: preset.id,
    name: preset.name,
    category: 'basic',
    preset,
    isBuiltIn: true,
  }));
}
