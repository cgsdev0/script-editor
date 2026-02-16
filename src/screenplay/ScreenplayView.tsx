/**
 * ScreenplayView — React wrapper that mounts a read-only ProseMirror editor
 * and keeps it in sync with the CRDT document.
 */

import { useEffect, useRef } from "react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type * as Y from "yjs";
import { screenplaySchema } from "./schema.ts";
import { projectStoryToDoc } from "./projection.ts";
import { createIdIndexPlugin } from "./idIndex.ts";
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
      plugins: [createIdIndexPlugin()],
    });

    const view = new EditorView(containerRef.current, {
      state,
      editable: () => false,
    });
    viewRef.current = view;

    // Observe CRDT changes and rebuild PM doc
    const scenesMap = getScenesMap(doc);
    const observer = () => {
      if (isSyncing.current) return;

      const newDoc = projectStoryToDoc(doc);
      const tr = view.state.tr.replaceWith(
        0,
        view.state.doc.content.size,
        newDoc.content,
      );
      view.dispatch(tr);
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
