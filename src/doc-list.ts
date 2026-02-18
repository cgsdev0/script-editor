import { navigate } from "./router.ts";
import type { AuthUser } from "./main.ts";

interface DocInfo {
  id: string;
  lastModified: string;
  size: number;
}

export function mountDocList(appEl: HTMLElement, user: AuthUser | null): () => void {
  appEl.innerHTML = "";

  const container = document.createElement("div");
  container.className = "doc-list";

  // Auth bar at top of doc list
  const authBar = document.createElement("div");
  authBar.className = "doc-list-auth";
  if (user) {
    if (user.avatarUrl) {
      const avatar = document.createElement("img");
      avatar.src = user.avatarUrl;
      avatar.className = "toolbar-avatar";
      avatar.alt = user.displayName;
      authBar.appendChild(avatar);
    }
    const userSpan = document.createElement("span");
    userSpan.className = "toolbar-user";
    userSpan.textContent = user.displayName;
    authBar.appendChild(userSpan);

    const logoutLink = document.createElement("a");
    logoutLink.href = "/auth/logout";
    logoutLink.className = "toolbar-logout";
    logoutLink.textContent = "Logout";
    authBar.appendChild(logoutLink);
  } else {
    const loginLink = document.createElement("a");
    loginLink.href = "/auth/twitch";
    loginLink.className = "toolbar-login";
    loginLink.textContent = "Sign in with Twitch";
    authBar.appendChild(loginLink);
  }
  container.appendChild(authBar);

  const header = document.createElement("h2");
  header.textContent = "Documents";
  header.className = "doc-list-header";
  container.appendChild(header);

  const newBtn = document.createElement("button");
  newBtn.className = "doc-list-new-btn";
  newBtn.textContent = "+ New Document";
  newBtn.addEventListener("click", () => {
    const name = prompt("Document name:");
    if (!name) return;
    const id = name.trim().replace(/\s+/g, "-").toLowerCase();
    if (!id) return;
    navigate(`/d/${id}`);
  });
  container.appendChild(newBtn);

  const list = document.createElement("div");
  list.className = "doc-list-items";
  list.textContent = "Loading...";
  container.appendChild(list);

  appEl.appendChild(container);

  fetch("/api/documents")
    .then((r) => r.json())
    .then((docs: DocInfo[]) => {
      list.textContent = "";
      if (docs.length === 0) {
        list.textContent = "No documents yet. Create one!";
        return;
      }
      docs.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
      for (const doc of docs) {
        const item = document.createElement("a");
        item.className = "doc-list-item";
        item.href = `/d/${doc.id}`;
        item.addEventListener("click", (e) => {
          e.preventDefault();
          navigate(`/d/${doc.id}`);
        });

        const name = document.createElement("span");
        name.className = "doc-list-item-name";
        name.textContent = doc.id;
        item.appendChild(name);

        const meta = document.createElement("span");
        meta.className = "doc-list-item-meta";
        meta.textContent = new Date(doc.lastModified).toLocaleString();
        item.appendChild(meta);

        list.appendChild(item);
      }
    })
    .catch(() => {
      list.textContent = "Failed to load documents.";
    });

  return () => {
    appEl.innerHTML = "";
  };
}
