/**
 * BranchView — Read-only branching screenplay visualization.
 *
 * Renders scenes in a grid with side-by-side columns for branching paths.
 * Straight SVG lines connect each choice to its target scene heading.
 */

import { useEffect, useRef } from "react";
import type * as Y from "yjs";
import { useBranchLayout } from "./useBranchLayout.ts";
import { useElementMeasurements } from "./useElementMeasurements.ts";
import BranchRow from "./BranchRow.tsx";
import BranchLines from "./BranchLines.tsx";
import "../screenplay/styles.css";
import "./styles.css";

const GUTTER_WIDTH = 80;

export default function BranchView({ doc }: { doc: Y.Doc }) {
  const layout = useBranchLayout(doc);
  const { containerRef, measurements, measure } = useElementMeasurements();
  const gridRef = useRef<HTMLDivElement>(null);

  // Re-measure whenever layout changes or after render
  useEffect(() => {
    const id = requestAnimationFrame(() => measure());
    return () => cancelAnimationFrame(id);
  }, [layout, measure]);

  // Also re-measure on scroll so SVG stays aligned
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use ResizeObserver to catch content size changes
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    if (gridRef.current) ro.observe(gridRef.current);

    return () => ro.disconnect();
  }, [measure, containerRef]);

  if (!layout || layout.rows.length === 0) {
    return (
      <div className="branch-view-container" ref={containerRef}>
        <div className="branch-view-empty">No scenes to display</div>
      </div>
    );
  }

  const grid = gridRef.current;
  const totalHeight = grid ? grid.scrollHeight : layout.rows.length * 200;

  return (
    <div className="branch-view-container" ref={containerRef}>
      <BranchLines
        segments={layout.segments}
        measurements={measurements}
        gutterWidth={GUTTER_WIDTH}
        totalHeight={totalHeight}
      />
      <div
        className="branch-grid"
        ref={gridRef}
        style={{ marginLeft: GUTTER_WIDTH }}
      >
        {layout.rows.map((row) => (
          <BranchRow
            key={row.depth}
            row={row}
            laneCount={layout.laneCount}
            story={layout.story}
          />
        ))}
      </div>
    </div>
  );
}
