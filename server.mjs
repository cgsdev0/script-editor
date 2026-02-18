import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
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

// --- Auth helper ---

function getSessionFromReq(c) {
  const sessionId = getCookie(c, "session");
  return getSession(db, sessionId);
}

// --- Hono app ---

const app = new Hono();

// --- Auth routes ---

app.get("/auth/twitch", (c) => {
  if (!TWITCH_CLIENT_ID) {
    return c.text("TWITCH_CLIENT_ID not configured", 500);
  }
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: TWITCH_REDIRECT_URI,
    response_type: "code",
  });
  return c.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

app.get("/auth/twitch/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) {
    return c.text("Missing code parameter", 400);
  }

  try {
    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: TWITCH_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return c.text("Token exchange failed", 400);
    }

    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Client-Id": TWITCH_CLIENT_ID,
      },
    });
    const userData = await userRes.json();
    const twitchUser = userData.data?.[0];
    if (!twitchUser) {
      return c.text("Failed to fetch Twitch user", 400);
    }

    const user = upsertUser(db, {
      twitchId: twitchUser.id,
      username: twitchUser.login,
      displayName: twitchUser.display_name,
      avatarUrl: twitchUser.profile_image_url,
    });

    const sessionId = createSession(db, user.id);
    setCookie(c, "session", sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return c.redirect("/");
  } catch (err) {
    console.error("Twitch auth error:", err);
    return c.text("Authentication failed", 500);
  }
});

app.get("/auth/logout", (c) => {
  const sessionId = getCookie(c, "session");
  deleteSession(db, sessionId);
  deleteCookie(c, "session", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
  });
  return c.redirect("/");
});

// --- API routes ---

app.get("/api/me", (c) => {
  const session = getSessionFromReq(c);
  if (!session) {
    return c.json(null);
  }
  const { user } = session;
  return c.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    isSuperuser: SUPERUSERS.includes(user.username.toLowerCase()),
  });
});

app.get("/api/documents", (c) => {
  try {
    const session = getSessionFromReq(c);
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
    return c.json(docs);
  } catch {
    return c.json([]);
  }
});

// --- Users list (superuser-gated) ---

app.get("/api/users", (c) => {
  const session = getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const isSuperuser = SUPERUSERS.includes(session.user.username.toLowerCase());
  if (!isSuperuser) return c.json({ error: "Superuser access required" }, 403);
  return c.json(getAllUsers(db));
});

// --- Per-document permission endpoints ---

app.get("/api/documents/:docId/permissions", (c) => {
  const session = getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const isSuperuser = SUPERUSERS.includes(session.user.username.toLowerCase());
  if (!isSuperuser) return c.json({ error: "Superuser access required" }, 403);

  const docId = c.req.param("docId");
  const perms = getDocumentPermissions(db, docId);
  return c.json(perms);
});

app.post("/api/documents/:docId/permissions", async (c) => {
  const session = getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const isSuperuser = SUPERUSERS.includes(session.user.username.toLowerCase());
  if (!isSuperuser) return c.json({ error: "Superuser access required" }, 403);

  const docId = c.req.param("docId");
  try {
    const { username } = await c.req.json();
    if (!username) return c.json({ error: "username required" }, 400);
    const targetUser = findUserByUsername(db, username);
    if (!targetUser) return c.json({ error: "User not found" }, 404);
    grantDocumentAccess(db, docId, targetUser.id);
    return c.json({ ok: true, userId: targetUser.id, username: targetUser.username });
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
});

app.delete("/api/documents/:docId/permissions/:userId", (c) => {
  const session = getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const isSuperuser = SUPERUSERS.includes(session.user.username.toLowerCase());
  if (!isSuperuser) return c.json({ error: "Superuser access required" }, 403);

  const docId = c.req.param("docId");
  const userId = parseInt(c.req.param("userId"), 10);
  revokeDocumentAccess(db, docId, userId);
  return c.json({ ok: true });
});

// --- Can-edit check ---

app.get("/api/documents/:docId/can-edit", (c) => {
  const docId = c.req.param("docId");
  const session = getSessionFromReq(c);
  if (!session) return c.json({ canEdit: false });
  const isSuperuser = SUPERUSERS.includes(session.user.username.toLowerCase());
  const canEdit = isSuperuser || userCanEditDocument(db, docId, session.user.id);
  return c.json({ canEdit });
});

// --- Static files + SPA fallback ---

app.use("*", serveStatic({ root: "./dist" }));

app.get("*", (c) => {
  try {
    const html = readFileSync(join(DIST_DIR, "index.html"), "utf-8");
    return c.html(html);
  } catch {
    return c.text("Not found", 404);
  }
});

// --- Start server ---

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server running on port ${PORT}`);
});

// --- Yjs document persistence ---

const yjsDocs = new Map();

function getDoc(room) {
  if (yjsDocs.has(room)) return yjsDocs.get(room);

  const doc = new Y.Doc();
  const filepath = join(PERSIST_DIR, `${room}.yjs`);
  if (existsSync(filepath)) {
    const data = readFileSync(filepath);
    Y.applyUpdate(doc, data);
  }

  doc._filepath = filepath;
  doc._clients = new Set();
  yjsDocs.set(room, doc);
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
