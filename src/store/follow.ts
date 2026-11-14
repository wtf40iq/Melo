import { useSyncExternalStore } from "react";
import { Artist } from "../types";

export type Followed = { key: string; id?: string; name: string; known: string[]; at: number };
const KEY = "melo.followed";
const subs = new Set<() => void>();
const read = (): Followed[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string" && Array.isArray(x.known)) : [];
  } catch {
    return [];
  }
};
let items = read();
const write = (next: Followed[]) => {
  items = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* */ }
  subs.forEach((fn) => fn());
};
const keyOf = (a: Artist) => a.id ? `id:${a.id}` : `name:${a.name.toLowerCase()}`;

export function followArtist(a: Artist, known: string[] = []) {
  const key = keyOf(a);
  write([{ key, id: a.id, name: a.name, known: known.slice(0, 50), at: Date.now() }, ...items.filter((x) => x.key !== key)].slice(0, 100));
}
export function unfollowArtist(a: Artist) {
  write(items.filter((x) => x.key !== keyOf(a)));
}
export function updateFollowedKnown(key: string, known: string[]) {
  write(items.map((x) => (x.key === key ? { ...x, known: known.slice(0, 50) } : x)));
}
export function useFollowed() {
  return useSyncExternalStore(
    (fn) => { subs.add(fn); return () => subs.delete(fn); },
    () => items,
  );
}
export const isFollowed = (a: Artist) => items.some((x) => x.key === keyOf(a));
