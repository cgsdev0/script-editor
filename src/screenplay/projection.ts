/**
 * Projects the CRDT story snapshot into a ProseMirror document.
 */

import type * as Y from "yjs";
import { type Node as PMNode } from "prosemirror-model";
import { screenplaySchema } from "./schema.ts";
import { computeSceneOrder } from "./sceneOrdering.ts";
import { readStory } from "../crdt/index.ts";

export function projectStoryToDoc(doc: Y.Doc): PMNode {
  const story = readStory(doc);
  const sceneOrder = computeSceneOrder(story);

  const sceneNodes: PMNode[] = [];

  for (const sceneId of sceneOrder) {
    const scene = story.scenes[sceneId];
    if (!scene) continue;

    const children: PMNode[] = [];

    // Scene heading
    children.push(
      screenplaySchema.node("scene_heading", { sceneId: scene.id }),
    );

    // Blocks
    for (const block of scene.blocks) {
      const textNode = block.text
        ? screenplaySchema.text(block.text)
        : null;
      const paragraph = screenplaySchema.node(
        "paragraph",
        null,
        textNode ? [textNode] : [],
      );
      children.push(
        screenplaySchema.node(
          "block",
          {
            blockId: block.id,
            blockType: block.type,
            speaker: block.speaker || "",
          },
          [paragraph],
        ),
      );
    }

    // Choices
    for (const choice of scene.choices) {
      const textNode = choice.text
        ? screenplaySchema.text(choice.text)
        : null;
      const paragraph = screenplaySchema.node(
        "paragraph",
        null,
        textNode ? [textNode] : [],
      );
      children.push(
        screenplaySchema.node(
          "choice",
          { choiceId: choice.id, target: choice.target },
          [paragraph],
        ),
      );
    }

    // Divider
    children.push(screenplaySchema.node("scene_divider"));

    sceneNodes.push(
      screenplaySchema.node("scene", { sceneId: scene.id }, children),
    );
  }

  return screenplaySchema.node("doc", null, sceneNodes);
}
