/**
 * InteractionSection — full prototype interaction editor for selected nodes.
 */

import type { ActionKind, TransitionConfig, TriggerKind } from '@varve/prototype';
import type { DocumentInteraction } from '@varve/scene';
import { Button, Icon, Select } from '@varve/ui';
import { useEffect, useRef } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

const TRIGGER_OPTIONS: { value: TriggerKind; label: string }[] = [
  { value: 'onClick', label: 'On click' },
  { value: 'onHover', label: 'On hover' },
  { value: 'onKeyPress', label: 'On key press' },
  { value: 'afterDelay', label: 'After delay' },
  { value: 'onLoad', label: 'On load' },
];

const ACTION_OPTIONS: { value: ActionKind; label: string }[] = [
  { value: 'navigateTo', label: 'Navigate to' },
  { value: 'openOverlay', label: 'Open overlay' },
  { value: 'closeOverlay', label: 'Close overlay' },
  { value: 'startAnimation', label: 'Play animation' },
  { value: 'stopAnimation', label: 'Stop animation' },
  { value: 'setVariable', label: 'Set variable' },
  { value: 'toggleVisibility', label: 'Toggle visibility' },
];

const TRANSITION_OPTIONS: TransitionConfig['kind'][] = [
  'instant',
  'dissolve',
  'slide',
  'smartAnimate',
];

const TRANSITION_LABELS: Record<string, string> = {
  instant: 'Instant',
  dissolve: 'Dissolve',
  slide: 'Slide',
  smartAnimate: 'Smart Animate',
};

const DEFAULT_TRIGGER = { kind: 'onClick' as const };
const DEFAULT_ACTION = {
  kind: 'navigateTo' as const,
  targetId: '',
  transition: { kind: 'dissolve' as const, duration: 300, easing: { kind: 'ease' as const } },
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function InteractionSection() {
  const {
    selectedNodes,
    selectedInteractionId,
    getNodeInteractions,
    addNodeInteraction,
    removeNodeInteraction,
    updateNodeInteraction,
    getPrototypeScreens,
    state,
  } = useEditor();
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const nodes = selectedNodes();

  useEffect(() => {
    if (!selectedInteractionId) return;
    const row = rowRefs.current.get(selectedInteractionId);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedInteractionId, nodes.length]);

  if (nodes.length !== 1) return null;
  const node = nodes[0];
  if (!node) return null;

  const interactions = getNodeInteractions(node.id);
  const screens = getPrototypeScreens();
  const timelineOptions = state.document.timelines
    ? Object.values(state.document.timelines).map((t) => ({ value: t.id, label: t.name }))
    : [];

  const patchInteraction = (ix: DocumentInteraction, updates: Partial<DocumentInteraction>) => {
    updateNodeInteraction(ix.id, updates);
  };

  return (
    <DisclosureSection title="Prototype Interactions" defaultExpanded>
      {interactions.length === 0 ? (
        <p className="insp-panel__empty-hint">No interactions on this layer.</p>
      ) : (
        <ul className="insp-interaction-list">
          {interactions.map((ix) => {
            const trigger = asRecord(ix.trigger);
            const actions = Array.isArray(ix.actions) ? ix.actions : [];
            const primary = asRecord(actions[0]);
            const transition = asRecord(primary.transition) as Partial<TransitionConfig>;
            return (
              <li
                key={ix.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(ix.id, el);
                  else rowRefs.current.delete(ix.id);
                }}
                data-interaction-id={ix.id}
                className={`insp-interaction-row insp-interaction-row--expanded${selectedInteractionId === ix.id ? ' insp-interaction-row--selected' : ''}`}
              >
                <div className="insp-interaction-row__header">
                  <input
                    type="text"
                    className="insp-interaction-row__name-input"
                    value={ix.name}
                    aria-label="Interaction name"
                    onChange={(e) => patchInteraction(ix, { name: e.target.value })}
                  />
                  <label className="insp-interaction-row__enabled">
                    <input
                      type="checkbox"
                      className="insp-checkbox"
                      checked={ix.enabled}
                      onChange={(e) => patchInteraction(ix, { enabled: e.target.checked })}
                    />
                    <span>Enabled</span>
                  </label>
                  <button
                    type="button"
                    className="insp-interaction-row__remove"
                    aria-label={`Remove interaction ${ix.name}`}
                    onClick={() => removeNodeInteraction(ix.id)}
                  >
                    <Icon name="Trash2" size={14} label="Remove" />
                  </button>
                </div>

                <div className="insp-interaction-row__field">
                  <Select
                    label="Trigger"
                    value={String(trigger.kind ?? 'onClick')}
                    options={TRIGGER_OPTIONS}
                    onChange={(v) =>
                      patchInteraction(ix, {
                        trigger: { ...trigger, kind: v },
                      })
                    }
                  />
                </div>

                <div className="insp-interaction-row__field">
                  <Select
                    label="Action"
                    value={String(primary.kind ?? 'navigateTo')}
                    options={ACTION_OPTIONS}
                    onChange={(v) => {
                      const kind = v as ActionKind;
                      const nextAction =
                        kind === 'navigateTo'
                          ? { ...DEFAULT_ACTION, kind, targetId: String(primary.targetId ?? '') }
                          : kind === 'startAnimation'
                            ? { kind, animationId: String(primary.animationId ?? '') }
                            : {
                                kind,
                                ...(kind === 'setVariable' ? { variableId: '', value: '' } : {}),
                              };
                      patchInteraction(ix, { actions: [nextAction] });
                    }}
                  />
                </div>

                {(primary.kind === 'navigateTo' || primary.kind === 'openOverlay') && (
                  <div className="insp-interaction-row__field">
                    <Select
                      label="Target screen"
                      value={String(primary.targetId ?? '')}
                      placeholder="Select screen..."
                      options={screens.map((s) => ({ value: s.id, label: s.name }))}
                      onChange={(v) =>
                        patchInteraction(ix, {
                          actions: [{ ...primary, targetId: v }],
                        })
                      }
                    />
                  </div>
                )}

                {primary.kind === 'startAnimation' && (
                  <div className="insp-interaction-row__field">
                    <Select
                      label="Target animation"
                      value={String(primary.animationId ?? '')}
                      placeholder="Select timeline..."
                      options={timelineOptions}
                      onChange={(v) =>
                        patchInteraction(ix, {
                          actions: [{ ...primary, animationId: v }],
                        })
                      }
                    />
                  </div>
                )}

                {primary.kind === 'navigateTo' && (
                  <>
                    <div className="insp-interaction-row__field">
                      <Select
                        label="Transition"
                        value={String(transition.kind ?? 'dissolve')}
                        options={TRANSITION_OPTIONS.map((k) => ({
                          value: k,
                          label: TRANSITION_LABELS[k] ?? k,
                        }))}
                        onChange={(v) =>
                          patchInteraction(ix, {
                            actions: [
                              {
                                ...primary,
                                transition: {
                                  ...transition,
                                  kind: v,
                                  duration: transition.duration ?? 300,
                                  easing: transition.easing ?? { kind: 'ease' },
                                },
                              },
                            ],
                          })
                        }
                      />
                    </div>
                    <div className="insp-interaction-row__field">
                      <label htmlFor={`${ix.id}-duration`}>Duration (ms)</label>
                      <input
                        id={`${ix.id}-duration`}
                        type="number"
                        min={0}
                        max={10000}
                        step={50}
                        value={Number(transition.duration ?? 300)}
                        onChange={(e) =>
                          patchInteraction(ix, {
                            actions: [
                              {
                                ...primary,
                                transition: {
                                  ...transition,
                                  kind: (transition.kind as TransitionConfig['kind']) ?? 'dissolve',
                                  duration: Number(e.target.value),
                                  easing: transition.easing ?? { kind: 'ease' },
                                },
                              },
                            ],
                          })
                        }
                      />
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          const payload: Omit<DocumentInteraction, 'id' | 'nodeId'> = {
            name: `Interaction ${interactions.length + 1}`,
            trigger: DEFAULT_TRIGGER,
            actions: [DEFAULT_ACTION],
            enabled: true,
          };
          addNodeInteraction(node.id, payload);
        }}
      >
        Add Interaction
      </Button>
    </DisclosureSection>
  );
}
