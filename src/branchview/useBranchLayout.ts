/**
 * useBranchLayout — Observes CRDT document and recomputes BranchLayout on changes.
 */

import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { readStory, getScenesMap } from "../crdt/index.ts";
import { getConnectedComponent } from "../graph/graphUtils.ts";
import { computeBranchLayout } from "./layoutAlgorithm.ts";
import type { BranchLayout } from "./layoutTypes.ts";

export function useBranchLayout(doc: Y.Doc): BranchLayout | null {
  const [layout, setLayout] = useState<BranchLayout | null>(null);

  useEffect(() => {
    function recompute() {
      const story = readStory(doc);
      // Use bartender_0 subgraph (same as graph editor)
      const subgraphRoot = "bartender_0";
      const visibleIds = story.scenes[subgraphRoot]
        ? getConnectedComponent(story, subgraphRoot)
        : Object.keys(story.scenes);

      const newLayout = computeBranchLayout(story, visibleIds);
      setLayout(newLayout);
    }

    recompute();

    const scenesMap = getScenesMap(doc);
    scenesMap.observeDeep(recompute);

    return () => {
      scenesMap.unobserveDeep(recompute);
    };
  }, [doc]);

  return layout;
}
