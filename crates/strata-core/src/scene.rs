//! Scene graph node + hit-testing in world space.
//!
//! A `SceneNode` carries a local-space `Shape` plus an `Affine` transform that
//! maps local into its parent's space (composed up to world for hit-testing).
//! For the first pass, the scene is a flat ordered list (paint order); nesting
//! + slots land in task 0.8/1.1.

use crate::geom::Affine;
use crate::shape::Shape;
use kurbo::Point;

/// Stable node identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct NodeId(pub u64);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SceneNode {
    pub id: NodeId,
    pub name: String,
    pub transform: Affine,
    pub shape: Shape,
    /// RGBA fill, 0-255 per channel.
    pub fill: [u8; 4],
}

/// Find the topmost node (highest paint-order index) whose shape contains the
/// world-space `pt`. Returns its index in `nodes`, or `None`.
///
/// Nodes are assumed to be in paint order (index 0 painted first / bottom).
pub fn hit_test(nodes: &[SceneNode], world: Point) -> Option<usize> {
    for (i, node) in nodes.iter().enumerate().rev() {
        let local = node.transform.inverse() * world;
        if node.shape.contains(local) {
            return Some(i);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::{Circle, Rect};
    use kurbo::Affine;

    fn node(id: u64, shape: Shape, translate: (f64, f64)) -> SceneNode {
        SceneNode {
            id: NodeId(id),
            name: format!("node-{id}"),
            transform: Affine::translate(translate),
            shape,
            fill: [57, 208, 198, 255],
        }
    }

    #[test]
    fn hits_topmost_when_overlapping() {
        let nodes = vec![
            node(1, Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)), (0.0, 0.0)),
            node(2, Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)), (2.0, 2.0)),
        ];
        // Point inside both -> topmost (node 2 at index 1).
        assert_eq!(hit_test(&nodes, Point::new(5.0, 5.0)), Some(1));
    }

    #[test]
    fn hits_only_node_containing_point() {
        let nodes = vec![
            node(1, Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)), (0.0, 0.0)),
            node(
                2,
                Shape::Circle(Circle::new(Point::new(0.0, 0.0), 3.0)),
                (50.0, 50.0),
            ),
        ];
        assert_eq!(hit_test(&nodes, Point::new(5.0, 5.0)), Some(0));
        assert_eq!(hit_test(&nodes, Point::new(50.0, 50.0)), Some(1));
        assert_eq!(hit_test(&nodes, Point::new(99.0, 99.0)), None);
    }

    #[test]
    fn respects_transforms() {
        // A rect scaled 2x at origin: local 0..5 -> world 0..10.
        let node = SceneNode {
            id: NodeId(1),
            name: "scaled".into(),
            transform: Affine::scale(2.0),
            shape: Shape::Rect(Rect::new(0.0, 0.0, 5.0, 5.0)),
            fill: [57, 208, 198, 255],
        };
        assert_eq!(hit_test(&[node], Point::new(9.0, 9.0)), Some(0));
    }

    #[test]
    fn empty_scene_misses() {
        assert_eq!(hit_test(&[], Point::new(0.0, 0.0)), None);
    }
}
