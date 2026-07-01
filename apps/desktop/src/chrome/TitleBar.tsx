/**
 * Custom titlebar — rendered when Tauri decorations are disabled.
 *
 * A3: drag region (data-tauri-drag-region), bounded window-control cluster,
 *     no stray text nodes that could leak glyphs at window edges.
 *
 * Window controls use window.__TAURI__.window (injected via withGlobalTauri:true)
 * with optional-chaining fallback so the component is safe in browser/test envs.
 *
 * Research basis: Tauri 2 custom titlebar guide, Wayland CSD notes
 *   (https://tauri.app/learn/window-customization/).
 */

import './title-bar.css';

declare global {
  interface Window {
    __TAURI__?: {
      window?: {
        getCurrentWindow?: () => {
          minimize: () => Promise<void>;
          toggleMaximize: () => Promise<void>;
          close: () => Promise<void>;
        };
      };
    };
  }
}

function getTauriWindow() {
  return window.__TAURI__?.window?.getCurrentWindow?.();
}

export function TitleBar({ title = 'Strata' }: { title?: string }) {
  function minimize() {
    getTauriWindow()?.minimize();
  }
  function toggleMaximize() {
    getTauriWindow()?.toggleMaximize();
  }
  function close() {
    getTauriWindow()?.close();
  }

  return (
    <div className="title-bar">
      {/* Drag region fills available space */}
      <div className="title-bar__drag-region" data-tauri-drag-region>
        <img src="/icons/strata-icon.svg" alt="" aria-hidden className="title-bar__icon" />
        <span className="title-bar__title">{title}</span>
      </div>

      {/* Window controls — width-bounded container so they can never overflow */}
      <div className="title-bar__controls">
        <WinButton variant="minimize" label="Minimize" onClick={minimize}>
          <MinimizeIcon />
        </WinButton>
        <WinButton variant="maximize" label="Maximize" onClick={toggleMaximize}>
          <MaximizeIcon />
        </WinButton>
        <WinButton variant="close" label="Close" onClick={close}>
          <CloseIcon />
        </WinButton>
      </div>
    </div>
  );
}

function WinButton({
  variant,
  label,
  onClick,
  children,
}: {
  variant: 'minimize' | 'maximize' | 'close';
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`title-bar__win-btn title-bar__win-btn--${variant}`}
    >
      {children}
    </button>
  );
}

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" role="presentation">
      <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" role="presentation">
      <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" role="presentation">
      <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" />
      <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
