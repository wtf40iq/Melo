// Эквалайзер на Web Audio API: <audio> → 10 фильтров → компрессор → колонки.
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS: Record<string, number[]> = {
  "Обычный": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Басы": [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  "Вокал": [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  "Рок": [5, 4, 2, 0, -1, -1, 1, 3, 4, 5],
  "Танцевальная": [6, 5, 2, 0, 0, -1, 0, 2, 4, 4],
  "Акустика": [3, 3, 2, 1, 2, 2, 3, 3, 2, 1],
  "Тише верха": [0, 0, 0, 0, 0, 0, -2, -4, -6, -8],
};

type Graph = {
  ctx: AudioContext;
  filters: BiquadFilterNode[];
  comp: DynamicsCompressorNode;
  preGain: GainNode;
  out: GainNode;
  analyser: AnalyserNode;
};

let graph: Graph | null = null;

export function attachEq(el: HTMLMediaElement): Graph | null {
  if (graph) return graph;
  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(el);
    const filters = EQ_BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
      b.frequency.value = f;
      b.Q.value = 1.1;
      b.gain.value = 0;
      return b;
    });
    const preGain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    const out = ctx.createGain();
    src.connect(preGain);
    let node: AudioNode = preGain;
    for (const f of filters) { node.connect(f); node = f; }
    node.connect(comp);
    comp.connect(out);
    out.connect(ctx.destination);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    out.connect(analyser);
    graph = { ctx, filters, comp, preGain, out, analyser };
    return graph;
  } catch (e) {
    console.warn("Эквалайзер недоступен", e);
    return null;
  }
}

/** Анализатор спектра для визуализатора (появляется после первого запуска звука). */
export const getAnalyser = () => graph?.analyser ?? null;

export function resumeEq() {
  if (graph?.ctx.state === "suspended") graph.ctx.resume();
}

export function applyEq(enabled: boolean, gains: number[], normalize: boolean) {
  if (!graph) return;
  const t = graph.ctx.currentTime;
  graph.filters.forEach((f, i) => f.gain.setTargetAtTime(enabled ? gains[i] ?? 0 : 0, t, 0.05));
  // Чтобы усиление не давало хрип — немного опускаем общий уровень
  const maxBoost = enabled ? Math.max(0, ...gains) : 0;
  graph.preGain.gain.setTargetAtTime(Math.pow(10, -maxBoost / 2 / 20), t, 0.05);
  const c = graph.comp;
  if (normalize) {
    c.threshold.value = -24; c.knee.value = 12; c.ratio.value = 4; c.attack.value = 0.01; c.release.value = 0.25;
    graph.out.gain.setTargetAtTime(1.6, t, 0.05);
  } else {
    c.threshold.value = 0; c.knee.value = 0; c.ratio.value = 1;
    graph.out.gain.setTargetAtTime(1, t, 0.05);
  }
}
