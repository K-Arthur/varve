// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DestinationPicker } from './DestinationPicker';

afterEach(cleanup);

function makeJob() {
  return {
    presetId: 'p1',
    nodeId: 'n1',
    nodeName: 'Rect',
    format: 'png' as const,
    fileName: 'rect.png',
    dimensions: { w: 100, h: 80 },
    estimatedSize: 51200,
    status: 'pending' as const,
  };
}

describe('DestinationPicker', () => {
  it('filename template preview', () => {
    render(
      <DestinationPicker
        template="{name}{suffix}.{ext}"
        folderRule="flat"
        jobs={[makeJob()]}
        onTemplateChange={() => {}}
        onFolderRuleChange={() => {}}
        onSelectDestination={() => {}}
        destinationLabel=""
      />,
    );
    expect(screen.getByText(/Rect/)).toBeTruthy();
  });

  it('shows select folder button', () => {
    render(
      <DestinationPicker
        template="{name}.{ext}"
        folderRule="flat"
        jobs={[]}
        onTemplateChange={() => {}}
        onFolderRuleChange={() => {}}
        onSelectDestination={() => {}}
        destinationLabel=""
      />,
    );
    expect(screen.getByText('Select folder\u2026')).toBeTruthy();
  });

  it('shows destination label when set', () => {
    render(
      <DestinationPicker
        template="{name}.{ext}"
        folderRule="flat"
        jobs={[]}
        onTemplateChange={() => {}}
        onFolderRuleChange={() => {}}
        onSelectDestination={() => {}}
        destinationLabel="/exports"
      />,
    );
    expect(screen.getByText('/exports')).toBeTruthy();
  });

  it('renders folder rule buttons', () => {
    render(
      <DestinationPicker
        template="{name}.{ext}"
        folderRule="flat"
        jobs={[]}
        onTemplateChange={() => {}}
        onFolderRuleChange={() => {}}
        onSelectDestination={() => {}}
        destinationLabel=""
      />,
    );
    expect(screen.getByText('Flat')).toBeTruthy();
    expect(screen.getByText('By node')).toBeTruthy();
  });

  it('explains archive delivery when direct folder selection is unavailable', () => {
    render(
      <DestinationPicker
        template="{name}.{ext}"
        folderRule="flat"
        jobs={[]}
        onTemplateChange={() => {}}
        onFolderRuleChange={() => {}}
        onSelectDestination={() => {}}
        destinationLabel=""
        folderSelectionAvailable={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Browser download' })).toBeDisabled();
    expect(screen.getByText('Multi-file exports download as one ZIP archive.')).toBeTruthy();
  });
});
