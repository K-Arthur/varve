import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { Button } from './Button';
import { ShineBorder } from './ShineBorder';

const meta: Meta<typeof ShineBorder> = {
  title: 'Components/ShineBorder',
  component: ShineBorder,
  tags: ['autodocs', 'a11y'],
  parameters: {
    docs: {
      description: {
        component:
          'Beta reference fixture. Shine Border is reserved for rare state-driven emphasis; gallery coverage is not approval for broad production use.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ShineBorder>;

const cardStyle = {
  display: 'grid',
  gap: 'var(--space-2)',
  minWidth: '15rem',
  padding: 'var(--space-4)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--color-surface-raised)',
  color: 'var(--color-text-primary)',
} as const;

function ReferenceCard({ label, className }: { label: string; className?: string }) {
  return (
    <article className={className} style={cardStyle}>
      <strong>{label}</strong>
      <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
        Development reference, not a general card treatment.
      </span>
    </article>
  );
}

function ReplayFixture() {
  const [active, setActive] = useState(true);
  const replay = () => {
    setActive(false);
    requestAnimationFrame(() => setActive(true));
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
      <ShineBorder variant="beam" tone="success" active={active}>
        <ReferenceCard label="Export complete" />
      </ShineBorder>
      <Button variant="secondary" onClick={replay}>
        Replay one-shot
      </Button>
    </div>
  );
}

export const ReferenceGallery: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
      <section aria-label="Card variants" style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        <ShineBorder variant="static">
          <ReferenceCard label="Static fallback" />
        </ShineBorder>
        <ShineBorder variant="subtle">
          <ReferenceCard label="Subtle — hover on a fine pointer" />
        </ShineBorder>
        <ShineBorder variant="beam" tone="success">
          <ReferenceCard label="Beam — one state-triggered cycle" />
        </ShineBorder>
      </section>
      <section aria-label="Button variants" style={{ display: 'flex', gap: 16 }}>
        <ShineBorder variant="subtle">
          <Button variant="primary">Hover reference</Button>
        </ShineBorder>
        <ShineBorder variant="beam">
          <Button variant="secondary">One-shot reference</Button>
        </ShineBorder>
        <ShineBorder variant="beam" disabled>
          <Button variant="secondary">Decoration disabled</Button>
        </ShineBorder>
      </section>
      <ReplayFixture />
    </div>
  ),
};

export const ThemeAndRadiusReference: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 20 }}>
      {[
        { label: 'Light', theme: 'light', background: '#f7f8fa' },
        { label: 'Dark', theme: 'dark', background: '#10151f' },
        { label: 'High contrast', theme: 'high-contrast', background: '#000' },
      ].map(({ label, theme, background }) => (
        <div
          key={theme}
          data-theme={theme}
          style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 24, background }}
        >
          <ShineBorder variant="static">
            <div style={{ ...cardStyle, borderRadius: 'var(--radius-sm)' }}>{label} / small</div>
          </ShineBorder>
          <ShineBorder variant="beam">
            <div style={{ ...cardStyle, borderRadius: 'var(--radius-lg)' }}>{label} / large</div>
          </ShineBorder>
          <ShineBorder variant="subtle">
            <button
              type="button"
              style={{ ...cardStyle, minWidth: 120, borderRadius: 'var(--radius-pill)' }}
            >
              {label} / pill
            </button>
          </ShineBorder>
        </div>
      ))}
    </div>
  ),
};

export const IdleStressReference: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24 }}>
      {[5, 10, 20].map((count) => (
        <section key={count} aria-label={`${count} instance stress reference`}>
          <h3 style={{ color: 'var(--color-text-primary)' }}>{count} idle instances</h3>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}
          >
            {Array.from({ length: count }, (_, index) => `instance-${index + 1}`).map((id) => (
              <ShineBorder key={id} variant="subtle">
                <div
                  style={{
                    padding: 12,
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-surface-raised)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {id.replace('instance-', '')}
                </div>
              </ShineBorder>
            ))}
          </div>
        </section>
      ))}
    </div>
  ),
};
