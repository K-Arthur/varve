/**
 * Interface density and UI font size — application runtime.
 *
 * Single source of truth for turning the persisted appearance preferences
 * into root-level interface state, the same role
 * `context/reducedMotionManager.ts` plays for motion. Settings UI and the
 * boot pre-paint script both apply through this module so the DOM contract
 * (`data-density` attribute, root font-size) has exactly one writer.
 *
 * Density maps the setting onto the existing shared `data-density` CSS
 * contract in `@varve/ui` (`comfortable` 34px rows / `compact` 28px rows);
 * no token or consumer CSS is duplicated here.
 */

export type InterfaceDensityValue = 'default' | 'compact';
export type InterfaceFontSizeValue = 'small' | 'medium' | 'large';

/** Row-height contracts, mirroring the shared density CSS blocks. */
export const DENSITY_ROW_HEIGHT_PX = {
  default: 34,
  compact: 28,
} as const;

/** Root font-size override per UI font-size preference; '' clears it. */
const FONT_SIZE_ROOT_PX = {
  small: '15px',
  medium: '',
  large: '18px',
} as const;

const DENSITY_ATTR: Record<InterfaceDensityValue, string> = {
  default: 'comfortable',
  compact: 'compact',
};

export function isInterfaceDensity(value: unknown): value is InterfaceDensityValue {
  return value === 'default' || value === 'compact';
}

export function normalizeInterfaceDensity(value: unknown): InterfaceDensityValue {
  return isInterfaceDensity(value) ? value : 'default';
}

export function isInterfaceFontSize(value: unknown): value is InterfaceFontSizeValue {
  return value === 'small' || value === 'medium' || value === 'large';
}

export function normalizeInterfaceFontSize(value: unknown): InterfaceFontSizeValue {
  return isInterfaceFontSize(value) ? value : 'medium';
}

type Root = Pick<HTMLElement, 'dataset' | 'style'>;

function browserRoot(): Root | undefined {
  return typeof document === 'undefined' ? undefined : document.documentElement;
}

/**
 * Apply the density mode to the root element.
 *
 * The attribute is always set explicitly (never removed): an absent attribute
 * would silently mean "comfortable" through the `:root` fallback, and an
 * explicit value makes the active mode observable to tests and diagnostics.
 */
export function applyInterfaceDensity(
  value: unknown,
  root: Root | undefined = browserRoot(),
): InterfaceDensityValue {
  const density = normalizeInterfaceDensity(value);
  const previous = root ? root.dataset.density : undefined;
  const next = DENSITY_ATTR[density];
  if (root && previous !== next) root.dataset.density = next;
  if (previous !== next) notifyListeners();
  return density;
}

/** Apply (or clear, for `medium`) the root font-size override. */
export function applyInterfaceFontSize(
  value: unknown,
  root: Root | undefined = browserRoot(),
): InterfaceFontSizeValue {
  const size = normalizeInterfaceFontSize(value);
  const previous = root ? root.style.fontSize : undefined;
  const next = FONT_SIZE_ROOT_PX[size];
  if (root && previous !== next) root.style.fontSize = next;
  if (previous !== next) notifyListeners();
  return size;
}

/**
 * Apply both appearance dimensions in one call. Used by the settings
 * application effect and by the boot pre-paint handshake.
 */
export function applyInterfaceAppearance(density: unknown, fontSize: unknown): void {
  applyInterfaceDensity(density);
  applyInterfaceFontSize(fontSize);
}

let listeners: Set<() => void> = new Set();

function notifyListeners(): void {
  for (const fn of listeners) fn();
}

/**
 * Subscribe to density changes. The Layers tree virtualizer uses this to
 * re-measure after a mode switch so cached row heights never go stale.
 */
export function subscribeInterfaceDensity(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Read the currently applied density from the DOM (observable contract). */
export function getAppliedInterfaceDensity(root: Root | undefined = browserRoot()): string | null {
  const value = root?.dataset.density;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Row height the currently applied DOM density resolves to. Used by
 * virtualizer consumers as the estimate baseline; measured element sizes stay
 * authoritative.
 */
export function appliedRowHeight(root: Root | undefined = browserRoot()): number {
  return root?.dataset.density === 'compact'
    ? DENSITY_ROW_HEIGHT_PX.compact
    : DENSITY_ROW_HEIGHT_PX.default;
}

/** @internal — reset subscribers for testing. */
export function __resetInterfaceDensity(): void {
  listeners = new Set();
}
