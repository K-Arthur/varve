// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  capturePanelLocalState,
  resetPanelLocalStateForTest,
  restorePanelLocalState,
  usePanelLocalState,
} from './panelLocalState';

function PanelStateProbe() {
  const [tab, setTab] = usePanelLocalState('layers', 'activeTab', 'properties');
  return (
    <button type="button" onClick={() => setTab('appearance')}>
      {tab}
    </button>
  );
}

describe('panelLocalState', () => {
  afterEach(() => resetPanelLocalStateForTest());

  it('captures live presentation state and updates an already-mounted host on restore', () => {
    render(<PanelStateProbe />);

    expect(screen.getByRole('button')).toHaveTextContent('properties');
    fireEvent.click(screen.getByRole('button'));
    expect(capturePanelLocalState('layers')).toEqual({ activeTab: 'appearance' });

    act(() => {
      restorePanelLocalState('layers', { activeTab: 'adjustments' });
    });
    expect(screen.getByRole('button')).toHaveTextContent('adjustments');
  });

  it('declines values that cannot cross the serializable transfer boundary', () => {
    restorePanelLocalState('layers', { invalid: () => {} });
    expect(capturePanelLocalState('layers')).toBeUndefined();
  });
});
