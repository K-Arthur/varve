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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 36,
        background: 'var(--color-surface-sunken)',
        borderBottom: '1px solid var(--color-border-subtle)',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Drag region fills available space */}
      <div
        data-tauri-drag-region
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 12,
          height: '100%',
          gap: 6,
        }}
      >
        <img
          src="/icons/strata-icon.svg"
          alt=""
          aria-hidden
          style={{ width: 18, height: 18, flexShrink: 0, pointerEvents: 'none' }}
        />
        <span
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--color-text-primary)',
            pointerEvents: 'none',
          }}
        >
          {title}
        </span>
      </div>

      {/* Window controls — width-bounded container so they can never overflow */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          width: 108 /* 3 x 36px; bounded so no overflow/clipping */,
          justifyContent: 'flex-end',
        }}
      >
        <WinButton label="Minimize" onClick={minimize} hoverColor="var(--color-surface-raised)">
          <MinimizeIcon />
        </WinButton>
        <WinButton
          label="Maximize"
          onClick={toggleMaximize}
          hoverColor="var(--color-surface-raised)"
        >
          <MaximizeIcon />
        </WinButton>
        <WinButton label="Close" onClick={close} hoverColor="#c42b1c" hoverTextColor="#fff">
          <CloseIcon />
        </WinButton>
      </div>
    </div>
  );
}

function WinButton({
  label,
  onClick,
  children,
  hoverColor,
  hoverTextColor,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  hoverColor?: string;
  hoverTextColor?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        if (hoverColor) el.style.background = hoverColor;
        if (hoverTextColor) el.style.color = hoverTextColor;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.background = '';
        el.style.color = '';
      }}
      style={{
        width: 36,
        height: 36,
        border: 'none',
        background: 'transparent',
        color: 'var(--color-text-primary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.1s',
        flexShrink: 0,
      }}
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
