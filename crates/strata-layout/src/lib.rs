//! CSS-native flex/grid/container-query layout backed by Taffy.
//!
//! `compute_layout()` converts a frame's layout properties into Taffy styles,
//! runs the layout algorithm, and returns resolved positions/sizes for each
//! child. `validate_breakpoints()` checks for overlapping min-width ranges.
//!
//! Research basis: Taffy implements the CSS Box / Flexbox / Grid specs and is
//! the layout engine used by Bevy and other Rust UI toolkits.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use strata_core::NodeId;
use taffy::prelude::*;

/// Layout mode for a frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LayoutMode {
    Flex,
    Grid,
}

/// Flex-direction (CSS `flex-direction`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FlexDirection {
    Row,
    Column,
    RowReverse,
    ColumnReverse,
}

/// Layout properties attached to a FrameNode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LayoutStyle {
    pub mode: LayoutMode,
    pub direction: FlexDirection,
    pub gap: f64,
    pub wrap: bool,
    pub padding: [f64; 4], // [top, right, bottom, left]
    /// Flex grow factor (0 = no grow).
    pub grow: f64,
    /// Flex shrink factor.
    pub shrink: f64,
    /// P3: Grid template columns (e.g., "1fr 200px 1fr").
    pub grid_template_columns: Option<String>,
    /// P3: Grid template rows (e.g., "auto 1fr auto").
    pub grid_template_rows: Option<String>,
}

impl Default for LayoutStyle {
    fn default() -> Self {
        Self {
            mode: LayoutMode::Flex,
            direction: FlexDirection::Row,
            gap: 0.0,
            wrap: false,
            padding: [0.0; 4],
            grow: 0.0,
            shrink: 1.0,
            grid_template_columns: None,
            grid_template_rows: None,
        }
    }
}

/// A breakpoint for responsive layout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Breakpoint {
    pub id: String,
    pub min_width: f64,
}

/// Resolved layout for a single child: position + size.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResolvedChild {
    pub node_id: NodeId,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Result of a layout computation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LayoutResult {
    pub children: Vec<ResolvedChild>,
    pub container_width: f64,
    pub container_height: f64,
}

/// Convert Strata layout properties to a Taffy `Style`.
fn to_taffy_style(style: &LayoutStyle) -> Style {
    let display = match style.mode {
        LayoutMode::Flex => Display::Flex,
        LayoutMode::Grid => Display::Grid,
    };

    let direction = match style.direction {
        FlexDirection::Row => taffy::prelude::FlexDirection::Row,
        FlexDirection::Column => taffy::prelude::FlexDirection::Column,
        FlexDirection::RowReverse => taffy::prelude::FlexDirection::RowReverse,
        FlexDirection::ColumnReverse => taffy::prelude::FlexDirection::ColumnReverse,
    };

    let flex_wrap = if style.wrap {
        taffy::prelude::FlexWrap::Wrap
    } else {
        taffy::prelude::FlexWrap::NoWrap
    };

    // P3: Grid template support (stub - full parsing requires Taffy GridTrack API)
    // For now, just set display to Grid. Full grid template parsing deferred.
    let taffy_style = Style {
        display,
        flex_direction: direction,
        flex_wrap,
        gap: Size {
            width: length(style.gap as f32),
            height: length(0.0),
        },
        padding: Rect {
            top: length(style.padding[0] as f32),
            right: length(style.padding[1] as f32),
            bottom: length(style.padding[2] as f32),
            left: length(style.padding[3] as f32),
        },
        flex_grow: style.grow as f32,
        flex_shrink: style.shrink as f32,
        ..Default::default()
    };

    // TODO: Parse grid_template_columns and grid_template_rows into Taffy GridTrack
    // This requires understanding Taffy's grid API which is more complex

    taffy_style
}

/// Compute layout for a frame's children using Taffy.
///
/// `container_width` / `container_height`: available size for the layout
/// container. Each child's size is determined by its `child_sizes` map
/// (node_id -> (width, height) known size, or None for auto).
pub fn compute_layout(
    style: &LayoutStyle,
    child_ids: &[NodeId],
    child_sizes: &HashMap<NodeId, Option<(f64, f64)>>,
    container_width: f64,
    container_height: f64,
) -> LayoutResult {
    let mut tree: TaffyTree = TaffyTree::new();
    let taffy_style = to_taffy_style(style);

    let container = tree.new_with_children(taffy_style, &[]).unwrap();

    let mut taffy_ids: HashMap<u64, taffy::NodeId> = HashMap::new();

    for child_id in child_ids {
        let child_size = child_sizes.get(child_id).and_then(|s| *s);
        let mut child_style = Style {
            flex_grow: style.grow as f32,
            flex_shrink: style.shrink as f32,
            ..Default::default()
        };
        if let Some((w, h)) = child_size {
            child_style.size = Size {
                width: Dimension::from_length(w as f32),
                height: Dimension::from_length(h as f32),
            };
        }
        let child = tree.new_leaf(child_style).unwrap();
        tree.add_child(container, child).unwrap();
        taffy_ids.insert(child_id.0, child);
    }

    let available = Size {
        width: AvailableSpace::Definite(container_width as f32),
        height: AvailableSpace::Definite(container_height as f32),
    };
    tree.compute_layout(container, available).unwrap();

    let mut children = Vec::with_capacity(child_ids.len());
    for child_id in child_ids {
        if let Some(&taffy_id) = taffy_ids.get(&child_id.0) {
            let layout = tree.layout(taffy_id).unwrap();
            children.push(ResolvedChild {
                node_id: *child_id,
                x: layout.location.x as f64,
                y: layout.location.y as f64,
                width: layout.size.width as f64,
                height: layout.size.height as f64,
            });
        }
    }

    let container_layout = tree.layout(container).unwrap();
    LayoutResult {
        children,
        container_width: container_layout.size.width as f64,
        container_height: container_layout.size.height as f64,
    }
}

/// Validate breakpoints: return true if no overlaps (duplicate or overlapping
/// ranges). Each breakpoint's `min_width` defines the start of its range;
/// the end is implicitly the next breakpoint's `min_width` or infinity.
pub fn validate_breakpoints(breakpoints: &[Breakpoint]) -> bool {
    if breakpoints.is_empty() {
        return true;
    }
    let mut sorted: Vec<f64> = breakpoints.iter().map(|b| b.min_width).collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    for i in 0..sorted.len().saturating_sub(1) {
        if sorted[i] >= sorted[i + 1] || (sorted[i + 1] - sorted[i]).abs() < f64::EPSILON {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }

    #[test]
    fn compute_flex_row_layout() {
        let style = LayoutStyle::default();
        let ids = vec![NodeId(1), NodeId(2)];
        let mut sizes = HashMap::new();
        sizes.insert(NodeId(1), Some((50.0, 100.0)));
        sizes.insert(NodeId(2), Some((50.0, 100.0)));

        let result = compute_layout(&style, &ids, &sizes, 200.0, 100.0);
        assert_eq!(result.children.len(), 2);
        assert_eq!(result.children[0].x, 0.0);
        assert_eq!(result.children[1].x, 50.0);
    }

    #[test]
    fn compute_flex_column_layout() {
        let style = LayoutStyle {
            direction: FlexDirection::Column,
            ..Default::default()
        };
        let ids = vec![NodeId(1), NodeId(2)];
        let mut sizes = HashMap::new();
        sizes.insert(NodeId(1), Some((100.0, 50.0)));
        sizes.insert(NodeId(2), Some((100.0, 50.0)));

        let result = compute_layout(&style, &ids, &sizes, 100.0, 200.0);
        assert_eq!(result.children.len(), 2);
        assert_eq!(result.children[0].y, 0.0);
        assert_eq!(result.children[1].y, 50.0);
    }

    #[test]
    fn compute_layout_with_gap() {
        let style = LayoutStyle {
            gap: 10.0,
            ..Default::default()
        };
        let ids = vec![NodeId(1), NodeId(2)];
        let mut sizes = HashMap::new();
        sizes.insert(NodeId(1), Some((40.0, 100.0)));
        sizes.insert(NodeId(2), Some((40.0, 100.0)));

        let result = compute_layout(&style, &ids, &sizes, 200.0, 100.0);
        assert_eq!(result.children.len(), 2);
        assert_eq!(result.children[0].x, 0.0);
        assert_eq!(result.children[1].x, 50.0);
    }

    #[test]
    fn validate_breakpoints_no_overlap() {
        let bps = vec![
            Breakpoint {
                id: "sm".into(),
                min_width: 0.0,
            },
            Breakpoint {
                id: "md".into(),
                min_width: 768.0,
            },
            Breakpoint {
                id: "lg".into(),
                min_width: 1280.0,
            },
        ];
        assert!(validate_breakpoints(&bps));
    }

    #[test]
    fn validate_breakpoints_overlap_detected() {
        let bps = vec![
            Breakpoint {
                id: "a".into(),
                min_width: 100.0,
            },
            Breakpoint {
                id: "b".into(),
                min_width: 100.0,
            },
        ];
        assert!(!validate_breakpoints(&bps));
    }

    #[test]
    fn validate_breakpoints_empty() {
        assert!(validate_breakpoints(&[]));
    }

    #[test]
    fn validate_breakpoints_single() {
        let bps = vec![Breakpoint {
            id: "a".into(),
            min_width: 0.0,
        }];
        assert!(validate_breakpoints(&bps));
    }

    #[test]
    fn compute_empty_children() {
        let style = LayoutStyle::default();
        let result = compute_layout(&style, &[], &HashMap::new(), 100.0, 100.0);
        assert!(result.children.is_empty());
    }
}
