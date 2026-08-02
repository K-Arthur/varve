/**
 * StateMachineSection — inspector for complex prototype state machines.
 *
 * Provides a complete editor for states, transitions, triggers, guards,
 * priorities, and inputs. Surfaces validation warnings from
 * `validateStateMachine`. Uses progressive disclosure: common transitions
 * are simple; advanced conditions and actions live in expandable sections.
 *
 * Research basis: Rive State Machine editor, Figma variant/condition UX,
 * APG Disclosure/Spinbox/Combobox patterns.
 */

import type { SMTransitionTrigger, SMValidationIssue, StateMachine } from '@strata/scene';
import type { EasingDefinition } from '@strata/shared';
import { Button, Icon, NumberInput, Select, Tooltip } from '@strata/ui';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

const TRIGGER_OPTIONS: { value: SMTransitionTrigger; label: string }[] = [
  { value: 'onClick', label: 'On click' },
  { value: 'onHover', label: 'On hover' },
  { value: 'onPointerDown', label: 'Pointer down' },
  { value: 'onPointerUp', label: 'Pointer up' },
  { value: 'onKeyPress', label: 'Key press' },
  { value: 'onTimer', label: 'Timer' },
  { value: 'onDragEnd', label: 'Drag end' },
  { value: 'onVariableChange', label: 'Variable change' },
  { value: 'onTimelineEnd', label: 'Timeline end' },
  { value: 'onMediaEvent', label: 'Media event' },
];

const EASING_OPTIONS: { value: EasingDefinition['kind']; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease', label: 'Ease' },
  { value: 'easeIn', label: 'Ease in' },
  { value: 'easeOut', label: 'Ease out' },
  { value: 'easeInOut', label: 'Ease in-out' },
  { value: 'cubicBezier', label: 'Cubic bezier' },
  { value: 'spring', label: 'Spring' },
  { value: 'steps', label: 'Steps' },
];

export function StateMachineSection() {
  const {
    getStateMachines,
    getPrimaryStateMachineId,
    selectedStateMachineId,
    selectedSMStateId,
    selectedSMTransitionId,
    createStateMachine,
    removeStateMachine,
    addSMState,
    removeSMState,
    renameSMState,
    duplicateSMState,
    setSMEntryState,
    addSMTransition,
    removeSMTransition,
    setSMTransitionTrigger,
    setSMTransitionTarget,
    setSMTransitionCondition,
    setSMTransitionPriority,
    setSMTransitionDuration,
    setSMTransitionEasing,
    addSMInput,
    removeSMInput,
    validateStateMachine,
    selectStateMachine,
    selectSMState,
    selectSMTransition,
  } = useEditor();

  const machines = getStateMachines();
  const primaryId = getPrimaryStateMachineId();
  const smId = selectedStateMachineId ?? primaryId;

  const sm: StateMachine | undefined = useMemo(
    () => machines.find((m) => m.id === smId),
    [machines, smId],
  );

  const validation = useMemo(
    () => (smId ? validateStateMachine(smId) : null),
    [smId, validateStateMachine, machines],
  );

  if (!sm || !smId) {
    return (
      <DisclosureSection title="State Machine" defaultExpanded={false}>
        <div className="insp-sm__empty">
          {machines.length === 0 ? (
            <>
              <p className="insp-panel__empty-hint">No state machines.</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => createStateMachine('State Machine 1')}
                aria-label="Create first state machine"
              >
                <Icon name="Plus" label="" />
                Create State Machine
              </Button>
            </>
          ) : (
            <Select
              value={smId ?? ''}
              label="State machine"
              options={machines.map((m) => ({ value: m.id, label: m.name }))}
              onChange={(v) => selectStateMachine(v || null)}
              aria-label="Select state machine"
            />
          )}
        </div>
      </DisclosureSection>
    );
  }

  const validationForState = (stateId: string): SMValidationIssue[] =>
    validation?.issues.filter((i) => i.stateId === stateId || i.transitionId === stateId) ?? [];

  return (
    <DisclosureSection title={`State Machine — ${sm.name}`} defaultExpanded>
      <div className="insp-sm">
        {/* Validation warnings */}
        {validation && validation.issues.length > 0 && (
          <div className="insp-sm__warnings" role="status" aria-live="polite">
            {validation.issues.slice(0, 5).map((issue, idx) => (
              <div
                key={`${issue.code}-${idx}`}
                className={`insp-sm__warning insp-sm__warning--${issue.severity}`}
              >
                <Icon
                  name={issue.severity === 'error' ? 'TriangleAlert' : 'Info'}
                  label=""
                  aria-hidden="true"
                />
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* States */}
        <div className="insp-sm__section">
          <div className="insp-sm__header">
            <h4 className="insp-sm__heading">States</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => addSMState(smId, `State ${sm.states.length + 1}`, '')}
              aria-label="Add state"
            >
              <Icon name="Plus" label="" />
            </Button>
          </div>
          <ul className="insp-sm__states">
            {sm.states.map((s) => {
              const isSelected = s.id === selectedSMStateId;
              const isEntry = s.isEntryState;
              const issues = validationForState(s.id);
              return (
                <li
                  key={s.id}
                  className={`insp-sm__state ${isSelected ? 'insp-sm__state--selected' : ''}`}
                >
                  <button
                    type="button"
                    className="insp-sm__state-select"
                    onClick={() => selectSMState(smId, isSelected ? null : s.id)}
                    aria-pressed={isSelected}
                  >
                    <span className="insp-sm__state-name">{s.name}</span>
                    {isEntry && (
                      <Tooltip label="Entry state">
                        <span className="insp-sm__badge insp-sm__badge--entry">Entry</span>
                      </Tooltip>
                    )}
                    {issues.length > 0 && (
                      <Icon
                        name="TriangleAlert"
                        label={`${issues.length} issue(s)`}
                        className="insp-sm__state-icon"
                      />
                    )}
                  </button>
                  <div className="insp-sm__state-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSMEntryState(smId, s.id)}
                      aria-label={`Set "${s.name}" as entry state`}
                      disabled={isEntry}
                    >
                      <Icon name="Star" label="" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => duplicateSMState(smId, s.id)}
                      aria-label={`Duplicate "${s.name}"`}
                    >
                      <Icon name="Copy" label="" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSMState(smId, s.id)}
                      aria-label={`Delete "${s.name}"`}
                    >
                      <Icon name="Trash2" label="" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Selected state detail */}
        {selectedSMStateId && (
          <StateDetail
            sm={sm}
            stateId={selectedSMStateId}
            onRename={(name) => renameSMState(smId, selectedSMStateId, name)}
          />
        )}

        {/* Transitions */}
        <div className="insp-sm__section">
          <div className="insp-sm__header">
            <h4 className="insp-sm__heading">Transitions</h4>
            {sm.states.length >= 2 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const from = sm.states[0]!.id;
                  const to = sm.states[1]!.id;
                  const id = addSMTransition(smId, from, to, 'onClick');
                  if (id) selectSMTransition(smId, id);
                }}
                aria-label="Add transition"
              >
                <Icon name="Plus" label="" />
              </Button>
            )}
          </div>
          {sm.transitions.length === 0 ? (
            <p className="insp-panel__empty-hint">No transitions defined.</p>
          ) : (
            <ul className="insp-sm__transitions">
              {sm.transitions.map((t) => {
                const fromName = sm.states.find((s) => s.id === t.fromStateId)?.name ?? '?';
                const toName = sm.states.find((s) => s.id === t.toStateId)?.name ?? '?';
                const isSelected = t.id === selectedSMTransitionId;
                return (
                  <li
                    key={t.id}
                    className={`insp-sm__transition ${isSelected ? 'insp-sm__transition--selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="insp-sm__transition-select"
                      onClick={() => selectSMTransition(smId, isSelected ? null : t.id)}
                      aria-pressed={isSelected}
                    >
                      <span className="insp-sm__transition-from">{fromName}</span>
                      <Icon name="ArrowRight" label="" aria-hidden="true" />
                      <span className="insp-sm__transition-to">{toName}</span>
                      <span className="insp-sm__badge">{t.trigger}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSMTransition(smId, t.id)}
                      aria-label={`Delete transition ${fromName} to ${toName}`}
                    >
                      <Icon name="Trash2" label="" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Selected transition detail */}
        {selectedSMTransitionId && (
          <TransitionDetail
            sm={sm}
            transitionId={selectedSMTransitionId}
            onTriggerChange={(trigger) =>
              setSMTransitionTrigger(smId, selectedSMTransitionId, trigger)
            }
            onTargetChange={(toId) => setSMTransitionTarget(smId, selectedSMTransitionId, toId)}
            onConditionChange={(cond) =>
              setSMTransitionCondition(smId, selectedSMTransitionId, cond)
            }
            onPriorityChange={(p) => setSMTransitionPriority(smId, selectedSMTransitionId, p)}
            onDurationChange={(d) => setSMTransitionDuration(smId, selectedSMTransitionId, d)}
            onEasingChange={(e) => setSMTransitionEasing(smId, selectedSMTransitionId, e)}
          />
        )}

        {/* Inputs */}
        <div className="insp-sm__section">
          <div className="insp-sm__header">
            <h4 className="insp-sm__heading">Inputs</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => addSMInput(smId, `input${sm.inputs.length + 1}`, 'boolean')}
              aria-label="Add input"
            >
              <Icon name="Plus" label="" />
            </Button>
          </div>
          {sm.inputs.length === 0 ? (
            <p className="insp-panel__empty-hint">No inputs.</p>
          ) : (
            <ul className="insp-sm__inputs">
              {sm.inputs.map((input) => (
                <li key={input.id} className="insp-sm__input">
                  <span className="insp-sm__input-name">{input.name}</span>
                  <span className="insp-sm__badge">{input.type}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSMInput(smId, input.id)}
                    aria-label={`Delete input "${input.name}"`}
                  >
                    <Icon name="Trash2" label="" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Machine-level actions */}
        <div className="insp-sm__footer">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => createStateMachine(`State Machine ${machines.length + 1}`)}
          >
            <Icon name="Plus" label="" />
            New Machine
          </Button>
          {machines.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeStateMachine(smId)}
              aria-label={`Delete state machine "${sm.name}"`}
            >
              <Icon name="Trash2" label="" />
              Delete
            </Button>
          )}
        </div>
      </div>
    </DisclosureSection>
  );
}

function StateDetail({
  sm,
  stateId,
  onRename,
}: {
  sm: StateMachine;
  stateId: string;
  onRename: (name: string) => void;
}) {
  const state = sm.states.find((s) => s.id === stateId);
  if (!state) return null;
  return (
    <div className="insp-sm__detail">
      <div className="insp-sm__field">
        <label className="insp-sm__label" htmlFor={`sm-state-name-${stateId}`}>
          Name
        </label>
        <input
          id={`sm-state-name-${stateId}`}
          className="insp-sm__input-text"
          value={state.name}
          onChange={(e) => onRename(e.target.value)}
        />
      </div>
      <p className="insp-sm__hint">
        Timeline: {state.timelineId || 'none'} {state.isEntryState && '(entry state)'}
      </p>
    </div>
  );
}

function TransitionDetail({
  sm,
  transitionId,
  onTriggerChange,
  onTargetChange,
  onConditionChange,
  onPriorityChange,
  onDurationChange,
  onEasingChange,
}: {
  sm: StateMachine;
  transitionId: string;
  onTriggerChange: (trigger: SMTransitionTrigger) => void;
  onTargetChange: (toId: string) => void;
  onConditionChange: (condition: string | undefined) => void;
  onPriorityChange: (priority: number) => void;
  onDurationChange: (duration: number) => void;
  onEasingChange: (easing: EasingDefinition) => void;
}) {
  const transition = sm.transitions.find((t) => t.id === transitionId);
  if (!transition) return null;

  return (
    <div className="insp-sm__detail">
      <div className="insp-sm__field">
        <label className="insp-sm__label" htmlFor={`sm-tr-trigger-${transitionId}`}>
          Trigger
        </label>
        <Select
          value={transition.trigger}
          label="Trigger"
          options={TRIGGER_OPTIONS}
          onChange={(v) => onTriggerChange(v as SMTransitionTrigger)}
        />
      </div>

      <div className="insp-sm__field">
        <label className="insp-sm__label" htmlFor={`sm-tr-target-${transitionId}`}>
          Target state
        </label>
        <Select
          value={transition.toStateId}
          label="Target state"
          options={sm.states.map((s) => ({ value: s.id, label: s.name }))}
          onChange={onTargetChange}
        />
      </div>

      <DisclosureSection title="Advanced" defaultExpanded={false}>
        <div className="insp-sm__field">
          <label className="insp-sm__label" htmlFor={`sm-tr-condition-${transitionId}`}>
            Condition (guard)
          </label>
          <input
            id={`sm-tr-condition-${transitionId}`}
            className="insp-sm__input-text"
            value={transition.condition ?? ''}
            placeholder="e.g. inputs.enabled === true"
            onChange={(e) => onConditionChange(e.target.value || undefined)}
          />
        </div>

        <div className="insp-sm__field">
          <label className="insp-sm__label" htmlFor={`sm-tr-priority-${transitionId}`}>
            Priority
          </label>
          <NumberInput
            value={transition.priority ?? 0}
            label="Priority"
            onChange={(v) => onPriorityChange(v)}
            aria-label="Transition priority"
          />
        </div>

        <div className="insp-sm__field">
          <label className="insp-sm__label" htmlFor={`sm-tr-duration-${transitionId}`}>
            Duration (ms)
          </label>
          <NumberInput
            value={transition.duration ?? 300}
            label="Duration (ms)"
            onChange={(v) => onDurationChange(v)}
            aria-label="Transition duration"
          />
        </div>

        <div className="insp-sm__field">
          <label className="insp-sm__label" htmlFor={`sm-tr-easing-${transitionId}`}>
            Easing
          </label>
          <Select
            value={transition.easing?.kind ?? 'ease'}
            label="Easing"
            options={EASING_OPTIONS}
            onChange={(v) =>
              onEasingChange({ kind: v as EasingDefinition['kind'] } as EasingDefinition)
            }
          />
        </div>
      </DisclosureSection>
    </div>
  );
}
