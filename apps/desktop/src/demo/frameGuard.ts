/**
 * Refuse to run the browser demo inside someone else's frame.
 *
 * The demo's CSP is delivered in a meta tag, because GitHub Pages serves
 * static files and cannot set response headers. `frame-ancestors` is one of
 * the directives browsers ignore in that form — it was previously listed in
 * the meta CSP, which achieved nothing beyond a console error on every load.
 *
 * This is the script-side equivalent. It is weaker than the header (a frame
 * can sandbox away navigation), but it removes the easy case: the demo being
 * wrapped and passed off as someone else's product, or as bait for clicks the
 * visitor cannot see. Nothing here is a security boundary for the visitor's
 * data — the demo holds no credentials and performs no privileged action.
 */
export function installFrameGuard(): void {
  if (typeof window === 'undefined') return;
  let embedded: boolean;
  try {
    embedded = window.top !== window.self;
  } catch {
    // Cross-origin access to window.top throws, which is itself proof of a
    // frame from another origin.
    embedded = true;
  }
  if (!embedded) return;

  try {
    // Prefer breaking out: the visitor still gets the demo, just at its own
    // URL where the address bar tells the truth about who is serving it.
    if (window.top) {
      window.top.location.replace(window.self.location.href);
      return;
    }
  } catch {
    // A sandboxed frame blocks top-level navigation. Fall through to the
    // notice, which at least stops the demo pretending to be embedded content.
  }

  document.documentElement.innerHTML = '';
  const notice = document.createElement('div');
  notice.setAttribute('role', 'alert');
  notice.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;padding:24px;' +
    'background:#10151f;color:#fff;font:15px/1.5 system-ui,sans-serif;text-align:center';
  const link = document.createElement('a');
  link.href = window.self.location.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Open the Varve browser demo';
  link.style.cssText = 'color:#4adecc';
  const text = document.createElement('p');
  text.textContent = 'The Varve demo does not run inside another site’s frame.';
  text.style.cssText = 'margin:0 0 12px';
  const box = document.createElement('div');
  box.append(text, link);
  notice.appendChild(box);
  document.body.appendChild(notice);
}
