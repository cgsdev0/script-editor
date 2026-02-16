/**
 * Undo Manager
 *
 * Per-client undo/redo using Yjs UndoManager.
 * Only undoes local changes — remote edits are never affected.
 */

import * as Y from "yjs";
import { getScenesMap } from "./schema.ts";

/**
 * Create an UndoManager tracking changes to the scenes map.
 * Each client should have its own UndoManager instance.
 *
 * The manager groups rapid changes into single undo steps
 * (default 500ms capture timeout).
 */
export function createUndoManager(
  doc: Y.Doc,
  opts?: { captureTimeout?: number }
): Y.UndoManager {
  const scenes = getScenesMap(doc);
  const manager = new Y.UndoManager(scenes, {
    captureTimeout: opts?.captureTimeout ?? 500,
  });
  return manager;
}

/** Undo the last local change. Returns false if nothing to undo. */
export function undo(manager: Y.UndoManager): boolean {
  if (manager.undoStack.length === 0) return false;
  manager.undo();
  return true;
}

/** Redo the last undone change. Returns false if nothing to redo. */
export function redo(manager: Y.UndoManager): boolean {
  if (manager.redoStack.length === 0) return false;
  manager.redo();
  return true;
}

/** Check if undo is available. */
export function canUndo(manager: Y.UndoManager): boolean {
  return manager.undoStack.length > 0;
}

/** Check if redo is available. */
export function canRedo(manager: Y.UndoManager): boolean {
  return manager.redoStack.length > 0;
}
