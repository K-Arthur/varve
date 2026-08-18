/**
 * Email-specific types for Varve's email template system.
 *
 * These types capture email-specific semantics that augment normal Varve
 * design primitives. The visual design remains ordinary Varve nodes;
 * email metadata adds meaning for the email compiler pipeline.
 *
 * Architecture: Document-level `emailProfile` stores the email document
 * configuration. Node-level `emailSemantic` (stored in `Document.emailSemantics`
 * keyed by node ID) captures per-node email meaning.
 */

// ── Email Document Profile ────────────────────────────────────────────────────

export type EmailCompatibilityProfile = 'conservative' | 'modern' | 'provider-specific';

export type EmailProvider = 'generic' | 'mailchimp';

export interface EmailProfile {
  /** Schema version for safe migration. */
  version: number;

  /** Email subject line (for preview/testing, not campaign sending). */
  subject?: string;

  /** Preheader text — shown as preview in inbox before opening. */
  preheader?: string;

  /** Document language (ISO 639-1). Default 'en'. */
  language: string;

  /** Text direction. Default 'ltr'. */
  direction: 'ltr' | 'rtl';

  /** Content width in CSS pixels. Default 600 (email standard). */
  contentWidth: number;

  /** Body background color. */
  bodyBackground?: string;

  /** Content area background color. */
  contentBackground?: string;

  /** Mobile breakpoint in CSS pixels. Default 480. */
  mobileBreakpoint: number;

  /** Compatibility profile for the email compiler. */
  compatibilityProfile: EmailCompatibilityProfile;

  /** Target provider adapter (determines template syntax). */
  provider: EmailProvider;

  /** Provider-specific settings. */
  providerSettings?: EmailProviderSettings;

  /** Asset base URL for exported images (user-configurable). */
  assetBaseUrl?: string;

  /** Manual plain-text version (if set, overrides auto-generated). */
  plainTextOverride?: string;

  /** Custom email CSS (validated against email-safe subset). */
  customCss?: string;

  /** Custom classes/IDs for targeted styling. */
  customClasses?: Record<string, string>;
}

export interface EmailProviderSettings {
  /** Mailchimp editable region settings. */
  mailchimp?: {
    /** Template folder ID for Mailchimp upload. */
    templateFolderId?: string;
    /** Required Mailchimp merge tags. */
    requiredMergeTags?: string[];
    /** Editable region definitions. */
    editableRegions?: MailchimpEditableRegion[];
  };
}

// ── Email Semantic Metadata (per-node) ────────────────────────────────────────

export type EmailSemanticKind =
  | 'auto'
  | 'preheader'
  | 'section'
  | 'row'
  | 'column'
  | 'container'
  | 'heading'
  | 'paragraph'
  | 'text'
  | 'image'
  | 'button'
  | 'divider'
  | 'spacer'
  | 'social-links'
  | 'logo'
  | 'hero'
  | 'footer'
  | 'compliance'
  | 'custom-html'
  | 'decorative';

export interface EmailSemanticMetadata {
  /** Semantic kind — how this node maps to email structure. */
  kind: EmailSemanticKind;

  /** Whether this kind was inferred or explicitly set by the user. */
  inferred: boolean;

  /** Heading level (1-6) for heading semantics. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;

  /** Mobile behavior for this node. */
  mobileBehavior?: EmailMobileBehavior;

  /** Whether this node should be hidden on mobile. */
  hideOnMobile?: boolean;

  /** Whether this node should be hidden on desktop. */
  hideOnDesktop?: boolean;

  /** Provider-specific editable region tag. */
  editableRegion?: string;

  /** Stable identifier for provider region mapping. */
  regionId?: string;
}

export type EmailMobileBehavior = 'stack' | 'collapse' | 'hide' | 'resize' | 'preserve';

// ── Email Links ───────────────────────────────────────────────────────────────

export type EmailLinkKind = 'web' | 'email' | 'tel' | 'anchor' | 'merge-tag';

export interface EmailLink {
  /** The URL target. */
  url: string;

  /** Link kind (determines protocol validation). */
  kind: EmailLinkKind;

  /** Optional title/tooltip. */
  title?: string;

  /** Target attribute (_blank, _self, etc.). */
  target?: '_blank' | '_self';

  /** UTM tracking parameters. */
  tracking?: EmailTrackingParams;

  /** Whether this link has been validated. */
  validated?: boolean;

  /** Validation errors, if any. */
  validationErrors?: string[];
}

export interface EmailTrackingParams {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

// ── Text-Range Links ──────────────────────────────────────────────────────────

/**
 * A link applied to a range within a TextNode's rich text.
 * Stored on the Document keyed by `${nodeId}:${startIndex}:${endIndex}`.
 */
export interface EmailTextRangeLink {
  /** Node ID of the text node. */
  nodeId: string;
  /** Character start index (inclusive). */
  startIndex: number;
  /** Character end index (exclusive). */
  endIndex: number;
  /** The link data. */
  link: EmailLink;
}

// ── Personalization Variables ─────────────────────────────────────────────────

export type EmailVariableType = 'text' | 'number' | 'date' | 'image' | 'boolean';

export interface EmailVariable {
  /** Unique variable identifier (stable across sessions). */
  id: string;

  /** Display name. */
  name: string;

  /** Variable type. */
  type: EmailVariableType;

  /** Provider-neutral template tag (e.g., *|FNAME|* for Mailchimp). */
  templateTag?: string;

  /** Sample value for preview. */
  sampleValue: string;

  /** Fallback value if variable is missing. */
  fallback?: string;

  /** Description of this variable. */
  description?: string;

  /** Whether this variable is required. */
  required?: boolean;
}

// ── Email Asset Metadata ──────────────────────────────────────────────────────

export interface EmailAssetInfo {
  /** Source scene node ID. */
  sourceNodeId: string;

  /** Output filename for the asset package. */
  outputFilename: string;

  /** Content hash for deduplication. */
  hash: string;

  /** Image dimensions. */
  width: number;
  height: number;

  /** MIME type. */
  mimeType: string;

  /** Alt text for accessibility. */
  alt: string;

  /** Whether this image is decorative (no alt needed). */
  decorative: boolean;

  /** Remote URL if already hosted. */
  remoteUrl?: string;

  /** Embedded source data for local-first asset packaging. */
  dataUrl?: string;
}

// ── Email Custom HTML Block ───────────────────────────────────────────────────

export interface EmailCustomHtmlBlock {
  /** Source code. */
  code: string;

  /** Whether this block is user-authored (preserved through recompile). */
  userAuthored: boolean;

  /** Preview HTML (sandboxed). */
  previewHtml?: string;

  /** Validation diagnostics. */
  diagnostics?: EmailDiagnostic[];
}

// ── Diagnostics / Preflight ───────────────────────────────────────────────────

export type EmailDiagnosticSeverity = 'error' | 'warning' | 'info';

export type EmailDiagnosticCategory =
  | 'link'
  | 'image'
  | 'accessibility'
  | 'compatibility'
  | 'asset'
  | 'variable'
  | 'provider'
  | 'security'
  | 'layout'
  | 'typography'
  | 'css'
  | 'structure';

export interface EmailDiagnostic {
  /** Severity level. */
  severity: EmailDiagnosticSeverity;

  /** Diagnostic code for programmatic identification. */
  code: string;

  /** Human-readable message. */
  message: string;

  /** Source node ID (for canvas navigation). */
  sourceNodeId?: string;

  /** Source variable ID. */
  sourceVariableId?: string;

  /** Category for grouping. */
  category: EmailDiagnosticCategory;

  /** Suggested fix description. */
  suggestedFix?: string;

  /** Whether an auto-fix is available. */
  autoFixAvailable?: boolean;

  /** Compatibility profile this applies to. */
  profile?: EmailCompatibilityProfile;
}

// ── Mailchimp-Specific Types ──────────────────────────────────────────────────

export interface MailchimpEditableRegion {
  /** Stable region identifier (derived from node ID, not position). */
  id: string;

  /** Display name. */
  name: string;

  /** Region type. */
  type: 'text' | 'image' | 'button' | 'repeat';

  /** Associated scene node ID. */
  nodeId: string;

  /** For repeat regions: child node pattern. */
  repeatPattern?: string;
}

// ── Email Semantic Map (stored on Document) ───────────────────────────────────

export interface EmailSemanticMap {
  /** Per-node email semantics, keyed by scene node ID. */
  nodes: Record<string, EmailSemanticMetadata>;

  /** Whole-node links, kept separate from text-range links. */
  nodeLinks: Record<string, EmailLink>;

  /** Text-range links, keyed by `${nodeId}:${start}:${end}`. */
  textRangeLinks: Record<string, EmailTextRangeLink>;

  /** Personalization variables. */
  variables: EmailVariable[];

  /** Custom HTML blocks (keyed by node ID). */
  customHtmlBlocks: Record<string, EmailCustomHtmlBlock>;

  /** Asset metadata for email export. */
  assets: Record<string, EmailAssetInfo>;

  /** Diagnostics from last compilation. */
  diagnostics: EmailDiagnostic[];
}

// ── Default Values ────────────────────────────────────────────────────────────

export const DEFAULT_EMAIL_PROFILE: EmailProfile = {
  version: 1,
  language: 'en',
  direction: 'ltr',
  contentWidth: 600,
  mobileBreakpoint: 480,
  compatibilityProfile: 'modern',
  provider: 'generic',
};

export const DEFAULT_EMAIL_SEMANTIC: EmailSemanticMetadata = {
  kind: 'auto',
  inferred: true,
};

export const DEFAULT_EMAIL_SEMANTIC_MAP: EmailSemanticMap = {
  nodes: {},
  nodeLinks: {},
  textRangeLinks: {},
  variables: [],
  customHtmlBlocks: {},
  assets: {},
  diagnostics: [],
};
