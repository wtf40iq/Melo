import { useSyncExternalStore } from "react";
import { Track } from "../types";

/** Локальная история прослушивания — без отправки на сервер. */
export type PlayedEntry = { track: Track; at: number };

const KEY = "melo.played";
const MAX = 200;
const subs = new Set<() => void>();

const read = (): PlayedEntry[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v)
      ? v.filter((x) => x && x.track && typeof x.track.id === "string" && typeof x.at === "number")
      : [];
  } catch {
    return [];
  }
};

let items = read();
const write = (next: PlayedEntry[]) => {
  items = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* history is optional */ }
  subs.forEach((fn) => fn());
};

/** Запомнить трек в истории. Повторный запуск поднимает его наверх. */
export function rememberPlayed(track: Track) {
  const entry: PlayedEntry = { track, at: Date.now() };
  write([entry, ...items.filter((x) => x.track.id !== track.id)].slice(0, MAX));
}

export function forgetPlayed(id: string) {
  write(items.filter((x) => x.track.id !== id));
}

export function clearPlayed() {
  write([]);
}

export function usePlayed() {
  return useSyncExternalStore(
    (fn) => { subs.add(fn); return () => subs.delete(fn); },
    () => items,
  );
}
