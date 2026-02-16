/**
 * Layout Helpers
 *
 * Top-to-bottom hierarchical layout using dagre.
 * Matches React Flow's input-top / output-bottom handle placement.
 */

import dagre from "@dagrejs/dagre";
import type * as Y from "yjs";
import { readStory, getNodePosition, setNodePosition } from "../crdt/index.ts";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 150;

/**
 * Build a dagre graph from the story's edges and compute layout.
 */
function buildDagreGraph(
  doc: Y.Doc,
  sceneIds: string[]
): dagre.graphlib.Graph {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  const story = readStory(doc);
  const idSet = new Set(sceneIds);

  for (const id of sceneIds) {
    g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const id of sceneIds) {
    const scene = story.scenes[id];
    if (!scene) continue;

    for (const choice of scene.choices) {
      if (choice.target && idSet.has(choice.target)) {
        g.setEdge(id, choice.target);
      }
    }

    if (scene.autoTransition && idSet.has(scene.autoTransition)) {
      g.setEdge(id, scene.autoTransition);
    }
  }

  dagre.layout(g);
  return g;
}

/**
 * Assign dagre positions to scenes that don't have stored positions.
 * Scenes with existing positions are kept as-is.
 * Returns a map of sceneId → { x, y } for ALL scenes.
 */
export function autoLayoutMissing(
  doc: Y.Doc,
  sceneIds: string[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const needsLayout: string[] = [];

  for (const id of sceneIds) {
    const pos = getNodePosition(doc, id);
    if (pos) {
      positions.set(id, pos);
    } else {
      needsLayout.push(id);
    }
  }

  if (needsLayout.length === 0) return positions;

  const g = buildDagreGraph(doc, sceneIds);

  for (const id of needsLayout) {
    const node = g.node(id);
    if (node) {
      const x = node.x - NODE_WIDTH / 2;
      const y = node.y - NODE_HEIGHT / 2;
      setNodePosition(doc, id, x, y);
      positions.set(id, { x, y });
    }
  }

  return positions;
}

/**
 * Run a full dagre layout on the given scenes (or all scenes).
 * Used by the "Auto-arrange" button.
 */
export function relayoutAll(doc: Y.Doc, sceneIds?: string[]): void {
  if (!sceneIds) {
    const story = readStory(doc);
    sceneIds = Object.keys(story.scenes);
  }
  if (sceneIds.length === 0) return;

  const g = buildDagreGraph(doc, sceneIds);

  doc.transact(() => {
    for (const id of sceneIds) {
      const node = g.node(id);
      if (node) {
        setNodePosition(doc, id, node.x - NODE_WIDTH / 2, node.y - NODE_HEIGHT / 2);
      }
    }
  });
}
