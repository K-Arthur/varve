import type { EmailDiagnostic, EmailSemanticMap, MailchimpEditableRegion } from '@varve/scene';
import type { EmailDocumentIr, EmailIrNode } from './email-ir-types';
import { sanitizeEmailCss, sanitizeEmailHtml, validateEmailUrl } from './email-security';

export function runEmailPreflight(
  ir: EmailDocumentIr,
  semantics?: EmailSemanticMap,
  mailchimpRegions?: MailchimpEditableRegion[],
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
  inspectOverlappingTextRanges(semantics, diagnostics);
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
    inspectNode(
      node,
      diagnostics,
      ir.settings.compatibilityProfile,
      false,
      false,
      ir.assets,
      ir.settings.provider === 'mailchimp',
    );
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
    inspectMailchimpRegions(ir, diagnostics, mailchimpRegions ?? []);
  }
  if (ir.settings.plainTextOverride !== undefined) {
    diagnostics.push({
      severity: 'info',
      code: 'MANUAL_PLAIN_TEXT_OVERRIDE',
      message: 'The exported plain-text version is manually authored and will not be regenerated.',
      category: 'accessibility',
      suggestedFix: 'Review the plain-text version after changing the visual design.',
    });
  }

  // Compiler and layout findings are diagnostics too. They are raised while the
  // tree is being built, where preflight cannot see them, so fold them in here
  // rather than leaving them on the IR for nobody to read.
  for (const warning of ir.warnings) {
    diagnostics.push({
      severity: warning.severity,
      code: warning.code,
      message: warning.message,
      sourceNodeId: warning.sourceNodeId,
      category: warning.category,
      suggestedFix: warning.suggestedFix,
    });
  }

  return dedupeDiagnostics(diagnostics);
}

/**
 * Collapse repeats of the same finding on the same node.
 *
 * A single defect can be noticed by the compiler, the layout pass, and the
 * emitter. Listing it three times in the preflight panel reads as three
 * problems and buries the ones that are genuinely distinct.
 */
function dedupeDiagnostics(diagnostics: EmailDiagnostic[]): EmailDiagnostic[] {
  const seen = new Set<string>();
  const unique: EmailDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}|${diagnostic.sourceNodeId ?? ''}|${diagnostic.sourceVariableId ?? ''}|${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(diagnostic);
  }
  return unique;
}

/**
 * Explain declarations the compatibility profile changed.
 *
 * The compiler already swapped or dropped them, so the output is correct
 * either way; what a designer needs is to know their rounded corners will be
 * square in Outlook *before* they send, and which profile decided that. One
 * diagnostic per node keeps a heavily styled block from flooding the panel.
 */
function reportDegradedStyles(
  node: EmailIrNode,
  diagnostics: EmailDiagnostic[],
  profile: EmailDocumentIr['settings']['compatibilityProfile'],
): void {
  const degraded = node.degradedStyles;
  if (!degraded || degraded.length === 0) return;

  const dropped = degraded.filter((entry) => entry.support === 'unsupported');
  const substituted = degraded.filter((entry) => entry.support === 'fallback');

  if (dropped.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'UNSUPPORTED_CSS_DROPPED',
      message: `"${node.name}": ${listProperties(dropped)} cannot be represented in email and ${dropped.length === 1 ? 'was' : 'were'} dropped. ${firstNote(dropped)}`.trim(),
      sourceNodeId: node.sourceNodeId,
      category: 'css',
      profile,
      suggestedFix:
        'Bake the effect into an exported image, or use a solid colour the profile can render.',
    });
  }

  if (substituted.length > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'CSS_FALLBACK_APPLIED',
      message: `"${node.name}": ${listProperties(substituted)} ${substituted.length === 1 ? 'uses' : 'use'} a fallback in the ${profile} profile. ${firstNote(substituted)}`.trim(),
      sourceNodeId: node.sourceNodeId,
      category: 'css',
      profile,
    });
  }
}

function listProperties(entries: Array<{ property: string }>): string {
  const names = [...new Set(entries.map((entry) => entry.property))];
  if (names.length === 1) return `\`${names[0]}\``;
  const last = names.pop();
  return `${names.map((name) => `\`${name}\``).join(', ')} and \`${last}\``;
}

function firstNote(entries: Array<{ note?: string }>): string {
  return entries.find((entry) => entry.note)?.note ?? '';
}

function inspectOverlappingTextRanges(
  semantics: EmailSemanticMap | undefined,
  diagnostics: EmailDiagnostic[],
): void {
  const rangesByNode = new Map<string, EmailSemanticMap['textRangeLinks'][string][]>();
  for (const range of Object.values(semantics?.textRangeLinks ?? {})) {
    const nodeRanges = rangesByNode.get(range.nodeId) ?? [];
    nodeRanges.push(range);
    rangesByNode.set(range.nodeId, nodeRanges);
  }
  for (const [nodeId, ranges] of rangesByNode) {
    ranges.sort(
      (left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex,
    );
    let furthestEnd = -1;
    for (const range of ranges) {
      if (range.startIndex < furthestEnd) {
        diagnostics.push({
          severity: 'error',
          code: 'OVERLAPPING_TEXT_RANGE_LINK',
          message: 'Text-range links overlap and cannot be represented as nested email anchors.',
          sourceNodeId: nodeId,
          category: 'link',
          suggestedFix: 'Split the ranges so each character belongs to at most one link.',
        });
        break;
      }
      furthestEnd = Math.max(furthestEnd, range.endIndex);
    }
  }
}

function inspectNode(
  node: EmailIrNode,
  diagnostics: EmailDiagnostic[],
  profile: EmailDocumentIr['settings']['compatibilityProfile'],
  linkedAncestor: boolean,
  editableAncestor: boolean,
  assets: EmailDocumentIr['assets'],
  allowMailchimpAttributes: boolean,
): void {
  const hasInlineLink = Boolean(
    node.content?.runs?.some((run) => Boolean(run.link)) || node.image?.link,
  );
  reportDegradedStyles(node, diagnostics, profile);

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
  const editable = Boolean(node.providerAttributes?.['mc:edit']);
  if (editableAncestor && editable) {
    diagnostics.push({
      severity: 'error',
      code: 'NESTED_MAILCHIMP_EDITABLE_REGION',
      message: `Mailchimp editable region "${node.name}" is nested inside another editable region.`,
      sourceNodeId: node.sourceNodeId,
      category: 'provider',
      suggestedFix: 'Keep editable regions as non-overlapping scopes.',
    });
  }
  if (node.kind === 'custom-html' && node.content?.html) {
    const sanitized = sanitizeEmailHtml(node.content.html, { allowMailchimpAttributes });
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
    inspectNode(
      child,
      diagnostics,
      profile,
      linkedAncestor || Boolean(node.link),
      editableAncestor || editable,
      assets,
      allowMailchimpAttributes,
    );
}

function inspectMailchimpRegions(
  ir: EmailDocumentIr,
  diagnostics: EmailDiagnostic[],
  regions: MailchimpEditableRegion[],
): void {
  const seen = new Map<string, MailchimpEditableRegion>();
  for (const region of regions) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(region.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_MAILCHIMP_REGION_ID',
        message: `Mailchimp editable region "${region.name}" has an unsafe or invalid stable ID.`,
        sourceNodeId: region.nodeId,
        category: 'provider',
        suggestedFix:
          'Use a stable ID beginning with a letter and containing only letters, numbers, _ or -.',
      });
    }
    const previous = seen.get(region.id);
    if (previous) {
      diagnostics.push({
        severity: 'error',
        code: 'DUPLICATE_MAILCHIMP_REGION_ID',
        message: `Mailchimp editable region ID "${region.id}" is used more than once.`,
        sourceNodeId: region.nodeId,
        category: 'provider',
        suggestedFix: `Choose a different ID from region "${previous.name}".`,
      });
    }
    seen.set(region.id, region);
    if (!ir.nodes.some((node) => containsSourceNode(node, region.nodeId))) {
      diagnostics.push({
        severity: 'error',
        code: 'MISSING_MAILCHIMP_REGION_NODE',
        message: `Mailchimp editable region "${region.id}" points to a missing scene node.`,
        sourceNodeId: region.nodeId,
        category: 'provider',
        suggestedFix: 'Remove the stale region or attach it to an existing email node.',
      });
    }
    if (region.type === 'repeat' && !region.repeatPattern?.trim()) {
      diagnostics.push({
        severity: 'info',
        code: 'MAILCHIMP_REPEAT_USES_REGION_ID',
        message: `Repeatable region "${region.id}" uses its stable ID as the repeat group name.`,
        sourceNodeId: region.nodeId,
        category: 'provider',
        suggestedFix:
          'Set an explicit repeat pattern when multiple repeatable layouts share a group.',
      });
    }
  }
}

function containsSourceNode(node: EmailIrNode, sourceNodeId: string): boolean {
  return (
    node.sourceNodeId === sourceNodeId ||
    node.children.some((child) => containsSourceNode(child, sourceNodeId))
  );
}

function isLocalImageReference(src: string): boolean {
  return /^(?:file:|blob:|\/|\.\.?(?:\/|\\)|[A-Za-z]:[\\/])/i.test(src.trim());
}
