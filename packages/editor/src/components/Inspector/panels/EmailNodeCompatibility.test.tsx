// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { EmailDocumentIr, EmailIrNode } from '@varve/codegen';
import { describe, expect, it } from 'vitest';
import { EmailNodeCompatibility } from './EmailNodeCompatibility';

function irNode(overrides: Partial<EmailIrNode> = {}): EmailIrNode {
  return {
    id: 'email-node',
    sourceNodeId: 'node-1',
    kind: 'paragraph',
    name: 'Body copy',
    children: [],
    styles: {},
    compatibility: 'native',
    ...overrides,
  } as EmailIrNode;
}

function ir(nodes: EmailIrNode[]): EmailDocumentIr {
  return {
    version: '1.0',
    settings: {
      language: 'en',
      direction: 'ltr',
      contentWidth: 600,
      mobileBreakpoint: 480,
      compatibilityProfile: 'modern',
      provider: 'generic',
    },
    nodes,
    plainText: '',
    assets: [],
    warnings: [],
    diagnostics: [],
  } as EmailDocumentIr;
}

describe('EmailNodeCompatibility', () => {
  it('reports live text as email safe', () => {
    render(<EmailNodeCompatibility ir={ir([irNode()])} nodeId="node-1" />);

    expect(screen.getByTestId('email-compat-classification')).toHaveTextContent('Email safe');
    expect(screen.getByText('Live text')).toBeVisible();
  });

  it('shows how a row was split into columns', () => {
    const row = irNode({
      kind: 'row',
      sourceNodeId: 'row-1',
      children: [
        irNode({ kind: 'column', sourceNodeId: 'a', width: 200 }),
        irNode({ kind: 'column', sourceNodeId: 'b', width: 400 }),
      ],
      compatibility: 'converted',
    });

    render(<EmailNodeCompatibility ir={ir([row])} nodeId="row-1" />);

    expect(screen.getByText('2 · 200px + 400px')).toBeVisible();
    expect(screen.getByTestId('email-compat-classification')).toHaveTextContent('Converted');
  });

  it('explains which declarations the profile changed and why', () => {
    const node = irNode({
      degradedStyles: [
        {
          property: 'transform',
          value: 'rotate(12deg)',
          support: 'unsupported',
          note: 'Transforms require a raster fallback.',
        },
        { property: 'border-radius', value: '8px', support: 'fallback' },
      ],
    });

    render(<EmailNodeCompatibility ir={ir([node])} nodeId="node-1" />);

    expect(screen.getByText(/dropped/)).toHaveTextContent('transform');
    expect(screen.getByText(/Transforms require a raster fallback/)).toBeVisible();
    expect(screen.getByText(/replaced with a fallback/)).toHaveTextContent('border-radius');
  });

  it('says the object is absent rather than claiming it is safe', () => {
    render(<EmailNodeCompatibility ir={ir([irNode()])} nodeId="not-compiled" />);

    expect(screen.getByText(/does not appear in the compiled email/i)).toBeVisible();
    expect(screen.queryByTestId('email-compat-classification')).toBeNull();
  });

  it('describes the object itself, not the column shell wrapped around it', () => {
    // The layout pass synthesises a column carrying the same source id.
    const column = irNode({
      kind: 'column',
      sourceNodeId: 'node-1',
      compatibility: 'converted',
      children: [irNode({ kind: 'heading', headingLevel: 1, compatibility: 'native' })],
    });

    render(<EmailNodeCompatibility ir={ir([column])} nodeId="node-1" />);

    expect(screen.getByText('Heading level 1')).toBeVisible();
  });

  it('tells the designer a column will stack on a phone', () => {
    const column = irNode({
      kind: 'column',
      sourceNodeId: 'col-1',
      width: 300,
      mobileBehavior: 'stack',
      compatibility: 'converted',
    });

    render(<EmailNodeCompatibility ir={ir([column])} nodeId="col-1" />);

    expect(screen.getByText('Stacks to full width')).toBeVisible();
  });

  it('renders nothing without a compilation', () => {
    const { container } = render(<EmailNodeCompatibility ir={null} nodeId="node-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
