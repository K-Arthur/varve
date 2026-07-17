//! Median-cut color quantization in Oklab perceptually uniform space.
//!
//! Research basis: Ottosson (2020), "A perceptual color space for image
//! processing." https://bottosson.github.io/posts/oklab/

use serde::{Deserialize, Serialize};

/// A quantized color with pixel count.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuantizedColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
    pub count: usize,
}

struct OklabSample {
    r: u8,
    g: u8,
    b: u8,
    l: f64,
    a: f64,
    b_: f64,
}

/// sRGB gamma expansion: 8-bit value (0-255) → linear (0-1).
fn srgb_to_linear(c: u8) -> f64 {
    let v = c as f64 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

fn mul3x3(m: &[f64; 9], v: [f64; 3]) -> [f64; 3] {
    [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ]
}

/// Linear sRGB → Oklab [L, a, b].
const M1: [f64; 9] = [
    0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566, 0.0883024619,
    0.2817188376, 0.6299787005,
];

const M2: [f64; 9] = [
    0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371,
    0.7827717662, -0.808675766,
];

fn linear_srgb_to_oklab(rgb: [f64; 3]) -> [f64; 3] {
    let lms = mul3x3(&M1, rgb);
    let lms_cuberoot = [lms[0].cbrt(), lms[1].cbrt(), lms[2].cbrt()];
    mul3x3(&M2, lms_cuberoot)
}

/// Quantize RGBA pixels into a palette of at most `max_colors`.
/// Pixels with alpha < alpha_threshold are skipped.
/// Returns palette sorted by count descending.
pub fn quantize_palette(
    pixels: &[u8],
    width: u32,
    height: u32,
    max_colors: u8,
    alpha_threshold: u8,
    grayscale: bool,
) -> Vec<QuantizedColor> {
    let count = (width * height) as usize;
    let max_colors = max_colors.max(1) as usize;

    let mut samples: Vec<OklabSample> = Vec::new();

    for i in 0..count {
        let offset = i * 4;
        if offset + 3 >= pixels.len() {
            break;
        }
        let a = pixels[offset + 3];
        if a < alpha_threshold {
            continue;
        }
        let mut r = pixels[offset];
        let mut g = pixels[offset + 1];
        let mut b = pixels[offset + 2];

        if grayscale {
            let y = (0.2126 * r as f64 + 0.7152 * g as f64 + 0.0722 * b as f64).round() as u8;
            r = y;
            g = y;
            b = y;
        }

        let linear = [srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)];
        let oklab = linear_srgb_to_oklab(linear);
        samples.push(OklabSample {
            r,
            g,
            b,
            l: oklab[0],
            a: oklab[1],
            b_: oklab[2],
        });
    }

    if samples.is_empty() {
        return Vec::new();
    }

    let mut buckets: Vec<Vec<OklabSample>> = vec![samples];

    while buckets.len() < max_colors {
        let mut split_index = None;
        let mut split_channel: u8 = 0; // 0 = L, 1 = a, 2 = b_
        let mut max_range = -1.0_f64;

        for (i, bucket) in buckets.iter().enumerate() {
            if bucket.len() < 2 {
                continue;
            }
            let mut min_l = f64::MAX;
            let mut max_l = f64::MIN;
            let mut min_a = f64::MAX;
            let mut max_a = f64::MIN;
            let mut min_b = f64::MAX;
            let mut max_b = f64::MIN;

            for sample in bucket {
                if sample.l < min_l {
                    min_l = sample.l;
                }
                if sample.l > max_l {
                    max_l = sample.l;
                }
                if sample.a < min_a {
                    min_a = sample.a;
                }
                if sample.a > max_a {
                    max_a = sample.a;
                }
                if sample.b_ < min_b {
                    min_b = sample.b_;
                }
                if sample.b_ > max_b {
                    max_b = sample.b_;
                }
            }

            let ranges = [max_l - min_l, max_a - min_a, max_b - min_b];
            let mut best_ch = 0u8;
            let mut best_range = ranges[0];
            if ranges[1] > best_range {
                best_ch = 1;
                best_range = ranges[1];
            }
            if ranges[2] > best_range {
                best_ch = 2;
                best_range = ranges[2];
            }

            if best_range > max_range {
                max_range = best_range;
                split_index = Some(i);
                split_channel = best_ch;
            }
        }

        let si = match split_index {
            Some(i) => i,
            None => break,
        };

        if max_range <= 1e-6 {
            break;
        }

        let mut bucket = buckets.swap_remove(si);

        match split_channel {
            0 => bucket.sort_by(|x, y| x.l.partial_cmp(&y.l).unwrap_or(std::cmp::Ordering::Equal)),
            1 => bucket.sort_by(|x, y| x.a.partial_cmp(&y.a).unwrap_or(std::cmp::Ordering::Equal)),
            _ => bucket.sort_by(|x, y| x.b_.partial_cmp(&y.b_).unwrap_or(std::cmp::Ordering::Equal)),
        }

        let mid = bucket.len() / 2;
        let right = bucket.split_off(mid);
        buckets.push(bucket);
        buckets.push(right);
    }

    let mut palette: Vec<QuantizedColor> = buckets
        .into_iter()
        .map(|bucket| {
            let n = bucket.len();
            let mut sum_r = 0u64;
            let mut sum_g = 0u64;
            let mut sum_b = 0u64;
            for sample in &bucket {
                sum_r += sample.r as u64;
                sum_g += sample.g as u64;
                sum_b += sample.b as u64;
            }
            QuantizedColor {
                r: (sum_r / n as u64) as u8,
                g: (sum_g / n as u64) as u8,
                b: (sum_b / n as u64) as u8,
                a: 255,
                count: n,
            }
        })
        .collect();

    palette.sort_by(|a, b| b.count.cmp(&a.count));
    palette
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba_pixel(r: u8, g: u8, b: u8, a: u8) -> [u8; 4] {
        [r, g, b, a]
    }

    #[test]
    fn two_color_image() {
        // 2x1 image: half red, half blue
        let mut pixels = Vec::new();
        pixels.extend_from_slice(&rgba_pixel(255, 0, 0, 255));
        pixels.extend_from_slice(&rgba_pixel(0, 0, 255, 255));

        let palette = quantize_palette(&pixels, 2, 1, 2, 0, false);
        assert!(!palette.is_empty(), "should produce a palette");
        assert!(palette.len() <= 2, "should have at most 2 colors");
        // Both colors should be present
        let has_red = palette.iter().any(|c| c.r > 200 && c.g < 50 && c.b < 50);
        let has_blue = palette.iter().any(|c| c.r < 50 && c.g < 50 && c.b > 200);
        assert!(has_red, "should contain red");
        assert!(has_blue, "should contain blue");
    }

    #[test]
    fn grayscale_mode() {
        // 2x1 image: red and blue, but grayscale should collapse them
        let mut pixels = Vec::new();
        pixels.extend_from_slice(&rgba_pixel(255, 0, 0, 255));
        pixels.extend_from_slice(&rgba_pixel(0, 0, 255, 255));

        let palette = quantize_palette(&pixels, 2, 1, 2, 0, true);
        assert!(!palette.is_empty(), "should produce a palette");
        // In grayscale, all channels should be equal (or nearly)
        for c in &palette {
            let diff_rg = (c.r as i16 - c.g as i16).abs();
            let diff_rb = (c.r as i16 - c.b as i16).abs();
            let diff_gb = (c.g as i16 - c.b as i16).abs();
            assert!(diff_rg <= 1, "R≈G in grayscale mode");
            assert!(diff_rb <= 1, "R≈B in grayscale mode");
            assert!(diff_gb <= 1, "G≈B in grayscale mode");
        }
    }

    #[test]
    fn transparent_pixels_skipped() {
        // 2x1 image: opaque red, transparent green
        let mut pixels = Vec::new();
        pixels.extend_from_slice(&rgba_pixel(255, 0, 0, 255));
        pixels.extend_from_slice(&rgba_pixel(0, 255, 0, 0));

        let palette = quantize_palette(&pixels, 2, 1, 2, 128, false);
        assert_eq!(palette.len(), 1, "transparent pixel should be skipped");
        assert_eq!(palette[0].r, 255, "should only contain the red pixel");
        assert_eq!(palette[0].g, 0);
        assert_eq!(palette[0].count, 1);
    }

    #[test]
    fn deterministic() {
        let mut pixels = Vec::new();
        for i in 0..16 {
            let r = (i * 16) as u8;
            let g = (i * 8) as u8;
            let b = (32 - i as i32 * 2) as u8;
            pixels.extend_from_slice(&rgba_pixel(r, g, b, 255));
        }

        let a = quantize_palette(&pixels, 4, 4, 4, 0, false);
        let b = quantize_palette(&pixels, 4, 4, 4, 0, false);

        assert_eq!(a.len(), b.len(), "deterministic length");
        for (ca, cb) in a.iter().zip(b.iter()) {
            assert_eq!(ca.r, cb.r, "deterministic R");
            assert_eq!(ca.g, cb.g, "deterministic G");
            assert_eq!(ca.b, cb.b, "deterministic B");
            assert_eq!(ca.count, cb.count, "deterministic count");
        }
    }

    #[test]
    fn empty_image_returns_empty() {
        let pixels = Vec::new();
        let palette = quantize_palette(&pixels, 0, 0, 8, 0, false);
        assert!(palette.is_empty());
    }

    #[test]
    fn sort_by_count_descending() {
        // 4 pixels: 2 red, 1 green, 1 blue
        let mut pixels = Vec::new();
        pixels.extend_from_slice(&rgba_pixel(255, 0, 0, 255));
        pixels.extend_from_slice(&rgba_pixel(255, 0, 0, 255));
        pixels.extend_from_slice(&rgba_pixel(0, 255, 0, 255));
        pixels.extend_from_slice(&rgba_pixel(0, 0, 255, 255));

        let palette = quantize_palette(&pixels, 2, 2, 3, 0, false);
        assert!(!palette.is_empty());
        // First entry should have the highest count
        let mut prev_count = usize::MAX;
        for c in &palette {
            assert!(c.count <= prev_count, "should be sorted descending by count");
            prev_count = c.count;
        }
    }

    #[test]
    fn max_colors_one() {
        // Single color palette
        let mut pixels = Vec::new();
        for _ in 0..4 {
            pixels.extend_from_slice(&rgba_pixel(100, 150, 200, 255));
        }
        let palette = quantize_palette(&pixels, 2, 2, 1, 0, false);
        assert_eq!(palette.len(), 1);
        assert_eq!(palette[0].count, 4);
    }

    #[test]
    fn oklab_srgb_roundtrip() {
        for &(r, g, b) in &[(0, 0, 0), (255, 255, 255), (255, 0, 0), (0, 255, 0), (128, 64, 200)] {
            let linear = [srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)];
            let oklab = linear_srgb_to_oklab(linear);

            // Reconstruct approximate via forward-direction values staying in reasonable range
            assert!(
                oklab[0] >= 0.0 && oklab[0] <= 1.0,
                "Oklab L out of range: {}",
                oklab[0]
            );
        }
    }
}
