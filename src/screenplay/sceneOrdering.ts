/**
 * Compute scene display order via topological DFS from entryScene.
 * Orphan scenes (unreachable) are appended alphabetically.
 */

import type { Story } from "../crdt/index.ts";

export function computeSceneOrder(story: Story): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  function dfs(sceneId: string) {
    if (visited.has(sceneId) || !story.scenes[sceneId]) return;
    visited.add(sceneId);
    order.push(sceneId);

    const scene = story.scenes[sceneId];

    // Follow choices first
    for (const choice of scene.choices) {
      if (choice.target) dfs(choice.target);
    }

    // Then autoTransition
    if (scene.autoTransition) dfs(scene.autoTransition);
  }

  if (story.entryScene) {
    dfs(story.entryScene);
  }

  // Append orphans alphabetically
  const orphans = Object.keys(story.scenes)
    .filter((id) => !visited.has(id))
    .sort();

  for (const id of orphans) {
    dfs(id);
  }

  return order;
}
