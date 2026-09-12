//! Deterministic preflight checks for prompt-capable local models.
//!
//! A helper that merely decodes an image, or changes any masked byte, has not
//! demonstrated that it understood the prompt. The production qualification
//! fixture asks for a red object, so this module checks for a bounded red
//! signal in the requested mask in addition to checking that the output
//! changed. The full photographic corpus remains the release-quality gate;
//! this is the inexpensive prerequisite that prevents an incompatible model
//! from being advertised as ready.

use image::RgbImage;

const MIN_CHANGED_FRACTION: f32 = 0.2;
const MIN_RED_FRACTION: f32 = 0.05;
const MIN_MEAN_RED_DOMINANCE: f32 = 8.0;
const MIN_CHANNEL_DELTA: u8 = 12;
const MIN_RED_DOMINANCE: i16 = 20;
const MIN_RED_VALUE: u8 = 64;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct QualificationMetrics {
    pub(crate) masked_pixels: usize,
    pub(crate) changed_fraction: f32,
    pub(crate) red_fraction: f32,
    pub(crate) mean_red_dominance: f32,
}

/// Validate the fixed prompt-conditioned qualification fixture.
///
/// `mask` uses the same convention as the native inpainting contract:
/// non-zero coverage is the region allowed to change. Pixels outside that
/// region are intentionally not scored here because stable-diffusion.cpp
/// returns a complete frame and Varve protects the source during the final
/// composite. Outside-region preservation is tested by the compositor lane.
pub(crate) fn validate_masked_prompt_output(
    output: &RgbImage,
    mask: &[u8],
    mask_width: u32,
    mask_height: u32,
    source_rgb: [u8; 3],
) -> Result<QualificationMetrics, String> {
    if output.width() != mask_width || output.height() != mask_height {
        return Err(format!(
            "Qualification output {}x{} does not match the {}x{} fixture",
            output.width(),
            output.height(),
            mask_width,
            mask_height
        ));
    }
    let expected_len = usize::try_from(mask_width).ok().and_then(|width| {
        usize::try_from(mask_height)
            .ok()
            .map(|height| width * height)
    });
    if expected_len != Some(mask.len()) {
        return Err("Qualification mask dimensions could not be verified".into());
    }

    let mut masked_pixels = 0usize;
    let mut changed_pixels = 0usize;
    let mut red_pixels = 0usize;
    let mut red_dominance_sum = 0f32;

    for y in 0..mask_height {
        for x in 0..mask_width {
            let index = usize::try_from(y * mask_width + x).unwrap_or(usize::MAX);
            if mask.get(index).copied().unwrap_or(0) == 0 {
                continue;
            }
            masked_pixels += 1;
            let pixel = output.get_pixel(x, y).0;
            let delta = pixel
                .iter()
                .zip(source_rgb)
                .map(|(actual, source)| u16::from(actual.abs_diff(source)))
                .sum::<u16>();
            if delta >= u16::from(MIN_CHANNEL_DELTA) {
                changed_pixels += 1;
            }

            let red_dominance = i16::from(pixel[0]) - i16::from(pixel[1].max(pixel[2]));
            if red_dominance >= MIN_RED_DOMINANCE && pixel[0] >= MIN_RED_VALUE {
                red_pixels += 1;
            }
            red_dominance_sum += f32::from(red_dominance);
        }
    }

    if masked_pixels == 0 {
        return Err("Qualification fixture has an empty mask".into());
    }

    let denominator = masked_pixels as f32;
    let metrics = QualificationMetrics {
        masked_pixels,
        changed_fraction: changed_pixels as f32 / denominator,
        red_fraction: red_pixels as f32 / denominator,
        mean_red_dominance: red_dominance_sum / denominator,
    };
    if metrics.changed_fraction < MIN_CHANGED_FRACTION {
        return Err(format!(
            "The masked qualification output changed only {:.1}% of the fixture; model compatibility was not proven",
            metrics.changed_fraction * 100.0
        ));
    }
    if metrics.red_fraction < MIN_RED_FRACTION
        || metrics.mean_red_dominance < MIN_MEAN_RED_DOMINANCE
    {
        return Err(format!(
            "The qualification output did not show the requested red object (red signal {:.1}%, mean dominance {:.1}); prompt conditioning was not proven",
            metrics.red_fraction * 100.0,
            metrics.mean_red_dominance
        ));
    }

    Ok(metrics)
}

#[cfg(test)]
mod tests {
    use super::validate_masked_prompt_output;
    use image::{Rgb, RgbImage};

    fn mask(width: u32, height: u32) -> Vec<u8> {
        vec![255; (width * height) as usize]
    }

    #[test]
    fn rejects_output_that_only_changes_pixels_without_prompt_signal() {
        let output = RgbImage::from_pixel(8, 8, Rgb([30, 120, 220]));
        let error = validate_masked_prompt_output(&output, &mask(8, 8), 8, 8, [238; 3])
            .expect_err("blue output must not qualify as a red-object prompt result");
        assert!(error.contains("red object"));
    }

    #[test]
    fn accepts_a_masked_red_prompt_signal() {
        let output = RgbImage::from_pixel(8, 8, Rgb([238, 238, 238]));
        let mut output = output;
        for pixel in output.pixels_mut() {
            *pixel = Rgb([180, 60, 45]);
        }
        let metrics = validate_masked_prompt_output(&output, &mask(8, 8), 8, 8, [238; 3])
            .expect("red output should pass the preflight signal check");
        assert_eq!(metrics.masked_pixels, 64);
        assert!(metrics.red_fraction > 0.9);
    }

    #[test]
    fn scores_only_the_edit_mask() {
        let mut output = RgbImage::from_pixel(8, 8, Rgb([238, 238, 238]));
        for y in 2..6 {
            for x in 2..6 {
                output.put_pixel(x, y, Rgb([180, 60, 45]));
            }
        }
        let mut fixture_mask = vec![0; 64];
        for y in 2..6 {
            for x in 2..6 {
                fixture_mask[(y * 8 + x) as usize] = 255;
            }
        }
        let metrics = validate_masked_prompt_output(&output, &fixture_mask, 8, 8, [238; 3])
            .expect("the masked red region should qualify");
        assert_eq!(metrics.masked_pixels, 16);
        assert_eq!(metrics.changed_fraction, 1.0);
    }
}
