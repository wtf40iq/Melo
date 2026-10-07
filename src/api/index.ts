import { demoApi } from "./demo";
import { vkApi } from "./vk";
import { withCloud } from "./cloud";
import { inTauri } from "./env";

export { inTauri };
export const api = withCloud(inTauri ? vkApi : demoApi);
