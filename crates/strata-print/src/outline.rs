//! Font outlining via ab_glyph.
//!
//! Converts font glyphs into vector path commands (MoveTo, LineTo, CurveTo,
//! ClosePath) for use in PDF export and SVG path generation.
//!
//! `outline_text_multi()` supports multiple fonts looked up by family name,
//! falling back to the first available font on miss.
//!
//! Research basis: ab_glyph for OpenType glyph outline extraction, SVG path
//! specification for commands_to_svg_path.

#![forbid(unsafe_code)]

use ab_glyph::{Font, FontArc, OutlineCurve};

/// A vector path command, analogous to SVG path operators.
#[derive(Debug, Clone, PartialEq)]
pub enum PathCommand {
    /// Move to absolute position (x, y).
    MoveTo(f64, f64),
    /// Line to absolute position (x, y).
    LineTo(f64, f64),
    /// Cubic bezier curve: control point 1, control point 2, end point.
    CurveTo(f64, f64, f64, f64, f64, f64),
    /// Close the current sub-path.
    ClosePath,
}

/// The outline of a single glyph, consisting of path commands and advance
/// width (cursor advance in the same coordinate space as the commands).
#[derive(Debug, Clone)]
pub struct GlyphOutline {
    pub commands: Vec<PathCommand>,
    pub advance_width: f64,
}

/// Outline a string of text into glyph outlines using a TrueType/OpenType font.
///
/// `font_data` should be raw TTF/OTF font bytes. Each output `GlyphOutline`
/// corresponds to one character; non-printable characters that produce no
/// outline are skipped.
pub fn outline_text(
    font_data: &[u8],
    text: &str,
    font_size: f64,
) -> Result<Vec<GlyphOutline>, String> {
    let font = FontArc::try_from_vec(font_data.to_vec())
        .map_err(|e| format!("Failed to load font: {e}"))?;

    if text.is_empty() {
        return Ok(Vec::new());
    }

    let upem = font
        .units_per_em()
        .ok_or_else(|| "Font has no units_per_em".to_string())? as f64;
    let scale_factor = font_size / upem;
    let mut results: Vec<GlyphOutline> = Vec::new();
    let mut x_pos = 0.0f64;

    for ch in text.chars() {
        let glyph_id = font.glyph_id(ch);
        let advance = font.h_advance_unscaled(glyph_id) as f64 * scale_factor;

        if let Some(outline) = font.outline(glyph_id) {
            let mut commands: Vec<PathCommand> = Vec::new();
            let mut last_end: Option<(f64, f64)> = None;

            for curve in &outline.curves {
                match curve {
                    OutlineCurve::Line(p0, p1) => {
                        let sx = p0.x as f64 * scale_factor + x_pos;
                        let sy = p0.y as f64 * scale_factor;
                        let ex = p1.x as f64 * scale_factor + x_pos;
                        let ey = p1.y as f64 * scale_factor;

                        start_or_move(&mut commands, last_end, sx, sy);
                        commands.push(PathCommand::LineTo(ex, ey));
                        last_end = Some((ex, ey));
                    }
                    OutlineCurve::Quad(p0, p1, p2) => {
                        let sx = p0.x as f64 * scale_factor + x_pos;
                        let sy = p0.y as f64 * scale_factor;
                        let cx = p1.x as f64 * scale_factor + x_pos;
                        let cy = p1.y as f64 * scale_factor;
                        let ex = p2.x as f64 * scale_factor + x_pos;
                        let ey = p2.y as f64 * scale_factor;

                        start_or_move(&mut commands, last_end, sx, sy);
                        // Convert quadratic bezier to cubic:
                        // C1 = P0 + 2/3*(P1-P0),  C2 = P2 + 2/3*(P1-P2)
                        let cp1x = sx + 2.0 / 3.0 * (cx - sx);
                        let cp1y = sy + 2.0 / 3.0 * (cy - sy);
                        let cp2x = ex + 2.0 / 3.0 * (cx - ex);
                        let cp2y = ey + 2.0 / 3.0 * (cy - ey);
                        commands.push(PathCommand::CurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey));
                        last_end = Some((ex, ey));
                    }
                    OutlineCurve::Cubic(p0, p1, p2, p3) => {
                        let sx = p0.x as f64 * scale_factor + x_pos;
                        let sy = p0.y as f64 * scale_factor;
                        let c1x = p1.x as f64 * scale_factor + x_pos;
                        let c1y = p1.y as f64 * scale_factor;
                        let c2x = p2.x as f64 * scale_factor + x_pos;
                        let c2y = p2.y as f64 * scale_factor;
                        let ex = p3.x as f64 * scale_factor + x_pos;
                        let ey = p3.y as f64 * scale_factor;

                        start_or_move(&mut commands, last_end, sx, sy);
                        commands.push(PathCommand::CurveTo(c1x, c1y, c2x, c2y, ex, ey));
                        last_end = Some((ex, ey));
                    }
                }
            }

            if !commands.is_empty() {
                results.push(GlyphOutline {
                    commands,
                    advance_width: advance,
                });
            }
        }

        x_pos += advance;
    }

    Ok(results)
}

/// Outline text using a multi-font lookup.
///
/// `fonts` is a slice of `(family_name, font_data)` pairs.
/// The function searches for a font whose family name matches `font_family`,
/// falling back to the first font if no match is found.
pub fn outline_text_multi(
    fonts: &[(String, Vec<u8>)],
    font_family: &str,
    text: &str,
    font_size: f64,
) -> Result<Vec<GlyphOutline>, String> {
    if fonts.is_empty() {
        return Err("No fonts provided".into());
    }

    if text.is_empty() {
        return Ok(Vec::new());
    }

    // Find matching font by family name, or fall back to first
    let font_data = fonts
        .iter()
        .find(|(name, _)| name == font_family)
        .map(|(_, data)| data)
        .unwrap_or(&fonts[0].1);

    outline_text(font_data, text, font_size)
}

/// Helper: emit a MoveTo for the first segment or when a gap (new sub-path)
/// is detected.
fn start_or_move(commands: &mut Vec<PathCommand>, last_end: Option<(f64, f64)>, sx: f64, sy: f64) {
    match last_end {
        None => commands.push(PathCommand::MoveTo(sx, sy)),
        Some((lx, ly)) => {
            if (sx - lx).abs() > 1e-9 || (sy - ly).abs() > 1e-9 {
                commands.push(PathCommand::MoveTo(sx, sy));
            }
        }
    }
}

/// Convert a slice of `PathCommand` values to an SVG path `d` attribute string.
///
/// `precision` controls the number of decimal places for numeric output.
pub fn commands_to_svg_path(commands: &[PathCommand], precision: usize) -> String {
    if commands.is_empty() {
        return String::new();
    }

    let mut path = String::new();
    for cmd in commands {
        match cmd {
            PathCommand::MoveTo(x, y) => {
                path.push_str(&format!(
                    "M{x:.prec$} {y:.prec$} ",
                    prec = precision,
                    x = x,
                    y = y
                ));
            }
            PathCommand::LineTo(x, y) => {
                path.push_str(&format!(
                    "L{x:.prec$} {y:.prec$} ",
                    prec = precision,
                    x = x,
                    y = y
                ));
            }
            PathCommand::CurveTo(x1, y1, x2, y2, x3, y3) => {
                path.push_str(&format!(
                    "C{x1:.prec$} {y1:.prec$} {x2:.prec$} {y2:.prec$} {x3:.prec$} {y3:.prec$} ",
                    prec = precision,
                    x1 = x1,
                    y1 = y1,
                    x2 = x2,
                    y2 = y2,
                    x3 = x3,
                    y3 = y3
                ));
            }
            PathCommand::ClosePath => {
                path.push_str("Z ");
            }
        }
    }
    path.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_font_data() -> &'static [u8] {
        // Cross-platform candidate fonts. CI matrices run Linux (Ubuntu),
        // macOS, and Windows — a test that only knows /usr/share/fonts dies on
        // the other two runners.
        let paths = [
            // Linux (Ubuntu runner)
            "/usr/share/fonts/TTF/OpenSans-Regular.ttf",
            "/usr/share/fonts/Adwaita/AdwaitaSans-Regular.ttf",
            "/usr/share/fonts/TTF/Vera.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/Inter-Regular.ttf",
            // macOS
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Georgia.ttf",
            "/Library/Fonts/Arial Unicode.ttf",
            // Windows
            "C:\\Windows\\Fonts\\arial.ttf",
            "C:\\Windows\\Fonts\\calibri.ttf",
        ];
        for p in &paths {
            if let Ok(data) = std::fs::read(p) {
                return Box::leak(data.into_boxed_slice());
            }
        }
        panic!("no test font found — tried {paths:?}")
    }

    #[test]
    fn outline_simple_text() {
        let data = test_font_data();
        let outlines = outline_text(data, "A", 16.0).expect("outline A");
        assert!(!outlines.is_empty(), "should produce at least one glyph");
        assert!(
            !outlines[0].commands.is_empty(),
            "glyph A should have path commands"
        );
        assert!(
            outlines[0].advance_width > 0.0,
            "advance width should be positive"
        );
    }

    #[test]
    fn outline_multiple_chars() {
        let data = test_font_data();
        let outlines = outline_text(data, "AB", 16.0).expect("outline AB");
        assert_eq!(outlines.len(), 2, "should produce two glyphs");
        for (i, g) in outlines.iter().enumerate() {
            assert!(!g.commands.is_empty(), "glyph {i} should have commands");
            assert!(g.advance_width > 0.0, "glyph {i} should have advance width");
        }
    }

    #[test]
    fn outline_empty_string() {
        let data = test_font_data();
        let outlines = outline_text(data, "", 16.0).expect("outline empty");
        assert!(outlines.is_empty(), "should be empty");
    }

    #[test]
    fn commands_to_svg_path_produces_valid_d() {
        let cmds = vec![
            PathCommand::MoveTo(10.0, 10.0),
            PathCommand::LineTo(100.0, 10.0),
            PathCommand::CurveTo(120.0, 20.0, 110.0, 90.0, 100.0, 100.0),
            PathCommand::LineTo(10.0, 100.0),
            PathCommand::ClosePath,
        ];
        let d = commands_to_svg_path(&cmds, 2);
        assert!(!d.is_empty(), "SVG path should not be empty");
        assert!(d.starts_with('M'), "should start with M");
        assert!(d.contains('C'), "should contain cubic curve");
        assert!(d.ends_with('Z'), "should end with Z");
        assert!(d.contains('L'), "should contain line");
    }

    #[test]
    fn outline_different_character() {
        let data = test_font_data();
        let outlines_b = outline_text(data, "B", 16.0).expect("outline B");
        let _outlines_a = outline_text(data, "A", 16.0).expect("outline A");
        assert!(!outlines_b.is_empty(), "B should produce outline");
        assert!(!outlines_b[0].commands.is_empty(), "B should have commands");
    }

    #[test]
    fn outline_font_size_scales_advance() {
        let data = test_font_data();
        let small = outline_text(data, "M", 12.0).expect("small");
        let large = outline_text(data, "M", 24.0).expect("large");
        assert!(
            large[0].advance_width > small[0].advance_width,
            "larger font should have larger advance width"
        );
        let ratio = large[0].advance_width / small[0].advance_width;
        assert!(
            (ratio - 2.0).abs() < 0.1,
            "advance ratio should be ~2.0, got {ratio}"
        );
    }

    #[test]
    fn commands_to_svg_path_empty() {
        let d = commands_to_svg_path(&[], 2);
        assert!(d.is_empty(), "empty commands should produce empty string");
    }

    #[test]
    fn commands_to_svg_path_precision() {
        let cmds = vec![PathCommand::MoveTo(10.12345, 20.67890)];
        let low_prec = commands_to_svg_path(&cmds, 1);
        let high_prec = commands_to_svg_path(&cmds, 4);
        assert_ne!(low_prec, high_prec, "precision should affect output");
        assert!(
            low_prec.len() < high_prec.len(),
            "lower precision = shorter output"
        );
    }

    // ── outline_text_multi tests ───────────────────────────────────────

    #[test]
    fn outline_text_multi_font_lookup() {
        let font_data = test_font_data().to_vec();
        let fonts = vec![("DejaVu Sans".into(), font_data)];
        let result = outline_text_multi(&fonts, "DejaVu Sans", "ABC", 16.0);
        assert!(result.is_ok(), "should find font by family name");
        let outlines = result.unwrap();
        assert_eq!(outlines.len(), 3, "should produce three glyph outlines");
    }

    #[test]
    fn outline_text_multi_font_fallback() {
        let font_data = test_font_data().to_vec();
        let fonts = vec![("Fallback".into(), font_data)];
        // Look up a non-existent family — should fall back to first font
        let result = outline_text_multi(&fonts, "NonExistentFont", "A", 16.0);
        assert!(result.is_ok(), "should fall back to first font");
        let outlines = result.unwrap();
        assert!(
            !outlines.is_empty(),
            "should produce outline from fallback font"
        );
    }

    #[test]
    fn outline_text_multi_empty_text() {
        let font_data = test_font_data().to_vec();
        let fonts = vec![("Test".into(), font_data)];
        let result = outline_text_multi(&fonts, "Test", "", 16.0);
        assert!(result.is_ok(), "empty text should be ok");
        assert_eq!(result.unwrap().len(), 0, "no outlines for empty text");
    }

    #[test]
    fn outline_text_multi_empty_fonts() {
        let result = outline_text_multi(&[], "Any", "A", 16.0);
        assert!(result.is_err(), "empty fonts should error");
        assert!(
            result.unwrap_err().contains("No fonts"),
            "should say no fonts"
        );
    }

    #[test]
    fn outline_text_multi_multiple_fonts() {
        let font_data = test_font_data().to_vec();
        let fonts = vec![
            ("FontA".into(), font_data.clone()),
            ("DejaVu Sans".into(), font_data),
        ];
        let result = outline_text_multi(&fonts, "DejaVu Sans", "Hello", 24.0);
        assert!(result.is_ok(), "should find DejaVu Sans");
        let outlines = result.unwrap();
        assert_eq!(outlines.len(), 5, "Hello has 5 characters");
        for (i, g) in outlines.iter().enumerate() {
            assert!(!g.commands.is_empty(), "glyph {i} should have commands");
        }
    }

    #[test]
    fn outline_text_multi_returns_paths() {
        let font_data = test_font_data().to_vec();
        let fonts = vec![("Bold".into(), font_data)];
        let outlines = outline_text_multi(&fonts, "Bold", "A", 16.0).expect("outline A with multi");
        assert!(!outlines.is_empty(), "should produce glyph");
        // The commands should contain path operators (MoveTo at minimum)
        assert!(
            !outlines[0].commands.is_empty(),
            "glyph should have path commands"
        );
        let has_moveto = outlines[0]
            .commands
            .iter()
            .any(|c| matches!(c, PathCommand::MoveTo(_, _)));
        assert!(has_moveto, "glyph should start with MoveTo");
        // Most fonts use bezier curves, but some may be all lines for simple glyphs
        let has_path = outlines[0].commands.iter().any(|c| {
            matches!(
                c,
                PathCommand::CurveTo(_, _, _, _, _, _) | PathCommand::LineTo(_, _)
            )
        });
        assert!(has_path, "glyph should have LineTo or CurveTo commands");
    }
}
