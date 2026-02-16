/**
 * ProseMirror plugin that builds an index from scene/block/choice IDs
 * to document positions. Rebuilt on every doc change.
 */

import { Plugin, PluginKey, type EditorState } from "prosemirror-state";

export interface IdIndexState {
  scenes: Map<string, { from: number; to: number }>;
  blocks: Map<string, { from: number; to: number }>;
  choices: Map<string, { from: number; to: number }>;
}

export const idIndexKey = new PluginKey<IdIndexState>("idIndex");

function buildIndex(doc: import("prosemirror-model").Node): IdIndexState {
  const scenes = new Map<string, { from: number; to: number }>();
  const blocks = new Map<string, { from: number; to: number }>();
  const choices = new Map<string, { from: number; to: number }>();

  doc.descendants((node, pos) => {
    if (node.type.name === "scene" && node.attrs.sceneId) {
      scenes.set(node.attrs.sceneId, { from: pos, to: pos + node.nodeSize });
    } else if (node.type.name === "block" && node.attrs.blockId) {
      blocks.set(node.attrs.blockId, { from: pos, to: pos + node.nodeSize });
    } else if (node.type.name === "choice" && node.attrs.choiceId) {
      choices.set(node.attrs.choiceId, { from: pos, to: pos + node.nodeSize });
    }
  });

  return { scenes, blocks, choices };
}

export interface ContainingElement {
  type: "block" | "choice";
  sceneId: string;
  id: string;
  textOffset: number;
}

/**
 * Map a PM cursor position to the containing CRDT block or choice.
 * Returns null if the position is not inside a block or choice
 * (e.g. inside a scene_heading or scene_divider).
 */
export function findContaining(
  state: EditorState,
  pos: number,
): ContainingElement | null {
  const $pos = state.doc.resolve(pos);

  // Walk up the node tree to find a block or choice
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    const parentNode = depth > 1 ? $pos.node(depth - 1) : null;

    if (node.type.name === "block" || node.type.name === "choice") {
      // Find the scene ancestor
      let sceneId = "";
      for (let d = depth - 1; d > 0; d--) {
        const ancestor = $pos.node(d);
        if (ancestor.type.name === "scene") {
          sceneId = ancestor.attrs.sceneId as string;
          break;
        }
      }
      // Also check the immediate parent
      if (!sceneId && parentNode?.type.name === "scene") {
        sceneId = parentNode.attrs.sceneId as string;
      }

      const nodeStart = $pos.start(depth); // start of node content
      const textOffset = pos - nodeStart;

      // The block/choice contains a paragraph which contains text.
      // textOffset here is relative to the block node content start.
      // We need the offset within the text itself.
      // Block content: <paragraph><text...></paragraph>
      // nodeStart points to start of block content, which is before the paragraph.
      // paragraph start = nodeStart + 1 (entering paragraph)
      // text start = nodeStart + 1 (paragraph has no wrapper around inline content beyond the open tag)
      // So text offset = pos - (nodeStart + 1), clamped to >= 0
      const innerTextOffset = Math.max(0, pos - nodeStart - 1);

      return {
        type: node.type.name as "block" | "choice",
        sceneId,
        id:
          node.type.name === "block"
            ? (node.attrs.blockId as string)
            : (node.attrs.choiceId as string),
        textOffset: innerTextOffset,
      };
    }
  }

  return null;
}

export function createIdIndexPlugin(): Plugin {
  return new Plugin({
    key: idIndexKey,
    state: {
      init(_, state) {
        return buildIndex(state.doc);
      },
      apply(tr, value) {
        if (tr.docChanged) {
          return buildIndex(tr.doc);
        }
        return value;
      },
    },
  });
}
