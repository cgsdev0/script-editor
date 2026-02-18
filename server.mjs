import { createServer } from "http";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, extname } from "path";

const PORT = parseInt(process.env.PORT || "1234", 10);
const PERSIST_DIR = process.env.YPERSISTENCE || "./yjs-data";
const DIST_DIR = join(import.meta.dirname, "dist");

mkdirSync(PERSIST_DIR, { recursive: true });

// --- Static file serving ---

const MIME = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveStatic(req, res) {
  let url = req.url.split("?")[0];
  if (url === "/") url = "/index.html";
  const filePath = join(DIST_DIR, url);

  // Prevent path traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    const data = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    // SPA fallback — serve index.html for non-file routes
    try {
      const index = readFileSync(join(DIST_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(index);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
}

const server = createServer(serveStatic);

// --- Yjs document persistence ---

const docs = new Map();

function getDoc(room) {
  if (docs.has(room)) return docs.get(room);

  const doc = new Y.Doc();
  const filepath = join(PERSIST_DIR, `${room}.yjs`);
  if (existsSync(filepath)) {
    const data = readFileSync(filepath);
    Y.applyUpdate(doc, data);
  }

  doc._filepath = filepath;
  doc._clients = new Set();
  docs.set(room, doc);
  return doc;
}

function persistDoc(doc) {
  const state = Y.encodeStateAsUpdate(doc);
  writeFileSync(doc._filepath, state);
}

// --- Yjs sync protocol ---

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

function writeVarUint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push(0x80 | (value & 0x7f));
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return bytes;
}

function readVarUint(buf, offset) {
  let value = 0;
  let shift = 0;
  let byte;
  do {
    byte = buf[offset++];
    value |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return { value, offset };
}

function readVarUint8Array(buf, offset) {
  const { value: len, offset: newOffset } = readVarUint(buf, offset);
  return { value: buf.slice(newOffset, newOffset + len), offset: newOffset + len };
}

function encodeVarUint8Array(data) {
  return [...writeVarUint(data.length), ...data];
}

// --- WebSocket server (attached to HTTP server) ---

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const room = (req.url || "/").slice(1) || "default";
  const doc = getDoc(room);
  doc._clients.add(ws);

  ws.on("message", (message) => {
    const data = new Uint8Array(message);
    if (data.length === 0) return;

    const msgType = data[0];

    if (msgType === MSG_SYNC) {
      const syncType = data[1];

      if (syncType === SYNC_STEP1) {
        const { value: sv } = readVarUint8Array(data, 2);
        const update = Y.encodeStateAsUpdate(doc, sv);
        const encoded = [MSG_SYNC, SYNC_STEP2, ...encodeVarUint8Array(update)];
        ws.send(new Uint8Array(encoded));

        const ourSv = Y.encodeStateVector(doc);
        const step1 = [MSG_SYNC, SYNC_STEP1, ...encodeVarUint8Array(ourSv)];
        ws.send(new Uint8Array(step1));
      } else if (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE) {
        const { value: update } = readVarUint8Array(data, 2);
        Y.applyUpdate(doc, update);
        persistDoc(doc);

        const broadcastMsg = syncType === SYNC_STEP2
          ? new Uint8Array([MSG_SYNC, SYNC_UPDATE, ...encodeVarUint8Array(update)])
          : data;
        for (const client of doc._clients) {
          if (client !== ws && client.readyState === 1) {
            client.send(broadcastMsg);
          }
        }
      }
    } else if (msgType === MSG_AWARENESS) {
      for (const client of doc._clients) {
        if (client !== ws && client.readyState === 1) {
          client.send(data);
        }
      }
    }
  });

  ws.on("close", () => {
    doc._clients.delete(ws);
    if (doc._clients.size === 0) {
      persistDoc(doc);
    }
  });

  const sv = Y.encodeStateVector(doc);
  const step1 = [MSG_SYNC, SYNC_STEP1, ...encodeVarUint8Array(sv)];
  ws.send(new Uint8Array(step1));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
