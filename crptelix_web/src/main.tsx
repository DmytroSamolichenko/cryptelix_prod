import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import App from './app/App.tsx';
import { wagmiAdapter } from './app/lib/reownConfig';
import './styles/index.css';

const queryClient = new QueryClient();

function Root() {
  if (!wagmiAdapter) {
    return <App />;
  }
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    <Root />
    <Analytics />
  </>
);
