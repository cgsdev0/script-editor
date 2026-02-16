import type { Story } from "../crdt/types.ts";

export interface GridCell {
  lane: number;
  sceneId: string;
}

export interface GridRow {
  depth: number;
  cells: GridCell[];
}

export interface BranchSegment {
  branchId: string;
  color: string;
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
  type: "vertical" | "fork" | "merge" | "loop";
  choiceId: string;
  sourceSceneId: string;
  targetSceneId: string;
}

export interface BranchLayout {
  rows: GridRow[];
  scenePositions: Map<string, { row: number; lane: number }>;
  segments: BranchSegment[];
  laneCount: number;
  story: Story;
}
