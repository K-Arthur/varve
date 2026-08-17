/**
 * Email Semantic IR — the intermediate representation for the email compiler pipeline.
 *
 * This IR captures email-specific semantic structure that maps Varve's
 * scene model into email-compatible HTML output. It sits between the
 * design IR (DesignIR/IRDocument) and the final HTML output.
 *
 * Architecture:
 *   Varve Scene → EmailSemanticIR → Email HTML / Plain Text / Asset Manifest
 */

// ── Email IR Node Types ───────────────────────────────────────────────────────

export type EmailIrNodeKind =
  | 'document'
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
  | 'custom-html';

export interface EmailIrNode {
  /** Unique node ID (matches source Varve node ID for provenance). */
  id: string;

  /** Source Varve scene node ID. */
  sourceNodeId: string;

  /** Email semantic kind. */
  kind: EmailIrNodeKind;

  /** Human-readable name. */
  name: string;

  /** Children nodes. */
  children: EmailIrNode[];

  /** Inline CSS properties (already email-safe). */
  styles: Record<string, string>;

  /** Table structure for layout (for conservative email output). */
  tableAttrs?: Record<string, string>;

  /** td/cell attributes for layout tables. */
  cellAttrs?: Record<string, string>;

  /** Content properties. */
  content?: EmailIrContent;

  /** Link data (for linked elements). */
  link?: EmailIrLink;

  /** Image-specific properties. */
  image?: EmailIrImage;

  /** Heading level (1-6). */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;

  /** Alt text for images. */
  alt?: string;

  /** Whether this is a decorative (non-semantic) element. */
  decorative?: boolean;

  /** Width in CSS pixels. */
  width?: number;

  /** Height in CSS pixels. */
  height?: number;

  /** Mobile behavior override. */
  mobileBehavior?: 'stack' | 'collapse' | 'hide' | 'resize' | 'preserve';

  /** Whether to hide on mobile. */
  hideOnMobile?: boolean;

  /** Whether to hide on desktop. */
  hideOnDesktop?: boolean;

  /** Raster fallback image data URL (for unsupported constructs). */
  rasterFallback?: string;

  /** Compatibility classification. */
  compatibility: EmailCompatibilityClassification;

  /** Stable provider attributes (for example Mailchimp editable regions). */
  providerAttributes?: Record<string, string>;
}

export type EmailCompatibilityClassification =
  | 'native'
  | 'converted'
  | 'approximated'
  | 'rasterized'
  | 'unsupported';

// ── Content Types ─────────────────────────────────────────────────────────────

export type EmailIrContentType = 'text' | 'image' | 'html' | 'none';

export interface EmailIrContent {
  type: EmailIrContentType;

  /** Plain text content. */
  text?: string;

  /** Rich text runs (for text-range links). */
  runs?: EmailIrTextRun[];

  /** Raw HTML (for custom HTML blocks). */
  html?: string;
}

export interface EmailIrTextRun {
  text: string;
  styles: Record<string, string>;
  link?: EmailIrLink;
}

// ── Link Types ────────────────────────────────────────────────────────────────

export interface EmailIrLink {
  /** URL target. */
  url: string;

  /** Link kind (web, email, tel, anchor). */
  kind: 'web' | 'email' | 'tel' | 'anchor' | 'merge-tag';

  /** Target attribute. */
  target?: '_blank' | '_self';

  /** Title attribute. */
  title?: string;
}

// ── Image Types ───────────────────────────────────────────────────────────────

export interface EmailIrImage {
  /** Source URL (resolved to remote or asset path). */
  src: string;

  /** Alt text. */
  alt: string;

  /** Width. */
  width?: number;

  /** Height. */
  height?: number;

  /** Whether this image is decorative. */
  decorative?: boolean;

  /** Link wrapping the image. */
  link?: EmailIrLink;
}

// ── Email Document IR ─────────────────────────────────────────────────────────

export interface EmailDocumentIr {
  /** IR version. */
  version: string;

  /** Document-level email profile settings. */
  settings: EmailDocumentSettings;

  /** Root nodes. */
  nodes: EmailIrNode[];

  /** Deterministic plain-text fallback. */
  plainText: string;

  /** Collected asset references. */
  assets: EmailIrAsset[];

  /** Fidelity warnings. */
  warnings: EmailIrWarning[];

  /** Source diagnostics. */
  diagnostics: EmailIrDiagnostic[];
}

export interface EmailDocumentSettings {
  /** Subject line. */
  subject?: string;

  /** Preheader text. */
  preheader?: string;

  /** Language. */
  language: string;

  /** Text direction. */
  direction: 'ltr' | 'rtl';

  /** Content width in CSS pixels. */
  contentWidth: number;

  /** Body background color. */
  bodyBackground?: string;

  /** Content area background color. */
  contentBackground?: string;

  /** Mobile breakpoint. */
  mobileBreakpoint: number;

  /** Compatibility profile. */
  compatibilityProfile: 'conservative' | 'modern' | 'provider-specific';

  /** Target provider. */
  provider: 'generic' | 'mailchimp';

  /** Custom CSS. */
  customCss?: string;

  /** Asset base URL used to resolve package-relative paths. */
  assetBaseUrl?: string;

  /** Manual plain-text override. */
  plainTextOverride?: string;
}

// ── Asset Types ───────────────────────────────────────────────────────────────

export interface EmailIrAsset {
  /** Source node ID. */
  sourceNodeId: string;

  /** Output filename. */
  filename: string;

  /** Content hash. */
  hash: string;

  /** MIME type. */
  mimeType: string;

  /** Width in pixels. */
  width: number;

  /** Height in pixels. */
  height: number;

  /** Alt text. */
  alt: string;

  /** Remote URL (if already hosted). */
  remoteUrl?: string;

  /** Local data URL (for local-first export). */
  dataUrl?: string;
}

// ── Warning / Diagnostic Types ────────────────────────────────────────────────

export type EmailIrSeverity = 'error' | 'warning' | 'info';

export type EmailIrCategory =
  | 'layout'
  | 'typography'
  | 'image'
  | 'link'
  | 'accessibility'
  | 'compatibility'
  | 'asset'
  | 'security'
  | 'css'
  | 'variable'
  | 'provider'
  | 'structure';

export interface EmailIrWarning {
  severity: EmailIrSeverity;
  code: string;
  message: string;
  sourceNodeId?: string;
  category: EmailIrCategory;
  suggestedFix?: string;
}

export interface EmailIrDiagnostic {
  severity: EmailIrSeverity;
  code: string;
  message: string;
  sourceNodeId?: string;
  sourceVariableId?: string;
  category: EmailIrCategory;
  line?: number;
  column?: number;

  suggestedFix?: string;

  profile?: 'conservative' | 'modern' | 'provider-specific';
}
