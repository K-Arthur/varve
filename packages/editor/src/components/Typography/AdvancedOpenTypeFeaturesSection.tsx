import { useVirtualizer } from '@tanstack/react-virtual';
import { canResolveCanvasFontFamily, getFontRegistry } from '@varve/engine';
import type { TextNode } from '@varve/scene';
import { richTextToPlainText } from '@varve/scene';
import type {
  OpenTypeFeatureEntry,
  OpenTypeFeatureSetting,
  OpenTypeFeatureValue,
} from '@varve/shared';
import { REQUIRED_SHAPING_FEATURE_TAGS } from '@varve/shared';
import { Select } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useEditor } from '../../context';
import { DisclosureSection } from '../Inspector/controls/DisclosureSection';
import type { MaybeMixed } from '../Inspector/selection/selectionState';
import { isMixed } from '../Inspector/selection/selectionState';
import type { TypographyTextChanges } from './typographyCommand';
import { hasSelectedCharacters } from './typographyCommand';

interface AdvancedOpenTypeFeaturesSectionProps {
  textNodes: TextNode[];
  familyRaw: MaybeMixed<string>;
  applyChanges: (changes: TypographyTextChanges) => void;
  batchUpdate: (updater: (node: TextNode) => TextNode) => void;
}

const FEATURE_LABELS: Record<string, string> = {
  aalt: 'Access all alternates',
  calt: 'Contextual alternates',
  ccmp: 'Glyph composition',
  cv01: 'Character variant 1',
  dlig: 'Discretionary ligatures',
  frac: 'Fractions',
  hlig: 'Historical ligatures',
  liga: 'Standard ligatures',
  lnum: 'Lining figures',
  onum: 'Old-style figures',
  ordn: 'Ordinals',
  pnum: 'Proportional figures',
  salt: 'Stylistic alternates',
  smcp: 'Small capitals',
  ss01: 'Stylistic set 1',
  ss02: 'Stylistic set 2',
  ss03: 'Stylistic set 3',
  ss04: 'Stylistic set 4',
  ss05: 'Stylistic set 5',
  ss06: 'Stylistic set 6',
  ss07: 'Stylistic set 7',
  ss08: 'Stylistic set 8',
  ss09: 'Stylistic set 9',
  ss10: 'Stylistic set 10',
  swsh: 'Swash',
  tnum: 'Tabular figures',
  titl: 'Titling alternates',
  zero: 'Slashed zero',
};

const UNKNOWN_FEATURES = [
  'liga',
  'dlig',
  'hlig',
  'calt',
  'kern',
  'salt',
  'swsh',
  'ss01',
  'ss02',
  'smcp',
  'onum',
  'tnum',
  'frac',
];

const ALTERNATE_TAG_PATTERN =
  /^(?:aalt|salt|swsh|cswh|titl|ss(?:0[1-9]|1[0-9]|20)|cv(?:0[1-9]|[1-9][0-9]))$/u;

function labelForFeature(tag: string): string {
  return FEATURE_LABELS[tag] ?? tag.toUpperCase();
}

function isFeatureSetting(
  entry: OpenTypeFeatureEntry | undefined,
): entry is OpenTypeFeatureSetting {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    !Array.isArray(entry) &&
    'value' in entry &&
    (typeof entry.value === 'boolean' || typeof entry.value === 'number')
  );
}

function featureBaseValue(
  entry: OpenTypeFeatureEntry | undefined,
): OpenTypeFeatureValue | undefined {
  if (typeof entry === 'boolean' || typeof entry === 'number') return entry;
  return isFeatureSetting(entry) ? entry.value : undefined;
}

function withFeatureValue(
  current: OpenTypeFeatureEntry | undefined,
  value: OpenTypeFeatureValue,
): OpenTypeFeatureEntry {
  return isFeatureSetting(current) ? { ...current, value } : value;
}

function featureControlValue(value: OpenTypeFeatureValue | undefined): string {
  if (value === undefined) return 'inherit';
  if (value === false || value === 0) return 'off';
  if (value === true || value === 1) return 'on';
  return 'value';
}

function isAlternateTag(tag: string): boolean {
  return ALTERNATE_TAG_PATTERN.test(tag);
}

export function AdvancedOpenTypeFeaturesSection({
  textNodes,
  familyRaw,
  applyChanges,
  batchUpdate,
}: AdvancedOpenTypeFeaturesSectionProps) {
  const editor = useEditor();
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const registry = useMemo(() => getFontRegistry(), []);
  const registrySubscribe = useCallback(
    (listener: () => void) => registry.subscribe(listener),
    [registry],
  );
  useSyncExternalStore(
    registrySubscribe,
    () => registry.revision,
    () => registry.revision,
  );

  const family = isMixed(familyRaw) ? undefined : familyRaw || undefined;
  const metadata = family ? registry.getMetadata(family) : undefined;
  const metadataKnown = Boolean(metadata);
  const supported = useMemo(
    () => new Set(metadata?.openTypeFeatures ?? []),
    [metadata?.openTypeFeatures],
  );
  const currentFeatures = commonFeatureMap(textNodes);
  const knownTags = useMemo(() => {
    const persisted = Object.keys(currentFeatures).filter((tag) => tag !== 'custom');
    const available = metadataKnown ? [...supported] : UNKNOWN_FEATURES;
    return [...new Set([...available, ...persisted])].sort((a, b) => a.localeCompare(b));
  }, [currentFeatures, metadataKnown, supported]);
  // Features the shaper must always run (rlig, ccmp, locl, mark…) are not
  // user decisions. Listing them as disabled rows added a wall of inert
  // controls to every face; they are silently correct and stay hidden.
  const visibleTags = useMemo(
    () => knownTags.filter((tag) => !REQUIRED_SHAPING_FEATURE_TAGS.has(tag)),
    [knownTags],
  );
  const alternateTags = useMemo(() => visibleTags.filter(isAlternateTag), [visibleTags]);
  // Collapsed-header badge: how many of this face's features the layer (or
  // run) has already switched away from the font default.
  const activeFeatureCount = useMemo(
    () => visibleTags.filter((tag) => featureBaseValue(currentFeatures[tag]) !== undefined).length,
    [currentFeatures, visibleTags],
  );
  const rangeSelection =
    textNodes.length === 1 && hasSelectedCharacters(editor.state.selectionRange)
      ? editor.state.selectionRange
      : null;
  const liveWholeRunAvailable = family ? canResolveCanvasFontFamily(family, { liga: true }) : false;
  const previewActiveRef = useRef(false);

  const cancelPreview = useCallback(() => {
    if (!previewActiveRef.current) return;
    previewActiveRef.current = false;
    editor.abortTransaction();
  }, [editor]);

  const previewFeature = useCallback(
    (tag: string) => {
      const node = textNodes.length === 1 ? textNodes[0] : undefined;
      if (!node) return;
      cancelPreview();
      editor.beginTransaction('preview');
      previewActiveRef.current = true;
      editor.updateNode(node.id, (current) => {
        if (current.kind !== 'text') return current;
        return {
          ...current,
          openTypeFeatures: { ...(current.openTypeFeatures ?? {}), [tag]: true },
        };
      });
    },
    [cancelPreview, editor, textNodes],
  );

  useEffect(() => {
    return () => {
      if (previewActiveRef.current) {
        previewActiveRef.current = false;
        editorRef.current.abortTransaction();
      }
    };
  }, []);

  useEffect(() => {
    if (!previewActiveRef.current) return;
    if (editor.state.selection.length !== 1 || editor.state.selection[0] !== textNodes[0]?.id) {
      cancelPreview();
    }
  }, [cancelPreview, editor.state.selection, textNodes]);

  const updateFeature = useCallback(
    (tag: string, value: OpenTypeFeatureValue) => {
      const current = currentFeatures[tag];
      const entry = withFeatureValue(current, value);
      if (textNodes.length === 1) {
        applyChanges({ openTypeFeatures: { [tag]: entry } });
      } else {
        batchUpdate((node) => ({
          ...node,
          openTypeFeatures: { ...(node.openTypeFeatures ?? {}), [tag]: entry },
        }));
      }
    },
    [applyChanges, batchUpdate, currentFeatures, textNodes.length],
  );

  const applyFeature = useCallback(
    (tag: string) => {
      updateFeature(tag, 1);
      if (previewActiveRef.current) {
        previewActiveRef.current = false;
        editor.commitTransaction();
      }
    },
    [editor, updateFeature],
  );

  const clearFeature = useCallback(
    (tag: string) => {
      if (textNodes.length === 1 && editor.state.selectionRange) {
        // The range command retains the source range and uses an undefined
        // entry as inherit for that range; the whole-node path removes it.
        applyChanges({ openTypeFeatures: { [tag]: undefined } });
        return;
      }
      batchUpdate((node) => {
        const next = { ...(node.openTypeFeatures ?? {}) };
        delete next[tag];
        return { ...node, openTypeFeatures: next };
      });
    },
    [applyChanges, batchUpdate, editor.state.selectionRange, textNodes.length],
  );

  return (
    <DisclosureSection
      title="OpenType features"
      sectionId="typography"
      subsectionId="openTypeFeatures"
      action={
        activeFeatureCount > 0 ? (
          <span className="typography__count">{activeFeatureCount} on</span>
        ) : undefined
      }
    >
      {!family && (
        <p className="insp-opentype-status">Select one font face to inspect its features.</p>
      )}
      {family && !metadataKnown && (
        <p className="insp-opentype-status" data-state="unknown">
          Feature metadata is unavailable for this face. Requests remain editable, but the font may
          ignore unsupported tags.
        </p>
      )}
      {family && metadataKnown && visibleTags.length === 0 && (
        <p className="insp-opentype-status">No OpenType feature tags were reported by this face.</p>
      )}
      {family && metadataKnown && !liveWholeRunAvailable && (
        <p className="insp-opentype-status" data-state="unavailable">
          This face has no local CSS font source for live Canvas feature preview. Values remain
          stored for a compatible shaping or outline backend.
        </p>
      )}
      {rangeSelection && (
        <p className="insp-opentype-status" data-state="unavailable">
          Source-range feature values require the exact shaping backend; the browser preview keeps
          the current whole-run appearance until the range is committed through that path.
        </p>
      )}
      {family && visibleTags.length > 0 && (
        <div className="insp-opentype-list">
          {visibleTags.map((tag) => {
            const value = featureBaseValue(currentFeatures[tag]);
            const available = metadataKnown && supported.has(tag);
            return (
              <FeatureRow
                key={tag}
                tag={tag}
                value={value}
                available={available}
                metadataKnown={metadataKnown}
                runtimeAvailable={liveWholeRunAvailable && !rangeSelection}
                onChange={(next) => updateFeature(tag, next)}
                onReset={() => clearFeature(tag)}
              />
            );
          })}
        </div>
      )}
      {family && alternateTags.length > 0 && (
        <AlternateBrowser
          tags={alternateTags}
          text={previewText(textNodes)}
          metadataKnown={metadataKnown}
          onApply={applyFeature}
          onPreview={previewFeature}
          onCancelPreview={cancelPreview}
        />
      )}
    </DisclosureSection>
  );
}

function FeatureRow({
  tag,
  value,
  available,
  metadataKnown,
  runtimeAvailable,
  onChange,
  onReset,
}: {
  tag: string;
  value: OpenTypeFeatureValue | undefined;
  available: boolean;
  metadataKnown: boolean;
  runtimeAvailable: boolean;
  onChange: (value: OpenTypeFeatureValue) => void;
  onReset: () => void;
}) {
  const current = featureControlValue(value);
  const indexed = /^cv|^ss/u.test(tag) || (typeof value === 'number' && value > 1);
  // A face with no metadata is not known to support this tag, but a local
  // whole-run CSS source can still honor the request. Keep that distinction
  // visible instead of pretending metadata is authoritative; disable only
  // when neither the shaping source nor the runtime can accept the setting.
  const canEdit = (available || !metadataKnown) && runtimeAvailable;
  // Plain language first, tag second: the OpenType spec is the source of the
  // label, but the tag remains visible because it is what a font editor and
  // CSS use. Option descriptions say what Inherit/Off/On/Indexed actually do
  // (the "be honest about the menu option" OpenType-interface rule).
  return (
    <div
      className="insp-opentype-row"
      data-feature-availability={
        !metadataKnown
          ? 'unknown'
          : !available
            ? 'unsupported'
            : !runtimeAvailable
              ? 'unavailable'
              : 'available'
      }
    >
      <span className="insp-opentype-label">
        {labelForFeature(tag)}
        {metadataKnown && !available && (
          <small className="insp-opentype-state">unsupported by face</small>
        )}
        {available && value === undefined && <small className="insp-opentype-state">inherit</small>}
      </span>
      <code className="insp-opentype-tag">{tag}</code>
      <Select
        className="insp-opentype-select"
        label={`${labelForFeature(tag)} value`}
        value={current}
        disabled={!canEdit}
        options={[
          {
            value: 'inherit',
            label: 'Inherit',
            description: 'Use the font or paragraph default',
          },
          { value: 'off', label: 'Off', description: 'Disable this feature' },
          { value: 'on', label: 'On', description: 'Enable this feature' },
          ...(indexed
            ? [
                {
                  value: 'value',
                  label: 'Indexed…',
                  description: 'Pick a numbered alternate between 2 and 99',
                },
              ]
            : []),
        ]}
        onChange={(next) => {
          if (next === 'inherit') return onReset();
          if (next === 'off') return onChange(false);
          if (next === 'on') return onChange(true);
          return onChange(typeof value === 'number' && value > 1 ? value : indexed ? 2 : 1);
        }}
      />
      {indexed && current === 'value' && (
        <input
          className="insp-opentype-index"
          aria-label={`${labelForFeature(tag)} numeric value`}
          type="number"
          min={2}
          max={99}
          step={1}
          value={typeof value === 'number' && value > 1 ? value : 2}
          disabled={!canEdit}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(Math.max(2, Math.min(99, Math.trunc(next))));
          }}
        />
      )}
    </div>
  );
}

function AlternateBrowser({
  tags,
  text,
  metadataKnown,
  onApply,
  onPreview,
  onCancelPreview,
}: {
  tags: string[];
  text: string;
  metadataKnown: boolean;
  onApply: (tag: string) => void;
  onPreview: (tag: string) => void;
  onCancelPreview: () => void;
}) {
  const [query, setQuery] = useState('');
  const [previewSize, setPreviewSize] = useState(28);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const filtered = useMemo(
    () =>
      tags.filter((tag) => {
        const haystack = `${tag} ${labelForFeature(tag)}`.toLocaleLowerCase();
        return haystack.includes(query.trim().toLocaleLowerCase());
      }),
    [query, tags],
  );
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 68,
    overscan: 6,
  });

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1));
  }, [activeIndex, filtered.length]);

  const focusItem = (index: number) => {
    if (filtered.length === 0) return;
    const next = (index + filtered.length) % filtered.length;
    setActiveIndex(next);
    virtualizer.scrollToIndex(next);
    requestAnimationFrame(() => buttonRefs.current[next]?.focus());
  };

  return (
    <div className="insp-feature-browser">
      <div className="insp-feature-browser__heading">
        <span className="insp-opentype-label">Alternates &amp; glyphs</span>
        <small>{metadataKnown ? 'font-defined' : 'support unknown'}</small>
      </div>
      <input
        className="insp-feature-browser__search"
        type="search"
        value={query}
        placeholder="Search alternates"
        aria-label="Search alternates"
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusItem(activeIndex + 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusItem(activeIndex - 1);
          } else if (event.key === 'Escape') {
            onCancelPreview();
          }
        }}
      />
      <label className="insp-feature-browser__size">
        Preview size
        <input
          type="range"
          className="varve-native-range"
          min={16}
          max={64}
          step={1}
          value={previewSize}
          aria-label="Alternate preview size"
          onChange={(event) => setPreviewSize(Number(event.currentTarget.value))}
        />
        <output>{previewSize}px</output>
      </label>
      <div
        ref={listRef}
        className="insp-feature-browser__list"
        role="listbox"
        aria-label="Available alternates"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancelPreview();
        }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const tag = filtered[item.index]!;
            return (
              <button
                key={tag}
                ref={(element) => {
                  buttonRefs.current[item.index] = element;
                }}
                type="button"
                role="option"
                aria-selected={activeIndex === item.index}
                tabIndex={activeIndex === item.index ? 0 : -1}
                className="insp-feature-browser__item"
                style={{
                  position: 'absolute',
                  insetInline: 0,
                  top: 0,
                  transform: `translateY(${item.start}px)`,
                }}
                onPointerEnter={() => onPreview(tag)}
                onFocus={() => onPreview(tag)}
                onPointerLeave={onCancelPreview}
                onClick={() => onApply(tag)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    focusItem(item.index + 1);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    focusItem(item.index - 1);
                  } else if (event.key === 'Escape') {
                    onCancelPreview();
                  }
                }}
              >
                <span
                  className="insp-feature-browser__sample"
                  style={{ fontSize: `${previewSize}px`, fontFeatureSettings: `"${tag}" 1` }}
                >
                  {text || 'Aa'}
                </span>
                <span className="insp-feature-browser__meta">
                  <strong>{labelForFeature(tag)}</strong>
                  <code>{tag}</code>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function commonFeatureMap(textNodes: TextNode[]): Record<string, OpenTypeFeatureEntry | undefined> {
  if (textNodes.length !== 1) return {};
  return (textNodes[0]?.openTypeFeatures ?? {}) as Record<string, OpenTypeFeatureEntry | undefined>;
}

function previewText(textNodes: TextNode[]): string {
  const node = textNodes[0];
  if (!node) return 'Aa';
  return (node.richText ? richTextToPlainText(node.richText) : node.text).slice(0, 32) || 'Aa';
}
