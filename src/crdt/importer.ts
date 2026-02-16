/**
 * Legacy Schema Importer
 *
 * Converts the flat node graph from schema.ts into the CRDT scene model.
 * Each legacy node becomes one scene, preserving the graph topology exactly.
 *
 * Mapping:
 *   legacy node key     → scene ID
 *   char + text         → dialogue block (speaker + text)
 *   next                → scene.autoTransition
 *   input[]             → scene.choices[]
 *   input[].next        → choice.target
 *   input[].cond        → choice.condition
 *   input[].effect      → choice.effects
 *   extra properties    → scene/block/choice metadata
 */

import * as Y from "yjs";
import type { Block, Choice, Scene } from "./types.ts";
import { initializeDoc, getScenesMap, createYScene } from "./schema.ts";
import { generateId } from "./schema.ts";

// ── Legacy type definitions ────────────────────────────────────────────

interface LegacyTextObject {
  text?: string;
  trigger?: string;
  look_at?: string;
  camera?: string;
  laser?: string;
  stall?: number;
  animation?: string;
}

type LegacyTextEntry = string | LegacyTextObject;

interface LegacyInput {
  text: string;
  next?: string;
  effect?: string | string[];
  cond?: string;
  once?: boolean;
  trigger?: string;
  look_at?: string;
  camera?: string;
  locks?: boolean;
  soft_once?: boolean;
  always?: boolean;
  last_input?: string;
}

interface LegacyNode {
  char?: string;
  text?: LegacyTextEntry[] | string;
  next?: string;
  input?: LegacyInput[];
  delay?: number;
  trigger?: string;
  look_at?: string;
  camera?: string;
  lights?: { time?: number; delay?: number };
  randomize?: boolean;
  unskippable?: boolean;
}

type LegacyLines = Record<string, LegacyNode>;

// ── Conversion helpers ─────────────────────────────────────────────────

/** Flatten legacy text entries into a single plain string for the block text */
function flattenText(
  text: LegacyTextEntry[] | string | undefined
): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;

  return text
    .map((entry) => {
      if (typeof entry === "string") return entry;
      return entry.text ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Extract text-level metadata (triggers, animations, etc.) from rich text entries */
function extractTextMetadata(
  text: LegacyTextEntry[] | string | undefined
): Record<string, unknown> | undefined {
  if (text === undefined || typeof text === "string") return undefined;

  const richEntries: LegacyTextObject[] = [];
  text.forEach((entry, index) => {
    if (typeof entry !== "string") {
      richEntries.push({ ...entry, text: undefined });
      // Clean: only keep if there's something beyond text
      const { text: _t, ...rest } = entry;
      if (Object.keys(rest).length > 0) {
        richEntries[richEntries.length - 1] = { ...rest, text: `[${index}]` };
      }
    }
  });

  if (richEntries.length === 0) return undefined;
  return { textDirectives: richEntries };
}

/** Convert a legacy node to a Scene */
function convertNode(nodeId: string, node: LegacyNode): Scene {
  const blocks: Block[] = [];
  const choices: Choice[] = [];
  const metadata: Record<string, unknown> = {};

  // Build dialogue block if the node has text or a character
  if (node.text !== undefined || node.char !== undefined) {
    const block: Block = {
      id: generateId(),
      type: "dialogue",
      text: flattenText(node.text),
    };
    if (node.char) {
      block.speaker = node.char;
    }
    blocks.push(block);

    // Store text-level metadata (triggers embedded in text objects)
    const textMeta = extractTextMetadata(node.text);
    if (textMeta) {
      metadata.textDirectives = textMeta.textDirectives;
    }
  }

  // Convert input choices
  if (node.input) {
    for (const input of node.input) {
      const choice: Choice = {
        id: generateId(),
        text: input.text,
        target: input.next ?? "",
      };
      if (input.cond) {
        choice.condition = input.cond;
      }
      if (input.effect) {
        choice.effects = Array.isArray(input.effect)
          ? input.effect
          : [input.effect];
      }

      // Store choice-level metadata for properties not in the core model
      const choiceMeta: Record<string, unknown> = {};
      if (input.once) choiceMeta.once = true;
      if (input.trigger) choiceMeta.trigger = input.trigger;
      if (input.look_at) choiceMeta.look_at = input.look_at;
      if (input.camera) choiceMeta.camera = input.camera;
      if (input.locks) choiceMeta.locks = true;
      if (input.soft_once) choiceMeta.soft_once = true;
      if (input.always) choiceMeta.always = true;
      if (input.last_input) choiceMeta.last_input = input.last_input;

      if (Object.keys(choiceMeta).length > 0) {
        // Store per-choice metadata keyed by choice ID in scene metadata
        if (!metadata.choiceMeta) metadata.choiceMeta = {};
        (metadata.choiceMeta as Record<string, unknown>)[choice.id] =
          choiceMeta;
      }

      choices.push(choice);
    }
  }

  // Node-level presentation metadata
  if (node.delay !== undefined) metadata.delay = node.delay;
  if (node.trigger) metadata.trigger = node.trigger;
  if (node.look_at) metadata.look_at = node.look_at;
  if (node.camera) metadata.camera = node.camera;
  if (node.lights) metadata.lights = node.lights;
  if (node.randomize) metadata.randomize = true;
  if (node.unskippable) metadata.unskippable = true;

  const scene: Scene = {
    id: nodeId,
    blocks,
    choices,
  };

  if (node.next) {
    scene.autoTransition = node.next;
  }

  if (Object.keys(metadata).length > 0) {
    scene.metadata = metadata;
  }

  return scene;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Import legacy lines data into a Y.Doc.
 * Each node in the flat graph becomes a scene in the CRDT model.
 * Returns the list of entry point scene IDs (scenes with no incoming references).
 */
export function importLegacyLines(
  doc: Y.Doc,
  lines: LegacyLines
): string[] {
  initializeDoc(doc);
  const scenes = getScenesMap(doc);

  // Find entry points (nodes not referenced by any next/input.next)
  const referenced = new Set<string>();
  for (const node of Object.values(lines)) {
    if (node.next) referenced.add(node.next);
    if (node.input) {
      for (const input of node.input) {
        if (input.next) referenced.add(input.next);
      }
    }
  }
  const entryPoints = Object.keys(lines).filter((k) => !referenced.has(k));

  doc.transact(() => {
    for (const [nodeId, node] of Object.entries(lines)) {
      const scene = convertNode(nodeId, node);
      scenes.set(nodeId, createYScene(scene));
    }

    // Set entry scene to the first entrypoint
    if (entryPoints.length > 0) {
      const story = doc.getMap("story");
      story.set("entryScene", entryPoints[0]);
    }
  });

  return entryPoints;
}
