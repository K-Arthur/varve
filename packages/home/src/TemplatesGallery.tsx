import type { TemplateDef } from '@strata/platform';
import { Icon } from '@strata/ui';
import { EmptyStates } from './EmptyStates';

export interface TemplatesGalleryProps {
  onSelect: (template: TemplateDef) => void;
  templates?: TemplateDef[];
}

const BUILTIN_TEMPLATES: TemplateDef[] = [
  {
    id: 'blank',
    name: 'Blank Canvas',
    category: 'General',
    description: 'Start with an empty frame.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'instagram-post',
    name: 'Instagram Post',
    category: 'Social',
    description: 'Square 1:1 format for social media.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'instagram-story',
    name: 'Instagram Story',
    category: 'Social',
    description: 'Vertical 9:16 format for stories.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'facebook-cover',
    name: 'Facebook Cover',
    category: 'Social',
    description: 'Banner format for social profiles.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'presentation-16-9',
    name: 'Presentation (16:9)',
    category: 'Presentation',
    description: 'Standard widescreen presentation format.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'a4',
    name: 'A4 Document',
    category: 'Print',
    description: 'Standard A4 print format with CMYK and bleed settings.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'us-letter',
    name: 'US Letter',
    category: 'Print',
    description: 'Standard US Letter print format.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'iphone-frame',
    name: 'iPhone 15 Pro',
    category: 'Device',
    description: 'Mobile device frame for app designs.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'ipad-frame',
    name: 'iPad Pro',
    category: 'Device',
    description: 'Tablet device frame for app designs.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'web-1440',
    name: 'Web (1440px)',
    category: 'Web',
    description: 'Standard desktop web format.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
];

const PREVIEW_COLORS: Record<string, string> = {
  General: 'var(--color-interactive-default)',
  Social: 'var(--color-feedback-warning)',
  Presentation: 'var(--color-feedback-success)',
  Print: 'var(--color-feedback-danger)',
  Device: 'var(--color-interactive-hover)',
  Web: 'var(--color-feedback-warning)',
};

export function TemplatesGallery({ onSelect, templates }: TemplatesGalleryProps) {
  const allTemplates = templates ?? BUILTIN_TEMPLATES;

  if (allTemplates.length === 0) {
    return <EmptyStates section="templates" onAction={() => {}} />;
  }

  const grouped: Record<string, TemplateDef[]> = {};
  for (const t of allTemplates) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category]?.push(t);
  }

  return (
    <div className="templates-gallery">
      {Object.entries(grouped).map(([category, cats]) => (
        <div key={category}>
          <h3 className="templates-gallery__cat">{category}</h3>
          {cats.map((template) => (
            <button
              key={template.id}
              type="button"
              className="template-card"
              onClick={() => onSelect(template)}
            >
              <div
                className="template-card__preview"
                style={{
                  background: `linear-gradient(135deg, ${PREVIEW_COLORS[category] ?? 'var(--color-border-subtle)'}, transparent)`,
                }}
              >
                <Icon
                  name="FileText"
                  label={undefined}
                  size="2rem"
                  style={{ opacity: 0.6, color: 'white' }}
                />
              </div>
              <span className="template-card__name">{template.name}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
