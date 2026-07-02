/**
 * Design governance system for validating and auditing design assets.
 *
 * Provides naming convention validation, orphan detection, style usage
 * tracking, and component property validation to ensure design system
 * consistency and quality at scale.
 *
 * Research basis: Figma's design system organization best practices,
 * industry naming conventions (CTI), WCAG contrast governance,
 * enterprise design system governance patterns.
 */
import type { ComponentDefinition, Document, NodeId, Style, StyleType } from './types';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  type: 'error' | 'warning' | 'info';
  category: 'naming' | 'orphan' | 'contrast' | 'component' | 'reference';
  message: string;
  targetId?: NodeId;
  targetName?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface StyleUsageReport {
  totalStyles: number;
  usedStyles: number;
  orphanedStyles: number;
  styleTypeBreakdown: Partial<Record<StyleType, number>>;
  styleUsageByNode: number;
  totalNodes: number;
}

// ── Naming Convention Validation ───────────────────────────────────────────

/**
 * Validate naming conventions for design assets.
 *
 * Rules:
 * - Components: PascalCase (e.g., "Button", "TextInput")
 * - Styles: kebab-case (e.g., "primary-teal", "heading-1")
 * - Variables: camelCase or kebab-case (e.g., "primaryColor", "space-md")
 */
export function validateNamingConventions(
  name: string,
  kind: 'component' | 'style' | 'variable',
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (kind === 'component') {
    // PascalCase: starts with uppercase, no spaces/hyphens/underscores
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      issues.push({
        type: 'error',
        category: 'naming',
        message: `Component name '${name}' should be PascalCase (e.g., 'Button', 'TextInput')`,
        targetName: name,
      });
    }
  }

  if (kind === 'style' || kind === 'variable') {
    // kebab-case or camelCase: no spaces, no special chars
    if (/\s/.test(name)) {
      issues.push({
        type: 'error',
        category: 'naming',
        message: `Style name '${name}' should use kebab-case (no spaces)`,
        targetName: name,
      });
    }

    // Check for PascalCase misused on styles
    if (/^[A-Z]/.test(name) && name.length > 1 && name === name.charAt(0)!.toUpperCase() + name.slice(1)) {
      issues.push({
        type: 'warning',
        category: 'naming',
        message: `Style name '${name}' appears to use PascalCase; prefer kebab-case`,
        targetName: name,
      });
    }

    // Check for semantic prefix convention
    const hasSemanticPrefix =
      /^(color|text|effect|layout|space|radius|shadow|font|border|surface|interactive|feedback|accent|layer|tree|hero|brand)-/.test(name);
    if (kind === 'style' && !hasSemanticPrefix && !name.startsWith('_')) {
      issues.push({
        type: 'info',
        category: 'naming',
        message: `Style name '${name}' should use a semantic prefix (e.g., 'color-', 'text-', 'effect-')`,
        targetName: name,
      });
    }
  }

  return { valid: issues.filter((i) => i.type === 'error').length === 0, issues };
}

// ── Orphan Detection ───────────────────────────────────────────────────────

/**
 * Find styles that are defined but not referenced by any node.
 */
export function findOrphanedStyles(doc: Document): Style[] {
  if (!doc.styles) return [];

  const usedStyleIds = new Set<NodeId>();
  for (const node of Object.values(doc.nodes)) {
    if ('styleId' in node && node.styleId) {
      usedStyleIds.add(node.styleId);
    }
  }

  return Object.values(doc.styles).filter((style) => !usedStyleIds.has(style.id));
}

/**
 * Find components that are defined but not instantiated.
 */
export function findUnusedComponents(doc: Document): ComponentDefinition[] {
  const instantiatedIds = new Set<NodeId>();
  for (const node of Object.values(doc.nodes)) {
    if (node.kind === 'frame' && node.componentId) {
      instantiatedIds.add(node.componentId);
    }
  }

  return Object.values(doc.components).filter((c) => !instantiatedIds.has(c.id));
}

// ── Component Validation ──────────────────────────────────────────────────

/**
 * Validate a component's properties and variants for consistency.
 */
export function validateComponentProperties(
  component: ComponentDefinition,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const propNames = new Set(component.properties?.map((p) => p.name) ?? []);

  // Validate variants reference valid properties
  for (const variant of component.variants ?? []) {
    for (const propName of Object.keys(variant.propertyValues)) {
      if (!propNames.has(propName)) {
        issues.push({
          type: 'error',
          category: 'component',
          message: `Variant '${variant.name}' references unknown property '${propName}'`,
          targetName: component.name,
        });
      }
    }
  }

  // Validate property names are unique
  const seen = new Set<string>();
  for (const prop of component.properties ?? []) {
    if (seen.has(prop.name)) {
      issues.push({
        type: 'error',
        category: 'component',
        message: `Duplicate property name '${prop.name}' in component '${component.name}'`,
        targetName: component.name,
      });
    }
    seen.add(prop.name);
  }

  return { valid: issues.filter((i) => i.type === 'error').length === 0, issues };
}

// ── Usage Reporting ────────────────────────────────────────────────────────

/**
 * Generate a comprehensive style usage report for a document.
 */
export function generateStyleUsageReport(doc: Document): StyleUsageReport {
  const allStyles = Object.values(doc.styles ?? {});
  const orphans = findOrphanedStyles(doc);
  const orphanIds = new Set(orphans.map((o) => o.id));

  // Count nodes that use styles
  let styleUsageByNode = 0;
  for (const node of Object.values(doc.nodes)) {
    if ('styleId' in node && node.styleId) {
      styleUsageByNode++;
    }
  }

  // Breakdown by type
  const styleTypeBreakdown: Partial<Record<StyleType, number>> = {};
  for (const style of allStyles) {
    const type = style.type as StyleType;
    styleTypeBreakdown[type] = (styleTypeBreakdown[type] ?? 0) + 1;
  }

  return {
    totalStyles: allStyles.length,
    usedStyles: allStyles.length - orphans.length,
    orphanedStyles: orphans.length,
    styleTypeBreakdown,
    styleUsageByNode,
    totalNodes: Object.keys(doc.nodes).length,
  };
}
