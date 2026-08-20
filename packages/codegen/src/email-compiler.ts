/**
 * Email Compiler — converts Varve scene model to Email IR.
 *
 * This module is responsible for:
 * 1. Traversing the scene graph and mapping nodes to email semantics
 * 2. Resolving links, images, and assets
 * 3. Classifying compatibility of each construct
 * 4. Producing the Email IR for the HTML emitter
 *
 * It does NOT directly produce HTML — that's the email emitter's job.
 */

import type {
  Document,
  EmailCompatibilityProfile,
  EmailDiagnostic,
  EmailSemanticKind,
  EmailSemanticMap,
} from '@varve/scene';
import { applyCssCompatibility, resolveEmailFontStack } from './email-compat';
import type {
  EmailCompatibilityClassification,
  EmailDocumentIr,
  EmailDocumentSettings,
  EmailIrAsset,
  EmailIrDegradedStyle,
  EmailIrImage,
  EmailIrLink,
  EmailIrNode,
  EmailIrNodeKind,
  EmailIrTextRun,
  EmailIrWarning,
} from './email-ir-types';
import { normalizeEmailLayout } from './email-layout';
import { emitEmailPlainText } from './email-plain-text';
import { runEmailPreflight } from './email-preflight';
import { appendTrackingParams, validateEmailUrl } from './email-security';
import type { IRDocument, SemanticNode } from './ir-types';

// ── Compiler Options ──────────────────────────────────────────────────────────

export interface EmailCompileOptions {
  /** Compatibility profile. */
  profile: EmailCompatibilityProfile;

  /** Provider. */
  provider: 'generic' | 'mailchimp';

  /** Content width override. */
  contentWidth?: number;

  /** Mobile breakpoint override. */
  mobileBreakpoint?: number;

  /** Asset base URL. */
  assetBaseUrl?: string;

  /** Whether to include comments in output. */
  includeComments?: boolean;

  /** Substitute sample values for preview output instead of provider tags. */
  previewVariables?: boolean;
}

export interface EmailCompileResult {
  /** The compiled Email IR. */
  ir: EmailDocumentIr;

  /** Compilation diagnostics. */
  diagnostics: EmailDiagnostic[];

  /** Compilation warnings. */
  warnings: EmailIrWarning[];
}

// ── Main Compiler Entry Point ─────────────────────────────────────────────────

/**
 * Compile a Varve document with email metadata into an Email IR.
 */
export function compileEmail(
  doc: Document,
  designIr: IRDocument,
  options: EmailCompileOptions,
): EmailCompileResult {
  const emailProfile = doc.emailProfile;
  const emailSemantics = doc.emailSemantics;

  const settings: EmailDocumentSettings = {
    subject: emailProfile?.subject,
    preheader: emailProfile?.preheader,
    language: emailProfile?.language ?? 'en',
    direction: emailProfile?.direction ?? 'ltr',
    contentWidth: options.contentWidth ?? emailProfile?.contentWidth ?? 600,
    bodyBackground: emailProfile?.bodyBackground,
    contentBackground: emailProfile?.contentBackground,
    mobileBreakpoint: options.mobileBreakpoint ?? emailProfile?.mobileBreakpoint ?? 480,
    compatibilityProfile: options.profile,
    provider: options.provider,
    customCss: emailProfile?.customCss,
    assetBaseUrl: options.assetBaseUrl ?? emailProfile?.assetBaseUrl,
    plainTextOverride: emailProfile?.plainTextOverride,
  };

  const warnings: EmailIrWarning[] = [];
  const diagnostics: EmailDiagnostic[] = [];
  const assets: EmailIrAsset[] = [];
  const nodes: EmailIrNode[] = [];

  // Walk the design IR root nodes and compile to email IR
  for (const rootId of designIr.rootIds) {
    const semanticNode = designIr.nodes[rootId];
    if (!semanticNode) continue;

    const emailNode = compileNode(
      doc,
      semanticNode,
      emailSemantics,
      settings,
      warnings,
      diagnostics,
      assets,
      options,
    );
    if (emailNode) nodes.push(emailNode);
  }

  // Rewrite side-by-side geometry into rows and columns before anything reads
  // the tree: the emitter, the plain-text projection, and preflight all need to
  // agree on the same structure.
  const layout = normalizeEmailLayout(nodes, settings);
  warnings.push(...layout.warnings);

  const draftIr: EmailDocumentIr = {
    version: '1.0',
    settings,
    nodes: layout.nodes,
    plainText: '',
    assets: dedupeAssets(assets),
    warnings,
    diagnostics: [],
  };
  const draftWithText: EmailDocumentIr = { ...draftIr, plainText: emitEmailPlainText(draftIr) };
  const preflight = runEmailPreflight(
    draftWithText,
    emailSemantics,
    emailProfile?.providerSettings?.mailchimp?.editableRegions,
  );
  const ir: EmailDocumentIr = {
    ...draftWithText,
    diagnostics: preflight.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      sourceNodeId: diagnostic.sourceNodeId,
      sourceVariableId: diagnostic.sourceVariableId,
      category: diagnostic.category,
      suggestedFix: diagnostic.suggestedFix,
      profile: diagnostic.profile,
    })),
  };
  return { ir, diagnostics: preflight, warnings };
}

function dedupeAssets(assets: EmailIrAsset[]): EmailIrAsset[] {
  const byIdentity = new Map<string, EmailIrAsset>();
  for (const asset of assets) {
    const identity =
      asset.hash || `${asset.mimeType}:${asset.filename}:${asset.width}x${asset.height}`;
    byIdentity.set(identity, asset);
  }
  return [...byIdentity.values()].sort(
    (a, b) => a.filename.localeCompare(b.filename) || a.sourceNodeId.localeCompare(b.sourceNodeId),
  );
}

// ── Node Compiler ─────────────────────────────────────────────────────────────

function compileNode(
  doc: Document,
  node: SemanticNode,
  emailSemantics: EmailSemanticMap | undefined,
  settings: EmailDocumentSettings,
  warnings: EmailIrWarning[],
  diagnostics: EmailDiagnostic[],
  assets: EmailIrAsset[],
  options: EmailCompileOptions,
): EmailIrNode | null {
  if (node.visible === false) return null;

  const sourceNodeId = node.metadata.sourceNodeId;
  const semanticMeta = emailSemantics?.nodes[sourceNodeId];

  // Determine email semantic kind
  const kind = resolveEmailKind(node, semanticMeta?.kind, warnings, sourceNodeId);

  // Build styles from appearance
  const degraded: EmailIrDegradedStyle[] = [];
  const styles = compileStyles(node, settings, degraded);

  // Build content
  const content = compileContent(
    node,
    emailSemantics,
    sourceNodeId,
    settings.provider,
    options.previewVariables ?? false,
    settings.compatibilityProfile,
  );

  // Build link
  const link = resolveLink(sourceNodeId, emailSemantics);

  // Build image
  const image = compileImage(node, sourceNodeId, emailSemantics, assets, warnings);

  // Classify compatibility
  const compatibility = classifyCompatibility(node, kind, settings);

  // Handle unsupported constructs
  let rasterFallback: string | undefined;
  if (compatibility === 'rasterized' || compatibility === 'unsupported') {
    rasterFallback = node.flattening?.flattenedImageUrl;
    if (compatibility === 'unsupported' && !rasterFallback) {
      warnings.push({
        severity: 'warning',
        code: 'UNSUPPORTED_NO_FALLBACK',
        message: `Node "${node.name}" uses unsupported features but no raster fallback is available`,
        sourceNodeId,
        category: 'compatibility',
        suggestedFix: 'Simplify the design or add a rasterized fallback image',
      });
    }
  }

  // Compile children
  const children: EmailIrNode[] = [];
  for (const child of node.children) {
    if (child.visible === false) continue;
    const emailChild = compileNode(
      doc,
      child,
      emailSemantics,
      settings,
      warnings,
      diagnostics,
      assets,
      options,
    );
    if (emailChild) children.push(emailChild);
  }

  const semanticChildren =
    kind === 'row' && children.length > 1
      ? children.map((child) =>
          child.kind === 'container'
            ? {
                ...child,
                kind: 'column' as const,
                compatibility: 'converted' as const,
                mobileBehavior: child.mobileBehavior ?? 'stack',
              }
            : { ...child, mobileBehavior: child.mobileBehavior ?? 'stack' },
        )
      : children;

  return {
    id: `email-${sourceNodeId}`,
    sourceNodeId,
    kind,
    name: node.name,
    children: semanticChildren,
    styles,
    content,
    link,
    image,
    headingLevel: semanticMeta?.headingLevel,
    alt: semanticMeta?.kind === 'decorative' ? '' : (image?.alt ?? node.name),
    decorative: semanticMeta?.kind === 'decorative',
    width: node.layout.width.mode === 'fixed' ? node.layout.width.value : undefined,
    height: node.layout.height.mode === 'fixed' ? node.layout.height.value : undefined,
    geometry: geometryOf(node),
    degradedStyles: degraded.length > 0 ? degraded : undefined,
    mobileBehavior: semanticMeta?.mobileBehavior,
    hideOnMobile: semanticMeta?.hideOnMobile,
    hideOnDesktop: semanticMeta?.hideOnDesktop,
    rasterFallback,
    compatibility,
    providerAttributes: resolveProviderAttributes(
      doc,
      settings.provider,
      sourceNodeId,
      semanticMeta?.editableRegion,
    ),
  };
}

/**
 * Geometry the layout pass reads to work out which siblings sit side by side.
 *
 * Only absolutely positioned nodes carry usable coordinates. Auto-layout
 * children are already in a meaningful order, so they are deliberately left
 * without geometry and keep their declared sequence.
 */
function geometryOf(node: SemanticNode): EmailIrNode['geometry'] {
  const position = node.layout.position;
  if (!position || position?.type !== 'absolute') return undefined;
  const width = node.layout.width.value;
  const height = node.layout.height.value;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return {
    x: Math.round(position.left ?? 0),
    y: Math.round(position.top ?? 0),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function resolveProviderAttributes(
  doc: Document,
  provider: 'generic' | 'mailchimp',
  sourceNodeId: string,
  semanticEditableRegion?: string,
): Record<string, string> | undefined {
  if (provider !== 'mailchimp') return undefined;
  const region = doc.emailProfile?.providerSettings?.mailchimp?.editableRegions?.find(
    (candidate) => candidate.nodeId === sourceNodeId,
  );
  const editId = region?.id ?? semanticEditableRegion;
  if (!editId) return undefined;
  const attributes: Record<string, string> = { 'mc:edit': editId };
  if (region?.name) attributes['mc:label'] = region.name;
  if (region?.type === 'repeat') {
    attributes['mc:repeatable'] = region.repeatPattern?.trim() || region.id;
  }
  return attributes;
}

// ── Semantic Kind Resolution ──────────────────────────────────────────────────

function resolveEmailKind(
  node: SemanticNode,
  explicitKind: EmailSemanticKind | undefined,
  _warnings: EmailIrWarning[],
  _sourceNodeId: string,
): EmailIrNodeKind {
  // If explicitly set by user, use it (unless auto)
  if (explicitKind && explicitKind !== 'auto') {
    return mapSemanticKindToIrKind(explicitKind);
  }

  // Otherwise, infer from the design IR semantic role
  const role = node.role.primary;
  switch (role) {
    case 'header':
      return 'hero';
    case 'footer':
      return 'footer';
    case 'button':
      return 'button';
    case 'image':
      return 'image';
    case 'navigation':
      return 'social-links';
    case 'divider':
      return 'divider';
    case 'table':
      return 'container';
    case 'article':
    case 'section':
      return 'section';
    default:
      break;
  }

  // Infer from node properties
  if (
    node.children.length > 1 &&
    node.layout.mode === 'flex' &&
    (node.layout.direction === 'row' || node.layout.direction === 'row-reverse')
  ) {
    return 'row';
  }
  if (node.content.type === 'text') return 'paragraph';
  if (node.content.type === 'image') return 'image';

  // Default to container
  return 'container';
}

function mapSemanticKindToIrKind(kind: EmailSemanticKind): EmailIrNodeKind {
  const mapping: Record<EmailSemanticKind, EmailIrNodeKind> = {
    auto: 'container',
    preheader: 'preheader',
    section: 'section',
    row: 'row',
    column: 'column',
    container: 'container',
    heading: 'heading',
    paragraph: 'paragraph',
    text: 'text',
    image: 'image',
    button: 'button',
    divider: 'divider',
    spacer: 'spacer',
    'social-links': 'social-links',
    logo: 'logo',
    hero: 'hero',
    footer: 'footer',
    compliance: 'compliance',
    'custom-html': 'custom-html',
    decorative: 'container',
  };
  return mapping[kind] ?? 'container';
}

// ── Style Compilation ─────────────────────────────────────────────────────────

function compileStyles(
  node: SemanticNode,
  settings: EmailDocumentSettings,
  degraded: EmailIrDegradedStyle[],
): Record<string, string> {
  const styles: Record<string, string> = {};
  const appearance = node.appearance;
  const layout = node.layout;

  // `ir-builders` currently derives both background and foreground fills from
  // the scene fill stack. Text therefore has the same color in both fields.
  // A text fill is a foreground color, never a cell background; copying it to
  // `background-color` makes live copy disappear in the email output.
  if (node.content.type !== 'text') {
    const bg = appearance.background.find((f) => f.type === 'solid' && f.opacity > 0);
    if (bg && bg.type === 'solid') {
      styles['background-color'] = bg.value;
    }
  }

  // Padding
  const pad = layout.padding;
  if (pad.top || pad.right || pad.bottom || pad.left) {
    styles.padding = `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`;
  }

  // Border
  if (appearance.border.uniform !== false) {
    const b = appearance.border.top;
    if (b.width > 0 && b.style !== 'none') {
      styles.border = `${b.width}px ${b.style} ${b.color}`;
    }
  }

  // Border radius (conservative: only for modern profile)
  if (settings.compatibilityProfile !== 'conservative') {
    const br = appearance.borderRadius;
    if (br.topLeft || br.topRight || br.bottomRight || br.bottomLeft) {
      if (
        br.topLeft === br.topRight &&
        br.topRight === br.bottomRight &&
        br.bottomRight === br.bottomLeft
      ) {
        styles['border-radius'] = `${br.topLeft}px`;
      } else {
        styles['border-radius'] =
          `${br.topLeft}px ${br.topRight}px ${br.bottomRight}px ${br.bottomLeft}px`;
      }
    }
  }

  // Width and height.
  //
  // Live text never gets a fixed box. The recipient's client picks its own
  // fallback face, and a substituted face with wider metrics overflows a pinned
  // width or gets clipped by a pinned height. Text is allowed to set its own
  // height; the surrounding cell controls the measure.
  const isTextual = node.content.type === 'text';
  if (!isTextual) {
    if (layout.width.mode === 'fixed' && layout.width.value > 0) {
      styles.width = `${round(layout.width.value)}px`;
    } else if (layout.width.mode === 'fill') {
      styles.width = '100%';
    }
    if (layout.height.mode === 'fixed' && layout.height.value > 0) {
      styles.height = `${round(layout.height.value)}px`;
    }
  } else if (layout.width.mode === 'fill') {
    styles.width = '100%';
  }

  // Typography
  const typo = appearance.typography;
  if (typo) {
    if (typo.fontFamily) {
      styles['font-family'] = resolveEmailFontStack(typo.fontFamily, settings.compatibilityProfile);
    }
    if (typo.fontSize) styles['font-size'] = `${typo.fontSize}px`;
    if (typo.fontWeight && typo.fontWeight !== 400) styles['font-weight'] = String(typo.fontWeight);
    if (typo.lineHeight && typo.lineHeight !== 1.4) styles['line-height'] = String(typo.lineHeight);
    if (typo.letterSpacing) styles['letter-spacing'] = `${typo.letterSpacing}px`;
    if (typo.textAlign && typo.textAlign !== 'left') styles['text-align'] = typo.textAlign;
    if (typo.textTransform && typo.textTransform !== 'none')
      styles['text-transform'] = typo.textTransform;
    if (typo.decoration && typo.decoration !== 'none') styles['text-decoration'] = typo.decoration;
    if (typo.direction && typo.direction !== 'ltr') styles.direction = typo.direction;
  }

  // Color (text color from foreground fill)
  const fg = appearance.foreground.find((f) => f.type === 'solid' && f.opacity > 0);
  if (fg && fg.type === 'solid') {
    styles.color = fg.value;
  }

  // Opacity
  if (appearance.opacity !== 1) {
    styles.opacity = String(appearance.opacity);
  }

  // Declare the effects the design asks for even though no profile can render
  // them. The compatibility table drops them from the output, but only because
  // they were declared does preflight get to tell the designer that their
  // rotation or blur is gone rather than letting them find out in an inbox.
  if (appearance.transform.rotate !== 0) {
    styles.transform = `rotate(${round(appearance.transform.rotate)}deg)`;
  }
  if (appearance.blendMode !== 'normal') {
    styles['mix-blend-mode'] = appearance.blendMode;
  }
  if (appearance.effects.some((effect) => effect.type === 'drop-shadow')) {
    styles['box-shadow'] = '0 2px 4px rgba(0, 0, 0, 0.15)';
  }
  if (
    appearance.effects.some(
      (effect) => effect.type === 'layer-blur' || effect.type === 'background-blur',
    )
  ) {
    styles.filter = 'blur(4px)';
  }

  // Display for layout
  if (layout.mode === 'flex' && settings.compatibilityProfile !== 'conservative') {
    styles.display = 'flex';
    if (layout.direction === 'row' || layout.direction === 'row-reverse') {
      styles['flex-direction'] = layout.direction;
    }
    const gap = Math.max(layout.gap.left, layout.gap.right, layout.gap.top, layout.gap.bottom);
    if (gap > 0) styles.gap = `${gap}px`;
    if (layout.alignItems === 'center') styles['align-items'] = 'center';
    if (layout.justifyContent === 'center') styles['justify-content'] = 'center';
  }

  // Run the whole declaration block past the compatibility table last, so every
  // property the compiler produced is judged by the same rules and anything
  // degraded is recorded once, with the reason preflight will show.
  const outcome = applyCssCompatibility(styles, settings.compatibilityProfile);
  for (const entry of outcome.degraded) {
    degraded.push({
      property: entry.property,
      value: entry.value,
      support: entry.support === 'unsupported' ? 'unsupported' : 'fallback',
      note: entry.note,
    });
  }
  return outcome.styles;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Content Compilation ───────────────────────────────────────────────────────

function compileContent(
  node: SemanticNode,
  emailSemantics: EmailSemanticMap | undefined,
  sourceNodeId: string,
  provider: 'generic' | 'mailchimp',
  previewVariables: boolean,
  profile: EmailCompatibilityProfile,
):
  | {
      type: 'text' | 'image' | 'html' | 'none';
      text?: string;
      runs?: EmailIrTextRun[];
      html?: string;
    }
  | undefined {
  const content = node.content;

  if (content.type === 'text' && content.text) {
    const runs: EmailIrTextRun[] = [];
    const sourceRuns = content.text.runs?.length
      ? content.text.runs
      : [{ text: content.text.value, style: {} }];
    let offset = 0;
    for (const run of sourceRuns) {
      const runStyles: Record<string, string> = {};
      if (run.style.fontFamily) {
        runStyles['font-family'] = resolveEmailFontStack(run.style.fontFamily, profile);
      }
      if (run.style.fontSize) runStyles['font-size'] = `${run.style.fontSize}px`;
      if (run.style.fontWeight && run.style.fontWeight !== 400)
        runStyles['font-weight'] = String(run.style.fontWeight);
      if (run.style.decoration) runStyles['text-decoration'] = run.style.decoration;

      const pieces = splitTextByLinks(sourceNodeId, run.text, offset, emailSemantics);
      for (const piece of pieces) {
        runs.push({
          ...piece,
          text: applyVariables(
            piece.text,
            emailSemantics?.variables ?? [],
            provider,
            previewVariables,
          ),
          styles: runStyles,
        });
      }
      offset += run.text.length;
    }

    return {
      type: 'text',
      text: applyVariables(
        content.text.value,
        emailSemantics?.variables ?? [],
        provider,
        previewVariables,
      ),
      runs: runs.length > 0 ? runs : undefined,
    };
  }

  if (content.type === 'image' && content.image) {
    return undefined; // Handled by image compilation
  }

  // Check for custom HTML blocks
  const customBlock = emailSemantics?.customHtmlBlocks[sourceNodeId];
  if (customBlock) {
    return {
      type: 'html',
      html: customBlock.code,
    };
  }

  return undefined;
}

function applyVariables(
  text: string,
  variables: EmailSemanticMap['variables'],
  provider: 'generic' | 'mailchimp',
  preview: boolean,
): string {
  return text.replace(
    /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}|\*\|([A-Za-z0-9_.-]+)\|\*/g,
    (match, neutral?: string, mailchimp?: string) => {
      const name = neutral ?? mailchimp ?? '';
      const variable = variables.find(
        (candidate) =>
          candidate.name === name || candidate.id === name || candidate.templateTag?.includes(name),
      );
      if (!variable) return match;
      if (preview) return variable.sampleValue || variable.fallback || '';
      if (provider === 'mailchimp') {
        return (
          variable.templateTag ?? `*|${variable.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}|*`
        );
      }
      return `{{${variable.name}}}`;
    },
  );
}

// ── Link Resolution ───────────────────────────────────────────────────────────

function resolveLink(
  sourceNodeId: string,
  emailSemantics: EmailSemanticMap | undefined,
): EmailIrLink | undefined {
  const link = emailSemantics?.nodeLinks?.[sourceNodeId];
  if (!link) return undefined;
  const result = validateEmailUrl(link);
  if (!result.valid) return undefined;
  return {
    url: appendTrackingParams(result.value, link.tracking),
    kind: link.kind,
    target: link.target,
    title: link.title,
  };
}

function splitTextByLinks(
  sourceNodeId: string,
  text: string,
  offset: number,
  emailSemantics: EmailSemanticMap | undefined,
): Array<{ text: string; link?: EmailIrLink }> {
  const ranges = Object.values(emailSemantics?.textRangeLinks ?? {})
    .filter(
      (range) =>
        range.nodeId === sourceNodeId &&
        range.endIndex > offset &&
        range.startIndex < offset + text.length,
    )
    .sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);
  const boundaries = new Set([offset, offset + text.length]);
  for (const range of ranges) {
    boundaries.add(Math.max(offset, range.startIndex));
    boundaries.add(Math.min(offset + text.length, range.endIndex));
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const result: Array<{ text: string; link?: EmailIrLink }> = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index] ?? offset;
    const end = sorted[index + 1] ?? offset + text.length;
    const range = ranges.find(
      (candidate) => candidate.startIndex <= start && candidate.endIndex >= end,
    );
    let link: EmailIrLink | undefined;
    if (range) {
      const validation = validateEmailUrl(range.link);
      if (validation.valid) {
        link = {
          url: appendTrackingParams(validation.value, range.link.tracking),
          kind: range.link.kind,
          target: range.link.target,
          title: range.link.title,
        };
      }
    }
    result.push({ text: text.slice(start - offset, end - offset), link });
  }
  return result;
}

// ── Image Compilation ─────────────────────────────────────────────────────────

function compileImage(
  node: SemanticNode,
  sourceNodeId: string,
  emailSemantics: EmailSemanticMap | undefined,
  assets: EmailIrAsset[],
  warnings: EmailIrWarning[],
): EmailIrImage | undefined {
  const content = node.content;
  if (content.type !== 'image' || !content.image) return undefined;

  const img = content.image;
  const explicitAsset = emailSemantics?.assets[sourceNodeId];
  const generatedAsset =
    !explicitAsset && img.src.startsWith('data:')
      ? {
          sourceNodeId,
          outputFilename: `${sourceNodeId}.${dataUrlExtension(img.src)}`,
          hash: `fnv1a:${simpleHash(img.src)}`,
          width: node.layout.width.value,
          height: node.layout.height.value,
          mimeType: dataUrlMimeType(img.src),
          alt: img.alt || '',
          decorative: false,
          remoteUrl: undefined,
          dataUrl: img.src,
        }
      : undefined;
  const assetInfo = explicitAsset ?? generatedAsset;
  const src = assetInfo?.remoteUrl ?? (assetInfo ? `assets/${assetInfo.outputFilename}` : img.src);

  // Validate source URL
  if (!src || src.startsWith('file://') || src.startsWith('data:')) {
    // Local file URL — need to resolve to asset path
    if (src?.startsWith('file://')) {
      warnings.push({
        severity: 'warning',
        code: 'LOCAL_FILE_URL',
        message: `Image "${node.name}" uses a local file URL that won't work in email`,
        sourceNodeId,
        category: 'asset',
        suggestedFix: 'Export assets and use relative paths or a CDN URL',
      });
    }
  }

  // Collect asset metadata
  if (assetInfo) {
    assets.push({
      sourceNodeId,
      filename: assetInfo.outputFilename,
      hash: assetInfo.hash,
      mimeType: assetInfo.mimeType,
      width: assetInfo.width,
      height: assetInfo.height,
      alt: assetInfo.alt || img.alt || node.name,
      remoteUrl: assetInfo.remoteUrl,
      dataUrl: assetInfo.dataUrl ?? (src.startsWith('data:') ? src : undefined),
    });
  }

  // Resolve link on image
  const link = resolveLink(sourceNodeId, emailSemantics);

  return {
    src,
    alt: assetInfo?.decorative ? '' : assetInfo?.alt || img.alt || '',
    width: node.layout.width.value,
    height: node.layout.height.value,
    decorative: assetInfo?.decorative ?? false,
    link,
  };
}

function dataUrlMimeType(dataUrl: string): string {
  return /^data:([^;,]+)/i.exec(dataUrl)?.[1] ?? 'application/octet-stream';
}

function dataUrlExtension(dataUrl: string): string {
  const mime = dataUrlMimeType(dataUrl);
  return mime === 'image/jpeg' ? 'jpg' : (mime.split('/')[1] ?? 'bin');
}

function simpleHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ── Compatibility Classification ──────────────────────────────────────────────

function classifyCompatibility(
  node: SemanticNode,
  kind: EmailIrNodeKind,
  settings: EmailDocumentSettings,
): EmailCompatibilityClassification {
  const profile = settings.compatibilityProfile;

  // Check flattening info
  if (node.flattening?.mustFlatten) {
    // Has effects/shapes that need raster fallback
    const reasons = node.flattening.reasons;
    const hasText = node.content.type === 'text' || kind === 'heading' || kind === 'paragraph';

    // Don't rasterize important text
    if (
      hasText &&
      reasons.every((r) => ['background-blur', 'layer-blur', 'unsupported-blend'].includes(r))
    ) {
      return 'approximated';
    }

    // Rasterize decorative/complex visuals
    return 'rasterized';
  }

  // Check layout compatibility
  if (node.layout.mode === 'absolute') {
    if (profile === 'conservative') {
      return 'converted';
    }
    // Modern email supports some CSS positioning
    return 'converted';
  }

  // Grid layout → converted (use tables)
  if (node.layout.mode === 'grid') {
    return 'converted';
  }

  // Effects
  const hasEffects = node.appearance.effects.some(
    (e) => e.type === 'layer-blur' || e.type === 'background-blur',
  );
  if (hasEffects) {
    return profile === 'conservative' ? 'rasterized' : 'approximated';
  }

  // Gradient fills
  const hasGradient = node.appearance.background.some((f) => f.type === 'gradient');
  if (hasGradient && profile === 'conservative') {
    return 'approximated';
  }

  // Blend modes
  if (node.appearance.blendMode !== 'normal') {
    return 'approximated';
  }

  // Rotated elements
  if (node.appearance.transform.rotate !== 0) {
    return 'converted';
  }

  // Default: native
  return 'native';
}
