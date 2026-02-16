/**
 * Layout algorithm for branching screenplay visualization.
 *
 * Three phases:
 * 1. BFS depth assignment — each scene gets a row depth
 * 2. Lane assignment — fork children get new lanes, merges take leftmost lane
 * 3. Segment generation — edges become colored branch segments
 */

import type { Story, Scene } from "../crdt/types.ts";
import type { BranchLayout, BranchSegment, GridRow, GridCell } from "./layoutTypes.ts";
import { BRANCH_COLORS, resetColorIndex } from "./colorPalette.ts";

interface Edge {
  from: string;
  to: string;
  choiceId: string; // "__auto__" for autoTransitions
}

/**
 * Compute the full branch layout from a story and a set of visible scene IDs.
 */
export function computeBranchLayout(story: Story, visibleIds: string[]): BranchLayout {
  resetColorIndex();

  const visibleSet = new Set(visibleIds);
  const scenes = new Map<string, Scene>();
  for (const id of visibleIds) {
    if (story.scenes[id]) scenes.set(id, story.scenes[id]);
  }

  if (scenes.size === 0) {
    return { rows: [], scenePositions: new Map(), segments: [], laneCount: 0, story };
  }

  // Collect directed edges
  const edges: Edge[] = [];
  for (const [id, scene] of scenes) {
    for (const choice of scene.choices) {
      if (choice.target && visibleSet.has(choice.target)) {
        edges.push({ from: id, to: choice.target, choiceId: choice.id });
      }
    }
    if (scene.autoTransition && visibleSet.has(scene.autoTransition)) {
      edges.push({ from: id, to: scene.autoTransition, choiceId: "__auto__" });
    }
  }

  // Build forward adjacency
  const forwardAdj = new Map<string, Edge[]>();
  const incomingEdges = new Map<string, Edge[]>();
  for (const id of scenes.keys()) {
    forwardAdj.set(id, []);
    incomingEdges.set(id, []);
  }
  for (const e of edges) {
    forwardAdj.get(e.from)?.push(e);
    incomingEdges.get(e.to)?.push(e);
  }

  // ── Phase 1: BFS depth assignment ──────────────────────────────────
  const depth = new Map<string, number>();
  const entryScene = story.entryScene && visibleSet.has(story.entryScene)
    ? story.entryScene
    : visibleIds[0];

  const bfsQueue: string[] = [entryScene];
  depth.set(entryScene, 0);

  const backEdges = new Set<string>(); // edge keys "from->to"

  while (bfsQueue.length > 0) {
    const cur = bfsQueue.shift()!;
    const curDepth = depth.get(cur)!;
    for (const edge of forwardAdj.get(cur) || []) {
      if (depth.has(edge.to)) {
        // Already visited — if it points to same or earlier depth, it's a back edge
        if (depth.get(edge.to)! <= curDepth) {
          backEdges.add(`${edge.from}->${edge.to}`);
        }
        continue;
      }
      depth.set(edge.to, curDepth + 1);
      bfsQueue.push(edge.to);
    }
  }

  // Handle orphans (not reachable from entry)
  for (const id of scenes.keys()) {
    if (!depth.has(id)) {
      depth.set(id, (Math.max(...depth.values()) || 0) + 1);
    }
  }

  // ── Phase 2: Lane assignment ──────────────────────────────────────
  const lane = new Map<string, number>();
  let nextLane = 0;

  // Process scenes in BFS order (by depth, then discovery order)
  const orderedScenes = [...scenes.keys()].sort((a, b) => {
    const da = depth.get(a) ?? Infinity;
    const db = depth.get(b) ?? Infinity;
    return da - db;
  });

  // Track which lanes are "active" at each depth to pack lanes tightly
  for (const sceneId of orderedScenes) {
    if (lane.has(sceneId)) continue;

    const incoming = incomingEdges.get(sceneId) || [];
    const assignedPredecessors = incoming
      .filter(e => lane.has(e.from) && !backEdges.has(`${e.from}->${sceneId}`))
      .map(e => ({ from: e.from, lane: lane.get(e.from)! }));

    if (assignedPredecessors.length > 0) {
      // Take leftmost predecessor lane (merge behavior)
      const leftmost = assignedPredecessors.reduce((min, p) =>
        p.lane < min.lane ? p : min
      );
      lane.set(sceneId, leftmost.lane);
    } else {
      // No assigned predecessor — this is entry or orphan
      if (sceneId === entryScene) {
        lane.set(sceneId, 0);
        nextLane = Math.max(nextLane, 1);
      } else {
        lane.set(sceneId, nextLane);
        nextLane++;
      }
    }

    // Now assign lanes to forward children that haven't been assigned yet
    const forwardChildren = (forwardAdj.get(sceneId) || [])
      .filter(e => !backEdges.has(`${e.from}->${e.to}`));

    let firstChild = true;
    for (const edge of forwardChildren) {
      if (lane.has(edge.to)) continue;
      if (firstChild) {
        // First child inherits parent lane
        lane.set(edge.to, lane.get(sceneId)!);
        firstChild = false;
      } else {
        // Additional children get new lanes
        lane.set(edge.to, nextLane);
        nextLane++;
      }
    }
  }

  const laneCount = Math.max(nextLane, 1);

  // ── Build grid rows ────────────────────────────────────────────────
  const maxDepth = Math.max(...depth.values(), 0);
  const scenePositions = new Map<string, { row: number; lane: number }>();
  const rows: GridRow[] = [];

  for (let d = 0; d <= maxDepth; d++) {
    const cellsAtDepth: GridCell[] = [];
    for (const sceneId of orderedScenes) {
      if (depth.get(sceneId) === d) {
        const l = lane.get(sceneId) ?? 0;
        cellsAtDepth.push({ lane: l, sceneId });
        scenePositions.set(sceneId, { row: d, lane: l });
      }
    }
    cellsAtDepth.sort((a, b) => a.lane - b.lane);
    rows.push({ depth: d, cells: cellsAtDepth });
  }

  // ── Phase 3: Segment generation ───────────────────────────────────
  const segments: BranchSegment[] = [];
  let colorIdx = 0;

  // Assign a stable color per choice/edge
  const edgeColorMap = new Map<string, string>();

  for (const edge of edges) {
    const fromPos = scenePositions.get(edge.from);
    const toPos = scenePositions.get(edge.to);
    if (!fromPos || !toPos) continue;

    const edgeKey = `${edge.from}:${edge.choiceId}`;
    if (!edgeColorMap.has(edgeKey)) {
      edgeColorMap.set(edgeKey, BRANCH_COLORS[colorIdx % BRANCH_COLORS.length]);
      colorIdx++;
    }
    const color = edgeColorMap.get(edgeKey)!;

    const isBackEdge = backEdges.has(`${edge.from}->${edge.to}`);

    let type: BranchSegment["type"];
    if (isBackEdge) {
      type = "loop";
    } else if (fromPos.lane === toPos.lane) {
      type = "vertical";
    } else if (toPos.lane > fromPos.lane) {
      type = "fork";
    } else {
      type = "merge";
    }

    segments.push({
      branchId: edgeKey,
      color,
      fromRow: fromPos.row,
      fromLane: fromPos.lane,
      toRow: toPos.row,
      toLane: toPos.lane,
      type,
      choiceId: edge.choiceId,
      sourceSceneId: edge.from,
      targetSceneId: edge.to,
    });
  }

  return { rows, scenePositions, segments, laneCount, story };
}
