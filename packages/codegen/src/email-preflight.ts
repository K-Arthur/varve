import type { EmailDiagnostic, EmailSemanticMap } from '@varve/scene';
import type { EmailDocumentIr, EmailIrNode } from './email-ir-types';
import { sanitizeEmailCss, sanitizeEmailHtml, validateEmailUrl } from './email-security';

export function runEmailPreflight(
  ir: EmailDocumentIr,
  semantics?: EmailSemanticMap,
): EmailDiagnostic[] {
  const diagnostics: EmailDiagnostic[] = [...(semantics?.diagnostics ?? [])];
  for (const [nodeId, link] of Object.entries(semantics?.nodeLinks ?? {})) {
    const result = validateEmailUrl(link);
    if (!result.valid)
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_LINK',
        message: result.reason ?? 'Link is invalid.',
        sourceNodeId: nodeId,
        category: 'link',
        suggestedFix: 'Use a supported safe URL.',
      });
  }
  for (const range of Object.values(semantics?.textRangeLinks ?? {})) {
    const result = validateEmailUrl(range.link);
    if (!result.valid)
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_TEXT_RANGE_LINK',
        message: result.reason ?? 'Text-range link is invalid.',
        sourceNodeId: range.nodeId,
        category: 'link',
        suggestedFix: 'Use a supported safe URL.',
      });
    if (range.startIndex < 0 || range.endIndex <= range.startIndex)
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_TEXT_RANGE',
        message: 'Text-range link boundaries are invalid.',
        sourceNodeId: range.nodeId,
        category: 'link',
      });
  }
  if (
    !Number.isInteger(ir.settings.contentWidth) ||
    ir.settings.contentWidth < 280 ||
    ir.settings.contentWidth > 1000
  ) {
    diagnostics.push({
      severity: 'error',
      code: 'INVALID_CONTENT_WIDTH',
      message: 'Email content width must be between 280 and 1000 CSS pixels.',
      category: 'layout',
    });
  }
  if (!Number.isInteger(ir.settings.mobileBreakpoint) || ir.settings.mobileBreakpoint < 280) {
    diagnostics.push({
      severity: 'error',
      code: 'INVALID_MOBILE_BREAKPOINT',
      message: 'Mobile breakpoint must be at least 280 CSS pixels.',
      category: 'layout',
    });
  }
  if (ir.settings.customCss) {
    const sanitizedCss = sanitizeEmailCss(ir.settings.customCss);
    if (sanitizedCss.removed.length > 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'CUSTOM_CSS_REQUIRES_SANITIZATION',
        message: 'Custom email CSS is filtered before it is emitted.',
        category: 'css',
        suggestedFix: 'Use email-safe selectors and declarations only.',
      });
    }
  }
  for (const node of ir.nodes)
    inspectNode(node, diagnostics, ir.settings.compatibilityProfile, false, ir.assets);
  for (const asset of ir.assets) {
    if (!asset.remoteUrl && !asset.dataUrl && !asset.filename) {
      diagnostics.push({
        severity: 'error',
        code: 'UNRESOLVED_ASSET',
        message: `Asset ${asset.filename} has no hosted or package source.`,
        sourceNodeId: asset.sourceNodeId,
        category: 'asset',
        suggestedFix: 'Set an asset base URL or attach the exported asset package.',
      });
    }
  }
  if (ir.settings.provider === 'mailchimp') {
    for (const required of semantics?.variables.filter((variable) => variable.required) ?? []) {
      if (!required.templateTag) {
        diagnostics.push({
          severity: 'error',
          code: 'MISSING_PROVIDER_VARIABLE_TAG',
          message: `Required variable ${required.name} has no Mailchimp merge tag.`,
          sourceVariableId: required.id,
          category: 'provider',
        });
      }
    }
  }
  return diagnostics;
}

function inspectNode(
  node: EmailIrNode,
  diagnostics: EmailDiagnostic[],
  profile: EmailDocumentIr['settings']['compatibilityProfile'],
  linkedAncestor: boolean,
  assets: EmailDocumentIr['assets'],
): void {
  const hasInlineLink = Boolean(
    node.content?.runs?.some((run) => Boolean(run.link)) || node.image?.link,
  );
  if (linkedAncestor && (node.link || hasInlineLink)) {
    diagnostics.push({
      severity: 'error',
      code: 'NESTED_LINK',
      message: `"${node.name}" is linked inside another linked email object.`,
      sourceNodeId: node.sourceNodeId,
      category: 'link',
      suggestedFix: 'Keep the link on the outer object or remove the inner link.',
    });
  }
  if (node.kind === 'image') {
    if (!node.image?.src) {
      diagnostics.push({
        severity: 'error',
        code: 'MISSING_IMAGE_SOURCE',
        message: `Image "${node.name}" has no source.`,
        sourceNodeId: node.sourceNodeId,
        category: 'image',
      });
    }
    if (!node.decorative && !node.image?.alt) {
      diagnostics.push({
        severity: 'warning',
        code: 'MISSING_IMAGE_ALT',
        message: `Image "${node.name}" has no alt text.`,
        sourceNodeId: node.sourceNodeId,
        category: 'accessibility',
        suggestedFix: 'Add descriptive alt text or mark the image decorative.',
      });
    }
    if (isLocalImageReference(node.image?.src ?? '')) {
      diagnostics.push({
        severity: 'error',
        code: 'LOCAL_IMAGE_URL',
        message: `Image "${node.name}" still references a local file URL.`,
        sourceNodeId: node.sourceNodeId,
        category: 'asset',
        suggestedFix: 'Attach an exported asset or configure a hosted asset URL.',
      });
    }
    if (
      node.image?.src &&
      !/^https?:|^data:/i.test(node.image.src) &&
      !isLocalImageReference(node.image.src) &&
      !assets.some((asset) => node.image?.src === `assets/${asset.filename}`)
    ) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNRESOLVED_IMAGE_REFERENCE',
        message: `Image "${node.name}" does not resolve to a hosted URL or exported asset.`,
        sourceNodeId: node.sourceNodeId,
        category: 'asset',
        suggestedFix: 'Attach an asset manifest entry or configure an asset base URL.',
      });
    }
    if (node.image?.src.startsWith('data:')) {
      diagnostics.push({
        severity: 'warning',
        code: 'EMBEDDED_IMAGE_DATA_URL',
        message: `Image "${node.name}" uses an embedded data URL.`,
        sourceNodeId: node.sourceNodeId,
        category: 'asset',
        suggestedFix: 'Export the image as a package asset or use a hosted URL.',
      });
    }
  }
  if (node.link) {
    const result = validateEmailUrl({
      url: node.link.url,
      kind: node.link.kind,
      title: node.link.title,
      target: node.link.target,
    });
    if (!result.valid)
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_LINK',
        message: result.reason ?? 'Link is invalid.',
        sourceNodeId: node.sourceNodeId,
        category: 'link',
        suggestedFix: 'Use an https, mailto, tel, fragment, or supported merge-tag URL.',
      });
  }
  if (node.link && node.content?.type === 'text' && hasInlineLink) {
    diagnostics.push({
      severity: 'error',
      code: 'NESTED_LINK_SCOPE',
      message: `"${node.name}" has both a whole-node link and text-range links.`,
      sourceNodeId: node.sourceNodeId,
      category: 'link',
      suggestedFix: 'Keep either the whole node linked or link individual text ranges.',
    });
  }
  if (node.kind === 'custom-html' && node.content?.html) {
    const sanitized = sanitizeEmailHtml(node.content.html);
    if (sanitized.removed.length > 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNSAFE_CUSTOM_HTML',
        message: `Custom HTML contains ${sanitized.removed.length} construct(s) that will be removed.`,
        sourceNodeId: node.sourceNodeId,
        category: 'security',
        suggestedFix: 'Remove scripts, event handlers, unsafe URLs, and unsupported elements.',
      });
    }
  }
  if (node.compatibility === 'rasterized') {
    diagnostics.push({
      severity: node.kind === 'heading' || node.kind === 'button' ? 'error' : 'warning',
      code: 'RASTERIZED_NODE',
      message: `"${node.name}" will be rasterized for email compatibility.`,
      sourceNodeId: node.sourceNodeId,
      category: 'compatibility',
      profile,
      suggestedFix:
        'Keep headings, copy, and CTA labels live; simplify decorative artwork if needed.',
    });
  }
  if (profile === 'conservative' && node.compatibility === 'approximated') {
    diagnostics.push({
      severity: 'warning',
      code: 'CONSERVATIVE_APPROXIMATION',
      message: `"${node.name}" uses styling that is approximated in the conservative profile.`,
      sourceNodeId: node.sourceNodeId,
      category: 'compatibility',
      profile,
    });
  }
  for (const child of node.children)
    inspectNode(child, diagnostics, profile, linkedAncestor || Boolean(node.link), assets);
}

function isLocalImageReference(src: string): boolean {
  return /^(?:file:|blob:|\/|\.\.?(?:\/|\\)|[A-Za-z]:[\\/])/i.test(src.trim());
}
