/**
 * BranchLines — SVG overlay confined to the left gutter.
 *
 * Draws straight vertical lines from choice Y-positions down to target
 * scene heading Y-positions, with short horizontal ticks at each end
 * reaching to the gutter edge. All lines stay within the gutter area.
 */

import type { ReactElement } from "react";
import type { BranchSegment } from "./layoutTypes.ts";
import type { ElementMeasurements } from "./useElementMeasurements.ts";

interface BranchLinesProps {
  segments: BranchSegment[];
  measurements: ElementMeasurements;
  gutterWidth: number;
  totalHeight: number;
}

const DOT_RADIUS = 3;
const GUTTER_PADDING = 8;
const LANE_SPACING = 10;
const TICK_LENGTH = 6; // horizontal tick reaching toward the cell border

export default function BranchLines({
  segments,
  measurements,
  gutterWidth,
  totalHeight,
}: BranchLinesProps) {
  const { choicePoints, sceneInputPoints } = measurements;
  if (choicePoints.size === 0 && sceneInputPoints.size === 0) return null;

  const els: ReactElement[] = [];
  let laneIdx = 0;
  const rightEdge = gutterWidth - 2; // right edge of gutter, just inside the border

  for (const seg of segments) {
    const sourceKey = seg.choiceId === "__auto__"
      ? `__auto__:${seg.sourceSceneId}`
      : seg.choiceId;

    const sourcePoint = choicePoints.get(sourceKey);
    const targetPoint = sceneInputPoints.get(seg.targetSceneId);
    if (!sourcePoint || !targetPoint) continue;

    const y1 = sourcePoint.y;
    const y2 = targetPoint.y;

    // Vertical lane X inside the gutter
    const laneX = GUTTER_PADDING + laneIdx * LANE_SPACING;
    laneIdx++;

    const isLoop = seg.type === "loop";
    const opacity = isLoop ? 0.6 : 0.8;
    const dash = isLoop ? "4 3" : undefined;

    // Tick from right edge to lane at source Y
    els.push(
      <line
        key={`${seg.branchId}-tick-src`}
        x1={rightEdge} y1={y1} x2={laneX + TICK_LENGTH} y2={y1}
        stroke={seg.color} strokeWidth={2} strokeOpacity={opacity}
        strokeDasharray={dash}
      />
    );

    // Vertical line from source Y to target Y at laneX
    els.push(
      <line
        key={`${seg.branchId}-vert`}
        x1={laneX} y1={y1} x2={laneX} y2={y2}
        stroke={seg.color} strokeWidth={2} strokeOpacity={opacity}
        strokeDasharray={dash}
      />
    );

    // Tick from lane to right edge at target Y
    els.push(
      <line
        key={`${seg.branchId}-tick-tgt`}
        x1={laneX + TICK_LENGTH} y1={y2} x2={rightEdge} y2={y2}
        stroke={seg.color} strokeWidth={2} strokeOpacity={opacity}
        strokeDasharray={dash}
      />
    );

    // Dots at junctions
    els.push(
      <circle
        key={`${seg.branchId}-dot-src`}
        cx={rightEdge} cy={y1} r={DOT_RADIUS}
        fill={seg.color} fillOpacity={opacity}
      />
    );
    els.push(
      <circle
        key={`${seg.branchId}-dot-tgt`}
        cx={rightEdge} cy={y2} r={DOT_RADIUS}
        fill={seg.color} fillOpacity={opacity}
      />
    );
  }

  return (
    <svg
      className="branch-lines-svg"
      width={gutterWidth}
      height={totalHeight}
    >
      {els}
    </svg>
  );
}
