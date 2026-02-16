/**
 * ProseMirror schema for the screenplay view.
 *
 * Structure:
 *   doc > scene(sceneId) > scene_heading | block | choice | scene_divider
 */

import { Schema } from "prosemirror-model";

export const screenplaySchema = new Schema({
  nodes: {
    doc: {
      content: "scene*",
    },

    scene: {
      attrs: { sceneId: { default: "" } },
      content: "scene_heading (block | choice)* scene_divider?",
      isolating: true,
      toDOM(node) {
        return ["div", { class: "sp-scene", "data-scene-id": node.attrs.sceneId }, 0];
      },
    },

    scene_heading: {
      attrs: { sceneId: { default: "" } },
      atom: true,
      toDOM(node) {
        return ["h2", { class: "sp-scene-heading" }, `SCENE: ${node.attrs.sceneId}`];
      },
    },

    block: {
      attrs: {
        blockId: { default: "" },
        blockType: { default: "dialogue" },
        speaker: { default: "" },
      },
      content: "paragraph",
      toDOM(node) {
        const attrs: Record<string, string> = {
          class: `sp-block sp-block--${node.attrs.blockType}`,
        };
        if (node.attrs.speaker) {
          attrs["data-speaker"] = node.attrs.speaker;
        }
        return ["div", attrs, 0];
      },
    },

    choice: {
      attrs: {
        choiceId: { default: "" },
        target: { default: "" },
      },
      content: "paragraph",
      toDOM() {
        return ["div", { class: "sp-choice" }, 0];
      },
    },

    scene_divider: {
      group: "block",
      atom: true,
      toDOM() {
        return ["hr", { class: "sp-divider" }];
      },
    },

    paragraph: {
      content: "text*",
      toDOM() {
        return ["p", 0];
      },
    },

    text: {
      inline: true,
    },
  },

  marks: {},
});
