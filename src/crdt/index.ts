/**
 * CRDT Core — Public API
 *
 * This is the single entry point for the CRDT layer.
 * All views import from here to interact with the semantic model.
 */

export type { Block, BlockType, Choice, Scene, Story } from "./types.ts";

// Schema & document
export {
  generateId,
  initializeDoc,
  getStoryMap,
  getScenesMap,
  readStory,
  readYScene,
  readYBlock,
  readYChoice,
  createYScene,
  createYBlock,
  createYChoice,
} from "./schema.ts";

// Mutation API
export {
  createScene,
  deleteScene,
  renameScene,
  setEntryScene,
  setAutoTransition,
  setSceneMetadata,
  addBlock,
  deleteBlock,
  moveBlock,
  setBlockSpeaker,
  setBlockType,
  getBlockText,
  addChoice,
  deleteChoice,
  moveChoice,
  setChoiceTarget,
  setChoiceCondition,
  setChoiceEffects,
  getChoiceText,
} from "./mutations.ts";

// Persistence
export { attachPersistence, waitForSync } from "./persistence.ts";

// Sync
export { attachSync, setAwareness, onAwarenessChange } from "./sync.ts";
export type { SyncOptions } from "./sync.ts";

// Undo
export {
  createUndoManager,
  undo,
  redo,
  canUndo,
  canRedo,
} from "./undo.ts";

// Importer
export { importLegacyLines } from "./importer.ts";
