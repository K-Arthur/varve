/**
 * CSP violation diagnostics for development.
 *
 * Captures ContentSecurityPolicy violation events and logs them with
 * actionable context (blocked directive, violated directive, source).
 * Helps developers identify CSP misconfigurations without exposing
 * sensitive local paths.
 *
 * Only active when import.meta.env.DEV is true. Stripped from production builds.
 */

export interface CspViolationReport {
  blockedDirective: string;
  violatedDirective: string;
  source: string | null;
  timestamp: number;
}

const LOCAL_PATH_RE = /^(file:\/\/|tauri:\/\/|http:\/\/ipc\.localhost).*$/i;

function sanitizeSource(uri: string | null | undefined): string | null {
  if (!uri || uri === 'null') return null;
  if (LOCAL_PATH_RE.test(uri)) return '[local]';
  try {
    const url = new URL(uri);
    return `${url.origin}${url.pathname.length > 40 ? '/…' : url.pathname}`;
  } catch {
    return uri.length > 60 ? `${uri.slice(0, 57)}…` : uri;
  }
}

let handlerAttached = false;

export function initCspDiagnostics(): void {
  if (handlerAttached) return;
  handlerAttached = true;

  document.addEventListener('securitypolicyviolation', (event) => {
    const report: CspViolationReport = {
      blockedDirective: event.effectiveDirective || event.violatedDirective || 'unknown',
      violatedDirective: event.effectiveDirective || 'unknown',
      source: sanitizeSource(event.blockedURI),
      timestamp: Date.now(),
    };

    console.warn(
      `[csp] blocked ${report.blockedDirective}` +
        (report.source ? ` from ${report.source}` : '') +
        ` — add the source to the CSP ${report.violatedDirective} directive`,
    );
  });
}

export const __test__ = { sanitizeSource };
