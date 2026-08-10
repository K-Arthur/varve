/**
 * Thumbnail — shared presentation primitive for every thumbnail surface
 * (Home cards, page rows, template cards, layer rows).
 *
 * Owns: image decoding/loading, object-fit, checkerboard for transparent
 * content, skeleton, empty/error/encrypted/unsupported states, lazy loading,
 * accessible naming. Business-specific labels and buttons stay in callers.
 *
 * The component never touches the DOM directly (no innerHTML + new Image());
 * it renders a plain <img> with onload/onerror state tracking.
 */

import {
  type CSSProperties,
  forwardRef,
  type ImgHTMLAttributes,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { Icon } from '../icons';
import './thumbnail.css';

export interface ThumbnailProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  /** Image source (data URL / object URL / path). */
  src?: string | null;
  /** Accessible name of the represented file/page/content. */
  alt: string;
  /** Loading state driven by the caller (e.g. generation in flight). */
  pending?: boolean;
  /** Fallback state driven by the caller (e.g. no thumbnail available). */
  unavailable?: boolean;
  /** Encrypted content: show the encrypted placeholder, never pixels. */
  encrypted?: boolean;
  /** Render a checkerboard behind transparent content. */
  checkerboard?: boolean;
  /** Object-fit for the image ('contain' default). */
  fit?: 'contain' | 'cover' | 'fill';
  /** Corner radius token (applied via CSS custom property). */
  radius?: 'none' | 'sm' | 'md';
}

export const Thumbnail = forwardRef<HTMLImageElement, ThumbnailProps>(function Thumbnail(
  {
    src,
    alt,
    pending = false,
    unavailable = false,
    encrypted = false,
    checkerboard = false,
    fit = 'contain',
    radius = 'md',
    role = 'img',
    className = '',
    style,
    onLoad,
    onError,
    ...rest
  },
  ref,
) {
  const [decodeState, setDecodeState] = useState<'idle' | 'decoding' | 'ready' | 'error'>('idle');
  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      setDecodeState('ready');
      onLoad?.(e as unknown as React.SyntheticEvent<HTMLImageElement>);
    },
    [onLoad],
  );

  const handleError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      setDecodeState('error');
      onError?.(e as unknown as React.SyntheticEvent<HTMLImageElement>);
    },
    [onError],
  );

  const status = useMemo(() => {
    if (encrypted) return 'encrypted';
    if (pending) return 'loading';
    if (!src) return unavailable ? 'unavailable' : 'empty';
    if (decodeState === 'error') return 'error';
    return 'image';
  }, [encrypted, pending, src, unavailable, decodeState]);

  const cls = [
    'varve-thumbnail',
    `varve-thumbnail--${status}`,
    fit !== 'contain' ? `varve-thumbnail--fit-${fit}` : '',
    checkerboard ? 'varve-thumbnail--checkerboard' : '',
    radius !== 'none' ? `varve-thumbnail--radius-${radius}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const wrapStyle: CSSProperties = useMemo(() => ({ ...style }), [style]);

  return (
    <div className={cls} style={wrapStyle}>
      {status === 'image' && (
        <img
          ref={ref}
          src={src ?? undefined}
          alt={alt}
          role={role}
          loading="lazy"
          decoding="async"
          className="varve-thumbnail__img"
          draggable={false}
          onLoad={handleLoad}
          onError={handleError}
          {...rest}
        />
      )}
      {status === 'loading' && (
        <div className="varve-thumbnail__skeleton" role="presentation" aria-hidden="true" />
      )}
      {status === 'encrypted' && (
        <div className="varve-thumbnail__state" role="img" aria-label="Encrypted">
          <Icon name="Lock" label={undefined} size="1.25em" />
        </div>
      )}
      {status === 'error' && (
        <div className="varve-thumbnail__state" role="img" aria-label="Preview unavailable">
          <Icon name="TriangleAlert" label={undefined} size="1.25em" />
        </div>
      )}
      {status === 'unavailable' && (
        <div className="varve-thumbnail__state" role="img" aria-label="No preview">
          <Icon name="FileImage" label={undefined} size="1.25em" />
        </div>
      )}
      {status === 'empty' && (
        <div className="varve-thumbnail__state" role="presentation" aria-hidden="true">
          <Icon name="FileImage" label={undefined} size="1.25em" />
        </div>
      )}
    </div>
  );
});
