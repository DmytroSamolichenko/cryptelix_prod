interface CryptelixLogoProps {
  showAlpha?: boolean;
}

export function CryptelixLogo({ showAlpha = true }: CryptelixLogoProps) {
  return (
    <div className="flex items-end">
      <div className="w-[280px] shrink-0 overflow-hidden rounded-xl">
        <img
          src="/cryptelix-logo.png"
          alt="Cryptelix"
          className="h-7.5 w-full object-cover object-center select-none"
          draggable={false}
        />
      </div>
      {showAlpha && (
        <span
          className="cryptelix-alpha-badge -ml-12 select-none text-[13px] font-semibold uppercase leading-none text-zinc-400"
          aria-hidden
        >
          Alpha
        </span>
      )}
    </div>
  );
}