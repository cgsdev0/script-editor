# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Collaborative branching narrative editor with a CRDT-based data model. Planned as a dual-view editor (screenplay + graph) where both views are projections of a shared Yjs document. See `PLAN.md` for the full design.

Built with TypeScript and Vite (v8 beta).

## Commands

- `npm run dev` — Start Vite dev server (default: http://localhost:5173)
- `npm run build` — Type-check with `tsc` then bundle with Vite
- `npm run preview` — Serve the production build locally

No test runner or linter is configured.

## Architecture

### Core invariant

The CRDT (Yjs Y.Doc) is the **single source of truth**. All views are projections. Views never directly mutate each other — all edits go through the mutation API which modifies the CRDT.

### CRDT layer (`src/crdt/`)

The central module. All views import from `src/crdt/index.ts`.

- **`types.ts`** — Plain TypeScript interfaces: `Story`, `Scene`, `Block`, `Choice`
- **`schema.ts`** — Yjs document structure, Y.Map/Y.Array/Y.Text creation and reading, `initializeDoc()`, `readStory()` snapshot
- **`mutations.ts`** — Mutation API used by all views. Scene CRUD, block CRUD, choice CRUD, text/speaker/target/condition/effects setters. All mutations wrap in `doc.transact()`.
- **`persistence.ts`** — IndexedDB persistence via `y-indexeddb`. `attachPersistence()` + `waitForSync()`
- **`sync.ts`** — WebSocket sync via `y-websocket`. `attachSync()` + awareness helpers
- **`undo.ts`** — Per-client undo/redo via `Y.UndoManager`
- **`importer.ts`** — Converts legacy `schema.ts` flat node graph into CRDT scenes (1:1 node→scene mapping, extra properties stored in metadata)

### Yjs document shape

```
doc.getMap("story")
  "entryScene": string
  "scenes": Y.Map<SceneID → Y.Map>
    "id": string
    "blocks": Y.Array<Y.Map>        (ordered dialogue/action blocks)
      "id", "type", "speaker", "text" (Y.Text)
    "choices": Y.Array<Y.Map>       (branching choices)
      "id", "text" (Y.Text), "target", "condition", "effects" (Y.Array)
    "autoTransition": string?
    "metadata": Y.Map               (presentation props: delay, trigger, camera, etc.)
```

### Legacy data (`src/schema.ts`)

Exports a `lines` object — a flat graph of ~200 dialogue nodes for a space prison escape story. Each node has `char`, `text`, `next`, `input[]`, and various presentation properties (`delay`, `trigger`, `camera`, `lights`, `once`, `cond`, `effect`, etc.). The importer converts this into CRDT scenes on first load.

### Implementation status

Phase 1 (Semantic CRDT Core) is complete. Next: Phase 2 (Graph Editor) per `PLAN.md`.
