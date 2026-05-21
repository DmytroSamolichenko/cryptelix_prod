export function CryptelixLogo() {
  return (
    <div className="flex items-center">
      <div className="w-[330px] overflow-hidden rounded-xl">
        <img
          src="/cryptelix-logo.png"
          alt="Cryptelix"
          className="h-13 w-full object-cover object-center select-none"
          draggable={false}
        />
      </div>
    </div>
  );
}