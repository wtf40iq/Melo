import { demoApi } from "./demo";
import { vkApi } from "./vk";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const api = inTauri ? vkApi : demoApi;
