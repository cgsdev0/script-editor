/**
 * CRDT Schema Module
 *
 * Manages the Yjs document that serves as the single authoritative state
 * for the narrative graph. All views (screenplay, graph, export) are
 * projections of this data.
 *
 * Yjs structure:
 *   doc.getMap("story")
 *     "entryScene": string
 *     "scenes": Y.Map<Y.Map>    (SceneID → Scene map)
 *       scene.get("id"): string
 *       scene.get("blocks"): Y.Array<Y.Map>
 *         block.get("id"): string
 *         block.get("type"): BlockType
 *         block.get("speaker"): string | undefined
 *         block.get("text"): Y.Text
 *       scene.get("choices"): Y.Array<Y.Map>
 *         choice.get("id"): string
 *         choice.get("text"): Y.Text
 *         choice.get("target"): string (SceneID)
 *         choice.get("condition"): string | undefined
 *         choice.get("effects"): Y.Array<string>
 *       scene.get("autoTransition"): string | undefined
 *       scene.get("metadata"): Y.Map
 */

import * as Y from "yjs";
import type { Block, BlockType, Choice, Scene, Story } from "./types.ts";

// ── ID generation ──────────────────────────────────────────────────────

let idCounter = 0;

/** Generate a stable unique ID. Uses crypto.randomUUID when available. */
export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `id_${Date.now()}_${idCounter++}`;
}

// ── Yjs ↔ Plain object helpers ─────────────────────────────────────────

/** Create a Y.Map representing a Block */
export function createYBlock(block: Block): Y.Map<unknown> {
  const yBlock = new Y.Map<unknown>();
  yBlock.set("id", block.id);
  yBlock.set("type", block.type);
  if (block.speaker !== undefined) {
    yBlock.set("speaker", block.speaker);
  }
  const yText = new Y.Text(block.text);
  yBlock.set("text", yText);
  return yBlock;
}

/** Create a Y.Map representing a Choice */
export function createYChoice(choice: Choice): Y.Map<unknown> {
  const yChoice = new Y.Map<unknown>();
  yChoice.set("id", choice.id);
  const yText = new Y.Text(choice.text);
  yChoice.set("text", yText);
  yChoice.set("target", choice.target);
  if (choice.condition !== undefined) {
    yChoice.set("condition", choice.condition);
  }
  if (choice.effects !== undefined) {
    const yEffects = new Y.Array<string>();
    yEffects.insert(0, choice.effects);
    yChoice.set("effects", yEffects);
  }
  return yChoice;
}

/** Create a Y.Map representing a Scene */
export function createYScene(scene: Scene): Y.Map<unknown> {
  const yScene = new Y.Map<unknown>();
  yScene.set("id", scene.id);

  const yBlocks = new Y.Array<Y.Map<unknown>>();
  yBlocks.insert(0, scene.blocks.map(createYBlock));
  yScene.set("blocks", yBlocks);

  const yChoices = new Y.Array<Y.Map<unknown>>();
  yChoices.insert(0, scene.choices.map(createYChoice));
  yScene.set("choices", yChoices);

  if (scene.autoTransition !== undefined) {
    yScene.set("autoTransition", scene.autoTransition);
  }

  const yMetadata = new Y.Map<unknown>();
  if (scene.metadata) {
    for (const [k, v] of Object.entries(scene.metadata)) {
      yMetadata.set(k, v);
    }
  }
  yScene.set("metadata", yMetadata);

  return yScene;
}

/** Read a Y.Map Block back into a plain Block object */
export function readYBlock(yBlock: Y.Map<unknown>): Block {
  const block: Block = {
    id: yBlock.get("id") as string,
    type: yBlock.get("type") as BlockType,
    text: (yBlock.get("text") as Y.Text).toString(),
  };
  const speaker = yBlock.get("speaker") as string | undefined;
  if (speaker !== undefined) {
    block.speaker = speaker;
  }
  return block;
}

/** Read a Y.Map Choice back into a plain Choice object */
export function readYChoice(yChoice: Y.Map<unknown>): Choice {
  const choice: Choice = {
    id: yChoice.get("id") as string,
    text: (yChoice.get("text") as Y.Text).toString(),
    target: yChoice.get("target") as string,
  };
  const condition = yChoice.get("condition") as string | undefined;
  if (condition !== undefined) {
    choice.condition = condition;
  }
  const yEffects = yChoice.get("effects") as Y.Array<string> | undefined;
  if (yEffects && yEffects.length > 0) {
    choice.effects = yEffects.toArray();
  }
  return choice;
}

/** Read a Y.Map Scene back into a plain Scene object */
export function readYScene(yScene: Y.Map<unknown>): Scene {
  const yBlocks = yScene.get("blocks") as Y.Array<Y.Map<unknown>>;
  const yChoices = yScene.get("choices") as Y.Array<Y.Map<unknown>>;
  const yMetadata = yScene.get("metadata") as Y.Map<unknown> | undefined;

  const scene: Scene = {
    id: yScene.get("id") as string,
    blocks: yBlocks.toArray().map(readYBlock),
    choices: yChoices.toArray().map(readYChoice),
  };

  const autoTransition = yScene.get("autoTransition") as string | undefined;
  if (autoTransition !== undefined) {
    scene.autoTransition = autoTransition;
  }

  if (yMetadata && yMetadata.size > 0) {
    scene.metadata = Object.fromEntries(yMetadata.entries());
  }

  return scene;
}

// ── Document initialization ────────────────────────────────────────────

/** Get the top-level story map from a Y.Doc */
export function getStoryMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("story");
}

/** Get the layout map from a Y.Doc (node positions, viewport state) */
export function getLayoutMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("layout");
}

/** Get the positions sub-map from the layout map */
export function getPositionsMap(doc: Y.Doc): Y.Map<Y.Map<number>> {
  const layout = getLayoutMap(doc);
  return layout.get("positions") as Y.Map<Y.Map<number>>;
}

/** Get the scenes map from the story */
export function getScenesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  const story = getStoryMap(doc);
  return story.get("scenes") as Y.Map<Y.Map<unknown>>;
}

/**
 * Initialize a Y.Doc with the story structure.
 * If the doc already contains data (e.g. loaded from persistence), this is a no-op.
 */
export function initializeDoc(doc: Y.Doc): void {
  const story = getStoryMap(doc);
  if (story.get("scenes")) {
    return; // Already initialized (loaded from persistence or sync)
  }

  doc.transact(() => {
    story.set("scenes", new Y.Map<Y.Map<unknown>>());
    story.set("entryScene", "");
  });

  // Initialize layout map if not present
  const layout = getLayoutMap(doc);
  if (!layout.get("positions")) {
    doc.transact(() => {
      layout.set("positions", new Y.Map<Y.Map<number>>());
      layout.set("zoom", 1);
      layout.set("panX", 0);
      layout.set("panY", 0);
    });
  }
}

/** Read the full story as a plain object snapshot */
export function readStory(doc: Y.Doc): Story {
  const story = getStoryMap(doc);
  const scenesMap = story.get("scenes") as Y.Map<Y.Map<unknown>> | undefined;
  const scenes: Record<string, Scene> = {};

  if (scenesMap) {
    scenesMap.forEach((yScene, sceneId) => {
      scenes[sceneId] = readYScene(yScene);
    });
  }

  return {
    scenes,
    entryScene: (story.get("entryScene") as string) || "",
  };
}
