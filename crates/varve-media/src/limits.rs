//! Allocation bounds for animated media decoding.
//!
//! All limits are enforced *before* any buffer is allocated, mirroring the
//! import gates in `@varve/import` (`MAX_RASTER_ENCODED_BYTES`,
//! `MAX_RASTER_DIMENSION`, `MAX_RASTER_PIXELS`) plus media-specific caps.

/// Default media decode limits.
///
/// - `max_dimension`: 65 535 px per axis (matches the import gate).
/// - `max_pixels_per_frame`: 64 MiPixels (matches the import gate).
/// - `max_frames`: 10 000 frames per animation.
/// - `max_decoded_bytes`: 512 MiB of in-flight decoded RGBA across the
///   requested frame range (soft ceiling; a single over-budget frame range
///   is refused before allocation).
pub const DEFAULT_LIMITS: DecodeLimits = DecodeLimits {
    max_dimension: 65_535,
    max_pixels_per_frame: 64 * 1024 * 1024,
    max_frames: 10_000,
    max_decoded_bytes: 512 * 1024 * 1024,
};

/// Bounds applied to every decode request.
#[derive(Debug, Clone, Copy)]
pub struct DecodeLimits {
    pub max_dimension: u32,
    pub max_pixels_per_frame: u64,
    pub max_frames: u32,
    pub max_decoded_bytes: u64,
}

impl DecodeLimits {
    /// Validate a canvas or frame rectangle before allocation.
    pub fn check_rect(&self, width: u32, height: u32) -> Result<(), String> {
        if width == 0 || height == 0 {
            return Err("frame has zero dimensions".to_string());
        }
        if width > self.max_dimension || height > self.max_dimension {
            return Err(format!(
                "frame {width}x{height} exceeds the {}-px dimension limit",
                self.max_dimension
            ));
        }
        let pixels = u64::from(width) * u64::from(height);
        if pixels > self.max_pixels_per_frame {
            return Err(format!(
                "frame {width}x{height} exceeds the {} pixel limit",
                self.max_pixels_per_frame
            ));
        }
        Ok(())
    }
}
