const NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  BNB: 'BNB',
  XRP: 'XRP',
  DOGE: 'Dogecoin',
  ADA: 'Cardano',
  AVAX: 'Avalanche',
  DOT: 'Polkadot',
  LINK: 'Chainlink',
  LTC: 'Litecoin',
  UNI: 'Uniswap',
  ATOM: 'Cosmos',
  NEAR: 'NEAR',
  APT: 'Aptos',
  SUI: 'Sui',
  ARB: 'Arbitrum',
  OP: 'Optimism',
};

export function assetDisplayName(base: string): string {
  const key = base.trim().toUpperCase();
  return NAMES[key] ?? key;
}

export function CoinLogo({
  symbol,
  className = 'h-8 w-8',
}: {
  symbol: string;
  className?: string;
}) {
  const base = symbol.trim().toUpperCase();

  if (base === 'BTC') {
    return (
      <svg viewBox="0 0 32 32" className={className} aria-hidden>
        <circle cx="16" cy="16" r="16" fill="#F7931A" />
        <path
          fill="#fff"
          d="M23.2 14.1c.3-2.1-1.3-3.2-3.5-4l.7-2.9-1.7-.4-.7 2.8c-.5-.1-.9-.2-1.4-.3l.7-2.8-1.7-.4-.7 2.9c-.4-.1-.8-.2-1.1-.3l.1-.1-2.4-.6-.5 1.8s1.3.3 1.2.3c.7.2.8.6.8 1l-.8 3.3c.1 0 .1 0 .2.1h-.2l-1.2 4.6c-.1.2-.3.6-.1.9-.2 0-1.2-.3-1.2-.3l-.8 1.9 2.2.5c.4.1.8.2 1.2.3l-.7 3 1.7.4.7-3c.5.1 1 .3 1.4.3l-.7 3 1.7.4.7-2.9c3 0 5.3-1.5 5.9-4.1.5-2-.1-3.2-1.5-3.8 1.1-.3 1.9-1 2.1-2.6zm-3.8 5.3c-.4 1.5-2.8.7-3.6.5l.6-2.6c.8.2 3.4.6 3 2.1zm.4-5.3c-.3 1.4-2.2.7-2.8.5l.6-2.3c.6.2 2.6.5 2.2 1.8z"
        />
      </svg>
    );
  }

  if (base === 'ETH') {
    return (
      <svg viewBox="0 0 32 32" className={className} aria-hidden>
        <circle cx="16" cy="16" r="16" fill="#627EEA" />
        <path fill="#fff" fillOpacity="0.7" d="M16.5 5v8.2l6.9 3.1L16.5 5z" />
        <path fill="#fff" d="M16.5 5 9.6 16.3l6.9-3.1V5z" />
        <path fill="#fff" fillOpacity="0.7" d="M16.5 21.97v5.02l7-9.67-7 4.65z" />
        <path fill="#fff" d="M16.5 27v-5.03l-6.99-4.64L16.5 27z" />
        <path fill="#fff" fillOpacity="0.4" d="m16.5 20.57 6.9-4.27-6.9-3.1v7.37z" />
        <path fill="#fff" fillOpacity="0.6" d="m9.6 16.3 6.9 4.27v-7.37l-6.9 3.1z" />
      </svg>
    );
  }

  if (base === 'SOL') {
    return (
      <svg viewBox="0 0 32 32" className={className} aria-hidden>
        <defs>
          <linearGradient id="cryptelix-sol-g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00FFA3" />
            <stop offset="100%" stopColor="#DC1FFF" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="16" fill="#000" />
        <path
          fill="url(#cryptelix-sol-g)"
          d="M10.4 19.6c.2-.2.4-.3.7-.3h10.5c.5 0 .7.6.4.9l-2.1 2.1c-.2.2-.4.3-.7.3H8.7c-.5 0-.7-.6-.4-.9l2.1-2.1zm0-9.7c.2-.2.4-.3.7-.3h10.5c.5 0 .7.6.4.9l-2.1 2.1c-.2.2-.4.3-.7.3H8.7c-.5 0-.7-.6-.4-.9l2.1-2.1zm11.2 4.6c-.2-.2-.4-.3-.7-.3H10.4c-.5 0-.7.6-.4.9l2.1 2.1c.2.2.4.3.7.3h10.5c.5 0 .7-.6.4-.9l-2.1-2.1z"
        />
      </svg>
    );
  }

  const letter = base.slice(0, 1) || '?';
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="16" fill="#2a261c" />
      <circle cx="16" cy="16" r="15" fill="#1a1814" stroke="#C9A84C" strokeWidth="1.2" />
      <text
        x="16"
        y="21"
        textAnchor="middle"
        fill="#C9A84C"
        fontSize="13"
        fontFamily="system-ui, sans-serif"
        fontWeight="600"
      >
        {letter}
      </text>
    </svg>
  );
}
