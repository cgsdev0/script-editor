## Development Plan: Collaborative Branching Narrative Editor

Dual-view editor (screenplay + graph) with shared real-time data model.

---

# 0. High-Level Architecture

**Single authoritative state:** structured CRDT document representing narrative graph.

Views are projections:

* Screenplay editor (structured document UI)
* Graph editor (node/edge visualization)
* Runtime serializer (export to engine format)

```
CRDT semantic model (authoritative)
        │
 ┌──────┼──────────────┐
 │      │              │
Screenplay view   Graph view   Export / simulation
(ProseMirror)     (visual)     (runtime JSON)
```

No view owns data. All mutate CRDT.

---

# 1. Core Domain Model (Semantic Structure)

Implement inside CRDT as structured maps and arrays.

### Story

```
scenes: Map<SceneID, Scene>
entry_scene: SceneID
```

### Scene

```
id: string
blocks: ordered list<Block>
choices: ordered list<Choice>
auto_transition?: SceneID
metadata?: object
```

### Block

```
id: string
type: "dialogue" | "action" | "narration" | "command"
speaker?: string
text: collaborative text
```

### Choice

```
id: string
text: collaborative text
target: SceneID
condition?: expression
effects?: list<effect>
```

All elements must have **stable IDs**.

---

# 2. CRDT Layer

## 2.1 Data Containers

Use structured CRDT primitives:

* map (object fields)
* array (ordered sequences)
* collaborative text
* nested maps

## 2.2 Responsibilities

CRDT must provide:

* concurrent editing
* merge without conflict resolution UI
* offline editing
* presence / awareness
* undo / redo per client
* update streaming

## 2.3 Persistence

Support:

* binary snapshot storage
* incremental update log
* server relay synchronization
* local offline cache

---

# 3. Screenplay View (Structured Document Editor)

Screenplay is a structured projection of semantic scenes.

## 3.1 Document Structure

Node types:

```
doc
  scene(id)
    block(id, type, speaker?)
      text
    choice(id, target)
      text
```

Each node contains semantic IDs matching CRDT objects.

## 3.2 Responsibilities

* display scenes sequentially
* allow editing block text
* create / delete blocks
* create / delete choices
* reorder blocks
* modify targets and attributes
* show validation errors
* show presence cursors

## 3.3 Rendering

Semantic change → patch document subtree.

Never full re-render.

Maintain:

```
element ID → document position index
```

---

# 4. Graph View (Visual Editor)

Pure structural interface.

## 4.1 Capabilities

* create scene
* delete scene
* rename scene
* connect choice to target
* reorder choices
* visualize reachability
* show validation markers
* display user presence

## 4.2 Graph Layout

Store separately:

```
node_positions
zoom
pan
```

Layout is not semantic data.

---

# 5. Projection Layer (Critical Component)

Translates between semantic CRDT and editor representations.

Two directions.

---

## 5.1 Semantic → Screenplay

Trigger: CRDT change.

Steps:

1. identify affected scene IDs
2. locate corresponding document nodes
3. rebuild only changed subtree
4. apply structured document transaction

---

## 5.2 Screenplay → Semantic

Trigger: document transaction.

Steps:

1. detect structural change
2. read node IDs
3. map to semantic object
4. emit semantic mutations

Examples:

| Document change    | Semantic mutation    |
| ------------------ | -------------------- |
| insert scene node  | create scene         |
| remove block       | delete block         |
| edit block text    | update text          |
| reorder nodes      | reorder array        |
| change target attr | update choice target |

Text content sync handled directly by collaborative text binding.

---

# 6. Validation System

Runs continuously on semantic model.

Checks:

* missing scene targets
* duplicate IDs
* unreachable scenes
* cycles (optional warning)
* invalid conditions
* orphan blocks

Produces diagnostics:

* screenplay decorations
* graph markers

Never blocks editing.

---

# 7. Multiplayer Infrastructure

## 7.1 Synchronization

Clients exchange CRDT updates via:

* websocket relay OR
* peer network

## 7.2 Presence

Shared awareness state:

```
user id
cursor location
selected scene
viewport location (graph)
```

Rendered in both views.

## 7.3 Undo

Per-client operation history.

Undo only local changes.

---

# 8. Export / Runtime Layer

Convert semantic CRDT snapshot to runtime graph.

Output:

```
scene nodes
choice edges
conditions
effects
metadata
```

Must be deterministic.

---

# 9. Performance Requirements

* incremental projection updates
* indexed ID lookup
* lazy scene rendering
* large document virtualization
* graph viewport culling
* batched CRDT transactions

---

# 10. Implementation Phases

## Phase 1 — Semantic CRDT Core

Deliverables:

* schema implementation
* mutation API
* persistence
* sync transport
* undo manager

Acceptance:

* multiple clients edit text concurrently
* order preserved
* stable IDs maintained

---

## Phase 2 — Graph Editor

Deliverables:

* scene node UI
* edge connections
* layout storage
* direct CRDT mutation
* presence rendering

Acceptance:

* structural edits sync across clients
* no screenplay view yet

---

## Phase 3 — Screenplay Renderer

Deliverables:

* document schema
* semantic → document projection
* ID indexing plugin

Acceptance:

* CRDT changes appear in screenplay view

---

## Phase 4 — Screenplay Editing Sync

Deliverables:

* document transaction listener
* structural diff mapping
* semantic mutation emitter

Acceptance:

* editing screenplay mutates CRDT
* graph view updates live

---

## Phase 5 — Validation Layer

Deliverables:

* validator engine
* diagnostics mapping
* UI decorations

---

## Phase 6 — Presence and Collaboration UI

Deliverables:

* cursor sharing
* user indicators
* selection sharing

---

## Phase 7 — Export and Simulation

Deliverables:

* runtime serializer
* traversal simulator

---

# 11. Testing Strategy

## Unit

* semantic mutation correctness
* projection mapping
* ID stability

## Property tests

Round-trip invariants:

```
semantic → document → semantic identical
concurrent edits converge
```

## Integration

* multi-client editing
* offline merge
* large graph performance

---

# 12. Non-Negotiable Invariants

* CRDT is single source of truth
* all semantic objects have stable IDs
* no full document regeneration
* views never directly mutate each other
* all edits become semantic mutations
* validation never blocks editing

---

# 13. Suggested Task Breakdown for Agent

1. implement CRDT schema module
2. implement mutation API
3. implement persistence and sync transport
4. build graph editor bound to mutation API
5. implement document schema for screenplay
6. implement semantic → document renderer
7. implement document → semantic mapping plugin
8. implement validation engine
9. implement presence layer
10. implement export serializer
11. add performance indexing
12. add automated round-trip tests

---

# 14. Definition of Done

System supports:

* multiple users editing simultaneously
* structural editing from both views
* deterministic convergence
* live synchronization between views
* lossless export to runtime graph
* validation feedback
* undo per user
* offline editing and merge

---

If additional specification is needed, next artifact can be:

* exact CRDT schema definition
* ProseMirror node schema
* projection algorithms
* mutation API contract
* networking protocol
* minimal reference implementation structure

