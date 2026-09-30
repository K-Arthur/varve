import {
  cryptoId,
  type Document,
  describePresentationLayoutOverrides,
  isPresentationLayoutSourceOutdated,
  type NodeId,
  PRESENTATION_BUILT_IN_LAYOUTS,
  type PresentationBuiltInLayoutId,
  type PresentationDeck,
  type PresentationLayoutPreview,
  type PresentationLayoutReflowMode,
  type PresentationSlideEntry,
  previewPresentationLayout,
  type SceneNode,
  supportsPresentationLayoutNode,
} from '@varve/scene';
import { Button, Dialog } from '@varve/ui';
import { useMemo, useState } from 'react';

interface PresentationLayoutManagerProps {
  document: Document;
  deck: PresentationDeck;
  slide: PresentationSlideEntry | undefined;
  selectedFrameId?: NodeId;
  runOperation: (label: string, type: string, payload: unknown) => void;
}

type FrameNode = Extract<SceneNode, { kind: 'frame' }>;

function ordinaryFrames(document: Document): FrameNode[] {
  const presentationFrames = new Set(
    document.presentation?.decks.flatMap((candidate) =>
      candidate.slides.map((slide) => slide.frameId),
    ) ?? [],
  );
  return Object.values(document.nodes).filter(
    (node): node is FrameNode =>
      node.kind === 'frame' &&
      node.frameRole !== 'exportRegion' &&
      !presentationFrames.has(node.id),
  );
}

function roleName(node: SceneNode): string {
  const name =
    node.name
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') ?? '';
  return name.replace(/^-|-$/g, '') || node.kind;
}

function compatibleNode(source: SceneNode, target: SceneNode): boolean {
  return supportsPresentationLayoutNode(source, target);
}

export function PresentationLayoutManager({
  document,
  deck,
  slide,
  selectedFrameId,
  runOperation,
}: PresentationLayoutManagerProps) {
  const sources = document.presentation?.layouts ?? [];
  const frames = useMemo(() => ordinaryFrames(document), [document]);
  const [layoutName, setLayoutName] = useState('Reusable layout');
  const [builtInLayoutId, setBuiltInLayoutId] = useState<PresentationBuiltInLayoutId>(
    PRESENTATION_BUILT_IN_LAYOUTS[0]!.id,
  );
  const [sourceFrameId, setSourceFrameId] = useState('');
  const [roleDraft, setRoleDraft] = useState<Record<string, string>>({});
  const [sourceId, setSourceId] = useState('');
  const [targetRoles, setTargetRoles] = useState<Record<string, NodeId>>({});
  const [mode, setMode] = useState<PresentationLayoutReflowMode>('reflow');
  const [preview, setPreview] = useState<PresentationLayoutPreview | null>(null);
  const [error, setError] = useState('');

  const sourceFrame =
    frames.find((frame) => frame.id === sourceFrameId) ??
    frames.find((frame) => frame.id === selectedFrameId) ??
    frames[0];
  const selectedSource = sources.find((source) => source.id === sourceId);
  const layoutFrame = selectedSource ? document.nodes[selectedSource.frameId] : undefined;
  const targetFrame = slide ? document.nodes[slide.frameId] : undefined;
  const targetChildren =
    targetFrame?.kind === 'frame'
      ? targetFrame.children.flatMap((nodeId) => {
          const node = document.nodes[nodeId];
          return node ? [node] : [];
        })
      : [];
  const boundOutdated = selectedSource
    ? deck.slides.filter(
        (entry) =>
          entry.layoutBinding?.sourceId === selectedSource.id &&
          (entry.layoutBinding.appliedRevision < selectedSource.revision ||
            isPresentationLayoutSourceOutdated(document, selectedSource)),
      ).length
    : 0;
  const overrides = useMemo(
    () => (slide ? describePresentationLayoutOverrides(document, deck.id, slide.id) : null),
    [document, deck.id, slide],
  );

  const registerSource = () => {
    if (!sourceFrame) return;
    const roleNodes: Record<string, NodeId> = {};
    for (const nodeId of sourceFrame.children) {
      const node = document.nodes[nodeId];
      const role = roleDraft[nodeId]?.trim() || (node ? roleName(node) : '');
      if (!node || !role) continue;
      if (Object.hasOwn(roleNodes, role)) {
        setError(`Role “${role}” is used more than once. Give each layout role a unique name.`);
        return;
      }
      roleNodes[role] = nodeId;
    }
    if (Object.keys(roleNodes).length === 0) {
      setError('Add at least one direct child to the source frame and assign it a role.');
      return;
    }
    const id = `layout-${crypto.randomUUID()}`;
    runOperation('Register presentation layout source', 'presentation.layout.register', {
      source: {
        id,
        name: layoutName.trim() || 'Reusable layout',
        frameId: sourceFrame.id,
        revision: 1,
        roleNodes,
      },
    });
    setSourceId(id);
    setError('');
  };

  const addBuiltInLayout = () => {
    const sourceId = `layout-${cryptoId()}`;
    runOperation('Create built-in presentation layout', 'presentation.layout.builtin.create', {
      deckId: deck.id,
      sourceId,
      templateId: builtInLayoutId,
    });
    setSourceId(sourceId);
    setTargetRoles({});
    setPreview(null);
    setError('');
  };

  const updateSource = () => {
    if (!selectedSource) return;
    const frame = document.nodes[selectedSource.frameId];
    if (frame?.kind !== 'frame') return;
    const roleNodes = Object.fromEntries(
      Object.entries(selectedSource.roleNodes).filter(([, nodeId]) =>
        frame.children.includes(nodeId),
      ),
    );
    runOperation('Refresh presentation layout source', 'presentation.layout.update', {
      sourceId: selectedSource.id,
      name: selectedSource.name,
      frameId: frame.id,
      roleNodes,
    });
  };

  const buildPreview = () => {
    if (!slide || !selectedSource) return;
    try {
      const mapped = Object.fromEntries(
        Object.entries(selectedSource.roleNodes).flatMap(([role]) =>
          targetRoles[role] ? [[role, targetRoles[role]!]] : [],
        ),
      );
      setPreview(
        previewPresentationLayout(document, deck.id, slide.id, selectedSource.id, mapped, mode),
      );
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not preview this layout.');
    }
  };

  const applyPreview = () => {
    if (!preview || !selectedSource || !slide) return;
    try {
      const current = previewPresentationLayout(
        document,
        deck.id,
        slide.id,
        selectedSource.id,
        preview.roleNodes,
        preview.mode,
      );
      if (JSON.stringify(current) !== JSON.stringify(preview)) {
        setError(
          'The slide changed after this preview. Preview the latest layout before applying.',
        );
        return;
      }
      runOperation('Apply presentation layout', 'presentation.layout.apply', { preview });
      setPreview(null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply this layout.');
    }
  };

  return (
    <details className="presentation-layouts">
      <summary>
        Reusable layouts <span>{sources.length}</span>
      </summary>
      <div className="presentation-layouts__body">
        <p>
          Choose an original native layout or register a frame as a geometry source. Reapplying
          changes only mapped role geometry; slide text, fills, effects, images, and extra artwork
          stay editable.
        </p>
        <div className="presentation-layouts__register">
          <strong>Original native layouts</strong>
          <p>
            These editable text and vector sources use the bundled font and work offline. Edit them
            on the Presentation Layouts Design Canvas.
          </p>
          <label className="presentation-navigator__field">
            <span>Built-in layout</span>
            <select
              aria-label="Built-in layout"
              value={builtInLayoutId}
              onChange={(event) =>
                setBuiltInLayoutId(event.target.value as PresentationBuiltInLayoutId)
              }
            >
              {PRESENTATION_BUILT_IN_LAYOUTS.map((layout) => (
                <option key={layout.id} value={layout.id}>
                  {layout.name} · {layout.description}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="default" onClick={addBuiltInLayout}>
            Add editable layout source
          </Button>
        </div>
        {sources.length > 0 && (
          <label className="presentation-navigator__field">
            <span>Layout source</span>
            <select
              aria-label="Layout source"
              value={sourceId}
              onChange={(event) => {
                setSourceId(event.target.value);
                setTargetRoles({});
                setPreview(null);
              }}
            >
              <option value="">Choose layout</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {selectedSource && (
          <>
            <p className="presentation-layouts__status">
              Revision {selectedSource.revision}
              {isPresentationLayoutSourceOutdated(document, selectedSource)
                ? ' · source edits need review'
                : ''}
              {boundOutdated ? ` · ${boundOutdated} slide(s) need reapplication` : ''}
            </p>
            <div className="presentation-layouts__actions">
              <Button size="sm" variant="ghost" onClick={updateSource}>
                Mark source revised
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  runOperation('Remove presentation layout source', 'presentation.layout.delete', {
                    sourceId: selectedSource.id,
                  });
                  setSourceId('');
                }}
              >
                Remove source
              </Button>
            </div>
          </>
        )}
        {frames.length > 0 && (
          <div className="presentation-layouts__register">
            <strong>Register a source frame</strong>
            <label className="presentation-navigator__field">
              <span>Source frame</span>
              <select
                aria-label="Source frame"
                value={sourceFrame?.id ?? ''}
                onChange={(event) => {
                  setSourceFrameId(event.target.value);
                  setRoleDraft({});
                  setError('');
                }}
              >
                {frames.map((frame) => (
                  <option key={frame.id} value={frame.id}>
                    {frame.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="presentation-navigator__field">
              <span>Layout name</span>
              <input
                value={layoutName}
                maxLength={240}
                onChange={(event) => setLayoutName(event.target.value)}
              />
            </label>
            {sourceFrame?.children.map((nodeId) => {
              const node = document.nodes[nodeId];
              if (!node) return null;
              return (
                <label className="presentation-navigator__field" key={nodeId}>
                  <span>{node.name || node.kind} role</span>
                  <input
                    aria-label={`Role for ${node.name || node.kind}`}
                    value={roleDraft[nodeId] ?? roleName(node)}
                    maxLength={100}
                    onChange={(event) =>
                      setRoleDraft((roles) => ({ ...roles, [nodeId]: event.target.value }))
                    }
                  />
                </label>
              );
            })}
            <Button size="sm" variant="default" onClick={registerSource}>
              Register layout source
            </Button>
          </div>
        )}
        {selectedSource &&
          slide &&
          layoutFrame?.kind === 'frame' &&
          targetFrame?.kind === 'frame' && (
            <div className="presentation-layouts__apply">
              <strong>Preview on “{slide.title}”</strong>
              {Object.entries(selectedSource.roleNodes).map(([role, sourceNodeId]) => {
                const sourceNode = document.nodes[sourceNodeId];
                const candidates = targetChildren.filter(
                  (target) => sourceNode && compatibleNode(sourceNode, target),
                );
                return (
                  <label className="presentation-navigator__field" key={role}>
                    <span>{role}</span>
                    <select
                      aria-label={`Slide object for ${role}`}
                      value={
                        targetChildren.some((target) => target.id === targetRoles[role])
                          ? targetRoles[role]
                          : ''
                      }
                      onChange={(event) =>
                        setTargetRoles((roles) => ({ ...roles, [role]: event.target.value }))
                      }
                    >
                      <option value="">Leave unmatched</option>
                      {candidates.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.name || target.kind}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              <label className="presentation-navigator__field">
                <span>Aspect ratio change</span>
                <select
                  aria-label="Aspect ratio change"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as PresentationLayoutReflowMode)}
                >
                  <option value="reflow">Preview reflow</option>
                  <option value="fit">Uniform fit</option>
                  <option value="crop">Uniform crop</option>
                </select>
              </label>
              <Button size="sm" variant="default" onClick={buildPreview}>
                Preview and reapply…
              </Button>
            </div>
          )}
        {overrides && slide && (
          <div className="presentation-layouts__overrides">
            <strong>Layout on “{slide.title}”</strong>
            <p className="presentation-layouts__status">
              {overrides.sourceName} · applied revision {overrides.appliedRevision}
              {overrides.sourceOutdated
                ? ` · source is now revision ${overrides.sourceRevision}; reapply to catch up`
                : ''}
            </p>
            <ul className="presentation-layouts__override-list">
              {overrides.nodes.map((node) => (
                <li key={node.nodeId} className="presentation-layouts__override-item">
                  <span className="presentation-layouts__override-name">
                    {node.nodeName}
                    {node.role ? ` · ${node.role}` : ''}
                  </span>
                  <span
                    className={`presentation-layouts__badge presentation-layouts__badge--${node.status}`}
                  >
                    {node.status === 'inherited'
                      ? 'Inherited'
                      : node.status === 'overridden'
                        ? 'Locally changed'
                        : 'Object removed'}
                  </span>
                  {node.properties
                    .filter((property) => property.status === 'overridden')
                    .map((property) => (
                      <Button
                        key={property.key}
                        size="sm"
                        variant="ghost"
                        aria-label={`Reset ${property.key} of ${node.nodeName} to the layout`}
                        onClick={() =>
                          runOperation(
                            `Reset ${property.key} to the layout`,
                            'presentation.layout.overrides.reset',
                            {
                              deckId: deck.id,
                              entryId: slide.id,
                              nodeId: node.nodeId,
                              property: property.key,
                            },
                          )
                        }
                      >
                        Reset {property.key}
                      </Button>
                    ))}
                </li>
              ))}
            </ul>
            <div className="presentation-layouts__actions">
              <Button
                size="sm"
                variant="ghost"
                disabled={overrides.overriddenPropertyCount === 0}
                onClick={() =>
                  runOperation('Reset layout overrides', 'presentation.layout.overrides.reset', {
                    deckId: deck.id,
                    entryId: slide.id,
                  })
                }
              >
                Reset all to layout
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  runOperation('Detach layout from slide', 'presentation.layout.detach', {
                    deckId: deck.id,
                    entryId: slide.id,
                  })
                }
              >
                Detach layout (keep appearance)
              </Button>
            </div>
            <p className="presentation-layouts__hint">
              Reset restores the layout geometry and leaves text, fills, effects, and this
              slide&apos;s identity untouched. Detaching stops tracking the layout only: every
              object keeps its current position, size, and appearance.
            </p>
          </div>
        )}
        {error && (
          <p className="presentation-layouts__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="Review layout changes"
        size="lg"
        focusFirstControl
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button variant="default" onClick={applyPreview}>
              Apply layout
            </Button>
          </>
        }
      >
        {preview && (
          <div className="presentation-layouts__review">
            <p>
              {preview.changes.length} object(s) will receive geometry changes. Rich content, fills,
              effects, and unmatched artwork remain unchanged.
            </p>
            {preview.changes.some((change) => change.preservedOverrides.length > 0) && (
              <p>
                Local overrides kept:{' '}
                {preview.changes.flatMap((change) => change.preservedOverrides).join(', ')}.
              </p>
            )}
            {preview.warnings.length > 0 && (
              <ul>
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            {preview.changes.length === 0 && <p>No compatible mapped objects will change.</p>}
          </div>
        )}
        {error && (
          <p className="presentation-layouts__error" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </details>
  );
}
