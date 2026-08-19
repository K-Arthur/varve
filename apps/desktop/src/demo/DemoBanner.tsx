/**
 * Demo limitations banner + desktop CTA (/try only).
 *
 * Non-disruptive: a single slim strip above the app surfaces. It states what
 * the demo is (real editor, runs locally, nothing uploaded), what it is not
 * (a desktop-parity environment), and points at the desktop download. The
 * "what's limited" disclosure is a native <details> so it is keyboard- and
 * screen-reader-accessible without custom state.
 *
 * Dismissal lasts the session only — the honesty signal must reappear on the
 * next visit.
 */

import { Icon } from '@varve/ui';
import { useEffect, useState } from 'react';
import type { DemoConfig } from './demoMode';
import './demoBanner.css';

const DISMISS_KEY = 'varve-demo-banner-dismissed';

const LIMITATIONS = [
  'Files are stored in this browser only. Clearing site data deletes them; there is no cloud account or upload.',
  'The demo runs the WASM engine, not the native desktop engine — expect slower rendering on large documents.',
  'Export gives you PNG, JPEG, WebP, and SVG. PDF, CMYK, bleed, and colour-managed print output are desktop-only — a browser has no print pipeline.',
  'Background removal, upscaling, and visual search are desktop-only. They run on-device, and a browser tab is the wrong place for the download and the compute.',
  'The demo covers the Design, Draw, and Photo workspaces. Print, Motion, Codegen, Logo, and Email are in the desktop app.',
  'Native menus and auto-updates are desktop-only.',
  'Best experienced on a desktop browser (Chrome, Edge, Firefox, Safari — recent versions).',
] as const;

export interface DemoBannerProps {
  config: DemoConfig;
}

export function DemoBanner({ config }: DemoBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') setDismissed(true);
    } catch {
      // sessionStorage can throw in strict privacy modes; the banner just
      // stays visible for the session.
    }
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // same privacy-mode fallback as above
    }
    setDismissed(true);
  };

  return (
    <section className="varve-demo-banner" aria-label="Browser demo notice">
      <div className="varve-demo-banner__inner">
        <p className="varve-demo-banner__intro">
          Browser demo — the real editor, running entirely on this device. No account, nothing
          uploaded.
        </p>
        <details className="varve-demo-banner__limits">
          <summary>What's limited in the browser demo</summary>
          <ul>
            {LIMITATIONS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
        <a
          className="varve-demo-banner__cta"
          href={config.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Download desktop
          <Icon name="ExternalLink" size={14} aria-hidden="true" />
        </a>
        <button
          type="button"
          className="varve-demo-banner__dismiss"
          onClick={dismiss}
          aria-label="Dismiss demo notice"
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
