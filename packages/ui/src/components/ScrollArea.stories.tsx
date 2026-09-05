import type { Meta, StoryObj } from '@storybook/react';
import { useRef, useState } from 'react';
import { ScrollArea, ScrollProgress } from './ScrollArea';

const meta: Meta<typeof ScrollArea> = {
  title: 'Components/ScrollArea',
  component: ScrollArea,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    orientation: { control: 'select', options: ['vertical', 'horizontal', 'both'] },
  },
};

export default meta;
type Story = StoryObj<typeof ScrollArea>;

/* ── Basic orientations ──────────────────────────────────── */

export const Vertical: Story = {
  render: (args) => (
    <ScrollArea {...args} style={{ blockSize: 'var(--space-20)' }} viewportProps={{ tabIndex: 0 }}>
      <div style={{ padding: 'var(--space-3)' }}>
        {Array.from({ length: 24 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static gallery rows have no state
          <div key={index} style={{ paddingBlock: 'var(--space-1)' }}>
            Layer {index + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
  args: { orientation: 'vertical' },
};

export const Horizontal: Story = {
  render: (args) => (
    <ScrollArea {...args} style={{ inlineSize: 'var(--space-20)' }}>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          padding: 'var(--space-3)',
          inlineSize: 'max-content',
        }}
      >
        {Array.from({ length: 12 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static gallery items have no state
          <div key={index} style={{ inlineSize: 'var(--space-12)' }}>
            Page {index + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
  args: { orientation: 'horizontal' },
};

export const BothAxes: Story = {
  render: (args) => (
    <ScrollArea {...args} style={{ blockSize: '16rem', inlineSize: '16rem' }}>
      <div style={{ padding: 'var(--space-3)', minWidth: '30rem', minHeight: '30rem' }}>
        {Array.from({ length: 40 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static grid
          <div key={i} style={{ padding: 'var(--space-1)', borderBlockEnd: '1px solid var(--color-border-subtle)' }}>
            Row {i + 1} — wide content to force both axes
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
  args: { orientation: 'both' },
};

/* ── Edge cases ──────────────────────────────────────────── */

export const NoOverflow: Story = {
  render: (args) => (
    <ScrollArea {...args} style={{ blockSize: '16rem' }}>
      <div style={{ padding: 'var(--space-3)' }}>
        <p>All content fits — no scrollbar should appear.</p>
      </div>
    </ScrollArea>
  ),
  args: { orientation: 'vertical' },
};

export const ExactFit: Story = {
  render: (args) => (
    <ScrollArea {...args} style={{ blockSize: '6rem' }}>
      <div style={{ padding: 'var(--space-2)', blockSize: '6rem', display: 'flex', alignItems: 'center' }}>
        Content that exactly matches the viewport height.
      </div>
    </ScrollArea>
  ),
  args: { orientation: 'vertical' },
};

/* ── Sticky header and footer ────────────────────────────── */

export const StickyHeaderWithProgress: Story = {
  render: () => {
    const viewportRef = useRef<HTMLDivElement>(null);
    return (
      <div style={{ blockSize: 'var(--space-20)' }}>
        <ScrollProgress viewportRef={viewportRef} aria-label="Reading progress" />
        <ScrollArea viewportRef={viewportRef} viewportProps={{ tabIndex: 0 }}>
          <div>
            <div
              style={{
                position: 'sticky',
                insetBlockStart: 0,
                padding: 'var(--space-2)',
                background: 'var(--color-surface-raised)',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}
            >
              Column labels
            </div>
            {Array.from({ length: 30 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static gallery rows have no state
              <div key={index} style={{ padding: 'var(--space-2)' }}>
                Entry {index + 1}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  },
};

export const StickyFooterActions: Story = {
  render: () => (
    <div style={{ blockSize: '18rem' }}>
      <ScrollArea orientation="vertical" viewportProps={{ tabIndex: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
          <div style={{ padding: 'var(--space-3)', flex: 1 }}>
            {Array.from({ length: 20 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static gallery rows
              <div key={index} style={{ padding: 'var(--space-2)' }}>
                Setting {index + 1}
              </div>
            ))}
          </div>
          <div
            style={{
              position: 'sticky',
              insetBlockEnd: 0,
              padding: 'var(--space-3)',
              background: 'var(--color-surface-raised)',
              borderTop: '1px solid var(--color-border-subtle)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-2)',
            }}
          >
            <button type="button" style={{ padding: 'var(--space-1) var(--space-3)' }}>
              Cancel
            </button>
            <button type="button" style={{ padding: 'var(--space-1) var(--space-3)' }}>
              Save
            </button>
          </div>
        </div>
      </ScrollArea>
    </div>
  ),
};

/* ── Wide table ──────────────────────────────────────────── */

export const WideTable: Story = {
  render: (args) => (
    <ScrollArea {...args} style={{ blockSize: '14rem' }}>
      <table style={{ width: '40rem', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
        <thead>
          <tr style={{ position: 'sticky', top: 0, background: 'var(--color-surface-raised)' }}>
            {Array.from({ length: 10 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static headers
              <th key={i} style={{ padding: 'var(--space-1) var(--space-2)', border: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                Column {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 15 }, (_, row) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static rows
            <tr key={row}>
              {Array.from({ length: 10 }, (_, col) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static cells
                <td key={col} style={{ padding: 'var(--space-1) var(--space-2)', border: '1px solid var(--color-border-subtle)' }}>
                  R{row + 1}C{col + 1}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  ),
  args: { orientation: 'both' },
};

/* ── Horizontal media strip ──────────────────────────────── */

export const HorizontalMediaStrip: Story = {
  render: (args) => (
    <ScrollArea {...args} style={{ inlineSize: '24rem' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-2)', inlineSize: 'max-content' }}>
        {Array.from({ length: 8 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static gallery items
          <div
            key={i}
            style={{
              inlineSize: '8rem',
              blockSize: '6rem',
              background: 'var(--color-surface-sunken)',
              borderRadius: 'var(--radius-control)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem',
              color: 'var(--color-text-secondary)',
              flexShrink: 0,
            }}
          >
            Frame {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
  args: { orientation: 'horizontal' },
};

/* ── Dynamic content ─────────────────────────────────────── */

export const DynamicContent: Story = {
  render: () => {
    const [count, setCount] = useState(5);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', blockSize: '16rem' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" onClick={() => setCount((c) => c + 5)}>
            Add 5 items
          </button>
          <button type="button" onClick={() => setCount((c) => Math.max(0, c - 5))}>
            Remove 5
          </button>
        </div>
        <ScrollArea orientation="vertical" viewportProps={{ tabIndex: 0 }}>
          <div style={{ padding: 'var(--space-2)' }}>
            {Array.from({ length: count }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: dynamic list
              <div key={i} style={{ padding: 'var(--space-1)', borderBlockEnd: '1px solid var(--color-border-subtle)' }}>
                Item {i + 1}
              </div>
            ))}
            {count === 0 && (
              <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                No items — click Add to populate
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  },
};

/* ── Nested scroll areas ─────────────────────────────────── */

export const NestedScrolling: Story = {
  render: () => (
    <div style={{ blockSize: '16rem', inlineSize: '20rem', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
        Outer scrolls vertically, inner scrolls horizontally
      </div>
      <ScrollArea orientation="vertical" style={{ flex: 1 }}>
        {Array.from({ length: 10 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static rows
          <div key={i} style={{ padding: 'var(--space-2)', borderBlockEnd: '1px solid var(--color-border-subtle)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>
              Row {i + 1}
            </div>
            <ScrollArea orientation="horizontal" style={{ blockSize: '2rem' }}>
              <div style={{ display: 'flex', gap: 'var(--space-2)', inlineSize: 'max-content', padding: 'var(--space-1)' }}>
                {Array.from({ length: 8 }, (_, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static cells
                  <span key={j} style={{ fontSize: '0.625rem', whiteSpace: 'nowrap' }}>
                    Cell {i + 1}-{j + 1}
                  </span>
                ))}
              </div>
            </ScrollArea>
          </div>
        ))}
      </ScrollArea>
    </div>
  ),
};

/* ── RTL ─────────────────────────────────────────────────── */

export const RTL: Story = {
  render: (args) => (
    <div dir="rtl" style={{ blockSize: '14rem' }}>
      <ScrollArea {...args} viewportProps={{ tabIndex: 0, 'aria-label': 'قائمة الروايات' }}>
        <div style={{ padding: 'var(--space-3)' }}>
          {Array.from({ length: 20 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list
            <div key={index} style={{ paddingBlock: 'var(--space-1)' }}>
              عنصر {index + 1}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  ),
  args: { orientation: 'vertical' },
};

/* ── ScrollProgress standalone ───────────────────────────── */

export const ProgressOnly: Story = {
  render: () => {
    const viewportRef = useRef<HTMLDivElement>(null);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', blockSize: '14rem' }}>
        <ScrollProgress viewportRef={viewportRef} aria-label="Reading progress" />
        <ScrollArea viewportRef={viewportRef} orientation="vertical">
          <div style={{ padding: 'var(--space-3)' }}>
            {Array.from({ length: 40 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static content
              <p key={i} style={{ marginBlockEnd: 'var(--space-2)', fontSize: '0.75rem' }}>
                Paragraph {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.
              </p>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  },
};
