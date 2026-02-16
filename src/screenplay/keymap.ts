/**
 * Custom ProseMirror keymap for structural screenplay edits.
 *
 * - Enter: insert a new dialogue block after the current block
 * - Backspace: delete empty block at cursor start
 * - Tab: cycle block type (dialogue → action → narration → command → dialogue)
 */

import { keymap } from "prosemirror-keymap";
import type { Plugin } from "prosemirror-state";
import type * as Y from "yjs";
import type { BlockType } from "../crdt/types.ts";
import {
  addBlock,
  deleteBlock,
  setBlockType,
} from "../crdt/mutations.ts";
import { findContaining } from "./idIndex.ts";

const BLOCK_TYPE_CYCLE: BlockType[] = [
  "dialogue",
  "action",
  "narration",
  "command",
];

export function createScreenplayKeymap(
  ydoc: Y.Doc,
  isSyncing: { current: boolean },
): Plugin {
  return keymap({
    Enter(state, dispatch) {
      const info = findContaining(state, state.selection.from);
      if (!info || info.type !== "block") return false;

      if (dispatch) {
        isSyncing.current = true;
        try {
          // Find the index of the current block in the CRDT scene
          const scenes = ydoc.getMap("story").get("scenes") as Y.Map<Y.Map<unknown>>;
          const yScene = scenes.get(info.sceneId);
          if (!yScene) return false;

          const yBlocks = yScene.get("blocks") as Y.Array<Y.Map<unknown>>;
          let blockIndex = -1;
          for (let i = 0; i < yBlocks.length; i++) {
            if (yBlocks.get(i).get("id") === info.id) {
              blockIndex = i;
              break;
            }
          }
          if (blockIndex === -1) return false;

          addBlock(
            ydoc,
            info.sceneId,
            { type: "dialogue", text: "" },
            blockIndex + 1,
          );
        } finally {
          isSyncing.current = false;
        }
      }
      return true;
    },

    Backspace(state, dispatch) {
      const { from } = state.selection;
      const info = findContaining(state, from);
      if (!info || info.type !== "block") return false;

      // Only handle if cursor is at the very start of the block text
      // and the block is empty
      if (info.textOffset !== 0) return false;

      // Check if the block text is empty
      const $from = state.doc.resolve(from);
      let blockNode = null;
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === "block") {
          blockNode = $from.node(depth);
          break;
        }
      }
      if (!blockNode) return false;

      // Block must be empty (paragraph with no text content)
      if (blockNode.textContent.length > 0) return false;

      if (dispatch) {
        isSyncing.current = true;
        try {
          deleteBlock(ydoc, info.sceneId, info.id);
        } finally {
          isSyncing.current = false;
        }
      }
      return true;
    },

    Tab(state, dispatch) {
      const info = findContaining(state, state.selection.from);
      if (!info || info.type !== "block") return false;

      if (dispatch) {
        // Find current block type from the PM node
        const $pos = state.doc.resolve(state.selection.from);
        let currentType: BlockType = "dialogue";
        for (let depth = $pos.depth; depth > 0; depth--) {
          if ($pos.node(depth).type.name === "block") {
            currentType = $pos.node(depth).attrs.blockType as BlockType;
            break;
          }
        }

        const idx = BLOCK_TYPE_CYCLE.indexOf(currentType);
        const nextType = BLOCK_TYPE_CYCLE[(idx + 1) % BLOCK_TYPE_CYCLE.length];

        isSyncing.current = true;
        try {
          setBlockType(ydoc, info.sceneId, info.id, nextType);
        } finally {
          isSyncing.current = false;
        }
      }
      return true;
    },
  });
}
