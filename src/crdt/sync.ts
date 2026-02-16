/**
 * Sync Transport Layer
 *
 * Provides WebSocket-based synchronization between clients via a relay server.
 * Includes CRDT update exchange and presence/awareness sharing.
 */

import { WebsocketProvider } from "y-websocket";
import type * as Y from "yjs";

export interface SyncOptions {
  /** WebSocket server URL (default: ws://localhost:1234) */
  serverUrl?: string;
  /** Room/document name — clients in the same room sync together */
  roomName: string;
}

/**
 * Attach WebSocket synchronization to a Y.Doc.
 * Clients connected to the same room will exchange CRDT updates in real time.
 *
 * The provider also exposes an `awareness` instance for sharing
 * cursor positions, selections, and user presence.
 */
export function attachSync(
  doc: Y.Doc,
  options: SyncOptions
): WebsocketProvider {
  const serverUrl = options.serverUrl ?? "ws://localhost:1234";

  const provider = new WebsocketProvider(serverUrl, options.roomName, doc, {
    connect: true,
  });

  return provider;
}

/**
 * Set local awareness state (cursor position, user info, etc.)
 * Other clients will receive this via the awareness protocol.
 */
export function setAwareness(
  provider: WebsocketProvider,
  state: Record<string, unknown>
): void {
  provider.awareness.setLocalState(state);
}

/**
 * Subscribe to awareness changes from all clients.
 * Callback receives the full awareness states map.
 */
export function onAwarenessChange(
  provider: WebsocketProvider,
  callback: (states: Map<number, Record<string, unknown>>) => void
): () => void {
  const handler = () => {
    callback(provider.awareness.getStates() as Map<number, Record<string, unknown>>);
  };
  provider.awareness.on("change", handler);
  return () => provider.awareness.off("change", handler);
}
