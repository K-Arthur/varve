import {
  applyOperation,
  type ContainerNode,
  cryptoId,
  deepCloneSubtree,
  isContainer,
  type NodeId,
  type PresentationSlideEntry,
  reparentNode,
  resolvePresentationSlides,
  type SceneNode,
} from '@varve/scene';
import { Button, Dialog, NumberInput } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { PanelDetachButton } from '../PanelDragHandle';
import { PresentationLayoutManager } from './PresentationLayoutManager';
import { PresentationPreflightPanel } from './PresentationPreflightPanel';
import { PresentationThumbnail } from './PresentationThumbnail';
import {
  CREATE_PRESENTATION_FROM_SELECTION_EVENT,
  PRESENTATION_EXPORT_EVENT,
  PRESENTATION_PREVIEW_EVENT,
  setPresentationFocus,
} from './presentationCommands';
import './presentationNavigator.css';

type FrameNode = Extract<SceneNode, { kind: 'frame' }>;

interface SlideDraft {
  frameId: NodeId;
  title: string;
}

type SlideDraftMode = 'create' | 'append';

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function getSelectedFrames(selection: NodeId[], nodes: Record<string, SceneNode>): FrameNode[] {
  return selection.flatMap((id) => {
    const node = nodes[id];
    return node?.kind === 'frame' && node.frameRole !== 'exportRegion' ? [node] : [];
  });
}

export function PresentationNavigator({ showDetach = true }: { showDetach?: boolean }) {
  const {
    state,
    updateDoc,
    groupCompoundOperation,
    setSelection,
    setSelectionRefs,
    revealSelection,
    enterIsolation,
    exitIsolation,
    announce,
  } = useEditor();
  const decks = state.document.presentation?.decks ?? [];
  const [deckId, setDeckId] = useState(decks[0]?.id ?? '');
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [overview, setOverview] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [slideDraftMode, setSlideDraftMode] = useState<SlideDraftMode>('create');
  const [draftName, setDraftName] = useState('New presentation');
  const [sectionNameDraft, setSectionNameDraft] = useState('');
  const [slideDrafts, setSlideDrafts] = useState<SlideDraft[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const previousSelection = useRef<NodeId[]>([]);

  useEffect(() => {
    if (!decks.some((deck) => deck.id === deckId)) {
      setDeckId(decks[0]?.id ?? '');
      setActiveEntryId(null);
    }
  }, [decks, deckId]);

  // Share the focused slide so the canonical Present command starts where the
  // author is looking instead of always at slide 1.
  useEffect(() => {
    setPresentationFocus(activeEntryId ? { deckId, entryId: activeEntryId } : null);
    return () => setPresentationFocus(null);
  }, [activeEntryId, deckId]);

  const resolution = useMemo(
    () => resolvePresentationSlides(state.document, deckId),
    [state.document, deckId],
  );
  const selectedFrames = useMemo(
    () => getSelectedFrames(state.selection, state.document.nodes),
    [state.selection, state.document.nodes],
  );

  const runOperation = useCallback(
    (label: string, type: string, payload: unknown) => {
      groupCompoundOperation(label, () => {
        updateDoc((document) => applyOperation(document, type, payload));
      });
    },
    [groupCompoundOperation, updateDoc],
  );

  const runOperations = useCallback(
    (label: string, operations: Array<{ type: string; payload: unknown }>) => {
      if (operations.length === 0) return;
      groupCompoundOperation(label, () => {
        updateDoc((document) =>
          operations.reduce(
            (current, operation) => applyOperation(current, operation.type, operation.payload),
            document,
          ),
        );
      });
    },
    [groupCompoundOperation, updateDoc],
  );

  const openCreateReview = useCallback(
    (mode: SlideDraftMode) => {
      const alreadyIncluded = new Set(resolution.deck?.slides.map((slide) => slide.frameId) ?? []);
      const frames =
        mode === 'append'
          ? selectedFrames.filter((frame) => !alreadyIncluded.has(frame.id))
          : selectedFrames;
      if (frames.length === 0) {
        announce(
          mode === 'append'
            ? 'Select frames that are not already in this deck'
            : 'Select one or more frames first',
        );
        return;
      }
      setSlideDraftMode(mode);
      setDraftName(
        mode === 'append' ? (resolution.deck?.name ?? 'Presentation') : 'New presentation',
      );
      setSlideDrafts(frames.map((frame) => ({ frameId: frame.id, title: frame.name })));
      setCreateOpen(true);
    },
    [announce, resolution.deck, selectedFrames],
  );

  useEffect(() => {
    const handleRequest = () => openCreateReview(resolution.deck ? 'append' : 'create');
    window.addEventListener(CREATE_PRESENTATION_FROM_SELECTION_EVENT, handleRequest);
    return () =>
      window.removeEventListener(CREATE_PRESENTATION_FROM_SELECTION_EVENT, handleRequest);
  }, [openCreateReview, resolution.deck]);

  const createFromDraft = useCallback(() => {
    const frames = slideDrafts.flatMap((draft) => {
      const frame = state.document.nodes[draft.frameId];
      return frame?.kind === 'frame' ? [frame] : [];
    });
    const firstFrame = frames[0];
    if (!firstFrame) return;
    const creatingDeck = slideDraftMode === 'create';
    const nextDeckId = creatingDeck ? cryptoId() : deckId;
    groupCompoundOperation(
      creatingDeck ? 'Create presentation from frames' : 'Add frames to presentation',
      () => {
        updateDoc((document) => {
          let next = creatingDeck
            ? applyOperation(document, 'presentation.deck.create', {
                id: nextDeckId,
                name: draftName.trim() || 'Untitled presentation',
                width: firstFrame.w,
                height: firstFrame.h,
              })
            : document;
          for (const [index, draft] of slideDrafts.entries()) {
            const frame = document.nodes[draft.frameId];
            if (frame?.kind !== 'frame') continue;
            const entry: PresentationSlideEntry = {
              id: cryptoId(),
              frameId: frame.id,
              title: draft.title.trim() || frame.name || `Slide ${index + 1}`,
            };
            next = applyOperation(next, 'presentation.slide.add', {
              deckId: nextDeckId,
              entry,
            });
          }
          return next;
        });
      },
    );
    if (creatingDeck) setDeckId(nextDeckId);
    setActiveEntryId(null);
    setCreateOpen(false);
    announce(
      creatingDeck
        ? `Created ${draftName.trim() || 'Untitled presentation'} with ${frames.length} slides`
        : `Added ${frames.length} slides to ${resolution.deck?.name ?? 'the presentation'}`,
    );
  }, [
    announce,
    deckId,
    draftName,
    groupCompoundOperation,
    resolution.deck,
    slideDraftMode,
    slideDrafts,
    state.document.nodes,
    updateDoc,
  ]);

  const focusSlideForEditing = useCallback(
    (frameId: NodeId, entryId: string) => {
      if (editingEntryId === null) previousSelection.current = [...state.selection];
      setSelection(frameId);
      revealSelection({ nodeId: frameId, behavior: 'center' });
      enterIsolation(frameId);
      setEditingEntryId(entryId);
      announce('Editing slide artwork. Return to Slides to restore the previous selection.');
    },
    [announce, editingEntryId, enterIsolation, revealSelection, setSelection, state.selection],
  );

  const returnToSlides = useCallback(() => {
    exitIsolation();
    setSelectionRefs(previousSelection.current);
    setEditingEntryId(null);
  }, [exitIsolation, setSelectionRefs]);

  const focusPreflightTarget = useCallback(
    (nodeId: NodeId) => {
      setSelection(nodeId);
      revealSelection({ nodeId, behavior: 'center' });
    },
    [revealSelection, setSelection],
  );

  const updateEntry = useCallback(
    (entryId: string, update: Record<string, unknown>, label: string) => {
      runOperation(label, 'presentation.slide.update', { deckId, entryId, update });
    },
    [deckId, runOperation],
  );

  const moveSlide = useCallback(
    (entry: PresentationSlideEntry, toIndex: number) => {
      runOperation('Reorder presentation slide', 'presentation.slide.reorder', {
        deckId,
        entryId: entry.id,
        toIndex,
      });
    },
    [deckId, runOperation],
  );

  const duplicateSlide = useCallback(
    (entry: PresentationSlideEntry, index: number) => {
      groupCompoundOperation('Duplicate presentation slide', () => {
        updateDoc((document) => {
          const frame = document.nodes[entry.frameId];
          if (frame?.kind !== 'frame') return document;
          const clone = deepCloneSubtree(document.nodes, document.nextId, frame.id, {
            translate: { x: 40, y: 40 },
            nameSuffix: ' copy',
          });
          const clonedFrame = clone.nodes[clone.rootId];
          if (clonedFrame?.kind !== 'frame') return document;
          const withArtwork = {
            ...document,
            nextId: clone.nextId,
            nodes: { ...document.nodes, ...clone.nodes },
          };
          const parent = Object.values(document.nodes).find(
            (candidate): candidate is ContainerNode =>
              isContainer(candidate) && candidate.children.includes(frame.id),
          );
          const parentIndex = parent?.children?.indexOf(frame.id) ?? -1;
          const sourceRootIndex = document.rootChildren.indexOf(frame.id);
          const placedArtwork =
            parent && parentIndex >= 0
              ? reparentNode(withArtwork, clonedFrame.id, parent.id, parentIndex + 1)
              : sourceRootIndex >= 0
                ? reparentNode(withArtwork, clonedFrame.id, null, sourceRootIndex + 1)
                : withArtwork;
          const layoutBinding = entry.layoutBinding
            ? {
                ...entry.layoutBinding,
                roleNodes: Object.fromEntries(
                  Object.entries(entry.layoutBinding.roleNodes).flatMap(([role, nodeId]) => {
                    const mapped = clone.idMap.get(nodeId);
                    return mapped ? [[role, mapped]] : [];
                  }),
                ),
                ...(entry.layoutBinding.managedBaseline
                  ? {
                      managedBaseline: Object.fromEntries(
                        Object.entries(entry.layoutBinding.managedBaseline).map(
                          ([nodeId, baseline]) => [clone.idMap.get(nodeId) ?? nodeId, baseline],
                        ),
                      ),
                    }
                  : {}),
              }
            : undefined;
          return applyOperation(placedArtwork, 'presentation.slide.add', {
            deckId,
            index: index + 1,
            entry: {
              id: cryptoId(),
              frameId: clonedFrame.id,
              title: `${entry.title} copy`,
              ...(entry.notes ? { notes: entry.notes } : {}),
              ...(entry.skipped !== undefined ? { skipped: entry.skipped } : {}),
              ...(entry.sectionId ? { sectionId: entry.sectionId } : {}),
              ...(layoutBinding ? { layoutBinding } : {}),
              ...(entry.themeId ? { themeId: entry.themeId } : {}),
              ...(entry.language ? { language: entry.language } : {}),
              ...(entry.altText ? { altText: entry.altText } : {}),
              ...(entry.readingOrder
                ? { readingOrder: entry.readingOrder.map((id) => clone.idMap.get(id) ?? id) }
                : {}),
            },
          });
        });
      });
      announce(`Duplicated ${entry.title} and its editable artwork`);
    },
    [announce, deckId, groupCompoundOperation, updateDoc],
  );

  const selectedSlides = resolution.slides.filter(({ entry }) =>
    selectedEntryIds.includes(entry.id),
  );
  const removeSelectedSlides = useCallback(() => {
    runOperations(
      'Remove selected presentation slides',
      selectedSlides.map(({ entry }) => ({
        type: 'presentation.slide.remove',
        payload: { deckId, entryId: entry.id },
      })),
    );
    setSelectedEntryIds([]);
    setActiveEntryId(null);
    announce(
      `Removed ${selectedSlides.length} slide references. The artwork remains on the canvas.`,
    );
  }, [announce, deckId, runOperations, selectedSlides]);

  const toggleSelectedSlideSkip = useCallback(() => {
    const nextSkipped = !selectedSlides.every(({ entry }) => entry.skipped === true);
    runOperations(
      nextSkipped ? 'Skip selected presentation slides' : 'Include selected presentation slides',
      selectedSlides.map(({ entry }) => ({
        type: 'presentation.slide.update',
        payload: { deckId, entryId: entry.id, update: { skipped: nextSkipped } },
      })),
    );
    announce(`${nextSkipped ? 'Skipped' : 'Included'} ${selectedSlides.length} selected slides`);
  }, [announce, deckId, runOperations, selectedSlides]);

  const toggleSelectedSlide = useCallback((entryId: string, selected: boolean) => {
    setSelectedEntryIds((ids) =>
      selected ? [...new Set([...ids, entryId])] : ids.filter((id) => id !== entryId),
    );
  }, []);

  const updateDraft = useCallback((index: number, update: Partial<SlideDraft>) => {
    setSlideDrafts((drafts) =>
      drafts.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...update } : draft)),
    );
  }, []);

  const moveDraft = useCallback((from: number, to: number) => {
    setSlideDrafts((drafts) => moveItem(drafts, from, to));
  }, []);

  const createSection = useCallback(() => {
    const title = sectionNameDraft.trim();
    if (!title || !resolution.deck) return;
    runOperation('Create presentation section', 'presentation.section.create', {
      deckId,
      section: { id: cryptoId(), title },
    });
    setSectionNameDraft('');
    announce(`Created section ${title}`);
  }, [announce, deckId, resolution.deck, runOperation, sectionNameDraft]);

  const renameSection = useCallback(
    (sectionId: string, title: string) => {
      if (!title.trim()) return;
      runOperation('Rename presentation section', 'presentation.section.rename', {
        deckId,
        sectionId,
        title: title.trim(),
      });
    },
    [deckId, runOperation],
  );

  const removeSection = useCallback(
    (sectionId: string) => {
      runOperation('Remove presentation section', 'presentation.section.delete', {
        deckId,
        sectionId,
      });
      announce('Removed section. Slides and their notes remain in the deck.');
    },
    [announce, deckId, runOperation],
  );

  const removeReference = useCallback(
    (entry: PresentationSlideEntry) => {
      runOperation('Remove slide from presentation', 'presentation.slide.remove', {
        deckId,
        entryId: entry.id,
      });
      if (activeEntryId === entry.id) setActiveEntryId(null);
      announce(`Removed ${entry.title} from the presentation. Its artwork remains on the canvas.`);
    },
    [activeEntryId, announce, deckId, runOperation],
  );

  return (
    <div className="presentation-navigator">
      <div className="presentation-navigator__header">
        <div className="presentation-navigator__heading">
          <h2>Slides</h2>
          <span>{resolution.slides.length} slides</span>
        </div>
        <div className="presentation-navigator__header-actions">
          {decks.length > 1 && (
            <label className="presentation-navigator__deck-label">
              <span>Presentation</span>
              <select
                aria-label="Presentation"
                value={deckId}
                onChange={(event) => {
                  setDeckId(event.target.value);
                  setSelectedEntryIds([]);
                  setActiveEntryId(null);
                }}
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showDetach && <PanelDetachButton />}
        </div>
      </div>

      {resolution.deck && (
        <label className="presentation-navigator__deck-title">
          <span>Presentation title</span>
          <input
            key={`${resolution.deck.id}-${resolution.deck.name}`}
            defaultValue={resolution.deck.name}
            maxLength={240}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim();
              if (name && name !== resolution.deck?.name)
                runOperation('Rename presentation', 'presentation.deck.rename', {
                  deckId,
                  name,
                });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </label>
      )}

      <div className="presentation-navigator__toolbar">
        <Button
          size="sm"
          variant="default"
          disabled={!resolution.deck}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent(PRESENTATION_PREVIEW_EVENT, {
                detail: { deckId, ...(activeEntryId ? { entryId: activeEntryId } : {}) },
              }),
            )
          }
        >
          Present
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!resolution.deck}
          onClick={() =>
            window.dispatchEvent(new CustomEvent(PRESENTATION_EXPORT_EVENT, { detail: { deckId } }))
          }
        >
          Export deck…
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={() => openCreateReview(resolution.deck ? 'append' : 'create')}
          disabled={selectedFrames.length === 0}
        >
          {resolution.deck ? 'Add selected frames' : 'Create presentation from selected frames'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOverview((value) => !value)}
          aria-pressed={overview}
        >
          {overview ? 'List view' : 'Overview'}
        </Button>
        {selectedSlides.length > 0 && (
          <>
            <span aria-live="polite">{selectedSlides.length} selected</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent(PRESENTATION_EXPORT_EVENT, {
                    detail: { deckId, slideEntryIds: selectedSlides.map(({ entry }) => entry.id) },
                  }),
                )
              }
            >
              Export selected…
            </Button>
            <Button size="sm" variant="ghost" onClick={toggleSelectedSlideSkip}>
              {selectedSlides.every(({ entry }) => entry.skipped === true)
                ? 'Include selected'
                : 'Skip selected'}
            </Button>
            <Button size="sm" variant="ghost" onClick={removeSelectedSlides}>
              Remove selected
            </Button>
          </>
        )}
      </div>
      {resolution.deck && (
        <PresentationPreflightPanel
          document={state.document}
          deckId={deckId}
          onFocus={focusPreflightTarget}
        />
      )}
      {resolution.deck && (
        <PresentationLayoutManager
          document={state.document}
          deck={resolution.deck}
          slide={
            resolution.slides.find(({ entry }) => entry.id === activeEntryId)?.entry ??
            resolution.slides[0]?.entry
          }
          selectedFrameId={selectedFrames[0]?.id}
          runOperation={runOperation}
        />
      )}
      {resolution.deck && (
        <details className="presentation-navigator__sections">
          <summary>
            Sections <span>{resolution.deck.sections.length}</span>
          </summary>
          <div className="presentation-navigator__section-list">
            <form
              className="presentation-navigator__new-section"
              onSubmit={(event) => {
                event.preventDefault();
                createSection();
              }}
            >
              <label className="presentation-navigator__field">
                <span>New section</span>
                <input
                  value={sectionNameDraft}
                  onChange={(event) => setSectionNameDraft(event.target.value)}
                  maxLength={120}
                  placeholder="Section name"
                />
              </label>
              <Button size="sm" variant="ghost" disabled={!sectionNameDraft.trim()} type="submit">
                Add section
              </Button>
            </form>
            {resolution.deck.sections.map((section) => (
              <div className="presentation-navigator__section" key={section.id}>
                <input
                  key={`${section.id}-${section.title}`}
                  aria-label={`Rename section ${section.title}`}
                  defaultValue={section.title}
                  maxLength={120}
                  onBlur={(event) => {
                    const title = event.currentTarget.value.trim();
                    if (title && title !== section.title) renameSection(section.id, title);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove section ${section.title}`}
                  onClick={() => removeSection(section.id)}
                >
                  Remove section
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}
      {decks.length === 0 ? (
        <p className="presentation-navigator__empty">
          Select frames, then create a presentation to review their order and start a deck.
        </p>
      ) : resolution.slides.length === 0 ? (
        <p className="presentation-navigator__empty">
          This deck has no slides yet. Add selected frames to create a deck.
        </p>
      ) : (
        <ol
          className={`presentation-navigator__slides${overview ? ' presentation-navigator__slides--overview' : ''}`}
          aria-label="Slides in presentation order"
        >
          {resolution.slides.map(({ entry, index, frame, status }) => {
            const active = activeEntryId === entry.id;
            const editing = editingEntryId === entry.id;
            return (
              <li
                className={`presentation-navigator__slide${active ? ' presentation-navigator__slide--active' : ''}${entry.skipped ? ' presentation-navigator__slide--skipped' : ''}`}
                key={entry.id}
              >
                <button
                  type="button"
                  className="presentation-navigator__activate"
                  onClick={() => setActiveEntryId(entry.id)}
                  aria-pressed={active}
                  aria-label={`Select slide ${index + 1}: ${entry.title}`}
                >
                  <span className="presentation-navigator__number">{index + 1}</span>
                  <PresentationThumbnail
                    document={state.document}
                    entry={entry}
                    revision={state.revision}
                  />
                  <span className="presentation-navigator__title">{entry.title}</span>
                  <span className="presentation-navigator__status">
                    {status === 'ready'
                      ? entry.skipped
                        ? 'Skipped'
                        : ''
                      : status === 'missing'
                        ? 'Missing artwork'
                        : 'Invalid frame'}
                  </span>
                </button>
                <label className="presentation-navigator__select">
                  <input
                    type="checkbox"
                    checked={selectedEntryIds.includes(entry.id)}
                    onChange={(event) => toggleSelectedSlide(entry.id, event.currentTarget.checked)}
                    aria-label={`Select ${entry.title} for multi-slide actions`}
                  />
                </label>
                <div className="presentation-navigator__slide-actions">
                  {editing ? (
                    <Button size="sm" variant="ghost" onClick={returnToSlides}>
                      Return to Slides
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!frame}
                      onClick={() => frame && focusSlideForEditing(frame.id, entry.id)}
                    >
                      Edit slide
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === 0}
                    aria-label={`Move ${entry.title} earlier`}
                    onClick={() => moveSlide(entry, index - 1)}
                  >
                    Earlier
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!frame}
                    onClick={() => duplicateSlide(entry, index)}
                  >
                    Duplicate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === resolution.slides.length - 1}
                    aria-label={`Move ${entry.title} later`}
                    onClick={() => moveSlide(entry, index + 1)}
                  >
                    Later
                  </Button>
                  <NumberInput
                    aria-label={`Move ${entry.title} to position`}
                    value={index + 1}
                    min={1}
                    max={resolution.slides.length}
                    onChange={(position) =>
                      moveSlide(
                        entry,
                        Math.max(
                          0,
                          Math.min(resolution.slides.length - 1, Math.round(position) - 1),
                        ),
                      )
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      updateEntry(entry.id, { skipped: !entry.skipped }, 'Change slide skip state')
                    }
                    aria-pressed={entry.skipped === true}
                  >
                    {entry.skipped ? 'Include' : 'Skip'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeReference(entry)}
                    aria-label={`Remove ${entry.title} from deck`}
                  >
                    Remove
                  </Button>
                </div>
                <label className="presentation-navigator__field">
                  <span>Slide title</span>
                  <input
                    key={`${entry.id}-${entry.title}`}
                    defaultValue={entry.title}
                    maxLength={240}
                    onBlur={(event) => {
                      const title = event.currentTarget.value.trim() || 'Untitled slide';
                      if (title !== entry.title)
                        updateEntry(entry.id, { title }, 'Rename presentation slide');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                </label>
                <label className="presentation-navigator__field">
                  <span>Section</span>
                  <select
                    aria-label={`Section for ${entry.title}`}
                    value={entry.sectionId ?? ''}
                    onChange={(event) =>
                      updateEntry(
                        entry.id,
                        { sectionId: event.target.value || null },
                        'Assign presentation section',
                      )
                    }
                  >
                    <option value="">No section</option>
                    {resolution.deck?.sections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="presentation-navigator__field">
                  <span>Speaker notes (private)</span>
                  <textarea
                    key={`${entry.id}-${entry.notes ?? ''}`}
                    defaultValue={entry.notes ?? ''}
                    maxLength={250_000}
                    rows={overview ? 2 : 3}
                    onBlur={(event) => {
                      const notes = event.currentTarget.value;
                      if (notes !== (entry.notes ?? ''))
                        updateEntry(entry.id, { notes: notes || null }, 'Edit speaker notes');
                    }}
                  />
                </label>
              </li>
            );
          })}
        </ol>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={
          slideDraftMode === 'create' ? 'Review presentation order' : 'Review added slide order'
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="default" onClick={createFromDraft} disabled={slideDrafts.length === 0}>
              {slideDraftMode === 'create' ? 'Create presentation' : 'Add slides'}
            </Button>
          </>
        }
      >
        <div className="presentation-navigator__review">
          <label className="presentation-navigator__field">
            <span>{slideDraftMode === 'create' ? 'Presentation name' : 'Presentation'}</span>
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              maxLength={240}
            />
          </label>
          <p>
            Review the order before creating a deck. This adds references to the selected frames; it
            does not duplicate or move their artwork.
          </p>
          <ol aria-label="Proposed slide order">
            {slideDrafts.map((draft, index) => (
              <li key={draft.frameId}>
                <span>{index + 1}</span>
                <input
                  aria-label={`Slide ${index + 1} title`}
                  value={draft.title}
                  onChange={(event) => updateDraft(index, { title: event.target.value })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  aria-label={`Move slide ${index + 1} earlier`}
                  onClick={() => moveDraft(index, index - 1)}
                >
                  Earlier
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index === slideDrafts.length - 1}
                  aria-label={`Move slide ${index + 1} later`}
                  onClick={() => moveDraft(index, index + 1)}
                >
                  Later
                </Button>
                <NumberInput
                  aria-label={`Move slide ${index + 1} to position`}
                  value={index + 1}
                  min={1}
                  max={slideDrafts.length}
                  onChange={(position) =>
                    moveDraft(
                      index,
                      Math.max(0, Math.min(slideDrafts.length - 1, Math.round(position) - 1)),
                    )
                  }
                />
              </li>
            ))}
          </ol>
        </div>
      </Dialog>
    </div>
  );
}
