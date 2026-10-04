import { generatePatternTile, PATTERN_TYPES, type PatternType } from '@varve/engine';
import type { PatternDefinition, PatternGeneratorRecipe, SceneNode } from '@varve/scene';
import {
  addPatternDefinition,
  createPatternDefinitionFromSelection,
  findOrCreateEmbeddedAsset,
  makePatternDefinitionUnique,
  patternDefinitionTileSrc,
  patternFill,
  patternFillForDefinition,
  resolveNodePaints,
  updatePatternDefinition,
} from '@varve/scene';
import type { PatternArrangement } from '@varve/shared';
import { Icon, SearchField, Select } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import {
  exportPatternDefinitionSupertileSvg,
  exportPatternDefinitionTileSvg,
} from '../../../export/patternTileSvg';
import { compilePatternPreview } from '../../../patterns/compilePatternPreview';
import {
  applyPatternSourceDraftWithPreview,
  getPatternSourceDraftStatus,
} from '../../../patterns/patternSourceDraft';
import { countPatternUses } from '../../../patterns/patternUsage';
import { DisclosureSection } from '../controls/DisclosureSection';
import { PatternRasterOffsetEditor } from './PatternRasterOffsetEditor';
import { PatternRepeatPreview } from './PatternRepeatPreview';
import { PatternSourceEditor } from './PatternSourceEditor';
import './PatternLibrarySection.css';

const DEFAULT_RECIPE: PatternGeneratorRecipe = {
  type: 'checkerboard',
  tileWidth: 48,
  tileHeight: 48,
  color1: '#ffffff',
  color2: '#d4e2e8',
  seed: 0,
};

export function PatternLibrarySection() {
  const editor = useEditor();
  const doc = editor.state.document;
  const selected = editor.selectedNodes();
  const definitions = doc.patternDefinitions ?? {};
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleTileFileRef = useRef<(event: React.ChangeEvent<HTMLInputElement>) => void>(() => {});
  const boundFileInputsRef = useRef(new WeakSet<HTMLInputElement>());
  const importGeneration = useRef(0);
  const pendingReplacement = useRef<{ id: string; revision: number } | null>(null);
  const pickPendingRef = useRef(false);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sourceEditingId, setSourceEditingId] = useState<string | null>(null);
  const [rasterOffsetEditingId, setRasterOffsetEditingId] = useState<string | null>(null);

  useEffect(() => {
    setEditingId(null);
    setSourceEditingId(null);
    setRasterOffsetEditingId(null);
  }, [doc.id]);

  const bindFileInput = useCallback((input: HTMLInputElement | null) => {
    fileInputRef.current = input;
    if (!input || boundFileInputsRef.current.has(input)) return;
    boundFileInputsRef.current.add(input);
    input.addEventListener('change', (event) => {
      handleTileFileRef.current(event as unknown as React.ChangeEvent<HTMLInputElement>);
    });
  }, []);

  const entries = useMemo(
    () =>
      Object.values(definitions).filter((definition) =>
        definition.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [definitions, search],
  );

  const announceError = useCallback(
    (error: unknown) => {
      editor.announce(
        error instanceof Error ? error.message : 'Pattern change could not be saved.',
      );
    },
    [editor],
  );

  const saveSelection = useCallback(() => {
    if (selected.length === 0) return;
    const sourceDocument = doc;
    const ids = selected.map((node) => node.id);
    try {
      const created = createPatternDefinitionFromSelection(sourceDocument, ids, {
        name: newName.trim() || selected[0]?.name || 'Pattern',
      });
      const previewSrc = compilePatternPreview(created.document, created.definition);
      const readyDefinition = {
        ...created.definition,
        previewSrc,
        previewRevision: created.definition.revision,
      };
      const nextDocument = {
        ...created.document,
        patternDefinitions: {
          ...created.document.patternDefinitions,
          [readyDefinition.id]: readyDefinition,
        },
      };
      let committed = false;
      editor.groupCompoundOperation('Create pattern from selection', () => {
        editor.updateDoc((current) => {
          if (current !== sourceDocument) return current;
          committed = true;
          return nextDocument;
        });
      });
      if (!committed) {
        editor.announce('Pattern creation was cancelled because the document changed.');
        return;
      }
      setNewName('');
      editor.announce(`Saved ${readyDefinition.name} to the pattern library`);
    } catch (error) {
      announceError(error);
    }
  }, [selected, doc, newName, editor, announceError]);

  const createProcedural = useCallback(() => {
    const tile = generatePatternTile('checkerboard', {
      tileSize: DEFAULT_RECIPE.tileWidth,
      tileWidth: DEFAULT_RECIPE.tileWidth,
      tileHeight: DEFAULT_RECIPE.tileHeight,
      color1: DEFAULT_RECIPE.color1,
      color2: DEFAULT_RECIPE.color2,
      seed: DEFAULT_RECIPE.seed,
    });
    if (!tile) {
      editor.announce('Pattern generator is unavailable in this environment.');
      return;
    }
    const definition: PatternDefinition = {
      id: newPatternId(),
      name: newName.trim() || 'New checker pattern',
      revision: 1,
      cell: { x: 0, y: 0, width: tile.width, height: tile.height },
      repeat: defaultRepeat(),
      source: { kind: 'procedural', recipe: { ...DEFAULT_RECIPE } },
      previewSrc: tile.dataUrl,
      previewRevision: 1,
    };
    try {
      editor.groupCompoundOperation('Create pattern', () => {
        editor.updateDoc((current) => addPatternDefinition(current, definition));
      });
      setNewName('');
      editor.announce(`Created ${definition.name}`);
    } catch (error) {
      announceError(error);
    }
  }, [newName, editor, announceError]);

  const applyDefinition = useCallback(
    (definition: PatternDefinition) => {
      if (selected.length === 0) return;
      const ids = selected.map((node) => node.id);
      const src = patternDefinitionTileSrc(definition, doc.assets);
      if (!src) {
        editor.announce('This pattern has no current render preview.');
        return;
      }
      const linked = selected.some((node) => Boolean(node.paintRefs?.length));
      if (linked) {
        editor.announce('Detach linked paint before adding a pattern fill.');
        return;
      }
      editor.groupCompoundOperation('Apply pattern', () => {
        editor.updateDoc((current) => {
          if (current.id !== doc.id) return current;
          const nodes = { ...current.nodes };
          for (const id of ids) {
            const node = nodes[id];
            if (!node) continue;
            const fills = resolveNodePaints(
              node as unknown as Parameters<typeof resolveNodePaints>[0],
              current,
            );
            const pattern = patternFillForDefinition(definition, {}, src);
            const nextFill = patternFill(src, pattern);
            nodes[id] = { ...node, fills: [...fills, nextFill] } as SceneNode;
          }
          return { ...current, nodes };
        });
      });
      editor.announce(
        `Applied ${definition.name} to ${ids.length} object${ids.length === 1 ? '' : 's'}`,
      );
    },
    [selected, doc, editor],
  );

  const makeUniqueForSelection = useCallback(
    (definitionId: string, fillIndex: number) => {
      if (selected.length !== 1) return;
      const node = selected[0];
      if (!node || node.paintRefs?.length) {
        editor.announce('Detach the linked paint before making this pattern unique.');
        return;
      }
      const fills = resolveNodePaints(
        node as unknown as Parameters<typeof resolveNodePaints>[0],
        doc,
      );
      if (
        fills[fillIndex]?.type !== 'pattern' ||
        fills[fillIndex]?.pattern?.definitionId !== definitionId
      ) {
        editor.announce('That fill no longer uses this pattern. Reopen the library and retry.');
        return;
      }
      try {
        const result = makePatternDefinitionUnique(doc, definitionId);
        const uniqueFills = [...fills];
        const fill = fills[fillIndex];
        if (fill?.type !== 'pattern' || fill.pattern?.definitionId !== definitionId) return;
        uniqueFills[fillIndex] = {
          ...fill,
          pattern: {
            ...fill.pattern,
            definitionId: result.definition.id,
            tileSrc: patternDefinitionTileSrc(result.definition, result.document.assets),
          },
        };
        const nodes = {
          ...result.document.nodes,
          [node.id]: { ...result.document.nodes[node.id], fills: uniqueFills } as SceneNode,
        };
        const nextDocument = { ...result.document, nodes };
        editor.groupCompoundOperation('Make pattern unique', () => {
          editor.updateDoc((current) => (current === doc ? nextDocument : current));
        });
        editor.announce(`Made ${result.definition.name} unique for this object`);
      } catch (error) {
        announceError(error);
      }
    },
    [selected, doc, editor, announceError],
  );

  const deleteUnused = useCallback(
    (id: string) => {
      const usageCount = countPatternUses(doc, id);
      if (usageCount > 0) {
        editor.announce(
          `Detach ${usageCount} use${usageCount === 1 ? '' : 's'} before deleting this pattern.`,
        );
        return;
      }
      let removed = false;
      editor.groupCompoundOperation('Delete pattern', () => {
        editor.updateDoc((current) => {
          if (!current.patternDefinitions?.[id]) return current;
          if (countPatternUses(current, id) > 0) return current;
          const { [id]: _removed, ...remaining } = current.patternDefinitions;
          removed = true;
          return { ...current, patternDefinitions: remaining };
        });
      });
      editor.announce(removed ? 'Pattern deleted' : 'Pattern is still in use and was not deleted.');
    },
    [doc, editor],
  );

  const editDefinition = useCallback(
    (
      id: string,
      patch: Partial<Pick<PatternDefinition, 'name' | 'cell'>> & {
        repeat?: Partial<PatternDefinition['repeat']>;
      },
    ) => {
      const documentId = doc.id;
      try {
        editor.groupCompoundOperation('Edit pattern definition', () => {
          editor.updateDoc((current) => {
            if (current.id !== documentId) return current;
            const updated = updatePatternDefinition(current, id, (definition) => ({
              ...definition,
              ...patch,
              ...(patch.cell && definition.source.kind === 'procedural'
                ? {
                    source: {
                      ...definition.source,
                      recipe: {
                        ...definition.source.recipe,
                        tileWidth: patch.cell.width,
                        tileHeight: patch.cell.height,
                      },
                    },
                  }
                : {}),
              repeat: patch.repeat ? { ...definition.repeat, ...patch.repeat } : definition.repeat,
            }));
            const definition = updated.patternDefinitions?.[id];
            if (!definition) return updated;
            const compileVectorPreview =
              definition.source.kind === 'vector' && Boolean(patch.cell || patch.repeat);
            const regenerateProceduralPreview =
              definition.source.kind === 'procedural' && Boolean(patch.cell);
            if (!compileVectorPreview && !regenerateProceduralPreview) return updated;
            let previewSrc: string | undefined;
            if (compileVectorPreview && definition.source.kind === 'vector') {
              previewSrc = compilePatternPreview(updated, definition);
            } else if (
              regenerateProceduralPreview &&
              definition.source.kind === 'procedural' &&
              (PATTERN_TYPES as readonly string[]).includes(definition.source.recipe.type)
            ) {
              const recipe = definition.source.recipe;
              previewSrc = generatePatternTile(recipe.type as PatternType, {
                tileSize: recipe.tileWidth,
                tileWidth: recipe.tileWidth,
                tileHeight: recipe.tileHeight,
                color1: recipe.color1,
                color2: recipe.color2,
                ...(recipe.seed !== undefined ? { seed: recipe.seed } : {}),
                ...(recipe.angle !== undefined ? { angle: recipe.angle } : {}),
                ...(recipe.density !== undefined ? { density: recipe.density } : {}),
                ...(recipe.gap !== undefined ? { gap: recipe.gap } : {}),
              })?.dataUrl;
            }
            if (!previewSrc) return updated;
            const nextDefinition = {
              ...definition,
              previewSrc,
              previewRevision: definition.revision,
            };
            return {
              ...updated,
              patternDefinitions: { ...updated.patternDefinitions, [id]: nextDefinition },
            };
          });
        });
      } catch (error) {
        announceError(error);
      }
    },
    [doc.id, editor, announceError],
  );

  const commitSourceDraft = useCallback(
    (draft: PatternDefinition, expectedDocumentId: string, expectedRevision: number) => {
      const previewReady = applyPatternSourceDraftWithPreview(
        doc,
        draft,
        expectedDocumentId,
        expectedRevision,
        compilePatternPreview,
      );
      if (previewReady.status !== 'ready') {
        if (previewReady.status === 'preview-failed') {
          announceError(previewReady.error);
          return false;
        }
        editor.announce(
          previewReady.status === 'document-changed'
            ? 'The active document changed. Reopen this pattern source to edit it.'
            : previewReady.status === 'stale'
              ? 'This pattern changed while its source was being edited. Reopen the editor and retry.'
              : 'This pattern no longer exists in the current document.',
        );
        return false;
      }

      editor.groupCompoundOperation('Edit pattern source', () => {
        editor.updateDoc((current) => {
          const committed = applyPatternSourceDraftWithPreview(
            current,
            draft,
            expectedDocumentId,
            expectedRevision,
            compilePatternPreview,
          );
          return committed.status === 'ready' ? committed.document : current;
        });
      });
      return true;
    },
    [doc, editor, announceError],
  );

  const completeSourceDraft = useCallback(
    (draft: PatternDefinition) => {
      setSourceEditingId(null);
      editor.announce(`Updated shared source for ${draft.name}`);
    },
    [editor],
  );

  const exportTile = useCallback(
    (definition: PatternDefinition) => {
      try {
        const svg = exportPatternDefinitionTileSvg(doc, definition);
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${safeFileStem(definition.name)}-tile.svg`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        editor.announce(`Exported ${definition.name} source tile as SVG`);
      } catch (error) {
        announceError(error);
      }
    },
    [doc, editor, announceError],
  );

  const exportSupertile = useCallback(
    (definition: PatternDefinition) => {
      try {
        const svg = exportPatternDefinitionSupertileSvg(doc, definition);
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${safeFileStem(definition.name)}-supertile.svg`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        editor.announce(`Exported ${definition.name} repeating supertile as SVG`);
      } catch (error) {
        announceError(error);
      }
    },
    [doc, editor, announceError],
  );

  const beginTileImport = useCallback(() => {
    pendingReplacement.current = null;
    importGeneration.current += 1;
    fileInputRef.current?.click();
  }, []);

  const beginSourceReplacement = useCallback((definition: PatternDefinition) => {
    pendingReplacement.current = { id: definition.id, revision: definition.revision };
    importGeneration.current += 1;
    fileInputRef.current?.click();
  }, []);

  const beginRasterOffset = useCallback((definition: PatternDefinition) => {
    importGeneration.current += 1;
    pendingReplacement.current = null;
    setEditingId(null);
    setSourceEditingId(null);
    setRasterOffsetEditingId((current) => (current === definition.id ? null : definition.id));
  }, []);

  const applyRasterOffset = useCallback(
    (
      id: string,
      expectedDocumentId: string,
      expectedRevision: number,
      dataUrl: string,
    ): boolean => {
      const status = getPatternSourceDraftStatus(doc, id, expectedDocumentId, expectedRevision);
      if (status !== 'ready') {
        editor.announce(
          status === 'document-changed'
            ? 'The active document changed. Reopen seam inspection before applying.'
            : status === 'stale'
              ? 'This pattern changed during seam inspection. Reopen it and retry.'
              : 'This pattern no longer exists in the current document.',
        );
        return false;
      }
      const definition = doc.patternDefinitions?.[id];
      if (definition?.source.kind !== 'raster') return false;

      try {
        const embedded = findOrCreateEmbeddedAsset(doc, {
          dataUrl,
          mimeType: 'image/png',
          naturalWidth: definition.source.width,
          naturalHeight: definition.source.height,
        });
        const asset = embedded.document.assets?.[embedded.assetId];
        if (!asset) throw new Error('The offset tile asset could not be stored.');
        const prepared = updatePatternDefinition(embedded.document, id, (current) => ({
          ...current,
          source:
            current.source.kind === 'raster'
              ? { ...current.source, assetId: embedded.assetId }
              : current.source,
        }));
        const updatedDefinition = prepared.patternDefinitions?.[id];
        if (!updatedDefinition) throw new Error('This pattern no longer exists.');

        editor.groupCompoundOperation('Offset raster pattern source', () => {
          editor.updateDoc((current) => {
            const latest = current.patternDefinitions?.[id];
            if (
              current.id !== expectedDocumentId ||
              latest?.revision !== expectedRevision ||
              latest.source.kind !== 'raster'
            ) {
              return current;
            }
            return {
              ...current,
              assets: { ...current.assets, [asset.id]: asset },
              patternDefinitions: {
                ...current.patternDefinitions,
                [id]: updatedDefinition,
              },
            };
          });
        });
        setRasterOffsetEditingId(null);
        editor.announce(
          `Applied a cyclic offset to the shared raster source for ${definition.name}`,
        );
        return true;
      } catch (error) {
        announceError(error);
        return false;
      }
    },
    [doc, editor, announceError],
  );

  const handleTileFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      const replacement = pendingReplacement.current;
      pendingReplacement.current = null;
      const generation = ++importGeneration.current;
      const documentId = doc.id;
      if (file.size > 64 * 1024 * 1024) {
        editor.announce('Pattern tile exceeds the 64 MB import limit.');
        return;
      }
      if (
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)
      ) {
        editor.announce('Choose a PNG, JPEG, WebP, GIF, or AVIF image tile.');
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => {
        if (generation === importGeneration.current)
          editor.announce('Pattern tile could not be read.');
      };
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (!dataUrl || generation !== importGeneration.current) return;
        const image = new Image();
        image.onerror = () => {
          if (generation === importGeneration.current) {
            editor.announce('Pattern tile is not a supported image.');
          }
        };
        image.onload = () => {
          if (generation !== importGeneration.current) return;
          if (
            image.naturalWidth <= 0 ||
            image.naturalHeight <= 0 ||
            image.naturalWidth * image.naturalHeight > 64_000_000
          ) {
            editor.announce('Pattern tile exceeds the 64 megapixel import limit.');
            return;
          }
          let committed = false;
          let commitMessage = '';
          editor.groupCompoundOperation(
            replacement ? 'Replace pattern source' : 'Import pattern tile',
            () => {
              editor.updateDoc((current) => {
                if (current.id !== documentId || generation !== importGeneration.current)
                  return current;
                const existing = replacement
                  ? current.patternDefinitions?.[replacement.id]
                  : undefined;
                if (replacement && (!existing || existing.revision !== replacement.revision)) {
                  return current;
                }
                const embedded = findOrCreateEmbeddedAsset(current, {
                  dataUrl,
                  mimeType: file.type || mimeTypeFromDataUrl(dataUrl),
                  naturalWidth: image.naturalWidth,
                  naturalHeight: image.naturalHeight,
                });
                if (replacement && existing) {
                  const replaced = updatePatternDefinition(
                    embedded.document,
                    replacement.id,
                    (definition) => ({
                      ...definition,
                      cell: {
                        x: 0,
                        y: 0,
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                      },
                      source: {
                        kind: 'raster',
                        assetId: embedded.assetId,
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                        fileName: file.name,
                      },
                      dependencyPatternIds: undefined,
                    }),
                  );
                  committed = replaced !== embedded.document;
                  commitMessage = `Replaced source for ${existing.name} with ${file.name}`;
                  return replaced;
                }
                const definition: PatternDefinition = {
                  id: newPatternId(),
                  name: file.name.replace(/\.[^.]+$/, '') || 'Imported tile',
                  revision: 1,
                  cell: { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight },
                  repeat: defaultRepeat(),
                  source: {
                    kind: 'raster',
                    assetId: embedded.assetId,
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                    fileName: file.name,
                  },
                };
                committed = true;
                commitMessage = `Imported ${file.name} to the pattern library`;
                return addPatternDefinition(embedded.document, definition);
              });
            },
          );
          if (committed) editor.announce(commitMessage);
          else if (generation === importGeneration.current && replacement) {
            editor.announce('Pattern source could not be replaced because the definition changed.');
          }
        };
        image.src = dataUrl;
      };
      reader.readAsDataURL(file);
    },
    [doc.id, editor],
  );

  useEffect(() => {
    handleTileFileRef.current = handleTileFile;
  }, [handleTileFile]);
  useEffect(() => {
    const onDocumentClick = (event: Event) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.classList.contains('insp-pattern-library__file')
      ) {
        pickPendingRef.current = true;
      }
    };
    const onDocumentChange = (event: Event) => {
      const target = event.target;
      if (!pickPendingRef.current || !(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains('insp-pattern-library__file')) return;
      pickPendingRef.current = false;
      if (target !== fileInputRef.current) {
        handleTileFileRef.current(event as unknown as React.ChangeEvent<HTMLInputElement>);
      }
    };
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('change', onDocumentChange, true);
    return () => {
      // Keep the node listener alive if the disclosure unmounts while the OS
      // picker is open; the input still owns the result of that dialog.
      document.removeEventListener('click', onDocumentClick, true);
      document.removeEventListener('change', onDocumentChange, true);
    };
  }, []);

  return (
    <DisclosureSection title="Pattern Library" sectionId="paint-library" subsectionId="patterns">
      <div className="insp-paint-library">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Filter patterns…"
          aria-label="Filter pattern library"
        />
        <input
          ref={bindFileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="insp-image-fill__file insp-pattern-library__file"
          aria-hidden
          tabIndex={-1}
        />
        {selected.length > 0 && (
          <>
            <input
              className="insp-pattern-library__name-input"
              aria-label="New pattern name"
              placeholder={`Pattern from ${selected[0]?.name ?? 'selection'}`}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <div className="insp-image-fill__actions">
              <button type="button" className="insp-paint-library__add-btn" onClick={saveSelection}>
                <Icon name="Plus" label={undefined} size="0.85em" />
                <span>Create from Selection</span>
              </button>
            </div>
          </>
        )}
        <div className="insp-image-fill__actions">
          <button
            type="button"
            className="insp-add-btn insp-image-fill__choose"
            onClick={createProcedural}
          >
            <Icon name="Sparkles" label={undefined} size="0.85em" />
            <span>New pattern</span>
          </button>
          <button
            type="button"
            className="insp-add-btn insp-image-fill__choose"
            onClick={beginTileImport}
          >
            <Icon name="Image" label={undefined} size="0.85em" />
            <span>Import tile</span>
          </button>
        </div>
        {entries.length === 0 && (
          <div className="insp-empty-message">
            {search ? 'No patterns match your filter' : 'No reusable patterns yet'}
          </div>
        )}
        <ul
          className={`insp-paint-library__list${editingId || sourceEditingId || rasterOffsetEditingId ? ' insp-pattern-library__list--editing' : ''}`}
          aria-label="Reusable patterns"
        >
          {entries.map((definition) => {
            const tileSrc = patternDefinitionTileSrc(definition, doc.assets);
            const usageCount = countPatternUses(doc, definition.id);
            const matchingFillIndexes =
              selected.length === 1
                ? selected.flatMap((node) =>
                    resolveNodePaints(
                      node as unknown as Parameters<typeof resolveNodePaints>[0],
                      doc,
                    ).flatMap((fill, index) =>
                      fill.type === 'pattern' && fill.pattern?.definitionId === definition.id
                        ? [index]
                        : [],
                    ),
                  )
                : [];
            const preview = patternFillForDefinition(definition, {}, tileSrc);
            return (
              <li
                key={`${doc.id}:${definition.id}`}
                className="insp-paint-library__entry insp-pattern-library__entry"
                data-pattern-id={definition.id}
              >
                <div
                  className="insp-paint-library__swatch insp-pattern-library__swatch"
                  aria-hidden
                >
                  <PatternRepeatPreview pattern={preview} />
                </div>
                <div className="insp-paint-library__info">
                  <span className="insp-paint-library__name">{definition.name}</span>
                  <span className="insp-paint-library__badge">
                    {definition.source.kind} · {definition.cell.width} by {definition.cell.height} ·{' '}
                    {usageCount} use{usageCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="insp-paint-library__actions">
                  {selected.length > 0 && tileSrc && (
                    <button
                      type="button"
                      className="insp-paint-library__action-btn"
                      onClick={() => applyDefinition(definition)}
                      aria-label={`Apply ${definition.name} to selection`}
                    >
                      <Icon name="Check" label={undefined} size="0.85em" />
                    </button>
                  )}
                  {matchingFillIndexes.map((fillIndex) => (
                    <button
                      key={`${definition.id}:unique:${fillIndex}`}
                      type="button"
                      className="insp-paint-library__action-btn"
                      onClick={() => makeUniqueForSelection(definition.id, fillIndex)}
                      aria-label={
                        matchingFillIndexes.length === 1
                          ? `Make ${definition.name} unique for this fill`
                          : `Make ${definition.name} unique for fill ${fillIndex + 1}`
                      }
                      title={`Make fill ${fillIndex + 1} unique`}
                    >
                      <Icon name="Copy" label={undefined} size="0.85em" />
                    </button>
                  ))}
                  {definition.source.kind === 'vector' && (
                    <button
                      type="button"
                      className="insp-paint-library__action-btn"
                      onClick={() => {
                        setEditingId(null);
                        setSourceEditingId((current) =>
                          current === definition.id ? null : definition.id,
                        );
                      }}
                      aria-label={`${sourceEditingId === definition.id ? 'Close' : 'Edit'} ${definition.name} source motifs`}
                      aria-expanded={sourceEditingId === definition.id}
                      title="Edit copied vector source motifs"
                    >
                      <Icon name="Pencil" label={undefined} size="0.85em" />
                    </button>
                  )}
                  {definition.source.kind === 'raster' && tileSrc && (
                    <button
                      type="button"
                      className="insp-paint-library__action-btn"
                      onClick={() => beginRasterOffset(definition)}
                      aria-label={`${rasterOffsetEditingId === definition.id ? 'Close' : 'Inspect'} ${definition.name} tile seams`}
                      aria-expanded={rasterOffsetEditingId === definition.id}
                      title="Inspect raster tile seams with cyclic offset editing"
                    >
                      <Icon name="Move" label={undefined} size="0.85em" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="insp-paint-library__action-btn"
                    onClick={() => beginSourceReplacement(definition)}
                    aria-label={`Replace ${definition.name} source`}
                    title="Replace source with an imported raster tile"
                  >
                    <Icon name="Image" label={undefined} size="0.85em" />
                  </button>
                  <button
                    type="button"
                    className="insp-paint-library__action-btn"
                    onClick={() =>
                      setEditingId((current) => (current === definition.id ? null : definition.id))
                    }
                    aria-label={`${editingId === definition.id ? 'Close' : 'Edit'} ${definition.name} definition settings`}
                    aria-expanded={editingId === definition.id}
                    title="Edit definition settings"
                  >
                    <Icon name="Settings" label={undefined} size="0.85em" />
                  </button>
                  <button
                    type="button"
                    className="insp-paint-library__action-btn"
                    onClick={() => exportTile(definition)}
                    aria-label={`Export ${definition.name} source tile as SVG`}
                    title="Export source tile as SVG"
                  >
                    <Icon name="Download" label={undefined} size="0.85em" />
                  </button>
                  <button
                    type="button"
                    className="insp-paint-library__action-btn"
                    onClick={() => exportSupertile(definition)}
                    aria-label={`Export ${definition.name} repeating supertile as SVG`}
                    title="Export rectangular repeat supertile as SVG"
                  >
                    <Icon name="Copy" label={undefined} size="0.85em" />
                  </button>
                  <button
                    type="button"
                    className="insp-paint-library__action-btn insp-paint-library__action-btn--danger"
                    onClick={() => deleteUnused(definition.id)}
                    aria-label={`Delete ${definition.name}`}
                    disabled={usageCount > 0}
                    title={usageCount > 0 ? 'Detach uses before deleting' : 'Delete pattern'}
                  >
                    <Icon name="Trash2" label={undefined} size="0.85em" />
                  </button>
                </div>
                {sourceEditingId === definition.id ? (
                  <PatternSourceEditor
                    document={doc}
                    definition={definition}
                    usageCount={usageCount}
                    onCommit={commitSourceDraft}
                    onCommitted={completeSourceDraft}
                    onCancel={() => setSourceEditingId(null)}
                  />
                ) : rasterOffsetEditingId === definition.id &&
                  definition.source.kind === 'raster' ? (
                  <PatternRasterOffsetEditor
                    documentId={doc.id}
                    definition={definition}
                    assetDataUrl={doc.assets?.[definition.source.assetId]?.dataUrl ?? ''}
                    usageCount={usageCount}
                    onApply={applyRasterOffset}
                    onCancel={() => setRasterOffsetEditingId(null)}
                  />
                ) : editingId === definition.id ? (
                  <PatternDefinitionSettings definition={definition} onChange={editDefinition} />
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </DisclosureSection>
  );
}

function PatternDefinitionSettings({
  definition,
  onChange,
}: {
  definition: PatternDefinition;
  onChange: (
    id: string,
    patch: Partial<Pick<PatternDefinition, 'name' | 'cell'>> & {
      repeat?: Partial<PatternDefinition['repeat']>;
    },
  ) => void;
}) {
  const setNumber = (
    key: 'width' | 'height' | 'gapX' | 'gapY' | 'rowShift' | 'columnShift',
    value: string,
  ) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    if (key === 'width' || key === 'height') {
      onChange(definition.id, {
        cell: { ...definition.cell, [key]: Math.max(1, number) },
      });
      return;
    }
    onChange(definition.id, { repeat: { [key]: number } });
  };

  return (
    <fieldset className="insp-pattern-definition-settings">
      <legend>Definition settings for {definition.name}</legend>
      <label>
        Name
        <input
          className="insp-num__input"
          aria-label="Pattern definition name"
          value={definition.name}
          onChange={(event) => onChange(definition.id, { name: event.currentTarget.value })}
        />
      </label>
      <span className="insp-num">
        <span className="insp-num__label">Repeat arrangement</span>
        <Select
          className="insp-num__input"
          label="Repeat arrangement"
          aria-label="Definition repeat arrangement"
          value={definition.repeat.arrangement}
          onValueChange={(value) => {
            const arrangement = value as PatternArrangement;
            onChange(definition.id, {
              repeat: {
                arrangement,
                rowShift: arrangement === 'brick' ? 0.5 : 0,
                columnShift: arrangement === 'half-drop' ? 0.5 : 0,
              },
            });
          }}
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'half-drop', label: 'Half-drop' },
            { value: 'brick', label: 'Brick' },
          ]}
        />
      </span>
      <DefinitionNumberField
        label="Cell width"
        value={definition.cell.width}
        onChange={(v) => setNumber('width', v)}
      />
      <DefinitionNumberField
        label="Cell height"
        value={definition.cell.height}
        onChange={(v) => setNumber('height', v)}
      />
      <DefinitionNumberField
        label="Gap across"
        value={definition.repeat.gapX}
        onChange={(v) => setNumber('gapX', v)}
      />
      <DefinitionNumberField
        label="Gap down"
        value={definition.repeat.gapY}
        onChange={(v) => setNumber('gapY', v)}
      />
      {definition.repeat.arrangement === 'brick' && (
        <DefinitionNumberField
          label="Row offset"
          value={definition.repeat.rowShift}
          step={0.05}
          onChange={(v) => setNumber('rowShift', v)}
        />
      )}
      {definition.repeat.arrangement === 'half-drop' && (
        <DefinitionNumberField
          label="Column offset"
          value={definition.repeat.columnShift ?? 0.5}
          step={0.05}
          onChange={(v) => setNumber('columnShift', v)}
        />
      )}
      <label className="insp-pattern-definition-settings__check">
        <input
          type="checkbox"
          checked={definition.repeat.mirrorX}
          onChange={(event) =>
            onChange(definition.id, { repeat: { mirrorX: event.currentTarget.checked } })
          }
        />
        Mirror columns
      </label>
      <label className="insp-pattern-definition-settings__check">
        <input
          type="checkbox"
          checked={definition.repeat.mirrorY}
          onChange={(event) =>
            onChange(definition.id, { repeat: { mirrorY: event.currentTarget.checked } })
          }
        />
        Mirror rows
      </label>
      <p className="insp-hint" role="note">
        These repeat settings are shared by every linked fill. Edit a fill to change its own tile
        scale, phase, or rotation.
      </p>
    </fieldset>
  );
}

function DefinitionNumberField({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        className="insp-num__input"
        aria-label={label}
        min={label.startsWith('Cell') ? 1 : undefined}
        step={step}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function safeFileStem(name: string): string {
  return (
    name
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'pattern'
  );
}

function defaultRepeat(): PatternDefinition['repeat'] {
  return {
    arrangement: 'grid',
    gapX: 0,
    gapY: 0,
    rowShift: 0,
    columnShift: 0,
    mirrorX: false,
    mirrorY: false,
    originX: 0,
    originY: 0,
  };
}

function newPatternId(): string {
  const token =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `pattern-${token}`;
}

function mimeTypeFromDataUrl(dataUrl: string): string {
  return /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'application/octet-stream';
}
