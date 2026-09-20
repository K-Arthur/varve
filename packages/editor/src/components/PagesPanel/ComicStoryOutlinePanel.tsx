import {
  type ComicProductionStatus,
  type Document,
  type StoryOutlineEntry,
  setStoryStatus,
} from '@varve/scene';
import { Button, Select } from '@varve/ui';
import { type ReactElement, useCallback, useMemo } from 'react';
import { useEditor } from '../../context';
import {
  linkPageDialogue,
  linkPagePanels,
  pageDialogueStoryIds,
  pagePanelIdsInReadingOrder,
} from './storyOutline';

const STATUS_OPTIONS: Array<{ value: ComicProductionStatus; label: string }> = [
  { value: 'planned', label: 'Planned' },
  { value: 'rough', label: 'Rough' },
  { value: 'inked', label: 'Inked' },
  { value: 'lettered', label: 'Lettered' },
  { value: 'finished', label: 'Finished' },
];

function entryPatch(
  doc: Document,
  entryId: string,
  patch: (entry: StoryOutlineEntry, doc: Document) => StoryOutlineEntry,
): Document {
  return {
    ...doc,
    storyOutline: {
      version: 1,
      entries: (doc.storyOutline?.entries ?? []).map((candidate) =>
        candidate.id === entryId ? patch(candidate, doc) : candidate,
      ),
      updatedAt: Date.now(),
    },
  };
}

/**
 * Story-outline surface embedded in the existing Pages panel.
 *
 * Entries are references: panel order and dialogue order are derived from the
 * page's real nodes and stories on demand, never copied. The page remains the
 * single source of truth; this panel records production intent (status, notes,
 * reading order) around it.
 */
export function ComicStoryOutlinePanel(): ReactElement | null {
  const { state, updateDoc } = useEditor();
  const profile = state.document.workflowProfile;
  const pageId = state.document.activePageId;
  const entries = state.document.storyOutline?.entries ?? [];
  const current = useMemo(
    () => (pageId ? entries.find((entry) => entry.pageId === pageId) : undefined),
    [entries, pageId],
  );

  const pagePanels = useMemo(
    () =>
      pagePanelIdsInReadingOrder(state.document, pageId, state.document.readingDirection ?? 'ltr'),
    [state.document, pageId],
  );
  const pageDialogue = useMemo(
    () => pageDialogueStoryIds(state.document, pageId),
    [state.document, pageId],
  );

  const createEntry = useCallback(() => {
    if (!pageId) return;
    updateDoc((doc) => ({
      ...doc,
      storyOutline: {
        version: 1,
        entries: [
          ...(doc.storyOutline?.entries ?? []),
          {
            id: `outline-${pageId}`,
            pageId,
            title: doc.pages?.find((page) => page.id === pageId)?.name,
            status: 'planned',
            panelIds: [],
            dialogueStoryIds: [],
          },
        ],
        updatedAt: Date.now(),
      },
    }));
  }, [pageId, updateDoc]);

  const updateEntry = useCallback(
    (entry: StoryOutlineEntry, patch: Partial<StoryOutlineEntry>) => {
      updateDoc((doc) => entryPatch(doc, entry.id, (candidate) => ({ ...candidate, ...patch })));
    },
    [updateDoc],
  );

  const linkPanels = useCallback(() => {
    if (!current) return;
    updateDoc((doc) =>
      entryPatch(doc, current.id, (entry, source) =>
        linkPagePanels(entry, source, source.readingDirection ?? 'ltr'),
      ),
    );
  }, [current, updateDoc]);

  const linkDialogue = useCallback(() => {
    if (!current) return;
    updateDoc((doc) =>
      entryPatch(doc, current.id, (entry, source) => linkPageDialogue(entry, source)),
    );
  }, [current, updateDoc]);

  if (!profile || !pageId) return null;

  const panelNames = (ids: string[]): string =>
    ids.map((id) => state.document.nodes[id]?.name ?? 'Missing panel').join(', ');
  const dialogueNames = (ids: string[]): string =>
    ids
      .map((id) => {
        const story = state.document.stories?.[id];
        if (!story) return 'Missing dialogue';
        const kind = story.dialogueKind ? ` (${story.dialogueKind})` : '';
        return `${story.speaker ?? story.name}${kind}`;
      })
      .join(', ');

  return (
    <section className="pages-panel__story-outline" aria-label="Comic story outline">
      <div className="pages-panel__story-outline-header">
        <strong>Story outline</strong>
        {!current && (
          <Button variant="ghost" size="sm" onClick={createEntry}>
            Add outline entry
          </Button>
        )}
      </div>
      {current ? (
        <div className="pages-panel__story-outline-fields">
          <label className="pages-panel__story-outline-field">
            <span>Title</span>
            <input
              value={current.title ?? ''}
              placeholder="Page or scene title"
              onChange={(event) => updateEntry(current, { title: event.target.value })}
            />
          </label>
          <div className="pages-panel__story-outline-field">
            <span>Status</span>
            <Select
              value={current.status}
              label="Status"
              onChange={(value) =>
                updateDoc((doc) => setStoryStatus(doc, current.id, value as ComicProductionStatus))
              }
              options={STATUS_OPTIONS}
            />
          </div>
          <label className="pages-panel__story-outline-field">
            <span>Notes</span>
            <textarea
              value={current.notes ?? ''}
              placeholder="Production notes"
              onChange={(event) => updateEntry(current, { notes: event.target.value })}
            />
          </label>
          <div className="pages-panel__story-outline-link">
            <div>
              <strong>Panels in reading order</strong>
              <span aria-live="polite">
                {current.panelIds.length > 0 ? panelNames(current.panelIds) : 'None linked'}
              </span>
            </div>
            <div className="pages-panel__story-outline-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={linkPanels}
                disabled={pagePanels.length === 0}
              >
                Link page panels ({pagePanels.length})
              </Button>
              {current.panelIds.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateEntry(current, { panelIds: [] })}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
          <div className="pages-panel__story-outline-link">
            <div>
              <strong>Dialogue order</strong>
              <span aria-live="polite">
                {current.dialogueStoryIds.length > 0
                  ? dialogueNames(current.dialogueStoryIds)
                  : 'None linked'}
              </span>
            </div>
            <div className="pages-panel__story-outline-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={linkDialogue}
                disabled={pageDialogue.length === 0}
              >
                Link page dialogue ({pageDialogue.length})
              </Button>
              {current.dialogueStoryIds.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateEntry(current, { dialogueStoryIds: [] })}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p>Add an outline entry for this page to track panels and lettering.</p>
      )}
    </section>
  );
}
