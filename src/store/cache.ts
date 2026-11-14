import { Track } from "../types";

/** Небольшой кэш библиотеки в IndexedDB: мгновенный старт и меньше запросов к ВК. */
const DB_NAME = "melo-cache";
const STORE = "library";
const VERSION = 1;

type Cached = { uid: number; tracks: Track[]; total: number; at: number };

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "uid" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function readLibrary(uid: number): Promise<Cached | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(uid);
      req.onsuccess = () => {
        const v = req.result as Cached | undefined;
        db.close();
        resolve(v && Array.isArray(v.tracks) ? v : null);
      };
      req.onerror = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function writeLibrary(uid: number, tracks: Track[], total: number): Promise<void> {
  const db = await open();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ uid, tracks, total, at: Date.now() } satisfies Cached);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    } catch {
      db.close();
      resolve();
    }
  });
}
