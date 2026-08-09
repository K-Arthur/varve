//! `varve-media` — animated image decoding for the Varve media system.
//!
//! Decodes **source frames** for GIF (89a), APNG, and animated WebP under
//! explicit allocation bounds. The decode contract is deliberately low-level:
//! a frame is a rectangle of RGBA pixels plus timing and composition hints
//! (disposal / blend). Full-canvas composition semantics live in the
//! TypeScript compositor (`@varve/engine` `media/compositor.ts`) so every
//! consumer — canvas, thumbnails, export, video — shares one implementation.
//!
//! Format policies:
//! - GIF (`gif` crate): raw frame rects, palette + transparency applied by
//!   the decoder, disposal/delay exposed, interlace de-interlaced. Blend is
//!   always `source` (GIF has no per-frame blend).
//! - APNG (`png` crate): `fcTL` control exposed (offsets, dispose, blend,
//!   delay num/den); frames are sub-rect raw pixels converted to RGBA.
//! - WebP (`image-webp`): the decoder composites internally and emits
//!   pre-composited full-canvas frames (`pre_composited = true`); the TS
//!   compositor pastes them verbatim.
//!
//! Safety: no `unsafe`, no `unwrap` on untrusted input, every allocation is
//! pre-checked against `DecodeLimits`, malformed input yields typed
//! `MediaError`s. `unsafe_code` is denied workspace-wide.

mod decode;
mod limits;
mod probe;

pub use decode::{decode_frames, decode_frames_base64, DecodedFrame};
pub use limits::{DecodeLimits, DEFAULT_LIMITS};
pub use probe::{probe, MediaProbe};
