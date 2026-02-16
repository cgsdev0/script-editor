/**
 * Persistence Layer
 *
 * Provides IndexedDB-backed local persistence for the CRDT document.
 * Data survives page reloads and supports offline editing.
 */

import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";

/**
 * Attach IndexedDB persistence to a Y.Doc.
 * The document name determines the IndexedDB database used — different
 * documents (stories) get separate storage.
 *
 * Returns the persistence provider, which emits a "synced" event once
 * the local database has been loaded into the doc.
 */
export function attachPersistence(
  doc: Y.Doc,
  documentName: string
): IndexeddbPersistence {
  return new IndexeddbPersistence(documentName, doc);
}

/**
 * Wait for local persistence to finish loading.
 * Resolves once the IndexedDB data has been merged into the document.
 */
export function waitForSync(
  provider: IndexeddbPersistence
): Promise<void> {
  if (provider.synced) return Promise.resolve();
  return new Promise((resolve) => {
    provider.once("synced", () => resolve());
  });
}
