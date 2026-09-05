import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Button } from './Button';
import { FileDropZone } from './FileDropZone';
import { FileError } from './FileError';
import { FileQueue, type FileQueueItem } from './FileQueue';

const meta: Meta<typeof FileDropZone> = {
  title: 'Components/File ingestion',
  component: FileDropZone,
  tags: ['autodocs', 'a11y'],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof FileDropZone>;

export const CompactAssetField: Story = {
  args: {
    size: 'compact',
    label: 'Drop assets to add',
    description: 'Images, SVG, and fonts stay local',
    actionLabel: 'Import',
    accept: 'image/*,.svg,.ttf,.otf,.woff,.woff2',
    multiple: true,
    maxFiles: 50,
    onFiles: () => undefined,
  },
};

export const LargeDocumentField: Story = {
  args: {
    label: 'Drop a Varve document to open',
    description: 'Open a document stored on this device',
    actionLabel: 'Choose document',
    accept: '.varve,.strata',
    onFiles: () => undefined,
  },
};

export const Disabled: Story = {
  args: {
    label: 'Cannot import while read-only',
    description: 'Choose another document to continue',
    disabled: true,
    onFiles: () => undefined,
  },
};

const exampleItems: FileQueueItem[] = [
  { id: 'first', file: { name: 'hero.png', size: 2048, type: 'image/png' }, status: 'complete' },
  {
    id: 'second',
    file: { name: 'poster.svg', size: 8192, type: 'image/svg+xml' },
    status: 'processing',
    progress: 64,
  },
  {
    id: 'third',
    file: { name: 'notes.txt', size: 42, type: 'text/plain' },
    status: 'failed',
    error: 'This file type is not supported here.',
  },
];

export const BatchFeedback: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-3)', maxInlineSize: '42rem' }}>
      <FileDropZone
        size="compact"
        label="Drop files to import"
        description="Partial batches are allowed"
        actionLabel="Choose files"
        multiple
        onFiles={() => undefined}
      />
      <FileQueue items={exampleItems} onRetry={() => undefined} onRemove={() => undefined} />
      <FileError
        title="Some files were not added"
        message="notes.txt: This file type is not supported here."
        compact
      />
    </div>
  ),
};

export const InteractiveStates: Story = {
  render: () => {
    const [items, setItems] = useState<FileQueueItem[]>([]);
    const [message, setMessage] = useState('');
    return (
      <div style={{ display: 'grid', gap: 'var(--space-3)', maxInlineSize: '42rem' }}>
        <FileDropZone
          size="compact"
          label="Drop images to import"
          description="Try the picker or drag a file over this field"
          accept="image/*"
          multiple
          maxFiles={3}
          onFiles={(files) => {
            setMessage(`${files.length} file${files.length === 1 ? '' : 's'} ready`);
            setItems(
              files.map((file, index) => ({
                id: `${file.name}-${index}`,
                file,
                status: 'complete',
                progress: 100,
              })),
            );
          }}
          onReject={(rejections) =>
            setMessage(`${rejections.length} file${rejections.length === 1 ? '' : 's'} rejected`)
          }
        />
        {message && <p role="status">{message}</p>}
        <FileQueue
          items={items}
          onRemove={(id) => setItems((current) => current.filter((item) => item.id !== id))}
        />
        <Button variant="ghost" onClick={() => setItems([])} disabled={items.length === 0}>
          Clear selection
        </Button>
      </div>
    );
  },
};
