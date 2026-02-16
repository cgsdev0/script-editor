/**
 * Mutation API
 *
 * All views mutate the CRDT through this API — views never directly
 * mutate each other. Every function operates on the Y.Doc and wraps
 * changes in transactions for atomicity and undo grouping.
 */

import * as Y from "yjs";
import type { Block, BlockType, Choice } from "./types.ts";
import {
  generateId,
  getScenesMap,
  getStoryMap,
  createYScene,
  createYBlock,
  createYChoice,
} from "./schema.ts";

// ── Scene mutations ────────────────────────────────────────────────────

/** Create a new empty scene. Returns the scene ID. */
export function createScene(
  doc: Y.Doc,
  opts?: { id?: string; metadata?: Record<string, unknown> }
): string {
  const id = opts?.id ?? generateId();
  const scenes = getScenesMap(doc);

  doc.transact(() => {
    const yScene = createYScene({
      id,
      blocks: [],
      choices: [],
      metadata: opts?.metadata,
    });
    scenes.set(id, yScene);
  });

  return id;
}

/** Delete a scene by ID. */
export function deleteScene(doc: Y.Doc, sceneId: string): void {
  const scenes = getScenesMap(doc);
  doc.transact(() => {
    scenes.delete(sceneId);
  });
}

/** Rename a scene (change its key in the scenes map). */
export function renameScene(
  doc: Y.Doc,
  oldId: string,
  newId: string
): void {
  const scenes = getScenesMap(doc);
  const yScene = scenes.get(oldId);
  if (!yScene) return;

  doc.transact(() => {
    // Update the ID field inside the scene
    yScene.set("id", newId);
    // Move to new key
    scenes.set(newId, yScene);
    scenes.delete(oldId);

    // Update entry scene reference if needed
    const story = getStoryMap(doc);
    if (story.get("entryScene") === oldId) {
      story.set("entryScene", newId);
    }
  });
}

/** Set the entry scene for the story. */
export function setEntryScene(doc: Y.Doc, sceneId: string): void {
  const story = getStoryMap(doc);
  story.set("entryScene", sceneId);
}

/** Set or remove the auto-transition on a scene. */
export function setAutoTransition(
  doc: Y.Doc,
  sceneId: string,
  targetSceneId: string | undefined
): void {
  const scenes = getScenesMap(doc);
  const yScene = scenes.get(sceneId);
  if (!yScene) return;

  doc.transact(() => {
    if (targetSceneId !== undefined) {
      yScene.set("autoTransition", targetSceneId);
    } else {
      yScene.delete("autoTransition");
    }
  });
}

/** Set a metadata value on a scene. */
export function setSceneMetadata(
  doc: Y.Doc,
  sceneId: string,
  key: string,
  value: unknown
): void {
  const scenes = getScenesMap(doc);
  const yScene = scenes.get(sceneId);
  if (!yScene) return;

  const yMetadata = yScene.get("metadata") as Y.Map<unknown>;
  yMetadata.set(key, value);
}

// ── Block mutations ────────────────────────────────────────────────────

/** Add a block to a scene. Returns the block ID. */
export function addBlock(
  doc: Y.Doc,
  sceneId: string,
  block: Omit<Block, "id"> & { id?: string },
  index?: number
): string {
  const scenes = getScenesMap(doc);
  const yScene = scenes.get(sceneId);
  if (!yScene) throw new Error(`Scene not found: ${sceneId}`);

  const id = block.id ?? generateId();
  const yBlocks = yScene.get("blocks") as Y.Array<Y.Map<unknown>>;

  doc.transact(() => {
    const yBlock = createYBlock({ ...block, id });
    const insertAt = index ?? yBlocks.length;
    yBlocks.insert(insertAt, [yBlock]);
  });

  return id;
}

/** Delete a block by ID from a scene. */
export function deleteBlock(
  doc: Y.Doc,
  sceneId: string,
  blockId: string
): void {
  const scenes = getScenesMap(doc);
  const yScene = scenes.get(sceneId);
  if (!yScene) return;

  const yBlocks = yScene.get("blocks") as Y.Array<Y.Map<unknown>>;

  doc.transact(() => {
    for (let i = 0; i < yBlocks.length; i++) {
      const yBlock = yBlocks.get(i);
      if (yBlock.get("id") === blockId) {
        yBlocks.delete(i, 1);
        return;
      }
    }
  });
}

/** Reorder a block within its scene. */
export function moveBlock(
  doc: Y.Doc,
  sceneId: string,
  blockId: string,
  newIndex: number
): void {
  const scenes = getScenesMap(doc);
  const yScene = scenes.get(sceneId);
  if (!yScene) return;

  const yBlocks = yScene.get("blocks") as Y.Array<Y.Map<unknown>>;

  doc.transact(() => {
    let oldIndex = -1;
    for (let i = 0; i < yBlocks.length; i++) {
      if (yBlocks.get(i).get("id") === blockId) {
        oldIndex = i;
        break;
      }
    }
    if (oldIndex === -1 || oldIndex === newIndex) return;

    // Clone the Y.Map data, delete old, insert at new position
    const yBlock = yBlocks.get(oldIndex);
    const cloned = createYBlock({
      id: yBlock.get("id") as string,
      type: yBlock.get("type") as BlockType,
      speaker: yBlock.get("speaker") as string | undefined,
      text: (yBlock.get("text") as Y.Text).toString(),
    });

    yBlocks.delete(oldIndex, 1);
    const adjustedIndex = newIndex > oldIndex ? newIndex - 1 : newIndex;
    yBlocks.insert(adjustedIndex, [cloned]);
  });
}

/** Update a block's speaker. */
export function setBlockSpeaker(
  doc: Y.Doc,
  sceneId: string,
  blockId: string,
  speaker: string | undefined
): void {
  const yBlock = findBlock(doc, sceneId, blockId);
  if (!yBlock) return;

  doc.transact(() => {
    if (speaker !== undefined) {
      yBlock.set("speaker", speaker);
    } else {
      yBlock.delete("speaker");
    }
  });
}

/** Update a block's type. */
export function setBlockType(
  doc: Y.Doc,
  sceneId: string,
  blockId: string,
  type: BlockType
): void {
  const yBlock = findBlock(doc, sceneId, blockId);
  if (!yBlock) return;

  yBlock.set("type", type);
}

/**
 * Get the Y.Text for a block, for direct collaborative text editing.
 * Callers can use Y.Text APIs (insert, delete, format) for fine-grained edits.
 */
export function getBlockText(
  doc: Y.Doc,
  sceneId: string,
  blockId: string
): Y.Text | null {
  const yBlock = findBlock(doc, sceneId, blockId);
  if (!yBlock) return null;
  return yBlock.get("text") as Y.Text;
}

// ── Choice mutations ───────────────────────────────────────────────────

/** Add a choice to a scene. Returns the choice ID. */
export function addChoice(
  doc: Y.Doc,
  sceneId: string,
  choice: Omit<Choice, "id"> & { id?: string },
  index?: number
): string {
  const scenes = getScenesMap(doc);
  const yScene = scenes.get(sceneId);
  if (!yScene) throw new Error(`Scene not found: ${sceneId}`);

  const id = choice.id ?? generateId();
  const yChoices = yScene.get("choices") as Y.Array<Y.Map<unknown>>;

  doc.transact(() => {
    const yChoice = createYChoice({ ...choice, id });
    const insertAt = index ?? yChoices.length;
    yChoices.insert(insertAt, [yChoice]);
  });

  return id;
}

/** Delete a choice by ID from a scene. */
export function deleteChoice(
  doc: Y.Doc,
  sceneId: string,
  choiceId: string
): void {
  const scenes = getScenesMap(doc);
  const yScene = scenes.get(sceneId);
  if (!yScene) return;

  const yChoices = yScene.get("choices") as Y.Array<Y.Map<unknown>>;

  doc.transact(() => {
    for (let i = 0; i < yChoices.length; i++) {
      if (yChoices.get(i).get("id") === choiceId) {
        yChoices.delete(i, 1);
        return;
      }
    }
  });
}

/** Reorder a choice within its scene. */
export function moveChoice(
  doc: Y.Doc,
  sceneId: string,
  choiceId: string,
  newIndex: number
): void {
  const scenes = getScenesMap(doc);
  const yScene = scenes.get(sceneId);
  if (!yScene) return;

  const yChoices = yScene.get("choices") as Y.Array<Y.Map<unknown>>;

  doc.transact(() => {
    let oldIndex = -1;
    for (let i = 0; i < yChoices.length; i++) {
      if (yChoices.get(i).get("id") === choiceId) {
        oldIndex = i;
        break;
      }
    }
    if (oldIndex === -1 || oldIndex === newIndex) return;

    const yChoice = yChoices.get(oldIndex);
    const cloned = createYChoice({
      id: yChoice.get("id") as string,
      text: (yChoice.get("text") as Y.Text).toString(),
      target: yChoice.get("target") as string,
      condition: yChoice.get("condition") as string | undefined,
      effects: (yChoice.get("effects") as Y.Array<string> | undefined)?.toArray(),
    });

    yChoices.delete(oldIndex, 1);
    const adjustedIndex = newIndex > oldIndex ? newIndex - 1 : newIndex;
    yChoices.insert(adjustedIndex, [cloned]);
  });
}

/** Update a choice's target scene. */
export function setChoiceTarget(
  doc: Y.Doc,
  sceneId: string,
  choiceId: string,
  target: string
): void {
  const yChoice = findChoice(doc, sceneId, choiceId);
  if (!yChoice) return;

  yChoice.set("target", target);
}

/** Update a choice's condition expression. */
export function setChoiceCondition(
  doc: Y.Doc,
  sceneId: string,
  choiceId: string,
  condition: string | undefined
): void {
  const yChoice = findChoice(doc, sceneId, choiceId);
  if (!yChoice) return;

  doc.transact(() => {
    if (condition !== undefined) {
      yChoice.set("condition", condition);
    } else {
      yChoice.delete("condition");
    }
  });
}

/** Set the effects list on a choice. */
export function setChoiceEffects(
  doc: Y.Doc,
  sceneId: string,
  choiceId: string,
  effects: string[]
): void {
  const yChoice = findChoice(doc, sceneId, choiceId);
  if (!yChoice) return;

  doc.transact(() => {
    const yEffects = new Y.Array<string>();
    yEffects.insert(0, effects);
    yChoice.set("effects", yEffects);
  });
}

/**
 * Get the Y.Text for a choice, for direct collaborative text editing.
 */
export function getChoiceText(
  doc: Y.Doc,
  sceneId: string,
  choiceId: string
): Y.Text | null {
  const yChoice = findChoice(doc, sceneId, choiceId);
  if (!yChoice) return null;
  return yChoice.get("text") as Y.Text;
}

// ── Internal helpers ───────────────────────────────────────────────────

function findBlock(
  doc: Y.Doc,
  sceneId: string,
  blockId: string
): Y.Map<unknown> | null {
  const scenes = getScenesMap(doc);
  const yScene = scenes.get(sceneId);
  if (!yScene) return null;

  const yBlocks = yScene.get("blocks") as Y.Array<Y.Map<unknown>>;
  for (let i = 0; i < yBlocks.length; i++) {
    const yBlock = yBlocks.get(i);
    if (yBlock.get("id") === blockId) return yBlock;
  }
  return null;
}

function findChoice(
  doc: Y.Doc,
  sceneId: string,
  choiceId: string
): Y.Map<unknown> | null {
  const scenes = getScenesMap(doc);
  const yScene = scenes.get(sceneId);
  if (!yScene) return null;

  const yChoices = yScene.get("choices") as Y.Array<Y.Map<unknown>>;
  for (let i = 0; i < yChoices.length; i++) {
    const yChoice = yChoices.get(i);
    if (yChoice.get("id") === choiceId) return yChoice;
  }
  return null;
}
