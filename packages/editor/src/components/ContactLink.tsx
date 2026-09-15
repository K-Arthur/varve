import { type ContactChannelId, contactChannel, contactMailto } from '@varve/shared';
import type { ReactNode } from 'react';
import { openVarveContact } from '../actions/registerAll';

/**
 * ContactLink — a public Varve contact address, rendered as a real link that
 * actually opens on every platform.
 *
 * A bare `<a href="mailto:...">` is not sufficient in this application. In a
 * Tauri webview the default navigation for an external protocol is commonly
 * dropped (WebKitGTK), so the link looks correct, is focusable, announces
 * correctly — and does nothing when clicked. Routing the activation through
 * `openVarveContact` hands the URL to the native opener on desktop and falls
 * back to a normal navigation on the web build.
 *
 * The element stays an anchor with a real `href` on purpose, rather than
 * becoming a button:
 *  - "Copy email address" in the context menu keeps working;
 *  - the address is selectable and copyable with no mail client installed;
 *  - assistive technology announces it as a link to a mail address, which is
 *    what it is.
 *
 * `aria-label` defaults to the channel's distinguishing label ("Email Varve
 * product support") because several of these can appear near each other, and
 * "support@varve.studio" read out of context does not convey purpose.
 */
export function ContactLink({
  channel,
  children,
  className,
  ariaLabel,
}: {
  channel: ContactChannelId;
  /** Defaults to the address itself, which must remain visible and copyable. */
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const contact = contactChannel(channel);

  return (
    <a
      className={className}
      href={contactMailto(channel)}
      aria-label={ariaLabel ?? contact.linkLabel}
      onClick={(event) => {
        // Let the user's own modifiers (new tab/window) and non-primary
        // buttons behave normally; only take over the plain activation.
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.button !== 0) return;
        event.preventDefault();
        openVarveContact(channel);
      }}
    >
      {children ?? contact.email}
    </a>
  );
}
