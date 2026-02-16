/**
 * ScreenplayView — React wrapper that mounts an editable ProseMirror editor
 * and keeps it in two-way sync with the CRDT document.
 *
 * Local PM edits → CRDT mutations (via transactionHandler)
 * CRDT changes (from graph editor / remote) → PM doc rebuild (cursor-preserving)
 */

import { useEffect, useRef } from "react";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import type * as Y from "yjs";
import { screenplaySchema } from "./schema.ts";
import { projectStoryToDoc } from "./projection.ts";
import { createIdIndexPlugin, findContaining, idIndexKey } from "./idIndex.ts";
import { createScreenplayKeymap } from "./keymap.ts";
import { createTransactionHandler } from "./transactionHandler.ts";
import { getScenesMap } from "../crdt/index.ts";
import "./styles.css";

export default function ScreenplayView({ doc }: { doc: Y.Doc }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isSyncing = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Build initial PM doc from CRDT
    const pmDoc = projectStoryToDoc(doc);

    const state = EditorState.create({
      doc: pmDoc,
      schema: screenplaySchema,
      plugins: [
        createScreenplayKeymap(doc, isSyncing),
        keymap(baseKeymap),
        createIdIndexPlugin(),
      ],
    });

    const dispatchTransaction = createTransactionHandler(doc, viewRef, isSyncing);

    const view = new EditorView(containerRef.current, {
      state,
      dispatchTransaction,
    });
    viewRef.current = view;

    // Observe CRDT changes and rebuild PM doc (cursor-preserving)
    const scenesMap = getScenesMap(doc);
    const observer = () => {
      if (isSyncing.current) return;
      const view = viewRef.current;
      if (!view) return;

      // Save cursor context before rebuild
      const cursorCtx = saveCursorContext(view);

      const newDoc = projectStoryToDoc(doc);

      // Replace entire doc content
      isSyncing.current = true;
      try {
        const tr = view.state.tr.replaceWith(
          0,
          view.state.doc.content.size,
          newDoc.content,
        );
        tr.setMeta("crdt-sync", true);
        view.dispatch(tr);
      } finally {
        isSyncing.current = false;
      }

      // Restore cursor after rebuild
      if (cursorCtx) {
        restoreCursor(view, cursorCtx);
      }
    };

    scenesMap.observeDeep(observer);

    return () => {
      scenesMap.unobserveDeep(observer);
      view.destroy();
      viewRef.current = null;
    };
  }, [doc]);

  return <div className="screenplay-container" ref={containerRef} />;
}

interface CursorContext {
  type: "block" | "choice";
  sceneId: string;
  id: string;
  textOffset: number;
}

function saveCursorContext(view: EditorView): CursorContext | null {
  const { from } = view.state.selection;
  const info = findContaining(view.state, from);
  if (!info) return null;
  return {
    type: info.type,
    sceneId: info.sceneId,
    id: info.id,
    textOffset: info.textOffset,
  };
}

function restoreCursor(view: EditorView, ctx: CursorContext): void {
  const index = idIndexKey.getState(view.state);
  if (!index) return;

  const map = ctx.type === "block" ? index.blocks : index.choices;
  const range = map.get(ctx.id);
  if (!range) return;

  // range.from is the start of the block/choice node.
  // Block structure: block > paragraph > text
  // So text starts at range.from + 2 (enter block + enter paragraph)
  const textStart = range.from + 2;
  const textEnd = range.to - 2;
  const targetPos = Math.min(textStart + ctx.textOffset, Math.max(textStart, textEnd));
  const clampedPos = Math.max(0, Math.min(targetPos, view.state.doc.content.size));

  try {
    const $pos = view.state.doc.resolve(clampedPos);
    const selection = TextSelection.near($pos);
    const tr = view.state.tr.setSelection(selection);
    view.dispatch(tr);
  } catch {
    // Cursor restoration is best-effort
  }
}
