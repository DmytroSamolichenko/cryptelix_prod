import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number, decimals: number = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '';
  }

  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  // Use fixed-point to avoid scientific notation, then trim trailing zeros.
  const fixed = abs.toFixed(decimals);
  const [rawIntPart, rawFracPart = ''] = fixed.split('.');
  const trimmedFrac = rawFracPart.replace(/0+$/, '');

  const intPartNumber = Number(rawIntPart);
  const intFormatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(intPartNumber);

  if (trimmedFrac.length === 0) {
    return `${sign}${intFormatted}`;
  }

  return `${sign}${intFormatted}.${trimmedFrac}`;
}
