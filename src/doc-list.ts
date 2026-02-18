import { navigate } from "./router.ts";
import type { AuthUser } from "./main.ts";

interface DocInfo {
  id: string;
  lastModified: string;
  size: number;
  canEdit?: boolean;
}

interface PermUser {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
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

  const isSuperuser = user?.isSuperuser ?? false;

  let activeModal: HTMLElement | null = null;
  let activeDropdown: HTMLElement | null = null;

  function closeModal() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
    if (activeModal) {
      activeModal.remove();
      activeModal = null;
    }
  }

  // Cache all users for autocomplete (fetched once per mount)
  interface KnownUser {
    id: number;
    username: string;
    display_name: string;
    avatar_url: string;
  }
  let allUsersCache: KnownUser[] | null = null;

  function fetchAllUsers(): Promise<KnownUser[]> {
    if (allUsersCache) return Promise.resolve(allUsersCache);
    return fetch("/api/users")
      .then((r) => r.json())
      .then((users: KnownUser[]) => { allUsersCache = users; return users; })
      .catch(() => []);
  }

  function openPermModal(docId: string) {
    closeModal();

    const backdrop = document.createElement("div");
    backdrop.className = "doc-perm-backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal();
    });

    const modal = document.createElement("div");
    modal.className = "doc-perm-modal";

    const titleRow = document.createElement("div");
    titleRow.className = "doc-perm-modal-header";

    const title = document.createElement("span");
    title.className = "doc-perm-modal-title";
    title.textContent = docId;
    titleRow.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.className = "doc-perm-modal-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", closeModal);
    titleRow.appendChild(closeBtn);

    modal.appendChild(titleRow);

    const userList = document.createElement("div");
    userList.className = "doc-perm-user-list";
    userList.textContent = "Loading...";
    modal.appendChild(userList);

    const addRow = document.createElement("div");
    addRow.className = "doc-perm-add";

    const inputWrap = document.createElement("div");
    inputWrap.className = "doc-perm-input-wrap";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Twitch username";
    input.className = "doc-perm-add-input";
    inputWrap.appendChild(input);

    const dropdown = document.createElement("div");
    dropdown.className = "doc-perm-autocomplete";
    document.body.appendChild(dropdown);
    activeDropdown = dropdown;

    addRow.appendChild(inputWrap);

    const addBtn = document.createElement("button");
    addBtn.className = "doc-perm-add-btn";
    addBtn.textContent = "Add";
    addRow.appendChild(addBtn);

    modal.appendChild(addRow);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;
    input.focus();

    // Track which user IDs already have access so we can filter them out
    let grantedUserIds = new Set<number>();
    let selectedIdx = -1;
    let filtered: KnownUser[] = [];

    function positionDropdown() {
      const rect = input.getBoundingClientRect();
      dropdown.style.left = rect.left + "px";
      dropdown.style.top = (rect.bottom + 2) + "px";
      dropdown.style.width = rect.width + "px";
    }

    function renderDropdown() {
      dropdown.innerHTML = "";
      if (filtered.length === 0) {
        dropdown.style.display = "none";
        return;
      }
      positionDropdown();
      dropdown.style.display = "block";
      filtered.forEach((u, i) => {
        const item = document.createElement("div");
        item.className = "doc-perm-autocomplete-item" + (i === selectedIdx ? " selected" : "");
        const nameSpan = document.createElement("span");
        nameSpan.textContent = u.display_name || u.username;
        item.appendChild(nameSpan);
        if (u.display_name && u.display_name.toLowerCase() !== u.username.toLowerCase()) {
          const sub = document.createElement("span");
          sub.className = "doc-perm-autocomplete-sub";
          sub.textContent = u.username;
          item.appendChild(sub);
        }
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          input.value = u.username;
          dropdown.style.display = "none";
          submitGrant();
        });
        dropdown.appendChild(item);
      });
    }

    function updateDropdown() {
      const query = input.value.trim().toLowerCase();
      if (!query || !allUsersCache) {
        filtered = [];
        selectedIdx = -1;
        renderDropdown();
        return;
      }
      filtered = allUsersCache.filter((u) =>
        !grantedUserIds.has(u.id) &&
        (u.username.toLowerCase().includes(query) ||
         (u.display_name && u.display_name.toLowerCase().includes(query)))
      ).slice(0, 8);
      selectedIdx = filtered.length > 0 ? 0 : -1;
      renderDropdown();
    }

    input.addEventListener("input", updateDropdown);

    function loadPerms() {
      fetch(`/api/documents/${encodeURIComponent(docId)}/permissions`)
        .then((r) => r.json())
        .then((perms: PermUser[]) => {
          grantedUserIds = new Set(perms.map((p) => p.user_id));
          userList.innerHTML = "";
          if (perms.length === 0) {
            const empty = document.createElement("div");
            empty.className = "doc-perm-empty";
            empty.textContent = "No users have write access";
            userList.appendChild(empty);
            return;
          }
          for (const p of perms) {
            const row = document.createElement("div");
            row.className = "doc-perm-user";

            const name = document.createElement("span");
            name.className = "doc-perm-user-name";
            name.textContent = p.display_name || p.username;
            row.appendChild(name);

            const removeBtn = document.createElement("button");
            removeBtn.className = "doc-perm-remove";
            removeBtn.textContent = "\u00d7";
            removeBtn.addEventListener("click", () => {
              fetch(`/api/documents/${encodeURIComponent(docId)}/permissions/${p.user_id}`, { method: "DELETE" })
                .then(() => loadPerms());
            });
            row.appendChild(removeBtn);

            userList.appendChild(row);
          }
        })
        .catch(() => {
          userList.textContent = "Failed to load permissions";
        });
    }

    function submitGrant() {
      const username = input.value.trim();
      if (!username) return;
      fetch(`/api/documents/${encodeURIComponent(docId)}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) {
            input.style.borderColor = "#e85050";
            setTimeout(() => { input.style.borderColor = ""; }, 1500);
            return;
          }
          input.value = "";
          filtered = [];
          selectedIdx = -1;
          renderDropdown();
          loadPerms();
        });
    }

    addBtn.addEventListener("click", submitGrant);

    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filtered.length > 0) {
          selectedIdx = (selectedIdx + 1) % filtered.length;
          renderDropdown();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filtered.length > 0) {
          selectedIdx = selectedIdx <= 0 ? filtered.length - 1 : selectedIdx - 1;
          renderDropdown();
        }
      } else if (e.key === "Tab" && filtered.length > 0) {
        e.preventDefault();
        const sel = selectedIdx >= 0 ? filtered[selectedIdx] : filtered[0];
        if (sel) {
          input.value = sel.username;
          filtered = [];
          selectedIdx = -1;
          renderDropdown();
        }
      } else if (e.key === "Enter") {
        if (selectedIdx >= 0 && filtered[selectedIdx]) {
          e.preventDefault();
          input.value = filtered[selectedIdx].username;
          filtered = [];
          selectedIdx = -1;
          renderDropdown();
          submitGrant();
        } else {
          submitGrant();
        }
      } else if (e.key === "Escape") {
        if (dropdown.style.display === "block") {
          filtered = [];
          selectedIdx = -1;
          renderDropdown();
        } else {
          closeModal();
        }
      }
    });

    input.addEventListener("blur", () => {
      // Small delay so mousedown on dropdown item fires first
      setTimeout(() => {
        filtered = [];
        selectedIdx = -1;
        renderDropdown();
      }, 150);
    });

    fetchAllUsers().then(() => updateDropdown());
    loadPerms();
  }

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
        const row = document.createElement("div");
        row.className = "doc-list-row";

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

        row.appendChild(item);

        if (isSuperuser) {
          const gearBtn = document.createElement("button");
          gearBtn.className = "doc-perm-btn";
          gearBtn.textContent = "\u2699";
          gearBtn.title = "Manage permissions";

          gearBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            openPermModal(doc.id);
          });

          row.appendChild(gearBtn);
        }

        list.appendChild(row);
      }
    })
    .catch(() => {
      list.textContent = "Failed to load documents.";
    });

  return () => {
    closeModal();
    appEl.innerHTML = "";
  };
}
