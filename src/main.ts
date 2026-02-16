import "./style.css";
import * as Y from "yjs";
import { lines } from "./schema.ts";
import {
  importLegacyLines,
  readStory,
  createScene,
  addBlock,
  addChoice,
  createUndoManager,
  undo,
  redo,
  attachPersistence,
  waitForSync,
} from "./crdt/index.ts";

// ── Initialize CRDT document ───────────────────────────────────────────

const doc = new Y.Doc();

// Attach local persistence (IndexedDB)
const persistence = attachPersistence(doc, "script-editor-dev");

waitForSync(persistence).then(() => {
  console.log("[persistence] Local data loaded");

  const story = readStory(doc);

  // If the doc is empty (first load), import the legacy schema
  if (Object.keys(story.scenes).length === 0) {
    console.log("[importer] Importing legacy lines...");
    const entryPoints = importLegacyLines(doc, lines as any);
    console.log("[importer] Entry points:", entryPoints);
  }

  // Read and log the full story snapshot
  const fullStory = readStory(doc);
  console.log("[crdt] Story loaded:", fullStory);
  console.log(
    `[crdt] ${Object.keys(fullStory.scenes).length} scenes, entry: ${fullStory.entryScene}`
  );

  // Set up undo manager
  const undoManager = createUndoManager(doc);
  console.log("[undo] Undo manager ready");

  // ── Demo: verify mutation API works ────────────────────────────────

  // Create a test scene, mutate it, then undo
  const testId = createScene(doc, { id: "__test_scene__" });
  addBlock(doc, testId, {
    type: "dialogue",
    speaker: "NARRATOR",
    text: "This is a test block.",
  });
  addChoice(doc, testId, {
    text: "Continue...",
    target: fullStory.entryScene,
  });

  const afterMutation = readStory(doc);
  console.log("[test] Scene created:", afterMutation.scenes[testId]);

  // Undo the mutations
  undo(undoManager);
  undo(undoManager);
  undo(undoManager);

  const afterUndo = readStory(doc);
  console.log(
    "[test] After undo, test scene exists:",
    "__test_scene__" in afterUndo.scenes
  );

  // Redo
  redo(undoManager);
  redo(undoManager);
  redo(undoManager);

  const afterRedo = readStory(doc);
  console.log(
    "[test] After redo, test scene exists:",
    "__test_scene__" in afterRedo.scenes
  );

  // Clean up test scene
  undo(undoManager);
  undo(undoManager);
  undo(undoManager);

  // Expose doc on window for debugging
  (window as any).__ydoc = doc;
  (window as any).__undoManager = undoManager;
});

// ── Basic UI (placeholder) ─────────────────────────────────────────────

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>Script Editor</h1>
    <p>CRDT core initialized. Open the console to see the loaded story data.</p>
  </div>
`;
