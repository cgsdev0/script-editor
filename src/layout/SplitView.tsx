/**
 * SplitView — Resizable split pane with draggable divider.
 * Left pane: screenplay, Right pane: graph editor.
 * Divider clamps between 20% and 80%.
 */

import { useCallback, useRef, useState } from "react";
import type { ComponentType } from "react";
import type * as Y from "yjs";
import "./SplitView.css";

interface SplitViewProps {
  left: ComponentType<{ doc: Y.Doc }>;
  right: ComponentType<{ doc: Y.Doc }>;
  doc: Y.Doc;
}

export default function SplitView({ left: Left, right: Right, doc }: SplitViewProps) {
  const [splitPercent, setSplitPercent] = useState(40);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setSplitPercent(Math.min(80, Math.max(20, pct)));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div className="split-view" ref={containerRef}>
      <div className="split-pane split-pane--left" style={{ width: `${splitPercent}%` }}>
        <Left doc={doc} />
      </div>
      <div
        className="split-divider"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="split-pane split-pane--right" style={{ width: `${100 - splitPercent}%` }}>
        <Right doc={doc} />
      </div>
    </div>
  );
}
