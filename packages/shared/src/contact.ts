/**
 * Canonical public contact identities for Varve.
 *
 * Single source of truth for every public-facing contact channel. The
 * marketing website (contact/support/privacy/security/press pages, footer,
 * JSON-LD), the desktop app (Help menu, About, crash and privacy surfaces),
 * and the repository documentation all read from here instead of hard-coding
 * address strings in dozens of components.
 *
 * Two rules govern this module:
 *
 * 1. **Only `@varve.studio` role addresses are public.** How inbound mail is
 *    routed after it reaches the domain is administrative configuration, not
 *    user-facing information, and must never appear in this module, the
 *    website, the application, or any distributed artifact. See
 *    maintainer-only configuration outside the public repository.
 * 2. **One purpose per address.** A reader (human or answer engine) must be
 *    able to pick the correct channel without inference. Adding an address
 *    whose purpose overlaps an existing one defeats the point.
 *
 * These are role addresses reaching a small maintainer team, not staffed
 * departments — copy that consumes them must not imply otherwise.
 */

/** Domain that owns every public Varve contact identity. */
export const CONTACT_DOMAIN = 'varve.studio';

/**
 * The public contact addresses, keyed by role.
 *
 * Prefer `CONTACT_CHANNELS` when rendering a directory: it carries the
 * purpose copy that keeps every surface consistent.
 */
export const CONTACTS = {
  general: 'hello@varve.studio',
  support: 'support@varve.studio',
  feedback: 'feedback@varve.studio',
  security: 'security@varve.studio',
  privacy: 'privacy@varve.studio',
  press: 'press@varve.studio',
  partnerships: 'partnerships@varve.studio',
} as const;

/** Role key of a public contact address. */
export type ContactChannelId = keyof typeof CONTACTS;

export interface ContactChannel {
  /** Role key, stable across surfaces (also used as an analytics label). */
  readonly id: ContactChannelId;
  /** The public address. */
  readonly email: string;
  /** Heading-style label, e.g. "Product support". */
  readonly label: string;
  /** One factual sentence stating what the address is for. */
  readonly purpose: string;
  /** Concrete examples, for directory pages and documentation. */
  readonly examples: readonly string[];
  /**
   * Accessible link text. Never just "Email us" — screen-reader users
   * navigating by link list must be able to tell the channels apart.
   */
  readonly linkLabel: string;
  /**
   * Optional short `mailto:` subject. Deliberately generic: subjects must
   * never carry file paths, identifiers, diagnostics, or personal data.
   */
  readonly subject?: string;
}

/**
 * Ordered channel directory. The order is the presentation order used by the
 * website contact page and the repository documentation: general first, then
 * product channels, then trust channels, then outreach.
 */
export const CONTACT_CHANNELS: readonly ContactChannel[] = [
  {
    id: 'general',
    email: CONTACTS.general,
    label: 'General inquiries',
    purpose: 'General questions about Varve, and the right address when no other channel fits.',
    examples: [
      'General questions about the project',
      'Initial business contact',
      'Anything you are not sure where to send',
    ],
    linkLabel: 'Email Varve general inquiries',
    subject: 'Varve inquiry',
  },
  {
    id: 'support',
    email: CONTACTS.support,
    label: 'Product support',
    purpose: 'Help installing, launching, or using Varve, including platform-specific problems.',
    examples: [
      'Installation and download problems',
      'The application will not start or misbehaves',
      'Questions about how to do something in Varve',
      'Private support questions you would rather not post publicly',
    ],
    linkLabel: 'Email Varve product support',
    subject: 'Varve support',
  },
  {
    id: 'feedback',
    email: CONTACTS.feedback,
    label: 'Product feedback',
    purpose: 'Suggestions, feature ideas, usability feedback, and interest in user research.',
    examples: [
      'Feature ideas and workflow suggestions',
      'Usability and interface feedback',
      'Interest in taking part in user research',
    ],
    linkLabel: 'Email Varve product feedback',
    subject: 'Varve feedback',
  },
  {
    id: 'security',
    email: CONTACTS.security,
    label: 'Security',
    purpose:
      'Private reports of security vulnerabilities in Varve, its build pipeline, or its releases.',
    examples: [
      'Vulnerability disclosures',
      'Supply-chain concerns',
      'Signing or update-integrity problems',
      'Suspected credential exposure',
    ],
    linkLabel: 'Email Varve security reporting',
    subject: 'Varve security report',
  },
  {
    id: 'privacy',
    email: CONTACTS.privacy,
    label: 'Privacy',
    purpose:
      'Questions about what Varve collects, analytics and crash-reporting consent, and data handling.',
    examples: [
      'What a build does or does not collect',
      'Analytics, diagnostics, and crash-reporting consent',
      'Update-check and model-download network behaviour',
      'Privacy-related requests',
    ],
    linkLabel: 'Email Varve privacy questions',
    subject: 'Varve privacy question',
  },
  {
    id: 'press',
    email: CONTACTS.press,
    label: 'Press and media',
    purpose: 'Media inquiries, interviews, review requests, and brand assets.',
    examples: [
      'Interview and review requests',
      'Product coverage questions',
      'Logo, wordmark, and screenshot requests',
    ],
    linkLabel: 'Email Varve press inquiries',
    subject: 'Varve press inquiry',
  },
  {
    id: 'partnerships',
    email: CONTACTS.partnerships,
    label: 'Partnerships',
    purpose: 'Integration, distribution, education, and organisational inquiries.',
    examples: [
      'Integrations and interoperability',
      'Packaging and distribution',
      'Education and organisational use',
      'Sponsorship conversations',
    ],
    linkLabel: 'Email Varve partnership inquiries',
    subject: 'Varve partnership inquiry',
  },
];

/** Look up a channel by role key. */
export function contactChannel(id: ContactChannelId): ContactChannel {
  const found = CONTACT_CHANNELS.find((channel) => channel.id === id);
  // CONTACT_CHANNELS covers every key of CONTACTS (asserted in contact.test.ts),
  // so this is unreachable; it exists so callers get a value, not `undefined`.
  if (!found) throw new Error(`Unknown contact channel: ${id}`);
  return found;
}

/**
 * Build a `mailto:` URL for a channel.
 *
 * Only a short static subject is ever attached. Never pass user content,
 * file paths, document names, machine identifiers, or diagnostics through a
 * mail URL — query strings leak into shell history, mail clients, and
 * process lists.
 */
export function contactMailto(
  id: ContactChannelId,
  options: { subject?: string | false } = {},
): string {
  const channel = contactChannel(id);
  const subject = options.subject === false ? undefined : (options.subject ?? channel.subject);
  if (!subject) return `mailto:${channel.email}`;
  return `mailto:${channel.email}?subject=${encodeURIComponent(subject)}`;
}

/**
 * Canonical public Varve URLs referenced alongside the contact channels.
 *
 * Kept here so the application and the website agree on where "Support" or
 * "Privacy policy" points; the website additionally resolves in-site paths
 * through its own `sitePath()` for base-path-aware deploys.
 */
export const VARVE_URLS = {
  site: 'https://varve.studio',
  contact: 'https://varve.studio/contact',
  support: 'https://varve.studio/support',
  reportIssue: 'https://varve.studio/support/report-issue',
  docs: 'https://varve.studio/docs',
  download: 'https://varve.studio/download',
  privacy: 'https://varve.studio/about/privacy',
  security: 'https://varve.studio/security',
  securityTxt: 'https://varve.studio/.well-known/security.txt',
  press: 'https://varve.studio/contact',
  license: 'https://varve.studio/about/license',
  repository: 'https://github.com/K-Arthur/varve',
  issues: 'https://github.com/K-Arthur/varve/issues',
  newBugReport: 'https://github.com/K-Arthur/varve/issues/new?template=bug_report.yml',
  discussions: 'https://github.com/K-Arthur/varve/discussions',
  securityAdvisories: 'https://github.com/K-Arthur/varve/security/advisories',
} as const;
