// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StateMachinePanel } from './StateMachinePanel';

const useEditorMock = vi.fn();

vi.mock('../context', () => ({
  useEditor: () => useEditorMock(),
}));

function baseEditor() {
  return {
    getStateMachines: () => [],
    getPrimaryStateMachineId: () => null,
    selectedStateMachineId: null,
    selectedSMStateId: null,
    selectedSMTransitionId: null,
    createStateMachine: vi.fn(),
    removeStateMachine: vi.fn(),
    addSMState: vi.fn(),
    removeSMState: vi.fn(),
    renameSMState: vi.fn(),
    duplicateSMState: vi.fn(),
    setSMEntryState: vi.fn(),
    addSMTransition: vi.fn(),
    removeSMTransition: vi.fn(),
    setSMTransitionTrigger: vi.fn(),
    setSMTransitionTarget: vi.fn(),
    setSMTransitionCondition: vi.fn(),
    setSMTransitionPriority: vi.fn(),
    setSMTransitionDuration: vi.fn(),
    setSMTransitionEasing: vi.fn(),
    addSMInput: vi.fn(),
    removeSMInput: vi.fn(),
    validateStateMachine: vi.fn(() => null),
    selectStateMachine: vi.fn(),
    selectSMState: vi.fn(),
    selectSMTransition: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  useEditorMock.mockReset();
});

describe('StateMachinePanel', () => {
  it('renders nothing when closed', () => {
    useEditorMock.mockReturnValue(baseEditor());
    render(<StateMachinePanel open={false} onClose={() => {}} />);
    expect(screen.queryByText('No state machines.')).toBeNull();
  });

  it('shows the dialog title and the empty-state create action when open', () => {
    useEditorMock.mockReturnValue(baseEditor());
    render(<StateMachinePanel open={true} onClose={() => {}} />);

    expect(screen.getByRole('heading', { name: 'State Machine' })).toBeTruthy();

    // The inner disclosure is collapsed by default — expand it to reach content.
    fireEvent.click(screen.getByRole('button', { name: 'State Machine' }));
    expect(screen.getByText('No state machines.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create first state machine' })).toBeTruthy();
  });

  it('calls onClose when the dialog close button is clicked', () => {
    const onClose = vi.fn();
    useEditorMock.mockReturnValue(baseEditor());
    render(<StateMachinePanel open={true} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalled();
  });
});
