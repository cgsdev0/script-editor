import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from "y-prosemirror";

const userColors = [
  "#30bced", "#6eeb83", "#ffbc42", "#e85d75", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16",
];

const randomColor = userColors[Math.floor(Math.random() * userColors.length)];
const userName = `User ${Math.floor(Math.random() * 1000)}`;

export const ydoc = new Y.Doc();
export const provider = new WebsocketProvider("ws://localhost:1234", "script-editor", ydoc);
export const yXmlFragment = ydoc.getXmlFragment("prosemirror");

provider.awareness.setLocalStateField("user", {
  name: userName,
  color: randomColor,
  colorLight: randomColor + "33",
});

function cursorBuilder(user: { name: string; color: string }) {
  const el = document.createElement("span");
  el.classList.add("yjs-cursor");
  el.style.borderColor = user.color;
  el.setAttribute("data-user", user.name);
  el.style.setProperty("--cursor-color", user.color);
  return el;
}

export const plugins = [
  ySyncPlugin(yXmlFragment),
  yCursorPlugin(provider.awareness, { cursorBuilder }),
  yUndoPlugin(),
];

export function destroy() {
  provider.destroy();
  ydoc.destroy();
}
