/**
 * Panel host identity shared by ordinary editor panels and auxiliary windows.
 *
 * This intentionally lives beside the panel registry rather than under the
 * auxiliary bundle: generic panel controls need to know whether they are
 * hosted in an auxiliary window, while the host context must not depend on
 * any auxiliary-window implementation details.
 */

import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';

export interface PanelHostContextValue {
  /** Stable platform window identity for this panel host. */
  windowId: string;
  /** True only for a panel-only auxiliary window. */
  isAuxiliary: boolean;
}

const PRIMARY_PANEL_HOST: PanelHostContextValue = {
  windowId: 'main',
  isAuxiliary: false,
};

const PanelHostContext = createContext<PanelHostContextValue>(PRIMARY_PANEL_HOST);

export interface PanelHostProviderProps extends PanelHostContextValue {
  children: ReactNode;
}

/**
 * Marks a subtree with the host that owns its panels.
 *
 * The primary editor deliberately relies on the context default, so adding
 * this provider is only necessary at an alternate host boundary.
 */
export function PanelHostProvider({ children, windowId, isAuxiliary }: PanelHostProviderProps) {
  const value = useMemo<PanelHostContextValue>(
    () => ({ windowId, isAuxiliary }),
    [windowId, isAuxiliary],
  );

  return <PanelHostContext.Provider value={value}>{children}</PanelHostContext.Provider>;
}

/** Returns the containing panel host, defaulting to the primary editor. */
export function usePanelHost(): PanelHostContextValue {
  return useContext(PanelHostContext);
}
