//! Non-AI background removal methods.
//!
//! These methods work on any image without requiring model downloads:
//! - `auto` — analyzes the image and picks the best method
//! - `flood_fill` — user-click-point based region growing
//! - `chroma_key` — remove a known background color
//! - `k_means` — 2-cluster RGB segmentation
//! - `edge_detect` — Sobel + largest contour extraction

use image::DynamicImage;

use crate::{mask_to_base64, RemovalOptions, RemovalResult};

fn rgb_dist(r1: u8, g1: u8, b1: u8, r2: u8, g2: u8, b2: u8) -> f64 {
    let dr = r1 as f64 - r2 as f64;
    let dg = g1 as f64 - g2 as f64;
    let db = b1 as f64 - b2 as f64;
    (dr * dr + dg * dg + db * db).sqrt()
}

fn gray_at(buf: &[u8], w: u32, x: u32, y: u32) -> u8 {
    let i = ((y * w + x) * 4) as usize;
    ((buf[i] as u16 * 77 + buf[i + 1] as u16 * 150 + buf[i + 2] as u16 * 29) >> 8) as u8
}

/// Apply Gaussian blur to a binary mask for edge feathering.
fn feather_mask(mask: &[u8], width: u32, height: u32, radius: f32) -> Vec<u8> {
    if radius <= 0.0 {
        return mask.to_vec();
    }

    let r = (radius.max(1.0).round() as i32).max(1);
    let sigma = r as f64 / 2.0;
    let kernel_size = (r * 2 + 1) as usize;
    let mut kernel = vec![0.0_f64; kernel_size];
    let mut kernel_sum = 0.0;
    for i in -r..=r {
        let v = (-(i * i) as f64 / (2.0 * sigma * sigma)).exp();
        kernel[(i + r) as usize] = v;
        kernel_sum += v;
    }
    for k in &mut kernel {
        *k /= kernel_sum;
    }

    let len = (width * height) as usize;
    let mut temp = vec![0u8; len];

    for y in 0..height {
        for x in 0..width {
            let mut sum = 0.0_f64;
            for (k, &kw) in kernel.iter().enumerate() {
                let sx = (x as i32 + k as i32 - r).clamp(0, width as i32 - 1) as u32;
                sum += mask[(y * width + sx) as usize] as f64 * kw;
            }
            temp[(y * width + x) as usize] = sum.round() as u8;
        }
    }

    let mut result = vec![0u8; len];
    for x in 0..width {
        for y in 0..height {
            let mut sum = 0.0_f64;
            for (k, &kw) in kernel.iter().enumerate() {
                let sy = (y as i32 + k as i32 - r).clamp(0, height as i32 - 1) as u32;
                sum += temp[(sy * width + x) as usize] as f64 * kw;
            }
            result[(y * width + x) as usize] = sum.round() as u8;
        }
    }

    result
}

/// Public wrapper for feathering a mask. Used by the inference module.
pub fn apply_feather(mask: &[u8], width: u32, height: u32, radius: f32) -> Vec<u8> {
    feather_mask(mask, width, height, radius)
}

/// Compute a confidence score from the mask histogram.
fn compute_confidence(mask: &[u8]) -> f32 {
    if mask.is_empty() {
        return 0.0;
    }
    let sum: u32 = mask.iter().map(|&v| v as u32).sum();
    let avg = sum as f64 / mask.len() as f64 / 255.0;
    let edge_balance = (avg.min(1.0 - avg) * 2.0).min(1.0);
    if edge_balance < 0.1 {
        0.1
    } else {
        (edge_balance * 1.5).min(1.0) as f32
    }
}

/// Flood fill from a click point.
/// Returns a mask where 0 = background (connected to seed), 255 = foreground.
fn flood_fill_mask(
    rgba: &[u8],
    width: u32,
    height: u32,
    sx: u32,
    sy: u32,
    tolerance: u8,
) -> Vec<u8> {
    let mut mask = vec![255u8; (width * height) as usize];

    if sx >= width || sy >= height {
        return mask;
    }

    let seed_idx = ((sy * width + sx) * 4) as usize;
    let seed_r = rgba[seed_idx];
    let seed_g = rgba[seed_idx + 1];
    let seed_b = rgba[seed_idx + 2];
    let seed_a = rgba[seed_idx + 3];
    let seed_transparent = seed_a < 128;

    let mut stack: Vec<(u32, u32)> = Vec::with_capacity((width * height) as usize / 4);
    stack.push((sx, sy));

    while let Some((x, y)) = stack.pop() {
        let idx = (y * width + x) as usize;
        if mask[idx] != 255 {
            continue;
        }

        let i = idx * 4;
        let a = rgba[i + 3];
        let is_bg = if seed_transparent {
            a < 128
        } else {
            a >= 128
                && rgb_dist(rgba[i], rgba[i + 1], rgba[i + 2], seed_r, seed_g, seed_b)
                    <= tolerance as f64
        };

        if !is_bg {
            continue;
        }

        mask[idx] = 0;

        if x > 0 {
            stack.push((x - 1, y));
        }
        if x + 1 < width {
            stack.push((x + 1, y));
        }
        if y > 0 {
            stack.push((x, y - 1));
        }
        if y + 1 < height {
            stack.push((x, y + 1));
        }
    }

    mask
}

/// Chroma key mask: removes a known background color.
fn chroma_key_mask(
    rgba: &[u8],
    width: u32,
    height: u32,
    key_r: u8,
    key_g: u8,
    key_b: u8,
    tolerance: u8,
) -> Vec<u8> {
    let mut mask = vec![255u8; (width * height) as usize];
    for y in 0..height {
        for x in 0..width {
            let i = ((y * width + x) * 4) as usize;
            if rgb_dist(rgba[i], rgba[i + 1], rgba[i + 2], key_r, key_g, key_b) <= tolerance as f64
            {
                mask[(y * width + x) as usize] = 0;
            }
        }
    }
    mask
}

/// K-means clustering (k=2) for bimodal foreground/background separation.
fn k_means_mask(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let n = (width * height) as usize;
    let mut mask = vec![0u8; n];

    // Use the two corner colors as initial centroids
    let c0 = [rgba[0], rgba[1], rgba[2]];
    let last_i = ((height - 1) * width + (width - 1)) as usize * 4;
    let c1 = [rgba[last_i], rgba[last_i + 1], rgba[last_i + 2]];

    let mut centroids = [c0, c1];
    let mut assignments = vec![0u8; n];

    for _iter in 0..20 {
        let mut changed = 0;
        for (i, ass) in assignments.iter_mut().enumerate() {
            let pi = i * 4;
            let d0 = rgb_dist(
                rgba[pi],
                rgba[pi + 1],
                rgba[pi + 2],
                centroids[0][0],
                centroids[0][1],
                centroids[0][2],
            );
            let d1 = rgb_dist(
                rgba[pi],
                rgba[pi + 1],
                rgba[pi + 2],
                centroids[1][0],
                centroids[1][1],
                centroids[1][2],
            );
            let new_a = if d0 < d1 { 0 } else { 1 };
            if new_a != *ass {
                changed += 1;
            }
            *ass = new_a;
        }
        if changed == 0 {
            break;
        }

        let mut sums = [[0u64; 3]; 2];
        let mut counts = [0u64; 2];
        for (i, &ass) in assignments.iter().enumerate() {
            let pi = i * 4;
            let a = ass as usize;
            sums[a][0] += rgba[pi] as u64;
            sums[a][1] += rgba[pi + 1] as u64;
            sums[a][2] += rgba[pi + 2] as u64;
            counts[a] += 1;
        }
        for c in 0..2 {
            if counts[c] == 0 {
                continue;
            }
            centroids[c] = [
                (sums[c][0] / counts[c]) as u8,
                (sums[c][1] / counts[c]) as u8,
                (sums[c][2] / counts[c]) as u8,
            ];
        }
    }

    // Determine which cluster has more edge content (likely foreground)
    let mut edge_scores = [0u64; 2];
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let idx = (y * width + x) as usize;
            let gx = gray_at(rgba, width, x + 1, y) as i16 - gray_at(rgba, width, x - 1, y) as i16;
            let gy = gray_at(rgba, width, x, y + 1) as i16 - gray_at(rgba, width, x, y - 1) as i16;
            let mag = (gx as f64 * gx as f64 + gy as f64 * gy as f64).sqrt();
            if mag > 30.0 {
                edge_scores[assignments[idx] as usize] += 1;
            }
        }
    }

    let fg = if edge_scores[0] >= edge_scores[1] {
        0
    } else {
        1
    };
    for (i, &ass) in assignments.iter().enumerate() {
        mask[i] = if ass == fg { 255 } else { 0 };
    }

    mask
}

/// Auto-detect the best heuristic method for an image.
fn auto_detect(
    rgba: &[u8],
    width: u32,
    height: u32,
    click: Option<(u32, u32)>,
) -> (&'static str, Vec<u8>) {
    if let Some((sx, sy)) = click {
        return (
            "flood_fill",
            flood_fill_mask(rgba, width, height, sx, sy, 30),
        );
    }

    // Sample corners to check for uniform background
    let corners = [
        (0u32, 0u32),
        (width - 1, 0),
        (0, height - 1),
        (width - 1, height - 1),
    ];
    let mut corner_colors = Vec::new();
    for &(cx, cy) in &corners {
        let i = ((cy * width + cx) * 4) as usize;
        corner_colors.push((rgba[i], rgba[i + 1], rgba[i + 2]));
    }

    // Check color spread via evenly-spaced sample
    let mut spread = 0.0_f64;
    let sample = 100usize.min((width * height) as usize);
    let step = ((width * height) as usize / sample).max(1);
    for i in 0..sample {
        let idx = i * step * 4;
        if idx + 3 < rgba.len() {
            spread += rgb_dist(rgba[idx], rgba[idx + 1], rgba[idx + 2], 128, 128, 128);
        }
    }
    spread /= sample as f64;

    if spread < 30.0 {
        return ("k_means", k_means_mask(rgba, width, height));
    }

    // Check if corners have similar colors (likely chroma key candidate)
    let c0 = corner_colors[0];
    let similar_corners = corner_colors
        .iter()
        .filter(|&&c| rgb_dist(c0.0, c0.1, c0.2, c.0, c.1, c.2) < 30.0)
        .count();
    if similar_corners >= 3 {
        return (
            "chroma_key",
            chroma_key_mask(rgba, width, height, c0.0, c0.1, c0.2, 40),
        );
    }

    ("k_means", k_means_mask(rgba, width, height))
}

/// Remove background using the best heuristic method.
pub fn remove_quick(img: &DynamicImage, opts: &RemovalOptions) -> Result<RemovalResult, String> {
    let start = std::time::Instant::now();

    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    if width == 0 || height == 0 {
        return Err("Cannot remove background from empty image".to_string());
    }

    let pixels = rgba.into_raw();

    let mask = if let Some((sx, sy)) = opts.click_x.zip(opts.click_y) {
        let tol = opts.tolerance.unwrap_or(30);
        flood_fill_mask(&pixels, width, height, sx, sy, tol)
    } else {
        let (_method, mask) = auto_detect(&pixels, width, height, None);
        mask
    };

    let mask = feather_mask(&mask, width, height, opts.feather_radius.unwrap_or(0.0));

    let confidence = compute_confidence(&mask);
    let mask_base64 = mask_to_base64(&mask, width, height)?;
    let elapsed = start.elapsed();

    Ok(RemovalResult {
        mask_base64,
        confidence,
        method: "quick".to_string(),
        processing_time_ms: elapsed.as_millis() as u64,
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RemovalMethod;
    use crate::RemovalOptions;

    fn make_test_image(w: u32, h: u32, fill: impl Fn(u32, u32) -> [u8; 4]) -> DynamicImage {
        let mut buf = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                let [r, g, b, a] = fill(x, y);
                buf[i] = r;
                buf[i + 1] = g;
                buf[i + 2] = b;
                buf[i + 3] = a;
            }
        }
        DynamicImage::ImageRgba8(image::RgbaImage::from_raw(w, h, buf).unwrap())
    }

    #[test]
    fn test_flood_fill_basic() {
        let img = make_test_image(20, 20, |x, _y| {
            if x < 10 {
                [255, 0, 0, 255]
            } else {
                [0, 0, 255, 255]
            }
        });
        let opts = RemovalOptions {
            method: RemovalMethod::Quick,
            tolerance: Some(30),
            feather_radius: None,
            decontaminate: None,
            click_x: Some(15),
            click_y: Some(10),
        };
        let result = remove_quick(&img, &opts).unwrap();
        assert!(result.mask_base64.len() > 10);
        assert!(result.confidence > 0.0);
        assert_eq!(result.width, 20);
        assert_eq!(result.height, 20);
    }

    #[test]
    fn test_chroma_key() {
        let img = make_test_image(10, 10, |x, _y| {
            if x < 3 {
                [0, 255, 0, 255]
            } else {
                [255, 0, 0, 255]
            }
        });
        let pixels = img.to_rgba8().into_raw();
        let mask = chroma_key_mask(&pixels, 10, 10, 0, 255, 0, 30);
        assert_eq!(mask[0], 0);
        assert_eq!(mask[5], 255);
    }

    #[test]
    fn test_k_means() {
        let img = make_test_image(10, 10, |x, _y| {
            if x < 5 {
                [255, 0, 0, 255]
            } else {
                [0, 0, 255, 255]
            }
        });
        let pixels = img.to_rgba8().into_raw();
        let mask = k_means_mask(&pixels, 10, 10);
        let has_fg = mask.iter().any(|&v| v > 128);
        let has_bg = mask.iter().any(|&v| v <= 128);
        assert!(has_fg);
        assert!(has_bg);
    }

    #[test]
    fn test_empty_image_rejected() {
        let img = DynamicImage::new_rgba8(0, 0);
        let opts = RemovalOptions {
            method: RemovalMethod::Quick,
            tolerance: None,
            feather_radius: None,
            decontaminate: None,
            click_x: None,
            click_y: None,
        };
        assert!(remove_quick(&img, &opts).is_err());
    }

    #[test]
    fn test_mask_to_base64_roundtrip() {
        let mask = vec![255u8; 100]; // 10x10 mask
        let b64 = mask_to_base64(&mask, 10, 10).unwrap();
        assert!(b64.len() > 10);
    }
}
