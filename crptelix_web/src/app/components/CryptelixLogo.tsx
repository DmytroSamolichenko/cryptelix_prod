interface CryptelixLogoProps {
  showAlpha?: boolean;
}

export function CryptelixLogo({ showAlpha = true }: CryptelixLogoProps) {
  return (
    <div className="flex min-w-0 items-end">
      <div className="w-[7.5rem] shrink-0 overflow-hidden rounded-lg sm:w-[10rem] md:w-[12.5rem] lg:w-[15rem] xl:w-[17.5rem]">
        <img
          src="/cryptelix-logo.png"
          alt="Cryptelix"
          className="h-6 w-full object-cover object-center select-none sm:h-7"
          draggable={false}
        />
      </div>
      {showAlpha && (
        <span
          className="cryptelix-alpha-badge -ml-5 select-none text-[10px] font-semibold uppercase leading-none text-zinc-400 sm:-ml-7 sm:text-[11px] md:-ml-9 md:text-[12px] lg:-ml-11 lg:text-[13px]"
          aria-hidden
        >
          Alpha
        </span>
      )}
    </div>
  );
}