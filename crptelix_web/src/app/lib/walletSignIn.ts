import { useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitProvider } from '@reown/appkit/react';
import { useSignMessage } from 'wagmi';
import { REOWN_ENABLED } from './reownConfig';
import { apiFetch } from './apiClient';
import type { AuthSession } from './authStorage';

type WalletChain = 'eip155' | 'solana';

interface NonceResponse {
  nonce: string;
  message: string;
}

interface TokenResponse {
  access_token: string;
  csrf_token?: string | null;
  user: { id: number; email?: string | null; username?: string | null };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function resolveChain(caipNetworkId: string | undefined, address: string): WalletChain {
  if (caipNetworkId?.startsWith('solana:')) return 'solana';
  if (caipNetworkId?.startsWith('eip155:')) return 'eip155';
  return address.startsWith('0x') ? 'eip155' : 'solana';
}

function fillMessage(template: string, address: string, chain: WalletChain): string {
  return template.replaceAll('{address}', address).replaceAll('{chain}', chain);
}

function toSession(data: TokenResponse): AuthSession {
  return {
    accessToken: data.access_token,
    csrfToken: data.csrf_token ?? undefined,
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
      username: data.user.username ?? null,
      signedInAt: new Date().toISOString(),
    },
  };
}

async function verifyWallet(payload: {
  chain: WalletChain;
  address: string;
  message: string;
  signature: string;
  turnstileToken?: string;
}): Promise<AuthSession> {
  const verifyRes = await apiFetch('/api/v1/auth/wallet/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chain: payload.chain,
      address: payload.address,
      message: payload.message,
      signature: payload.signature,
      turnstile_token: payload.turnstileToken || undefined,
    }),
  });
  if (verifyRes.status === 429) {
    throw new Error('Too many attempts. Please wait a minute and try again.');
  }
  if (!verifyRes.ok) {
    const body = (await verifyRes.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail || 'Wallet sign-in failed.');
  }
  return toSession((await verifyRes.json()) as TokenResponse);
}

/** Used only under WalletProviders (Reown configured). */
export function useConfiguredWalletSignIn() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { caipNetwork } = useAppKitNetwork();
  const { walletProvider: solanaProvider } = useAppKitProvider<
    { signMessage: (msg: Uint8Array) => Promise<Uint8Array> } | undefined
  >('solana');
  const { signMessageAsync } = useSignMessage();

  const signIn = async (turnstileToken?: string): Promise<AuthSession> => {
    if (!isConnected || !address) {
      await open();
      throw new Error('Connect a wallet in the popup, then tap Continue with wallet again.');
    }

    const chain = resolveChain(
      typeof caipNetwork?.id === 'string' ? caipNetwork.id : undefined,
      address
    );

    const nonceRes = await apiFetch('/api/v1/auth/wallet/nonce');
    if (!nonceRes.ok) {
      throw new Error('Could not start wallet sign-in.');
    }
    const nonceBody = (await nonceRes.json()) as NonceResponse;
    const message = fillMessage(nonceBody.message, address, chain);

    let signature: string;
    if (chain === 'eip155') {
      signature = await signMessageAsync({ message });
    } else {
      if (!solanaProvider?.signMessage) {
        throw new Error('Solana wallet is not ready to sign.');
      }
      const signed = await solanaProvider.signMessage(new TextEncoder().encode(message));
      const bytes = signed instanceof Uint8Array ? signed : new Uint8Array(signed);
      signature = bytesToHex(bytes);
    }

    return verifyWallet({ chain, address, message, signature, turnstileToken });
  };

  return { signIn, isConnected, address };
}

export { REOWN_ENABLED };
