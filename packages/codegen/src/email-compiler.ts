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
import type {
  EmailCompatibilityClassification,
  EmailDocumentIr,
  EmailDocumentSettings,
  EmailIrAsset,
  EmailIrImage,
  EmailIrLink,
  EmailIrNode,
  EmailIrNodeKind,
  EmailIrTextRun,
  EmailIrWarning,
} from './email-ir-types';
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

  return {
    ir: {
      version: '1.0',
      settings,
      nodes,
      assets,
      warnings,
      diagnostics,
    },
    diagnostics,
    warnings,
  };
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
  const styles = compileStyles(node, settings);

  // Build content
  const content = compileContent(node, emailSemantics, sourceNodeId);

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

  return {
    id: `email-${sourceNodeId}`,
    sourceNodeId,
    kind,
    name: node.name,
    children,
    styles,
    content,
    link,
    image,
    headingLevel: semanticMeta?.headingLevel,
    alt: (image?.alt ?? semanticMeta?.kind === 'decorative') ? undefined : node.name,
    decorative: semanticMeta?.kind === 'decorative',
    width: node.layout.width.mode === 'fixed' ? node.layout.width.value : undefined,
    height: node.layout.height.mode === 'fixed' ? node.layout.height.value : undefined,
    mobileBehavior: semanticMeta?.mobileBehavior,
    hideOnMobile: semanticMeta?.hideOnMobile,
    hideOnDesktop: semanticMeta?.hideOnDesktop,
    rasterFallback,
    compatibility,
  };
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
): Record<string, string> {
  const styles: Record<string, string> = {};
  const appearance = node.appearance;
  const layout = node.layout;

  // Background
  const bg = appearance.background.find((f) => f.type === 'solid' && f.opacity > 0);
  if (bg && bg.type === 'solid') {
    styles['background-color'] = bg.value;
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

  // Width/Height
  if (layout.width.mode === 'fixed' && layout.width.value > 0) {
    styles.width = `${layout.width.value}px`;
  } else if (layout.width.mode === 'fill') {
    styles.width = '100%';
  }

  if (layout.height.mode === 'fixed' && layout.height.value > 0) {
    styles.height = `${layout.height.value}px`;
  }

  // Typography
  const typo = appearance.typography;
  if (typo) {
    if (typo.fontFamily) {
      // Email-safe font stack
      styles['font-family'] = resolveFontStack(typo.fontFamily);
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

  // Display for layout
  if (layout.mode === 'flex') {
    styles.display = 'flex';
    if (layout.direction === 'row' || layout.direction === 'row-reverse') {
      styles['flex-direction'] = layout.direction;
    }
    const gap = Math.max(layout.gap.left, layout.gap.right, layout.gap.top, layout.gap.bottom);
    if (gap > 0) styles.gap = `${gap}px`;
    if (layout.alignItems === 'center') styles['align-items'] = 'center';
    if (layout.justifyContent === 'center') styles['justify-content'] = 'center';
  }

  return styles;
}

function resolveFontStack(fontFamily: string): string {
  // Map common design fonts to email-safe stacks
  const fontMap: Record<string, string> = {
    Inter: 'Arial, Helvetica, sans-serif',
    Roboto: 'Arial, Helvetica, sans-serif',
    'Open Sans': 'Arial, Helvetica, sans-serif',
    Lato: 'Arial, Helvetica, sans-serif',
    Montserrat: 'Arial, Helvetica, sans-serif',
    Poppins: 'Arial, Helvetica, sans-serif',
    'Source Sans Pro': 'Arial, Helvetica, sans-serif',
    Nunito: 'Arial, Helvetica, sans-serif',
    Playfair: 'Georgia, Times, serif',
    'Playfair Display': 'Georgia, Times, serif',
    Merriweather: 'Georgia, Times, serif',
    Lora: 'Georgia, Times, serif',
    'PT Serif': 'Georgia, Times, serif',
    'Fira Code': 'Consolas, Monaco, monospace',
    'JetBrains Mono': 'Consolas, Monaco, monospace',
    'Source Code Pro': 'Consolas, Monaco, monospace',
  };

  const mapped = fontMap[fontFamily];
  if (mapped) return mapped;

  // Unknown font: use it with generic fallback
  return `"${fontFamily}", Arial, Helvetica, sans-serif`;
}

// ── Content Compilation ───────────────────────────────────────────────────────

function compileContent(
  node: SemanticNode,
  emailSemantics: EmailSemanticMap | undefined,
  sourceNodeId: string,
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
    if (content.text.runs) {
      for (const run of content.text.runs) {
        const runStyles: Record<string, string> = {};
        if (run.style.fontFamily) runStyles['font-family'] = resolveFontStack(run.style.fontFamily);
        if (run.style.fontSize) runStyles['font-size'] = `${run.style.fontSize}px`;
        if (run.style.fontWeight && run.style.fontWeight !== 400)
          runStyles['font-weight'] = String(run.style.fontWeight);
        if (run.style.decoration) runStyles['text-decoration'] = run.style.decoration;

        // Check for text-range link
        const textRangeLink = findTextRangeLink(sourceNodeId, run.text, emailSemantics);

        runs.push({
          text: run.text,
          styles: runStyles,
          link: textRangeLink
            ? {
                url: textRangeLink.url,
                kind: textRangeLink.kind,
              }
            : undefined,
        });
      }
    }

    return {
      type: 'text',
      text: content.text.value,
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

// ── Link Resolution ───────────────────────────────────────────────────────────

function resolveLink(
  sourceNodeId: string,
  emailSemantics: EmailSemanticMap | undefined,
): EmailIrLink | undefined {
  // Check text-range links first
  const textLinks = emailSemantics?.textRangeLinks ?? {};
  for (const key of Object.keys(textLinks)) {
    if (key.startsWith(`${sourceNodeId}:`)) {
      const link = textLinks[key];
      if (link) {
        return {
          url: link.link.url,
          kind: link.link.kind,
          target: link.link.target,
          title: link.link.title,
        };
      }
    }
  }

  return undefined;
}

function findTextRangeLink(
  sourceNodeId: string,
  _text: string,
  emailSemantics: EmailSemanticMap | undefined,
): { url: string; kind: EmailIrLink['kind'] } | undefined {
  // This is a simplified lookup — full implementation would check character ranges
  const textLinks = emailSemantics?.textRangeLinks ?? {};
  for (const key of Object.keys(textLinks)) {
    if (key.startsWith(`${sourceNodeId}:`)) {
      const link = textLinks[key];
      if (link) {
        return { url: link.link.url, kind: link.link.kind };
      }
    }
  }
  return undefined;
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
  const src = img.src;

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
  const assetInfo = emailSemantics?.assets[sourceNodeId];
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
    });
  }

  // Resolve link on image
  const link = resolveLink(sourceNodeId, emailSemantics);

  return {
    src,
    alt: img.alt || node.name,
    width: node.layout.width.value,
    height: node.layout.height.value,
    decorative: false,
    link,
  };
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
