export const WIN = '#22B864';
export const LOSS = '#E5484D';
export const WIN_RGB = '34, 184, 100';
export const LOSS_RGB = '229, 72, 77';

export function heatFill(net: number, maxAbs: number): string | null {
  if (maxAbs <= 0 || net === 0) return null;
  const t = Math.min(1, Math.abs(net) / maxAbs);
  const alpha = 0.18 + t * 0.44;
  return `rgba(${net > 0 ? WIN_RGB : LOSS_RGB}, ${alpha})`;
}
