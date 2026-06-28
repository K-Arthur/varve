//! Component definitions with typed slots (mirror of `@strata/scene/component.ts`).
//!
//! A ComponentDefinition declares typed slots; an instance fills slots with
//! arbitrary local content while master edits to non-slot regions propagate
//! (the instance stays synced).
//!
//! Research basis: Figma variant/swap and Penpot slot models.

use crate::scene::NodeId;
use std::collections::HashMap;

/// What kind of content a slot accepts.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SlotKind {
    Single,
    Multiple,
    Text,
}

/// One typed slot in a component definition.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Slot {
    pub id: String,
    pub name: String,
    pub kind: SlotKind,
    /// Optional default content (NodeId of a node used as the default fill).
    #[serde(default)]
    pub default_content_id: Option<NodeId>,
}

/// A component definition — the template for creating instances.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ComponentDefinition {
    pub id: NodeId,
    pub name: String,
    pub slots: Vec<Slot>,
    /// Root of the master tree (the synchronized template).
    pub master_root_id: NodeId,
}

/// Whether `frame_slots` fills every slot declared by `component`.
///
/// Mirrors `@strata/scene` `slotsSatisfied()`: returns `true` when all
/// declared slots have a fill (or when there are no slots and no fills).
pub fn slots_satisfied(
    component: &ComponentDefinition,
    frame_slots: Option<&HashMap<String, NodeId>>,
) -> bool {
    match frame_slots {
        None => component.slots.is_empty(),
        Some(slots) => component.slots.iter().all(|s| slots.contains_key(&s.id)),
    }
}

/// Generate the next `NodeId` from a mutable counter.
///
/// Mirrors `@strata/scene` `IdGen.next()`.
pub fn create_node_id(next_id: &mut u64) -> NodeId {
    let id = NodeId(*next_id);
    *next_id += 1;
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_component(slots: Vec<Slot>) -> ComponentDefinition {
        ComponentDefinition {
            id: NodeId(1),
            name: "Test Comp".into(),
            slots,
            master_root_id: NodeId(10),
        }
    }

    fn make_slot(id: &str) -> Slot {
        Slot {
            id: id.into(),
            name: format!("Slot {id}"),
            kind: SlotKind::Single,
            default_content_id: None,
        }
    }

    #[test]
    fn slots_satisfied_all_filled() {
        let comp = make_component(vec![make_slot("a"), make_slot("b")]);
        let mut fills = HashMap::new();
        fills.insert("a".into(), NodeId(1));
        fills.insert("b".into(), NodeId(2));
        assert!(slots_satisfied(&comp, Some(&fills)));
    }

    #[test]
    fn slots_satisfied_missing_slot_returns_false() {
        let comp = make_component(vec![make_slot("a"), make_slot("b")]);
        let mut fills = HashMap::new();
        fills.insert("a".into(), NodeId(1));
        assert!(!slots_satisfied(&comp, Some(&fills)));
    }

    #[test]
    fn slots_satisfied_no_slots_no_fills() {
        let comp = make_component(vec![]);
        assert!(slots_satisfied(&comp, None));
    }

    #[test]
    fn slots_satisfied_no_slots_with_fills_returns_true() {
        let comp = make_component(vec![]);
        let fills = HashMap::new();
        assert!(slots_satisfied(&comp, Some(&fills)));
    }

    #[test]
    fn create_node_id_increments_counter() {
        let mut counter = 0;
        assert_eq!(create_node_id(&mut counter), NodeId(0));
        assert_eq!(create_node_id(&mut counter), NodeId(1));
        assert_eq!(create_node_id(&mut counter), NodeId(2));
        assert_eq!(counter, 3);
    }
}
