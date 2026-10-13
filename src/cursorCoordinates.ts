/** Native cursor positions are physical window pixels. DOM pointer coordinates
 * use CSS pixels: Chromium's real DPR includes monitor DPI AND WebView zoom. */
export function cursorClientPoint(point: [number, number], pixelRatio: number): [number, number] | null {
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0 || !point.every(Number.isFinite)) return null;
  return [point[0] / pixelRatio, point[1] / pixelRatio];
}
