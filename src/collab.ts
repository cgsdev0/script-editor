import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from "y-prosemirror";

const userColors = [
  "#30bced", "#6eeb83", "#ffbc42", "#e85d75", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16",
];

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return userColors[Math.abs(hash) % userColors.length];
}

const randomColor = userColors[Math.floor(Math.random() * userColors.length)];
const randomName = `User ${Math.floor(Math.random() * 1000)}`;

const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = import.meta.env.DEV
  ? "ws://localhost:1234"
  : `${wsProto}//${location.host}`;

function cursorBuilder(user: { name: string; color: string }) {
  const el = document.createElement("span");
  el.classList.add("yjs-cursor");
  el.style.borderColor = user.color;
  el.setAttribute("data-user", user.name);
  el.style.setProperty("--cursor-color", user.color);
  return el;
}

export interface CollabUser {
  name: string;
  username: string;
}

export interface Collab {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  yXmlFragment: Y.XmlFragment;
  plugins: ReturnType<typeof ySyncPlugin | typeof yCursorPlugin | typeof yUndoPlugin>[];
  destroy(): void;
}

export function createCollab(roomName: string, user?: CollabUser): Collab {
  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider(wsUrl, roomName, ydoc);
  const yXmlFragment = ydoc.getXmlFragment("prosemirror");

  const displayName = user?.name ?? randomName;
  const color = user ? hashColor(user.username) : randomColor;

  provider.awareness.setLocalStateField("user", {
    name: displayName,
    color,
    colorLight: color + "33",
  });

  const plugins = [
    ySyncPlugin(yXmlFragment),
    yCursorPlugin(provider.awareness, { cursorBuilder }),
    yUndoPlugin(),
  ];

  return {
    ydoc,
    provider,
    yXmlFragment,
    plugins,
    destroy() {
      provider.destroy();
      ydoc.destroy();
    },
  };
}
