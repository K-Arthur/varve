// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelDetachButton, PanelDragHandle } from '../components/PanelDragHandle';
import { PanelHostProvider, usePanelHost } from './PanelHostContext';
import { registerBuiltinPanels } from './panelDefinitions';
import { type PanelTypeId, resetPanelRegistry } from './panelRegistry';
import { detachPanel } from './panelTransferCoordinator';

vi.mock('./panelTransferCoordinator', () => ({ detachPanel: vi.fn() }));

afterEach(cleanup);

beforeEach(() => {
  resetPanelRegistry();
  registerBuiltinPanels();
  vi.mocked(detachPanel).mockResolvedValue({
    status: 'detached',
    windowId: 'panel-layers-1',
    transactionId: 'detach-layers-1',
  });
});

function HostProbe() {
  const host = usePanelHost();
  return <output>{`${host.windowId}:${host.isAuxiliary}`}</output>;
}

function LayersHandle() {
  return (
    <PanelDragHandle
      panelTypeId="layers"
      panelInstanceId="layers-primary"
      currentWindowId="main"
      title="Layers"
    >
      <header>
        <span>Layers heading</span>
        <PanelDetachButton />
      </header>
    </PanelDragHandle>
  );
}

function PanelHeaderHandle({ panelTypeId, title }: { panelTypeId: PanelTypeId; title: string }) {
  return (
    <PanelDragHandle
      panelTypeId={panelTypeId}
      panelInstanceId={`${panelTypeId}-primary`}
      currentWindowId="main"
      title={title}
    >
      <header data-testid={`${panelTypeId}-header`}>
        <span>{title} heading</span>
        <PanelDetachButton />
      </header>
    </PanelDragHandle>
  );
}

describe('PanelHostContext', () => {
  it('defaults ordinary panel controls to the primary host', () => {
    render(<HostProbe />);

    expect(screen.getByText('main:false')).toBeInTheDocument();
  });

  it('provides the auxiliary host identity to its panel subtree', () => {
    render(
      <PanelHostProvider windowId="panel-layers-1" isAuxiliary>
        <HostProbe />
      </PanelHostProvider>,
    );

    expect(screen.getByText('panel-layers-1:true')).toBeInTheDocument();
  });

  it('suppresses a nested detach affordance in an auxiliary host', () => {
    const { rerender } = render(<LayersHandle />);
    expect(screen.getByTestId('detach-layers')).toBeInTheDocument();

    rerender(
      <PanelHostProvider windowId="panel-layers-1" isAuxiliary>
        <LayersHandle />
      </PanelHostProvider>,
    );

    expect(screen.queryByTestId('detach-layers')).not.toBeInTheDocument();
    expect(screen.getByText('Layers heading')).toBeInTheDocument();
  });

  it.each([
    ['layers', 'Layers'],
    ['inspector', 'Inspector'],
    ['library', 'Assets'],
    ['codegen', 'Code'],
    ['logo', 'Logo'],
  ] satisfies ReadonlyArray<readonly [PanelTypeId, string]>)(
    'renders the %s detach control inside its header action slot',
    (panelTypeId, title) => {
      render(<PanelHeaderHandle panelTypeId={panelTypeId} title={title} />);

      const control = screen.getByTestId(`detach-${panelTypeId}`);
      expect(control).toHaveAccessibleName(`Detach ${title} panel into a new window`);
      expect(screen.getByTestId(`${panelTypeId}-header`)).toContainElement(control);
    },
  );

  it('finishes a fallback drag when pointer capture is unavailable and release is outside', async () => {
    const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture');
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: () => {
        throw new Error('Pointer capture unavailable');
      },
    });

    try {
      render(<LayersHandle />);
      const header = screen.getByText('Layers heading').closest('header');
      if (!header) throw new Error('Layers header not found');

      fireEvent.pointerDown(header, { button: 0, pointerId: 7, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId: 7, clientX: 40, clientY: 10 });
      fireEvent.pointerUp(window, { pointerId: 7, clientX: 40, clientY: 80 });

      await waitFor(() => {
        expect(detachPanel).toHaveBeenCalledWith(
          expect.objectContaining({
            panelTypeId: 'layers',
            panelInstanceId: 'layers-primary',
            sourceWindowId: 'main',
          }),
        );
      });
    } finally {
      if (previous) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', previous);
      else delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture;
    }
  });
});
