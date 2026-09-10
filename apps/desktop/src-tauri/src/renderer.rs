//! Render-spike scene generator (task 0.2).
//!
//! Two outputs to compare transport strategies end-to-end:
//!   - `generate_ir`:     a compact list of shapes (KB-scale IPC payload).
//!   - `generate_pixels`: a raw RGBA buffer (MB-scale IPC payload).
//!
//! Both are deterministic functions of `frame`, so a headless test can assert
//! correctness without a GPU or display.

/// One rect in scene-IR space. Color is RGBA u8 (serde → JSON array).
#[derive(Debug, serde::Serialize, PartialEq)]
pub struct ShapeIr {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub color: [u8; 4],
}

/// Number of shapes drawn per frame. Large enough to stress the IR replay and
/// demonstrate the payload stays small even with many shapes.
pub const SHAPE_COUNT: usize = 600;

/// Produce `SHAPE_COUNT` deterministic, animated rects for `frame`.
///
/// Research basis: this mirrors how a retained-mode 2D renderer (Piet/Skia
/// Scene) emits an ordered draw list; the webview replays it. The wedge is that
/// the *generation* of this list (the engine) runs native, so document state is
/// never bound by the WASM memory ceiling.
pub fn generate_ir(frame: u32) -> Vec<ShapeIr> {
    let f = frame as f32;
    let mut shapes = Vec::with_capacity(SHAPE_COUNT);
    for i in 0..SHAPE_COUNT {
        let phase = (i as f32) * 0.1 + f * 0.02;
        let x = 320.0 + 280.0 * phase.sin() + (i as f32 % 40.0) * 6.0;
        let y = 240.0 + 180.0 * phase.cos() + ((i as f32) / 40.0) * 14.0;
        let w = 26.0;
        let h = 18.0;
        let r = ((i as u32).wrapping_mul(7).wrapping_add(frame) % 256) as u8;
        let color = [r, 120, 200, 230];
        shapes.push(ShapeIr { x, y, w, h, color });
    }
    shapes
}

/// Produce a `width * height` RGBA buffer: a deterministic animated gradient.
/// Used to measure the pixel-push ceiling.
pub fn generate_pixels(width: u32, height: u32, frame: u32) -> Vec<u8> {
    let mut buf = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let r = ((x + frame) % 256) as u8;
            let g = ((y + frame / 2) % 256) as u8;
            let b = ((x ^ y ^ frame) % 256) as u8;
            buf.extend_from_slice(&[r, g, b, 255]);
        }
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ir_has_expected_shape_count() {
        assert_eq!(generate_ir(0).len(), SHAPE_COUNT);
        assert_eq!(generate_ir(123).len(), SHAPE_COUNT);
    }

    #[test]
    fn ir_is_deterministic_per_frame() {
        assert_eq!(generate_ir(42), generate_ir(42));
    }

    #[test]
    fn ir_differs_across_frames() {
        // Animation should move at least one shape between adjacent frames.
        let a = generate_ir(0);
        let b = generate_ir(1);
        assert_ne!(a[0], b[0]);
    }

    #[test]
    fn pixels_buffer_is_correct_length() {
        let w = 64u32;
        let h = 48u32;
        let buf = generate_pixels(w, h, 0);
        assert_eq!(buf.len(), (w * h * 4) as usize);
    }

    #[test]
    fn pixels_alpha_is_opaque() {
        let buf = generate_pixels(8, 8, 0);
        for px in buf.chunks_exact(4) {
            assert_eq!(px[3], 255, "alpha must be opaque");
        }
    }
}
