import assert from "node:assert/strict";
import {
  READER_DATA_OWNER_KEY,
  currentReaderDataOwner,
  prepareReaderDataScope,
  readerDataBelongsTo,
  removeReaderDataOwner,
} from "../lib/readerDataOwnership";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { dispatchEvent: () => true },
});

function readObject(key: string) {
  return JSON.parse(storage.getItem(key) || "{}") as Record<string, unknown>;
}

storage.setItem("jju.account", JSON.stringify({ name: "Legacy A", email: "a@example.com" }));
storage.setItem("jju.readerProgress", JSON.stringify({ "legacy-a": 9 }));
assert.equal(prepareReaderDataScope("user-b", "b@example.com"), "account-switched");
assert.equal(storage.getItem("jju.readerProgress"), null);
assert.equal(currentReaderDataOwner(), "user-b");
removeReaderDataOwner();
storage.clear();

storage.setItem("jju.savedBooks", JSON.stringify(["guest-save"]));
storage.setItem("jju.savedBooks.sync.v1", JSON.stringify({
  "guest-save": { saved: true, updatedAt: "2026-08-19T10:00:00.000Z" },
  "guest-delete": { saved: false, updatedAt: "2026-08-19T11:00:00.000Z" },
}));
storage.setItem("jju.completedBooks.sync.v1", JSON.stringify({
  "guest-complete": { completed: true, updatedAt: "2026-08-19T10:00:00.000Z" },
  "guest-incomplete": { completed: false, updatedAt: "2026-08-19T11:00:00.000Z" },
}));
storage.setItem("jju.readerProgress", JSON.stringify({ "guest-save": 3 }));

assert.equal(prepareReaderDataScope("user-a", "a@example.com"), "guest-adopted");
assert.equal(currentReaderDataOwner(), "user-a");
assert.equal(readerDataBelongsTo("user-a"), true);
assert.deepEqual(Object.keys(readObject("jju.savedBooks.sync.v1")).sort(), ["guest-save"]);
assert.deepEqual(Object.keys(readObject("jju.completedBooks.sync.v1")).sort(), ["guest-complete"]);
assert.deepEqual(readObject("jju.readerProgress"), { "guest-save": 3 });

storage.setItem("jju.readerNotes", JSON.stringify({ "book::chapter": "A private note" }));
storage.setItem("jju.readerQuotes", JSON.stringify([{ id: "a-quote" }]));
storage.setItem("jju.savedBooks.sync.v1", JSON.stringify({
  "a-delete": { saved: false, updatedAt: "2026-08-19T12:00:00.000Z" },
}));
assert.equal(prepareReaderDataScope("user-a"), "same-account");
assert.ok(storage.getItem("jju.readerNotes"), "same-account notes should remain");

assert.equal(prepareReaderDataScope("user-b"), "account-switched");
assert.equal(storage.getItem("jju.readerNotes"), null);
assert.equal(storage.getItem("jju.readerQuotes"), null);
assert.equal(storage.getItem("jju.readerProgress"), null);
assert.equal(storage.getItem("jju.savedBooks.sync.v1"), null);
assert.equal(currentReaderDataOwner(), "user-b");
assert.equal(readerDataBelongsTo("user-a"), false);
assert.equal(readerDataBelongsTo("user-b"), true);

// Signing out intentionally leaves the scope on the last account. Offline
// changes therefore return to B, while a later switch to A clears them first.
storage.setItem("jju.readerBookmarks", JSON.stringify(["b-book::chapter"]));
assert.equal(currentReaderDataOwner(), "user-b");
assert.equal(prepareReaderDataScope("user-a"), "account-switched");
assert.equal(storage.getItem("jju.readerBookmarks"), null);

removeReaderDataOwner();
assert.equal(storage.getItem(READER_DATA_OWNER_KEY), null);

const throwingStorage = {
  getItem() { throw new Error("storage denied"); },
  setItem() { throw new Error("storage denied"); },
  removeItem() { throw new Error("storage denied"); },
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: throwingStorage });
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { dispatchEvent: () => { throw new Error("events denied"); } },
});
assert.equal(prepareReaderDataScope("memory-a", "a@example.com"), "guest-adopted");
assert.equal(readerDataBelongsTo("memory-a"), true);
assert.equal(prepareReaderDataScope("memory-b", "b@example.com"), "account-switched");
assert.equal(readerDataBelongsTo("memory-a"), false);
assert.equal(readerDataBelongsTo("memory-b"), true);
removeReaderDataOwner();

console.log("Reader data ownership tests passed (upgrade hint, guest adoption, A→B isolation, signed-out scope, account deletion, denied storage).");
