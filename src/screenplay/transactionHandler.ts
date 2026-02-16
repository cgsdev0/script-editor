/**
 * ProseMirror dispatchTransaction handler that syncs text edits
 * back to the CRDT.
 *
 * When a PM transaction changes document content, this handler:
 * 1. Applies the transaction to get the new PM state
 * 2. Compares old/new text for each changed block/choice
 * 3. Applies minimal Y.Text diffs to the CRDT
 */

import type { Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type * as Y from "yjs";
import { getBlockText, getChoiceText } from "../crdt/mutations.ts";
import { applyTextDiff } from "./textSync.ts";
import { idIndexKey, type IdIndexState } from "./idIndex.ts";

export function createTransactionHandler(
  ydoc: Y.Doc,
  viewRef: { current: EditorView | null },
  isSyncing: { current: boolean },
) {
  return (tr: Transaction) => {
    const view = viewRef.current;
    if (!view) return;

    const oldState = view.state;
    const newState = oldState.apply(tr);

    if (tr.docChanged && !isSyncing.current) {
      isSyncing.current = true;
      try {
        ydoc.transact(() => {
          syncChangedNodes(ydoc, oldState.doc, newState.doc, oldState, newState);
        });
      } finally {
        isSyncing.current = false;
      }
    }

    view.updateState(newState);
  };
}

/**
 * Walk both old and new PM docs, find blocks/choices whose text changed,
 * and apply diffs to the corresponding Y.Text instances.
 */
function syncChangedNodes(
  ydoc: Y.Doc,
  oldDoc: import("prosemirror-model").Node,
  newDoc: import("prosemirror-model").Node,
  oldState: import("prosemirror-state").EditorState,
  newState: import("prosemirror-state").EditorState,
): void {
  // Build a map of id → text content from the old doc
  const oldTexts = new Map<string, { text: string; sceneId: string; type: "block" | "choice" }>();
  gatherTexts(oldDoc, oldTexts);

  // Build a map of id → text content from the new doc
  const newTexts = new Map<string, { text: string; sceneId: string; type: "block" | "choice" }>();
  gatherTexts(newDoc, newTexts);

  // Diff and apply
  for (const [id, newEntry] of newTexts) {
    const oldEntry = oldTexts.get(id);
    if (!oldEntry) continue; // New node — handled by structural commands
    if (oldEntry.text === newEntry.text) continue;

    let yText: Y.Text | null = null;
    if (newEntry.type === "block") {
      yText = getBlockText(ydoc, newEntry.sceneId, id);
    } else {
      yText = getChoiceText(ydoc, newEntry.sceneId, id);
    }

    if (yText) {
      applyTextDiff(yText, oldEntry.text, newEntry.text);
    }
  }
}

/**
 * Walk a PM doc and collect text content for every block and choice node.
 */
function gatherTexts(
  doc: import("prosemirror-model").Node,
  out: Map<string, { text: string; sceneId: string; type: "block" | "choice" }>,
): void {
  doc.descendants((node, _pos, parent) => {
    if (node.type.name === "block" && node.attrs.blockId) {
      const sceneId = parent?.attrs?.sceneId ?? "";
      out.set(node.attrs.blockId as string, {
        text: node.textContent,
        sceneId,
        type: "block",
      });
    } else if (node.type.name === "choice" && node.attrs.choiceId) {
      const sceneId = parent?.attrs?.sceneId ?? "";
      out.set(node.attrs.choiceId as string, {
        text: node.textContent,
        sceneId,
        type: "choice",
      });
    }
  });
}
