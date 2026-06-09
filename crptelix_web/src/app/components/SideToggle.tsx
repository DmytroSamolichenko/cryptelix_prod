import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from './ui/utils';

export type TradeSide = 'Long' | 'Short';

export function normalizeTradeSide(value: string | undefined | null): TradeSide {
  return String(value ?? 'Long').toLowerCase() === 'short' ? 'Short' : 'Long';
}

interface SideToggleProps {
  value: string;
  onChange?: (side: TradeSide) => void;
  disabled?: boolean;
  className?: string;
}

export function SideToggle({ value, onChange, disabled = false, className }: SideToggleProps) {
  const side = normalizeTradeSide(value);
  const isShort = side === 'Short';
  const isInteractive = !disabled && Boolean(onChange);

  const handleClick = () => {
    if (!isInteractive) return;
    onChange!(isShort ? 'Long' : 'Short');
  };

  const iconClass = cn(
    'h-5 w-5',
    isShort
      ? disabled
        ? 'text-red-500/75'
        : 'text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.45)]'
      : disabled
        ? 'text-green-600/80'
        : 'text-green-400 drop-shadow-[0_0_6px_rgba(74,222,128,0.45)]'
  );

  const labelClass = cn(
    'text-xs font-semibold tracking-wide',
    isShort
      ? disabled
        ? 'text-red-500/70'
        : 'text-red-400 group-hover:text-red-300'
      : disabled
        ? 'text-green-600/75'
        : 'text-green-400 group-hover:text-green-300'
  );

  const content = (
    <>
      {isShort ? (
        <TrendingDown className={iconClass} aria-hidden />
      ) : (
        <TrendingUp className={iconClass} aria-hidden />
      )}
      <span className={labelClass}>{side}</span>
    </>
  );

  const sharedClass = cn(
    'group flex w-full min-w-[3.25rem] flex-col items-center justify-center gap-0.5 py-1 transition-colors',
    isInteractive && 'cursor-pointer active:scale-[0.97]',
    !isInteractive && 'cursor-default',
    className
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={isShort ? 'Click to select Long' : 'Click to select Short'}
        className={sharedClass}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      role="img"
      aria-label={side}
      title={`${side} (cannot be changed)`}
      className={sharedClass}
    >
      {content}
    </div>
  );
}
