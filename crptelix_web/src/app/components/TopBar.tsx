import { TrendingUp, Wallet, Link2, Bot, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from './ui/utils';
import { CryptelixLogo } from './CryptelixLogo';
import { ConnectBrokerModal } from './modals/ConnectBrokerModal';
import { ConnectTradingViewModal } from './modals/ConnectTradingViewModal';
import { UserProfileModal } from './UserProfileModal';
import { motion } from 'motion/react';
import { apiFetch } from '../lib/apiClient';

interface TopBarProps {
  userEmail: string;
  userSignedInAt: string;
  onLogout: () => void;
  currentView: 'constructor' | 'database';
  onViewChange: (view: 'constructor' | 'database') => void;
  onWidgetsToggle: () => void;
  onChatToggle: () => void;
  isChatOpen: boolean;
  isWidgetsOpen: boolean;
}

export function TopBar({
  userEmail,
  userSignedInAt,
  onLogout,
  currentView,
  onViewChange,
  onWidgetsToggle: _onWidgetsToggle,
  onChatToggle,
  isChatOpen,
}: TopBarProps) {
  const [connectedExchangeCount, setConnectedExchangeCount] = useState(0);
  const [connections, setConnections] = useState({
    broker: false,
    tradingView: false,
  });

  const [modals, setModals] = useState({
    broker: false,
    tradingView: false,
  });

  const [isUserProfileOpen, setIsUserProfileOpen] = useState(false);

  const refreshConnectionStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/exchanges/credentials/status');
      if (!res.ok) return;
      const payload = (await res.json()) as {
        connected_exchanges?: string[];
        binance_connected?: boolean;
      };
      const count = payload.connected_exchanges?.length ?? 0;
      setConnectedExchangeCount(count);
      setConnections((prev) => ({
        ...prev,
        broker: count > 0 || Boolean(payload.binance_connected),
      }));
    } catch {
      // keep local fallback state if API is unavailable
    }
  }, []);

  useEffect(() => {
    void refreshConnectionStatus();
  }, [refreshConnectionStatus]);

  const openModal = (type: 'broker' | 'tradingView') => {
    setModals((prev) => ({ ...prev, [type]: true }));
  };

  const closeModal = (type: 'broker' | 'tradingView') => {
    setModals((prev) => ({ ...prev, [type]: false }));
  };

  const handleBrokerConnect = () => {
    void refreshConnectionStatus();
  };

  const totalConnections = connectedExchangeCount;

  return (
    <>
      <div className="flex h-12 shrink-0 items-center border-b border-zinc-900/80 bg-black px-2 sm:px-3">
        <div className="flex shrink-0 items-center self-center">
          <CryptelixLogo />
        </div>

        <div className="scrollbar-hidden ml-auto flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto sm:gap-2">
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <motion.button
                onClick={() => openModal('broker')}
                className={cn(
                  'group flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-lg border px-1.5 sm:h-9 sm:min-w-9',
                  connectedExchangeCount > 0
                    ? 'border-green-500/40 bg-green-500/10 shadow-[0_0_12px_rgba(34,197,94,0.15)]'
                    : 'border-zinc-700/50 bg-zinc-900/40 hover:border-yellow-500/40 hover:bg-zinc-800/40'
                )}
                title="Connect Broker"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <TrendingUp
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    connectedExchangeCount > 0
                      ? 'text-green-400'
                      : 'text-gray-400 group-hover:text-yellow-400'
                  )}
                />
                {connectedExchangeCount > 0 && (
                  <span className="text-[11px] font-bold leading-none tabular-nums text-green-400">
                    {connectedExchangeCount}
                  </span>
                )}
              </motion.button>

              <button
                type="button"
                disabled
                className="flex h-8 min-w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-lg border border-zinc-800/50 bg-zinc-900/20 px-1.5 opacity-70 sm:h-9 sm:min-w-9"
                title="Wallet — Coming Soon"
              >
                <Wallet className="h-3.5 w-3.5 shrink-0 text-gray-600" />
                <span className="ml-1 hidden text-[8px] font-medium leading-tight text-gray-500 xl:inline">
                  <span className="block">Coming</span>
                  <span className="block">Soon</span>
                </span>
              </button>

              <button
                type="button"
                disabled
                className="flex h-8 min-w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-lg border border-zinc-800/50 bg-zinc-900/20 px-1.5 opacity-70 sm:h-9 sm:min-w-9"
                title="TradingView — Coming Soon"
              >
                <Link2 className="h-3.5 w-3.5 shrink-0 text-gray-600" />
                <span className="ml-1 hidden text-[8px] font-medium leading-tight text-gray-500 xl:inline">
                  <span className="block">Coming</span>
                  <span className="block">Soon</span>
                </span>
              </button>
            </div>

            <div className="mx-1 hidden h-6 w-px shrink-0 bg-zinc-700/50 sm:block" />

            <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-0.5 sm:gap-1 sm:p-1">
              <motion.button
                onClick={() => onViewChange('constructor')}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium transition-all sm:px-3 sm:py-1.5 sm:text-sm',
                  currentView === 'constructor'
                    ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/50'
                    : 'text-gray-400 hover:bg-zinc-800/50 hover:text-white'
                )}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <span className="sm:hidden">Build</span>
                <span className="hidden sm:inline">Constructor</span>
              </motion.button>
              <motion.button
                onClick={() => onViewChange('database')}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium transition-all sm:px-3 sm:py-1.5 sm:text-sm',
                  currentView === 'database'
                    ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/50'
                    : 'text-gray-400 hover:bg-zinc-800/50 hover:text-white'
                )}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <span className="sm:hidden">Deals</span>
                <span className="hidden sm:inline">Deal Base</span>
              </motion.button>
            </div>

            <div className="mx-1 hidden h-6 w-px shrink-0 bg-zinc-700/50 md:block" />

            <motion.button
              onClick={onChatToggle}
              className={cn(
                'flex h-8 shrink-0 items-center justify-center rounded-lg border px-2 text-xs font-medium transition-all sm:h-9 sm:px-3 sm:text-sm',
                isChatOpen
                  ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400'
                  : 'border-zinc-700/50 bg-zinc-900/40 text-gray-400 hover:border-yellow-500/40 hover:bg-zinc-800/40 hover:text-white'
              )}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="AI Assistant"
            >
              <Bot className="h-4 w-4 shrink-0" />
              <span className="ml-1.5 hidden lg:inline">AI Assistant</span>
            </motion.button>

            <div className="mx-1 hidden h-6 w-px shrink-0 bg-zinc-700/50 md:block" />

            <motion.button
              onClick={() => setIsUserProfileOpen(true)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-700/50 bg-zinc-900/40 transition-all hover:border-yellow-500/40 hover:bg-zinc-800/40 sm:h-9 sm:w-9"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              title="User profile"
            >
              <User className="h-4 w-4 text-gray-400" />
            </motion.button>
        </div>
      </div>

      <ConnectBrokerModal
        isOpen={modals.broker}
        onClose={() => closeModal('broker')}
        onConnect={handleBrokerConnect}
      />
      <ConnectTradingViewModal
        isOpen={modals.tradingView}
        onClose={() => closeModal('tradingView')}
        onConnect={() => {}}
      />

      <UserProfileModal
        isOpen={isUserProfileOpen}
        onClose={() => setIsUserProfileOpen(false)}
        email={userEmail}
        signedInAt={userSignedInAt}
        onLogout={onLogout}
        totalConnections={totalConnections}
        connections={connections}
      />
    </>
  );
}
