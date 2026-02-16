/**
 * BranchCell — Read-only rendering of a single scene.
 * Reuses .sp-* CSS classes from screenplay/styles.css.
 *
 * Adds data attributes on choices and scene heading for line measurements:
 *   data-scene-input="sceneId" on heading
 *   data-choice-id="choiceId" on each choice
 *   data-auto-source="sceneId" on autoTransition
 */

import type { Scene } from "../crdt/types.ts";

interface BranchCellProps {
  scene: Scene;
  isEntry: boolean;
}

export default function BranchCell({ scene, isEntry }: BranchCellProps) {
  return (
    <div className="branch-cell">
      <div className="sp-scene">
        <div
          className="sp-scene-heading"
          data-scene-input={scene.id}
        >
          {isEntry ? "★ " : ""}
          {scene.id}
        </div>

        {scene.blocks.map((block) => (
          <div
            key={block.id}
            className={`sp-block sp-block--${block.type}`}
            data-speaker={block.speaker ?? ""}
          >
            <p>{block.text}</p>
          </div>
        ))}

        {scene.choices.map((choice) => (
          <div
            key={choice.id}
            className="sp-choice"
            data-choice-id={choice.id}
          >
            <p>
              {choice.text}
              {choice.target && (
                <span className="branch-cell__target"> → {choice.target}</span>
              )}
            </p>
          </div>
        ))}

        {scene.autoTransition && (
          <div
            className="branch-cell__auto"
            data-auto-source={scene.id}
          >
            ↓ {scene.autoTransition}
          </div>
        )}
      </div>
    </div>
  );
}
