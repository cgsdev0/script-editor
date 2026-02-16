/**
 * useElementMeasurements — Measures DOM positions of choices and scene headings
 * by querying data attributes within the container.
 */

import { useCallback, useRef, useState } from "react";

export interface PointMeasurement {
  x: number;
  y: number;
}

export interface ElementMeasurements {
  /** choiceId or "__auto__:sceneId" → left-center position */
  choicePoints: Map<string, PointMeasurement>;
  /** sceneId → top-center of scene heading */
  sceneInputPoints: Map<string, PointMeasurement>;
}

const EMPTY: ElementMeasurements = {
  choicePoints: new Map(),
  sceneInputPoints: new Map(),
};

export function useElementMeasurements() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measurements, setMeasurements] = useState<ElementMeasurements>(EMPTY);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const scrollTop = container.scrollTop;
    const scrollLeft = container.scrollLeft;

    const choicePoints = new Map<string, PointMeasurement>();
    const sceneInputPoints = new Map<string, PointMeasurement>();

    // Measure all choice connectors
    const choiceEls = container.querySelectorAll<HTMLElement>("[data-choice-id]");
    for (const el of choiceEls) {
      const id = el.dataset.choiceId!;
      const rect = el.getBoundingClientRect();
      choicePoints.set(id, {
        x: rect.left - containerRect.left + scrollLeft,
        y: rect.top - containerRect.top + scrollTop + rect.height / 2,
      });
    }

    // Measure all auto-transition connectors
    const autoEls = container.querySelectorAll<HTMLElement>("[data-auto-source]");
    for (const el of autoEls) {
      const sceneId = el.dataset.autoSource!;
      const rect = el.getBoundingClientRect();
      choicePoints.set(`__auto__:${sceneId}`, {
        x: rect.left - containerRect.left + scrollLeft,
        y: rect.top - containerRect.top + scrollTop + rect.height / 2,
      });
    }

    // Measure all scene heading input points
    const headingEls = container.querySelectorAll<HTMLElement>("[data-scene-input]");
    for (const el of headingEls) {
      const sceneId = el.dataset.sceneInput!;
      const rect = el.getBoundingClientRect();
      sceneInputPoints.set(sceneId, {
        x: rect.left - containerRect.left + scrollLeft,
        y: rect.top - containerRect.top + scrollTop + rect.height / 2,
      });
    }

    setMeasurements({ choicePoints, sceneInputPoints });
  }, []);

  return { containerRef, measurements, measure };
}
