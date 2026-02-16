/**
 * useCRDTSync — React hook that observes CRDT changes
 * and rebuilds React Flow nodes/edges.
 *
 * Returns { nodes, edges, isSyncing } where isSyncing is a ref
 * used to prevent echo loops when React Flow callbacks write to CRDT.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import type * as Y from "yjs";
import { getScenesMap, readStory } from "../crdt/index.ts";
import { autoLayoutMissing } from "./layout.ts";
import { getVisibleSceneIds, scenesToNodes, scenesToEdges } from "./graphUtils.ts";

export function useCRDTSync(doc: Y.Doc) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const isSyncing = useRef(false);

  const rebuild = useCallback(() => {
    const story = readStory(doc);
    const sceneIds = getVisibleSceneIds(doc);

    // Ensure positions exist for all visible scenes
    autoLayoutMissing(doc, sceneIds);

    setNodes(scenesToNodes(doc, story, sceneIds));
    setEdges(scenesToEdges(story, sceneIds));
  }, [doc]);

  useEffect(() => {
    // Initial build
    rebuild();

    // Observe CRDT changes
    const scenesMap = getScenesMap(doc);
    const handler = () => {
      if (isSyncing.current) return;
      rebuild();
    };

    scenesMap.observeDeep(handler);
    return () => scenesMap.unobserveDeep(handler);
  }, [doc, rebuild]);

  return { nodes, setNodes, edges, setEdges, isSyncing, rebuild };
}
