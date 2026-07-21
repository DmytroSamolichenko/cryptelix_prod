import { useEffect } from 'react';

const TRADES_SYNCED_EVENT = 'cryptelix:trades-synced';

/**
 * Re-run `onSynced` when Binance connect/sync finishes
 * (ConnectBrokerModal dispatches this window event).
 */
export function useTradesSynced(onSynced: () => void) {
  useEffect(() => {
    const handler = () => {
      onSynced();
    };
    window.addEventListener(TRADES_SYNCED_EVENT, handler);
    return () => window.removeEventListener(TRADES_SYNCED_EVENT, handler);
  }, [onSynced]);
}
