//! Scene graph node + hit-testing in world space.
//!
//! A `SceneNode` carries a local-space `Shape` plus an `Affine` transform that
//! maps local into its parent's space (composed up to world for hit-testing).
//! Frame nodes carry optional `children`, `component_id`, and `slots` for the
//! Component Slots model (Task 1.1).

use crate::geom::Affine;
use crate::shape::Shape;
use kurbo::Point;
use std::collections::{HashMap, HashSet};

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
    /// Child node IDs in paint order (frame nodes only).
    #[serde(default)]
    pub children: Vec<NodeId>,
    /// If this frame is a component instance, the component ID.
    #[serde(default)]
    pub component_id: Option<NodeId>,
    /// Slot fills: slot_id -> child NodeId.
    #[serde(default)]
    pub slots: Option<HashMap<String, NodeId>>,
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

/// Walk all nodes in DFS paint order, yielding `(node_id, node, parent_id)`.
/// Root-level nodes have `parent_id = None`. Frame children are visited
/// recursively. Cycles are detected and terminated.
pub fn walk_nodes(nodes: &[SceneNode]) -> Vec<(NodeId, &SceneNode, Option<NodeId>)> {
    let map: HashMap<NodeId, &SceneNode> = nodes.iter().map(|n| (n.id, n)).collect();
    // Exclude self-references so a self-referencing node is still treated as
    // a root (the DFS `visited` set below terminates the cycle).
    let children_set: HashSet<NodeId> = nodes
        .iter()
        .flat_map(|n| n.children.iter().filter(move |c| **c != n.id).copied())
        .collect();
    let mut result = Vec::with_capacity(nodes.len());
    let mut visited = HashSet::new();

    for node in nodes {
        if !children_set.contains(&node.id) {
            walk_node_dfs(&map, node, None, &mut visited, &mut result);
        }
    }

    result
}

fn walk_node_dfs<'a>(
    map: &HashMap<NodeId, &'a SceneNode>,
    node: &'a SceneNode,
    parent_id: Option<NodeId>,
    visited: &mut HashSet<NodeId>,
    result: &mut Vec<(NodeId, &'a SceneNode, Option<NodeId>)>,
) {
    if !visited.insert(node.id) {
        return;
    }
    result.push((node.id, node, parent_id));
    for child_id in &node.children {
        if let Some(child) = map.get(child_id) {
            walk_node_dfs(map, child, Some(node.id), visited, result);
        }
    }
}

/// Find the parent frame that contains the node with the given ID.
/// Returns `None` for root-level nodes or nodes not present.
pub fn get_parent(nodes: &[SceneNode], id: NodeId) -> Option<NodeId> {
    nodes.iter().find_map(|n| {
        if n.children.contains(&id) {
            Some(n.id)
        } else {
            None
        }
    })
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
            children: Vec::new(),
            component_id: None,
            slots: None,
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
            children: Vec::new(),
            component_id: None,
            slots: None,
        };
        assert_eq!(hit_test(&[node], Point::new(9.0, 9.0)), Some(0));
    }

    #[test]
    fn empty_scene_misses() {
        assert_eq!(hit_test(&[], Point::new(0.0, 0.0)), None);
    }

    #[test]
    fn walk_nodes_flat_scene() {
        let nodes = vec![
            node(1, Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)), (0.0, 0.0)),
            node(2, Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)), (5.0, 5.0)),
        ];
        let walked = walk_nodes(&nodes);
        assert_eq!(walked.len(), 2);
        assert_eq!(walked[0].0, NodeId(1));
        assert_eq!(walked[0].2, None);
        assert_eq!(walked[1].0, NodeId(2));
        assert_eq!(walked[1].2, None);
    }

    #[test]
    fn walk_nodes_nested_frames() {
        let nodes = vec![
            SceneNode {
                id: NodeId(1),
                name: "frame".into(),
                transform: Affine::translate((0.0, 0.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 100.0, 100.0)),
                fill: [200, 200, 200, 255],
                children: vec![NodeId(2), NodeId(3)],
                component_id: None,
                slots: None,
            },
            SceneNode {
                id: NodeId(2),
                name: "child1".into(),
                transform: Affine::translate((10.0, 10.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 20.0, 20.0)),
                fill: [255, 0, 0, 255],
                children: Vec::new(),
                component_id: None,
                slots: None,
            },
            SceneNode {
                id: NodeId(3),
                name: "child2".into(),
                transform: Affine::translate((20.0, 20.0)),
                shape: Shape::Circle(Circle::new(Point::new(0.0, 0.0), 5.0)),
                fill: [0, 255, 0, 255],
                children: Vec::new(),
                component_id: None,
                slots: None,
            },
            SceneNode {
                id: NodeId(4),
                name: "root-shape".into(),
                transform: Affine::translate((100.0, 100.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 50.0, 50.0)),
                fill: [57, 208, 198, 255],
                children: Vec::new(),
                component_id: None,
                slots: None,
            },
        ];
        let walked = walk_nodes(&nodes);
        // DFS order: frame(1), child1(2), child2(3), root-shape(4)
        assert_eq!(walked.len(), 4);
        assert_eq!(walked[0].0, NodeId(1));
        assert_eq!(walked[0].2, None);

        assert_eq!(walked[1].0, NodeId(2));
        assert_eq!(walked[1].2, Some(NodeId(1)));

        assert_eq!(walked[2].0, NodeId(3));
        assert_eq!(walked[2].2, Some(NodeId(1)));

        assert_eq!(walked[3].0, NodeId(4));
        assert_eq!(walked[3].2, None);
    }

    #[test]
    fn walk_nodes_empty_yields_empty() {
        assert!(walk_nodes(&[]).is_empty());
    }

    #[test]
    fn walk_nodes_cycles_terminate() {
        // Self-referencing frame: children contains own ID.
        let nodes = vec![SceneNode {
            id: NodeId(1),
            name: "self-cycle".into(),
            transform: Affine::translate((0.0, 0.0)),
            shape: Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)),
            fill: [57, 208, 198, 255],
            children: vec![NodeId(1)],
            component_id: None,
            slots: None,
        }];
        let walked = walk_nodes(&nodes);
        assert_eq!(walked.len(), 1);
        assert_eq!(walked[0].0, NodeId(1));
    }

    #[test]
    fn get_parent_finds_containing_frame() {
        let nodes = vec![
            SceneNode {
                id: NodeId(1),
                name: "frame".into(),
                transform: Affine::translate((0.0, 0.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 100.0, 100.0)),
                fill: [200, 200, 200, 255],
                children: vec![NodeId(2)],
                component_id: None,
                slots: None,
            },
            SceneNode {
                id: NodeId(2),
                name: "child".into(),
                transform: Affine::translate((10.0, 10.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 20.0, 20.0)),
                fill: [255, 0, 0, 255],
                children: Vec::new(),
                component_id: None,
                slots: None,
            },
            SceneNode {
                id: NodeId(3),
                name: "root".into(),
                transform: Affine::translate((50.0, 50.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)),
                fill: [57, 208, 198, 255],
                children: Vec::new(),
                component_id: None,
                slots: None,
            },
        ];
        assert_eq!(get_parent(&nodes, NodeId(2)), Some(NodeId(1)));
        assert_eq!(get_parent(&nodes, NodeId(3)), None);
        assert_eq!(get_parent(&nodes, NodeId(99)), None);
    }
}
