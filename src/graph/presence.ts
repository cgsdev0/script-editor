/**
 * Presence Module
 *
 * Renders awareness state — highlights which scenes other users are viewing.
 */

import type { WebsocketProvider } from "y-websocket";
import { onAwarenessChange, setAwareness } from "../crdt/index.ts";

const USER_COLORS = [
  "#e06c75", "#61afef", "#98c379", "#e5c07b",
  "#c678dd", "#56b6c2", "#be5046", "#d19a66",
];

export interface PresenceState {
  selectedScene?: string;
  userName?: string;
  color?: string;
}

/**
 * Initialize presence tracking.
 * Returns helpers to update local selection and a cleanup function.
 */
export function initPresence(
  provider: WebsocketProvider,
  container: HTMLElement
) {
  const clientId = provider.awareness.clientID;
  const color = USER_COLORS[clientId % USER_COLORS.length];

  // Set initial awareness
  setAwareness(provider, { color, selectedScene: null });

  const cleanup = onAwarenessChange(provider, (states) => {
    // Clear all existing presence highlights
    container.querySelectorAll(".presence-highlight").forEach((el) => {
      (el as HTMLElement).style.outline = "";
      el.classList.remove("presence-highlight");
    });

    // Apply highlights for remote users
    states.forEach((state, id) => {
      if (id === clientId) return;
      const ps = state as PresenceState;
      if (!ps.selectedScene) return;

      const nodeEl = container.querySelector(
        `.react-flow__node[data-id="${CSS.escape(ps.selectedScene)}"]`
      );
      if (nodeEl) {
        (nodeEl as HTMLElement).style.outline = `2px solid ${ps.color || "#888"}`;
        nodeEl.classList.add("presence-highlight");
      }
    });
  });

  return {
    selectScene(sceneId: string | null) {
      setAwareness(provider, { color, selectedScene: sceneId });
    },
    destroy() {
      cleanup();
    },
  };
}
