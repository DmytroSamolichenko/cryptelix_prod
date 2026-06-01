/** Global UI compactness — ~85% of the original layout. */
export const UI_SCALE = 0.85;

export const DEFAULT_CANVAS_ZOOM = UI_SCALE;

export function scalePx(value: number): number {
  return Math.round(value * UI_SCALE);
}

export function scaleSize(width: number, height: number): { width: number; height: number } {
  return { width: scalePx(width), height: scalePx(height) };
}
