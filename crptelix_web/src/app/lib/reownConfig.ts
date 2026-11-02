import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { SolanaAdapter } from '@reown/appkit-adapter-solana/react';
import { mainnet, base, solana, solanaDevnet } from '@reown/appkit/networks';

// Dashboard Project ID. Empty VITE_REOWN_PROJECT_ID in .env.local still counts
// as "set" for Vite — trim and fall back. The public ID is Reown's localhost-only
// demo key (see AppKit skill); production must set a real VITE_REOWN_PROJECT_ID.
const LOCALHOST_PROJECT_ID = 'b56e18d47c72ab683b10814fe9495694';

export const reownProjectId = (
  (import.meta.env.VITE_REOWN_PROJECT_ID as string | undefined)?.trim() ||
  (import.meta.env.DEV ? LOCALHOST_PROJECT_ID : '')
);

const evmAndSolana = import.meta.env.DEV
  ? ([mainnet, base, solana, solanaDevnet] as const)
  : ([mainnet, base, solana] as const);

export const wagmiAdapter = reownProjectId
  ? new WagmiAdapter({
      networks: [...evmAndSolana],
      projectId: reownProjectId,
    })
  : null;

const solanaAdapter = new SolanaAdapter();

if (reownProjectId && wagmiAdapter) {
  createAppKit({
    adapters: [wagmiAdapter, solanaAdapter],
    networks: [...evmAndSolana],
    projectId: reownProjectId,
    metadata: {
      name: 'Cryptelix',
      description: 'Cryptelix analytical workspace',
      url: 'https://cryptelix.app',
      icons: ['https://cryptelix.app/favicon.ico'],
    },
    features: {
      analytics: false,
      // Off: AppKit defaults these ON even if dashboard "Social & Email" is OFF.
      // Our auth is wallet signature → Cryptelix JWT; Google/email here would be
      // Reown embedded wallets, not wired to our backend.
      email: false,
      socials: false,
    },
  });
}

export const REOWN_ENABLED = Boolean(reownProjectId && wagmiAdapter);
