/**
 * Custom title bar — rendered only when the resolved window-chrome strategy
 * calls for custom decorations (Linux fully-custom chrome; unknown desktop
 * fallback).
 *
 * Responsibilities, kept deliberately separate:
 *  - drag region (`data-tauri-drag-region`)
 *  - window controls (minimize / maximize-restore / close)
 *  - document title
 *
 * Interactive controls live OUTSIDE the drag region. The maximize button
 * reflects the live maximized state (icon + accessible label flip), and the
 * bar dims while the window is unfocused. Window actions go through the
 * `windowActions` service (rejection-safe, rapid-click guarded).
 */

import './title-bar.css';
import { requestCloseWindow } from '../lifecycle/requestCloseWindow';
import { useWindowChrome } from './useWindowChrome';
import { runWindowAction } from './windowActions';

export function TitleBar({ title = 'Varve' }: { title?: string }) {
  const chrome = useWindowChrome(title);
  const { strategy, isMaximized, isFocused, canMinimize, canMaximize, canClose } = chrome;

  // Native decorations / browser build: no custom chrome is rendered at all,
  // so the platform's own title bar and window controls are the only ones.
  if (!strategy.showCustomTitleBar) return null;

  const className = `title-bar${isFocused ? '' : ' title-bar--inactive'}`;

  return (
    <div className={className} data-window-chrome data-focused={isFocused || undefined}>
      {/* Drag region fills available space. Never contains focusable controls. */}
      <div className="title-bar__drag-region" data-tauri-drag-region>
        <img
          src="/icons/varve-icon.svg"
          alt=""
          aria-hidden
          className="title-bar__icon"
          // Never show a broken-image glyph: hide the icon and keep the
          // title bar usable if the asset is ever missing.
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        <span className="title-bar__title">{title}</span>
      </div>

      {/* Window controls — width-bounded container so they can never overflow */}
      <div className="title-bar__controls">
        <WinButton
          variant="minimize"
          label="Minimize"
          onClick={() => runWindowAction('minimize')}
          disabled={!canMinimize}
        >
          <MinimizeIcon />
        </WinButton>
        <WinButton
          variant="maximize"
          label={isMaximized ? 'Restore' : 'Maximize'}
          onClick={() => runWindowAction('toggleMaximize')}
          disabled={!canMaximize}
        >
          {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
        </WinButton>
        <WinButton variant="close" label="Close" onClick={requestCloseWindow} disabled={!canClose}>
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
  disabled,
  children,
}: {
  variant: 'minimize' | 'maximize' | 'close';
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
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

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" role="presentation">
      <rect
        x="0.5"
        y="2.5"
        width="6.5"
        height="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path d="M3 3V1.5h5.5V7H8" fill="none" stroke="currentColor" strokeWidth="1" />
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
