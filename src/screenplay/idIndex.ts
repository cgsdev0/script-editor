/**
 * ProseMirror plugin that builds an index from scene/block/choice IDs
 * to document positions. Rebuilt on every doc change.
 */

import { Plugin, PluginKey } from "prosemirror-state";

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
