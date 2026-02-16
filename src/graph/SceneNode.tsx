/**
 * SceneNode — Custom React Flow node component
 *
 * Layout: 1 input handle (top) → header → blocks → choices → auto-transition
 * 1 output handle per choice + 1 for autoTransition (bottom)
 */

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { Scene } from "../crdt/index.ts";

const MAX_BLOCK_PREVIEW = 3;
const MAX_TEXT_LENGTH = 40;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

interface SceneNodeData {
  scene: Scene;
  isEntry: boolean;
  [key: string]: unknown;
}

function SceneNode({ data }: NodeProps & { data: SceneNodeData }) {
  const { scene, isEntry } = data;

  return (
    <div className="scene-node">
      {/* Single input handle */}
      <Handle type="target" position={Position.Top} id="input" />

      {/* Header */}
      <div className={isEntry ? "scene-header scene-header--entry" : "scene-header"}>
        {scene.id}
      </div>

      {/* Block previews */}
      {scene.blocks.length > 0 && (
        <div className="scene-blocks">
          {scene.blocks.slice(0, MAX_BLOCK_PREVIEW).map((block) => (
            <div key={block.id} className="block-preview">
              {block.speaker && (
                <span className="block-speaker">{block.speaker}</span>
              )}
              {block.speaker && ": "}
              {truncate(block.text, MAX_TEXT_LENGTH)}
            </div>
          ))}
          {scene.blocks.length > MAX_BLOCK_PREVIEW && (
            <div className="block-preview block-preview--more">
              +{scene.blocks.length - MAX_BLOCK_PREVIEW} more
            </div>
          )}
        </div>
      )}

      {/* Choices with per-choice output handles laid out horizontally */}
      {scene.choices.length > 0 && (
        <div className="scene-choices">
          {scene.choices.map((choice) => (
            <div key={choice.id} className="choice-col">
              <span className="choice-label">
                {truncate(choice.text || "(unnamed)", MAX_TEXT_LENGTH)}
              </span>
              <Handle
                type="source"
                position={Position.Bottom}
                id={choice.id}
                className="choice-handle"
              />
            </div>
          ))}
        </div>
      )}

      {/* Auto-transition with its own output handle */}
      {scene.autoTransition && (
        <div className="scene-auto-transition">
          <span>{"\u2192"} {scene.autoTransition}</span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="__auto__"
            className="auto-handle"
          />
        </div>
      )}

      {/* Fallback: if no choices and no autoTransition, still need a source handle for creating new connections */}
      {scene.choices.length === 0 && !scene.autoTransition && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="__default__"
          className="default-handle"
        />
      )}
    </div>
  );
}

export default memo(SceneNode);
