import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  beginInteraction,
  enableInteractionTraces,
  endInteraction,
  recordInteractionSpan,
  recordInteractionSpanAt,
  resetInteractionTraces,
} from '../../performance/interactionTrace';
import { InteractionTracePanel } from './InteractionTracePanel';

function captureInteraction() {
  beginInteraction('pointer-drag');
  recordInteractionSpan('pointer.input', 3);
  recordInteractionSpan('interaction.dispatch', 2, { tool: 'select' });
  recordInteractionSpanAt('composite.estimated', performance.now(), 12, { bound: 'lower' });
  return endInteraction();
}

describe('InteractionTracePanel', () => {
  beforeEach(() => {
    enableInteractionTraces(false);
    resetInteractionTraces();
  });

  afterEach(() => {
    enableInteractionTraces(false);
    resetInteractionTraces();
  });

  // The panel announces state through a role="status" live region, and the
  // design-system Select it renders also contributes its own status announcer,
  // so disambiguate by text rather than assuming a single status region.
  function findStatus(matcher: RegExp) {
    const match = screen.getAllByRole('status').find((el) => matcher.test(el.textContent ?? ''));
    if (!match) {
      throw new Error(
        `Expected a status region matching ${matcher}; found: ${screen
          .getAllByRole('status')
          .map((el) => JSON.stringify(el.textContent))}`,
      );
    }
    return match;
  }

  it('does nothing until a snapshot is explicitly requested', () => {
    render(<InteractionTracePanel />);
    // Snapshot-driven by design: a live panel would distort the workload it
    // measures by re-rendering on every pointer event.
    expect(findStatus(/no snapshot/i)).toHaveTextContent('No snapshot taken yet');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('tells the developer how to enable capture when tracing is off', async () => {
    render(<InteractionTracePanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));
    expect(findStatus(/reload with/i)).toHaveTextContent('Reload with ?perf=1');
  });

  it('renders a waterfall with numeric columns beside the decorative bar', async () => {
    enableInteractionTraces(true);
    captureInteraction();
    render(<InteractionTracePanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    // Every span name is a row header, so a screen reader can navigate them.
    expect(screen.getByRole('rowheader', { name: 'pointer.input' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'interaction.dispatch' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'composite.estimated' })).toBeInTheDocument();
  });

  it('labels estimated spans distinctly from measured ones', async () => {
    enableInteractionTraces(true);
    captureInteraction();
    render(<InteractionTracePanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));

    // The evidence class must be readable as text, not conveyed by bar colour
    // alone — that is what keeps it usable in high contrast and greyscale.
    expect(screen.getAllByText('estimated').length).toBeGreaterThan(0);
    expect(screen.getAllByText('measured').length).toBeGreaterThan(0);
  });

  it('keeps the copy action disabled until a trace is selected', async () => {
    render(<InteractionTracePanel />);
    expect(screen.getByRole('button', { name: 'Copy trace' })).toBeDisabled();
  });

  it('is reachable by keyboard alone', async () => {
    enableInteractionTraces(true);
    captureInteraction();
    render(<InteractionTracePanel />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Refresh snapshot' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('reports the count of captured interactions in a live region', async () => {
    enableInteractionTraces(true);
    captureInteraction();
    captureInteraction();
    render(<InteractionTracePanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));
    expect(findStatus(/2 interaction/i)).toHaveTextContent('2 interaction(s) captured');
  });
});
