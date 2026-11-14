import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../api";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";

/** Отправляет текущий трек в Discord Rich Presence (если включено в настройках). */
export function DiscordBridge() {
  const p = usePlayer();
  const s = useSettings();
  const live = useRef(p);
  live.current = p;

  useEffect(() => {
    if (!inTauri) return;
    const send = () => {
      const pl = live.current;
      void invoke("discord_update", {
        enabled: s.discordRpc,
        title: pl.current?.title ?? null,
        artist: pl.current?.artist ?? null,
        playing: pl.playing,
        position: pl.position,
        duration: pl.duration,
      }).catch(() => {});
    };
    send();
    const id = window.setInterval(send, 15_000);
    return () => clearInterval(id);
  }, [s.discordRpc, p.current?.id, p.playing]);

  return null;
}
