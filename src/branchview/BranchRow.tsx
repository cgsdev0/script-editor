/**
 * BranchRow — A single row in the branch grid.
 * Renders cells positioned by lane in a CSS grid.
 */

import type { GridRow } from "./layoutTypes.ts";
import type { Story } from "../crdt/types.ts";
import BranchCell from "./BranchCell.tsx";

interface BranchRowProps {
  row: GridRow;
  laneCount: number;
  story: Story;
}

export default function BranchRow({ row, laneCount, story }: BranchRowProps) {
  return (
    <div
      className="branch-row"
      data-depth={row.depth}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${laneCount}, 1fr)`,
      }}
    >
      {row.cells.map((cell) => {
        const scene = story.scenes[cell.sceneId];
        if (!scene) return null;
        return (
          <div
            key={cell.sceneId}
            style={{ gridColumn: cell.lane + 1 }}
          >
            <BranchCell
              scene={scene}
              isEntry={story.entryScene === cell.sceneId}
            />
          </div>
        );
      })}
    </div>
  );
}
