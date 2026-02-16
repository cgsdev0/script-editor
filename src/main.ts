import "./style.css";
import * as Y from "yjs";
import { lines } from "./schema.ts";
import {
  importLegacyLines,
  readStory,
  initializeDoc,
  createUndoManager,
  attachPersistence,
  waitForSync,
} from "./crdt/index.ts";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import GraphEditor from "./graph/GraphEditor.tsx";
import BranchView from "./branchview/BranchView.tsx";
import SplitView from "./layout/SplitView.tsx";

// ── Initialize CRDT document ───────────────────────────────────────────

const doc = new Y.Doc();

// Initialize document structure (no-op if already loaded from persistence)
initializeDoc(doc);

// Attach local persistence (IndexedDB)
const persistence = attachPersistence(doc, "script-editor-dev");

waitForSync(persistence).then(() => {
  console.log("[persistence] Local data loaded");

  // Ensure layout map is initialized (for docs created before layout was added)
  const layout = doc.getMap("layout");
  if (!layout.get("positions")) {
    doc.transact(() => {
      layout.set("positions", new Y.Map());
      layout.set("zoom", 1);
      layout.set("panX", 0);
      layout.set("panY", 0);
    });
  }

  const story = readStory(doc);

  // If the doc is empty (first load), import the legacy schema
  if (Object.keys(story.scenes).length === 0) {
    console.log("[importer] Importing legacy lines...");
    const entryPoints = importLegacyLines(doc, lines as any);
    console.log("[importer] Entry points:", entryPoints);
  }

  // Log loaded state
  const fullStory = readStory(doc);
  console.log(
    `[crdt] ${Object.keys(fullStory.scenes).length} scenes, entry: ${fullStory.entryScene}`
  );

  // Set up undo manager
  const undoManager = createUndoManager(doc);

  // ── Mount split view (screenplay + graph) ─────────────────────────────

  const container = document.getElementById("app")!;
  const root = createRoot(container);
  root.render(createElement(SplitView, { left: BranchView, right: GraphEditor, doc }));

  // Keyboard undo/redo
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        undoManager.redo();
      } else {
        undoManager.undo();
      }
    }
  });

  // Expose for debugging
  (window as any).__ydoc = doc;
  (window as any).__undoManager = undoManager;
});
