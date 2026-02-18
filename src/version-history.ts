import { scriptSchema } from "./main.ts";
import { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import type { Notyf } from "notyf";

interface VersionEntry {
  id: number;
  document_id: string;
  user_id: number | null;
  created_at: string;
  label: string | null;
  auto_generated: number;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export function openVersionHistory(
  docId: string,
  view: EditorView,
  notyf: Notyf,
  canEdit: boolean,
) {
  let offset = 0;
  const limit = 50;
  let loading = false;
  let hasMore = true;

  const backdrop = document.createElement("div");
  backdrop.className = "version-backdrop";
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  const modal = document.createElement("div");
  modal.className = "version-modal";

  // Header
  const header = document.createElement("div");
  header.className = "version-modal-header";

  const title = document.createElement("span");
  title.className = "version-modal-title";
  title.textContent = "Version History";
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.className = "version-modal-close";
  closeBtn.textContent = "\u00d7";
  closeBtn.addEventListener("click", close);
  header.appendChild(closeBtn);

  modal.appendChild(header);

  // Save button
  if (canEdit) {
    const saveBtn = document.createElement("button");
    saveBtn.className = "version-save-btn";
    saveBtn.textContent = "Save Current Version";
    saveBtn.addEventListener("click", () => {
      const label = prompt("Version label (optional):");
      if (label === null) return;
      saveBtn.disabled = true;
      fetch(`/api/documents/${encodeURIComponent(docId)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label || undefined }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) {
            notyf.error(data.error);
          } else {
            notyf.success("Version saved");
            offset = 0;
            hasMore = true;
            versionList.innerHTML = "";
            loadVersions();
          }
        })
        .catch(() => notyf.error("Failed to save version"))
        .finally(() => { saveBtn.disabled = false; });
    });
    modal.appendChild(saveBtn);
  }

  // Version list
  const versionList = document.createElement("div");
  versionList.className = "version-list";
  modal.appendChild(versionList);

  // Load more button
  const loadMoreBtn = document.createElement("button");
  loadMoreBtn.className = "version-load-more";
  loadMoreBtn.textContent = "Load More";
  loadMoreBtn.style.display = "none";
  loadMoreBtn.addEventListener("click", loadVersions);
  modal.appendChild(loadMoreBtn);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  function close() {
    backdrop.remove();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", handleKeydown);
    }
  }
  document.addEventListener("keydown", handleKeydown);

  const origRemove = backdrop.remove.bind(backdrop);
  backdrop.remove = () => {
    document.removeEventListener("keydown", handleKeydown);
    origRemove();
  };

  function formatDate(iso: string): string {
    const d = new Date(iso + "Z");
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }) + ", " + d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function loadVersions() {
    if (loading || !hasMore) return;
    loading = true;
    loadMoreBtn.disabled = true;

    fetch(`/api/documents/${encodeURIComponent(docId)}/versions?limit=${limit}&offset=${offset}`)
      .then((r) => r.json())
      .then((versions: VersionEntry[]) => {
        if (versions.length < limit) hasMore = false;
        loadMoreBtn.style.display = hasMore ? "block" : "none";
        offset += versions.length;

        if (offset === versions.length && versions.length === 0) {
          const empty = document.createElement("div");
          empty.className = "version-empty";
          empty.textContent = "No versions yet";
          versionList.appendChild(empty);
          return;
        }

        for (const v of versions) {
          const item = document.createElement("div");
          item.className = "version-item";

          const info = document.createElement("div");
          info.className = "version-info";

          const topLine = document.createElement("div");
          topLine.className = "version-top-line";

          const idSpan = document.createElement("span");
          idSpan.className = "version-id";
          idSpan.textContent = `#${v.id}`;
          topLine.appendChild(idSpan);

          const labelSpan = document.createElement("span");
          labelSpan.className = "version-label";
          labelSpan.textContent = v.label ? `"${v.label}"` : "(auto-snapshot)";
          if (!v.label) labelSpan.classList.add("version-label-auto");
          topLine.appendChild(labelSpan);

          info.appendChild(topLine);

          const metaLine = document.createElement("div");
          metaLine.className = "version-meta";
          const userName = v.display_name || v.username || "Unknown";
          metaLine.textContent = `${userName} \u00b7 ${formatDate(v.created_at)}`;
          info.appendChild(metaLine);

          item.appendChild(info);

          if (canEdit) {
            const restoreBtn = document.createElement("button");
            restoreBtn.className = "version-restore-btn";
            restoreBtn.textContent = "Restore";
            restoreBtn.addEventListener("click", () => restoreVersion(v.id, restoreBtn));
            item.appendChild(restoreBtn);
          }

          versionList.appendChild(item);
        }
      })
      .catch(() => {
        notyf.error("Failed to load versions");
      })
      .finally(() => {
        loading = false;
        loadMoreBtn.disabled = false;
      });
  }

  function restoreVersion(versionId: number, btn: HTMLButtonElement) {
    if (!confirm("Restore this version? Current state will be auto-saved first.")) return;
    btn.disabled = true;
    btn.textContent = "Restoring...";

    fetch(`/api/documents/${encodeURIComponent(docId)}/versions/${versionId}/restore`, {
      method: "POST",
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          notyf.error(data.error);
          btn.disabled = false;
          btn.textContent = "Restore";
          return;
        }

        // Apply ProseMirror JSON to editor (same as import flow)
        const pmDoc = PMNode.fromJSON(scriptSchema, data.content);
        const tr = view.state.tr;
        tr.replaceWith(0, view.state.doc.content.size, pmDoc.content);
        view.dispatch(tr);
        notyf.success("Version restored");
        close();
      })
      .catch(() => {
        notyf.error("Failed to restore version");
        btn.disabled = false;
        btn.textContent = "Restore";
      });
  }

  loadVersions();
}
