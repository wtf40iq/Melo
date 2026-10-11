import { useSyncExternalStore } from "react";

// Небольшая история поиска: последние запросы, каждый можно удалить отдельно.
const KEY = "melo.searchHistory";
const MAX = 8;
const subs = new Set<() => void>();

const read = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
let items = read();
const write = (v: string[]) => {
  items = v;
  localStorage.setItem(KEY, JSON.stringify(v));
  subs.forEach((f) => f());
};

export const searchHistory = {
  add(q: string) {
    const s = q.trim().replace(/\s+/g, " ");
    if (s.length < 2) return;
    write([s, ...items.filter((x) => x.toLowerCase() !== s.toLowerCase())].slice(0, MAX));
  },
  remove(q: string) {
    write(items.filter((x) => x !== q));
  },
  clear() {
    write([]);
  },
};

export function useSearchHistory() {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => items,
  );
}
