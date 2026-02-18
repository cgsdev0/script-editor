import { createServer } from "http";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { initDb, upsertUser, createSession, getSession, deleteSession, parseSessionCookie, getDocumentPermissions, grantDocumentAccess, revokeDocumentAccess, userCanEditDocument, findUserByUsername, getAllUsers } from "./auth.mjs";

const PORT = parseInt(process.env.PORT || "1234", 10);
const PERSIST_DIR = process.env.YPERSISTENCE || "./yjs-data";
const DIST_DIR = join(import.meta.dirname, "dist");

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const TWITCH_REDIRECT_URI = process.env.TWITCH_REDIRECT_URI || "http://localhost:1234/auth/twitch/callback";
const SUPERUSERS = (process.env.SUPERUSERS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

const db = initDb(join(import.meta.dirname, "data", "auth.db"));

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

// --- Auth helpers ---

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function redirect(res, url) {
  res.writeHead(302, { Location: url });
  res.end();
}

function getSessionFromReq(req) {
  const sessionId = parseSessionCookie(req.headers.cookie);
  return getSession(db, sessionId);
}

// --- HTTP server ---

const server = createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const path = urlObj.pathname;

  // --- Auth routes ---

  if (req.method === "GET" && path === "/auth/twitch") {
    if (!TWITCH_CLIENT_ID) {
      res.writeHead(500);
      res.end("TWITCH_CLIENT_ID not configured");
      return;
    }
    const params = new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      redirect_uri: TWITCH_REDIRECT_URI,
      response_type: "code",
    });
    redirect(res, `https://id.twitch.tv/oauth2/authorize?${params}`);
    return;
  }

  if (req.method === "GET" && path === "/auth/twitch/callback") {
    const code = urlObj.searchParams.get("code");
    if (!code) {
      res.writeHead(400);
      res.end("Missing code parameter");
      return;
    }

    // Exchange code for token
    fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: TWITCH_REDIRECT_URI,
      }),
    })
      .then(r => r.json())
      .then(tokenData => {
        if (!tokenData.access_token) {
          res.writeHead(400);
          res.end("Token exchange failed");
          return;
        }
        // Fetch user info
        return fetch("https://api.twitch.tv/helix/users", {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            "Client-Id": TWITCH_CLIENT_ID,
          },
        })
          .then(r => r.json())
          .then(userData => {
            const twitchUser = userData.data?.[0];
            if (!twitchUser) {
              res.writeHead(400);
              res.end("Failed to fetch Twitch user");
              return;
            }

            const user = upsertUser(db, {
              twitchId: twitchUser.id,
              username: twitchUser.login,
              displayName: twitchUser.display_name,
              avatarUrl: twitchUser.profile_image_url,
            });

            const sessionId = createSession(db, user.id);
            res.writeHead(302, {
              Location: "/",
              "Set-Cookie": `session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`,
            });
            res.end();
          });
      })
      .catch(err => {
        console.error("Twitch auth error:", err);
        res.writeHead(500);
        res.end("Authentication failed");
      });
    return;
  }

  if (req.method === "GET" && path === "/auth/logout") {
    const sessionId = parseSessionCookie(req.headers.cookie);
    deleteSession(db, sessionId);
    res.writeHead(302, {
      Location: "/",
      "Set-Cookie": "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    });
    res.end();
    return;
  }

  // --- API routes ---

  if (req.method === "GET" && path === "/api/me") {
    const session = getSessionFromReq(req);
    if (!session) {
      json(res, 200, null);
      return;
    }
    const { user } = session;
    json(res, 200, {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isSuperuser: SUPERUSERS.includes(user.username.toLowerCase()),
    });
    return;
  }

  if (req.method === "GET" && path === "/api/documents") {
    try {
      const session = getSessionFromReq(req);
      const isSuperuser = session ? SUPERUSERS.includes(session.user.username.toLowerCase()) : false;
      const userId = session ? session.user.id : null;

      const files = readdirSync(PERSIST_DIR).filter((f) => f.endsWith(".yjs"));
      const docs = files.map((f) => {
        const docId = f.replace(/\.yjs$/, "");
        const st = statSync(join(PERSIST_DIR, f));
        const canEdit = isSuperuser || (userId ? userCanEditDocument(db, docId, userId) : false);
        return {
          id: docId,
          lastModified: st.mtime.toISOString(),
          size: st.size,
          canEdit,
        };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(docs));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    }
    return;
  }

  // --- Users list (superuser-gated) ---

  if (req.method === "GET" && path === "/api/users") {
    const session = getSessionFromReq(req);
    if (!session) { json(res, 401, { error: "Not authenticated" }); return; }
    const isSuperuser = SUPERUSERS.includes(session.user.username.toLowerCase());
    if (!isSuperuser) { json(res, 403, { error: "Superuser access required" }); return; }
    json(res, 200, getAllUsers(db));
    return;
  }

  // --- Per-document permission endpoints ---

  const docPermMatch = path.match(/^\/api\/documents\/([^/]+)\/permissions(?:\/(\d+))?$/);

  if (docPermMatch) {
    const docId = decodeURIComponent(docPermMatch[1]);
    const targetUserId = docPermMatch[2] ? parseInt(docPermMatch[2], 10) : null;

    const session = getSessionFromReq(req);
    if (!session) { json(res, 401, { error: "Not authenticated" }); return; }
    const isSuperuser = SUPERUSERS.includes(session.user.username.toLowerCase());
    if (!isSuperuser) { json(res, 403, { error: "Superuser access required" }); return; }

    if (req.method === "GET" && !targetUserId) {
      const perms = getDocumentPermissions(db, docId);
      json(res, 200, perms);
      return;
    }

    if (req.method === "POST" && !targetUserId) {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { username } = JSON.parse(body);
          if (!username) { json(res, 400, { error: "username required" }); return; }
          const targetUser = findUserByUsername(db, username);
          if (!targetUser) { json(res, 404, { error: "User not found" }); return; }
          grantDocumentAccess(db, docId, targetUser.id);
          json(res, 200, { ok: true, userId: targetUser.id, username: targetUser.username });
        } catch {
          json(res, 400, { error: "Invalid JSON" });
        }
      });
      return;
    }

    if (req.method === "DELETE" && targetUserId) {
      revokeDocumentAccess(db, docId, targetUserId);
      json(res, 200, { ok: true });
      return;
    }
  }

  // Any authenticated user can check their own edit access
  const canEditMatch = path.match(/^\/api\/documents\/([^/]+)\/can-edit$/);
  if (canEditMatch && req.method === "GET") {
    const docId = decodeURIComponent(canEditMatch[1]);
    const session = getSessionFromReq(req);
    if (!session) { json(res, 200, { canEdit: false }); return; }
    const isSuperuser = SUPERUSERS.includes(session.user.username.toLowerCase());
    const canEdit = isSuperuser || userCanEditDocument(db, docId, session.user.id);
    json(res, 200, { canEdit });
    return;
  }

  serveStatic(req, res);
});

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

  // Auth: determine write access from session cookie
  const session = getSession(db, parseSessionCookie(req.headers.cookie));
  const isSuperuser = session ? SUPERUSERS.includes(session.user.username.toLowerCase()) : false;
  const canEdit = session
    ? (isSuperuser || userCanEditDocument(db, room, session.user.id))
    : false;
  ws._canEdit = canEdit;
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
        // Gate writes: only allow if canEdit
        if (!ws._canEdit) return;

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
