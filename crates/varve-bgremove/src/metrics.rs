//! Mask quality metrics for benchmark and regression evaluation.
//!
//! Semantics mirror `packages/engine/src/backgroundRemoval/qualityMetrics.ts`
//! so that native and browser benchmark reports are directly comparable:
//! binary segmentation metrics (IoU, Dice, precision, recall, F0.3, mask MAE,
//! boundary precision/recall/F-score at a pixel tolerance) plus optional alpha
//! metrics (SAD, MSE, gradient error) that are only meaningful against a
//! genuine alpha matte, never a thresholded binary label.

/// Options controlling metric computation.
#[derive(Clone, Copy, Debug)]
pub struct MaskMetricsOptions {
    /// Foreground threshold on both masks (0-255, default 128).
    pub threshold: u8,
    /// Boundary matching radius in pixels (default 2).
    pub boundary_tolerance: u32,
    /// Mark the target as a genuine alpha matte to populate alpha metrics.
    pub alpha_target: bool,
}

impl Default for MaskMetricsOptions {
    fn default() -> Self {
        Self {
            threshold: 128,
            boundary_tolerance: 2,
            alpha_target: false,
        }
    }
}

/// Computed quality metrics for one predicted mask against a target.
#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub struct MaskMetrics {
    pub iou: f64,
    pub dice: f64,
    pub precision: f64,
    pub recall: f64,
    /// F0.3 — weights precision more heavily, as visible background halos
    /// are usually worse than a small edge omission in cutout work.
    pub f_beta: f64,
    /// Mean absolute error over the full soft mask, normalised to [0, 1].
    pub mae: f64,
    pub boundary_precision: f64,
    pub boundary_recall: f64,
    pub boundary_f_score: f64,
    pub boundary_tolerance: u32,
    pub threshold: u8,
    /// Alpha-matting metrics; only populated when `alpha_target` is set.
    pub alpha_sad: Option<f64>,
    pub alpha_mse: Option<f64>,
    pub alpha_gradient_error: Option<f64>,
}

fn safe_ratio(numerator: f64, denominator: f64) -> f64 {
    if denominator == 0.0 {
        1.0
    } else {
        numerator / denominator
    }
}

fn is_boundary(mask: &[u8], index: usize, width: u32, height: u32, threshold: u8) -> bool {
    let x = index as u32 % width;
    let y = index as u32 / width;
    let value = mask[index] >= threshold;
    let start = y.saturating_sub(1);
    let end_y = (y + 1).min(height - 1);
    let end_x = (x + 1).min(width - 1);
    for ny in start..=end_y {
        for nx in x.saturating_sub(1)..=end_x {
            if nx == x && ny == y {
                continue;
            }
            let neighbor = mask[(ny * width + nx) as usize] >= threshold;
            if neighbor != value {
                return true;
            }
        }
    }
    false
}

/// Count boundary pixels of a mask as a sorted index set.
fn boundary_indices(mask: &[u8], width: u32, height: u32, threshold: u8) -> Vec<usize> {
    (0..mask.len())
        .filter(|&index| is_boundary(mask, index, width, height, threshold))
        .collect()
}

/// Whether any candidate index lies within `radius` pixels of `index`.
fn has_nearby(index: usize, candidates: &[usize], width: u32, height: u32, radius: u32) -> bool {
    let x = index as u32 % width;
    let y = index as u32 / width;
    let r = radius as i64;
    // Candidates are row-major sorted; skip rows above the search window and
    // stop as soon as the window is passed.
    let first_row = y.saturating_sub(radius);
    let last_row = (y + radius).min(height - 1);
    let start = candidates.partition_point(|&i| i < (first_row * width) as usize);
    for &candidate in candidates.iter().skip(start) {
        let cy = (candidate / width as usize) as u32;
        if cy > last_row {
            break;
        }
        let cx = (candidate % width as usize) as u32;
        let dx = cx as i64 - x as i64;
        let dy = cy as i64 - y as i64;
        if dx * dx + dy * dy <= r * r {
            return true;
        }
    }
    false
}

fn gradient_error(predicted: &[u8], expected: &[u8], width: u32, height: u32) -> f64 {
    if width < 2 && height < 2 {
        return 0.0;
    }
    let mut error = 0.0f64;
    let mut samples = 0u64;
    for y in 0..height {
        for x in 0..width {
            let index = (y * width + x) as usize;
            if x + 1 < width {
                error += ((predicted[index + 1] as f64 - predicted[index] as f64) / 255.0
                    - (expected[index + 1] as f64 - expected[index] as f64) / 255.0)
                    .abs();
                samples += 1;
            }
            if y + 1 < height {
                error += ((predicted[index + width as usize] as f64 - predicted[index] as f64)
                    / 255.0
                    - (expected[index + width as usize] as f64 - expected[index] as f64) / 255.0)
                    .abs();
                samples += 1;
            }
        }
    }
    if samples == 0 {
        0.0
    } else {
        error / samples as f64
    }
}

/// Compare a predicted soft mask (0-255) against a binary or alpha target.
///
/// Panics if the masks have different lengths or non-positive dimensions —
/// callers validate input sizes before this point.
pub fn compute_mask_metrics(
    predicted: &[u8],
    expected: &[u8],
    width: u32,
    height: u32,
    options: MaskMetricsOptions,
) -> MaskMetrics {
    assert_eq!(
        predicted.len(),
        expected.len(),
        "mask length mismatch: predicted={} expected={}",
        predicted.len(),
        expected.len()
    );
    assert!(
        predicted.len() == (width as usize) * (height as usize),
        "mask length {} does not match {}x{}",
        predicted.len(),
        width,
        height
    );

    let threshold = options.threshold;
    let mut intersection = 0u64;
    let mut union = 0u64;
    let mut predicted_positive = 0u64;
    let mut expected_positive = 0u64;
    let mut absolute_error = 0.0f64;
    let mut squared_error = 0.0f64;

    for index in 0..predicted.len() {
        let p = predicted[index];
        let e = expected[index];
        let p_fg = p >= threshold;
        let e_fg = e >= threshold;
        if p_fg {
            predicted_positive += 1;
        }
        if e_fg {
            expected_positive += 1;
        }
        if p_fg && e_fg {
            intersection += 1;
        }
        if p_fg || e_fg {
            union += 1;
        }
        let difference = (p as f64 - e as f64).abs() / 255.0;
        absolute_error += difference;
        squared_error += difference * difference;
    }

    let predicted_boundary = boundary_indices(predicted, width, height, threshold);
    let expected_boundary = boundary_indices(expected, width, height, threshold);
    let matched_predicted = predicted_boundary
        .iter()
        .filter(|&&index| {
            has_nearby(
                index,
                &expected_boundary,
                width,
                height,
                options.boundary_tolerance,
            )
        })
        .count();
    let matched_expected = expected_boundary
        .iter()
        .filter(|&&index| {
            has_nearby(
                index,
                &predicted_boundary,
                width,
                height,
                options.boundary_tolerance,
            )
        })
        .count();

    let boundary_precision = safe_ratio(matched_predicted as f64, predicted_boundary.len() as f64);
    let boundary_recall = safe_ratio(matched_expected as f64, expected_boundary.len() as f64);

    let mut metrics = MaskMetrics {
        iou: safe_ratio(intersection as f64, union as f64),
        dice: safe_ratio(
            2.0 * intersection as f64,
            (predicted_positive + expected_positive) as f64,
        ),
        precision: safe_ratio(intersection as f64, predicted_positive as f64),
        recall: safe_ratio(intersection as f64, expected_positive as f64),
        f_beta: safe_ratio(
            1.09 * intersection as f64,
            0.09 * predicted_positive as f64 + expected_positive as f64,
        ),
        mae: if predicted.is_empty() {
            0.0
        } else {
            absolute_error / predicted.len() as f64
        },
        boundary_precision,
        boundary_recall,
        boundary_f_score: safe_ratio(
            2.0 * boundary_precision * boundary_recall,
            boundary_precision + boundary_recall,
        ),
        boundary_tolerance: options.boundary_tolerance,
        threshold,
        ..Default::default()
    };

    if options.alpha_target {
        metrics.alpha_sad = Some(absolute_error);
        metrics.alpha_mse = Some(if predicted.is_empty() {
            0.0
        } else {
            squared_error / predicted.len() as f64
        });
        metrics.alpha_gradient_error = Some(gradient_error(predicted, expected, width, height));
    }

    metrics
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_masks_score_perfect() {
        let width = 4;
        let height = 4;
        let mut mask = vec![0u8; width * height];
        mask[5..8].fill(255);
        let metrics = compute_mask_metrics(
            &mask,
            &mask,
            width as u32,
            height as u32,
            MaskMetricsOptions::default(),
        );
        assert_eq!(metrics.iou, 1.0);
        assert_eq!(metrics.dice, 1.0);
        assert_eq!(metrics.precision, 1.0);
        assert_eq!(metrics.recall, 1.0);
        assert_eq!(metrics.mae, 0.0);
        assert_eq!(metrics.boundary_f_score, 1.0);
    }

    #[test]
    fn disjoint_masks_score_zero() {
        let width = 4;
        let height = 1;
        let left = vec![255, 255, 0, 0];
        let right = vec![0, 0, 255, 255];
        let metrics = compute_mask_metrics(
            &left,
            &right,
            width as u32,
            height as u32,
            MaskMetricsOptions::default(),
        );
        assert_eq!(metrics.iou, 0.0);
        assert_eq!(metrics.dice, 0.0);
        assert_eq!(metrics.f_beta, 0.0);
    }

    #[test]
    fn soft_mask_mae_matches_manual_calculation() {
        let predicted = [0u8, 128, 255];
        let expected = [0u8, 0, 255];
        let metrics =
            compute_mask_metrics(&predicted, &expected, 3, 1, MaskMetricsOptions::default());
        let manual = (128.0 / 255.0) / 3.0;
        assert!((metrics.mae - manual).abs() < 1e-9);
    }

    #[test]
    fn boundary_metrics_penalise_shifted_edges() {
        let width = 16;
        let height = 16;
        let mut expected = vec![0u8; width * height];
        for y in 4..12 {
            for x in 4..12 {
                expected[y * width + x] = 255;
            }
        }
        // Predicted square shifted by 4 pixels.
        let mut predicted = vec![0u8; width * height];
        for y in 8..16 {
            for x in 8..16 {
                predicted[y * width + x] = 255;
            }
        }
        let metrics = compute_mask_metrics(
            &predicted,
            &expected,
            width as u32,
            height as u32,
            MaskMetricsOptions::default(),
        );
        assert!(
            metrics.boundary_f_score < 0.6,
            "got {}",
            metrics.boundary_f_score
        );
        // IoU of the two 8x8 squares shifted by 4x4: intersection 4x4=16, union 96+16=112.
        assert!(
            (metrics.iou - 16.0 / 112.0).abs() < 1e-9,
            "got {}",
            metrics.iou
        );
    }

    #[test]
    fn alpha_metrics_populated_only_for_alpha_target() {
        let mask = [0u8, 64, 128, 255];
        let base = compute_mask_metrics(&mask, &mask, 4, 1, MaskMetricsOptions::default());
        assert!(base.alpha_sad.is_none());

        let alpha = compute_mask_metrics(
            &mask,
            &mask,
            4,
            1,
            MaskMetricsOptions {
                alpha_target: true,
                ..Default::default()
            },
        );
        assert!(alpha.alpha_sad.is_some());
        assert_eq!(alpha.alpha_sad.unwrap(), 0.0);
        assert!(alpha.alpha_mse.is_some());
        assert!(alpha.alpha_gradient_error.is_some());
    }
}
