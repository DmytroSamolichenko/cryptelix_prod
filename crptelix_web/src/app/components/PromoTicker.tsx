const MESSAGE = 'Use Phoenix to get the best prices on Solana';
const REPEATS_PER_HALF = 8;

function TickerHalf({ hidden }: { hidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {Array.from({ length: REPEATS_PER_HALF }, (_, i) => (
        <span key={i} className="flex shrink-0 items-center">
          <span className="whitespace-nowrap px-10">{MESSAGE}</span>
          <span className="h-1 w-1 shrink-0 rounded-full bg-[#8C8960]" />
        </span>
      ))}
    </div>
  );
}

export function PromoTicker() {
  return (
    <div
      className="promo-ticker relative h-8 shrink-0 select-none overflow-hidden border-y border-[#C9A84C]/60 bg-[#09090b] text-[13px] font-medium text-[#C9A84C]"
      role="marquee"
      aria-label={MESSAGE}
    >
      <div className="promo-ticker-track flex h-full w-max items-center">
        <TickerHalf />
        <TickerHalf hidden />
      </div>
    </div>
  );
}
