import { TrendingUp, Wallet, Link2, Bot, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from './ui/utils';
import { CryptelixLogo } from './CryptelixLogo';
import { ConnectBrokerModal } from './modals/ConnectBrokerModal';
import { ConnectTradingViewModal } from './modals/ConnectTradingViewModal';
import { UserProfileModal } from './UserProfileModal';
import { motion, AnimatePresence } from 'motion/react';

interface TopBarProps {
  currentView: 'constructor' | 'database';
  onViewChange: (view: 'constructor' | 'database') => void;
  onWidgetsToggle: () => void;
  onChatToggle: () => void;
  isChatOpen: boolean;
  isWidgetsOpen: boolean;
}

export function TopBar({ 
  currentView, 
  onViewChange, 
  onWidgetsToggle, 
  onChatToggle,
  isChatOpen,
  isWidgetsOpen
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
      const res = await fetch('http://localhost:8000/api/v1/exchanges/credentials/status');
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
      <div className="h-12 bg-black border-b border-zinc-900/80 flex items-center justify-between px-3">
        {/* Left Section - Logo Only */}
        <div className="flex items-center">
          <CryptelixLogo />
        </div>

        {/* Right Section - All Controls */}
        <div className="flex items-center gap-2">
          {/* Connection Icons */}
          <div className="flex items-center gap-2">
            {/* Broker Connection */}
            <motion.button
              onClick={() => openModal('broker')}
              className={cn(
                'group h-9 min-w-9 rounded-lg border px-1.5 transition-all flex items-center justify-center gap-1',
                connectedExchangeCount > 0
                  ? 'bg-green-500/10 border-green-500/40 shadow-[0_0_12px_rgba(34,197,94,0.15)]'
                  : 'bg-zinc-900/40 border-zinc-700/50 hover:border-yellow-500/40 hover:bg-zinc-800/40'
              )}
              title="Connect Broker"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <TrendingUp
                className={cn(
                  'w-3.5 h-3.5 shrink-0',
                  connectedExchangeCount > 0
                    ? 'text-green-400'
                    : 'text-gray-400 group-hover:text-yellow-400'
                )}
              />
              {connectedExchangeCount > 0 && (
                <span className="text-[11px] font-bold tabular-nums leading-none text-green-400">
                  {connectedExchangeCount}
                </span>
              )}
            </motion.button>

            {/* Crypto Wallet — Coming Soon */}
            <button
              type="button"
              disabled
              className="h-9 min-w-[3.25rem] rounded-lg border border-zinc-800/50 bg-zinc-900/20 px-1.5 flex items-center justify-center gap-1 cursor-not-allowed opacity-70"
              title="Wallet — Coming Soon"
            >
              <Wallet className="w-3.5 h-3.5 shrink-0 text-gray-600" />
              <span className="text-[8px] font-medium leading-tight text-gray-500 text-left">
                <span className="block">Coming</span>
                <span className="block">Soon</span>
              </span>
            </button>

            {/* TradingView — Coming Soon */}
            <button
              type="button"
              disabled
              className="h-9 min-w-[3.25rem] rounded-lg border border-zinc-800/50 bg-zinc-900/20 px-1.5 flex items-center justify-center gap-1 cursor-not-allowed opacity-70"
              title="TradingView — Coming Soon"
            >
              <Link2 className="w-3.5 h-3.5 shrink-0 text-gray-600" />
              <span className="text-[8px] font-medium leading-tight text-gray-500 text-left">
                <span className="block">Coming</span>
                <span className="block">Soon</span>
              </span>
            </button>
          </div>

          {/* Separator */}
          <div className="w-px h-6 bg-zinc-700/50 mx-2" />

          {/* View Switcher */}
          <div className="flex items-center gap-1 bg-zinc-900/50 rounded-lg p-1 border border-zinc-700/50">
            <motion.button
              onClick={() => onViewChange('constructor')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                currentView === 'constructor'
                  ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/50'
                  : 'text-gray-400 hover:text-white hover:bg-zinc-800/50'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Constructor
            </motion.button>
            <motion.button
              onClick={() => onViewChange('database')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                currentView === 'database'
                  ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/50'
                  : 'text-gray-400 hover:text-white hover:bg-zinc-800/50'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Deal Base
            </motion.button>
          </div>

          {/* Separator */}
          <div className="w-px h-6 bg-zinc-700/50 mx-2" />

          {/* AI Assistant Toggle */}
          <motion.button
            onClick={onChatToggle}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              isChatOpen
                ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-400'
                : 'bg-zinc-900/40 border-zinc-700/50 text-gray-400 hover:text-white hover:border-yellow-500/40 hover:bg-zinc-800/40'
            }`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4" />
              AI Assistant
            </div>
          </motion.button>

          {/* Separator */}
          <div className="w-px h-6 bg-zinc-700/50 mx-2" />

          {/* User Profile Button */}
          <motion.button
            onClick={() => setIsUserProfileOpen(true)}
            className="w-9 h-9 rounded-lg border bg-zinc-900/40 border-zinc-700/50 hover:border-yellow-500/40 hover:bg-zinc-800/40 transition-all flex items-center justify-center"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            <User className="w-4 h-4 text-gray-400" />
          </motion.button>
        </div>
      </div>

      {/* Modals */}
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
      
      {/* User Profile Modal */}
      <UserProfileModal
        isOpen={isUserProfileOpen}
        onClose={() => setIsUserProfileOpen(false)}
        totalConnections={totalConnections}
        connections={connections}
      />
    </>
  );
}