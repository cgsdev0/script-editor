/**
 * Core domain types for the narrative editor.
 * These are the plain TypeScript types that describe the semantic model.
 * The CRDT layer stores data matching these shapes using Yjs structured types.
 */

export type BlockType = "dialogue" | "action" | "narration" | "command";

export interface Block {
  id: string;
  type: BlockType;
  speaker?: string;
  text: string;
}

export interface Choice {
  id: string;
  text: string;
  target: string; // SceneID
  condition?: string;
  effects?: string[];
}

export interface Scene {
  id: string;
  blocks: Block[];
  choices: Choice[];
  autoTransition?: string; // SceneID
  metadata?: Record<string, unknown>;
}

export interface Story {
  scenes: Record<string, Scene>;
  entryScene: string; // SceneID
}
