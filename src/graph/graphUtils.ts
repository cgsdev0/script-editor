/**
 * Graph Utilities
 *
 * Pure functions for building React Flow nodes/edges from CRDT state.
 */

import type { Node, Edge } from "@xyflow/react";
import type { Story, Scene } from "../crdt/index.ts";
import { getNodePosition, readStory } from "../crdt/index.ts";
import type * as Y from "yjs";

/**
 * BFS to collect the connected component reachable from `start`.
 * Follows edges in both directions.
 */
export function getConnectedComponent(story: Story, start: string): string[] {
  const allIds = new Set(Object.keys(story.scenes));
  if (!allIds.has(start)) return [...allIds];

  const adj = new Map<string, Set<string>>();
  for (const id of allIds) adj.set(id, new Set());

  for (const [id, scene] of Object.entries(story.scenes)) {
    for (const choice of scene.choices) {
      if (choice.target && allIds.has(choice.target)) {
        adj.get(id)!.add(choice.target);
        adj.get(choice.target)!.add(id);
      }
    }
    if (scene.autoTransition && allIds.has(scene.autoTransition)) {
      adj.get(id)!.add(scene.autoTransition);
      adj.get(scene.autoTransition)!.add(id);
    }
  }

  const visited = new Set<string>();
  const queue = [start];
  visited.add(start);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const neighbor of adj.get(cur) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return [...visited];
}

/** Returns the scene IDs that should be rendered (currently: warden subgraph). */
export function getVisibleSceneIds(doc: Y.Doc): string[] {
  const story = readStory(doc);
  const subgraphRoot = "the_warden_3";
  return story.scenes[subgraphRoot]
    ? getConnectedComponent(story, subgraphRoot)
    : Object.keys(story.scenes);
}

/** Build React Flow Node array from story data. */
export function scenesToNodes(
  doc: Y.Doc,
  story: Story,
  sceneIds: string[],
): Node[] {
  return sceneIds.map((sceneId) => {
    const scene = story.scenes[sceneId];
    const pos = getNodePosition(doc, sceneId) || { x: 0, y: 0 };
    return {
      id: sceneId,
      type: "sceneNode",
      position: { x: pos.x, y: pos.y },
      data: {
        scene,
        isEntry: story.entryScene === sceneId,
      },
    };
  });
}

/** Build React Flow Edge array from story data. */
export function scenesToEdges(
  story: Story,
  sceneIds: string[],
): Edge[] {
  const idSet = new Set(sceneIds);
  const edges: Edge[] = [];

  for (const sceneId of sceneIds) {
    const scene = story.scenes[sceneId];
    if (!scene) continue;

    for (const choice of scene.choices) {
      if (choice.target && idSet.has(choice.target)) {
        edges.push({
          id: `${sceneId}:${choice.id}`,
          source: sceneId,
          sourceHandle: choice.id,
          target: choice.target,
          targetHandle: "input",
          type: "smoothstep",
        });
      }
    }

    if (scene.autoTransition && idSet.has(scene.autoTransition)) {
      edges.push({
        id: `${sceneId}:__auto__`,
        source: sceneId,
        sourceHandle: "__auto__",
        target: scene.autoTransition,
        targetHandle: "input",
        type: "smoothstep",
      });
    }
  }

  return edges;
}
