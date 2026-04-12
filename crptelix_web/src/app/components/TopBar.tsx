import { TrendingUp, Wallet, Link2, Check, Bot, LayoutGrid, User } from 'lucide-react';
import { useState } from 'react';
import { CryptelixLogo } from './CryptelixLogo';
import { ConnectWalletModal } from './modals/ConnectWalletModal';
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
  const [connections, setConnections] = useState({
    broker: false,
    wallet: false,
    tradingView: false,
  });

  const [modals, setModals] = useState({
    wallet: false,
    broker: false,
    tradingView: false,
  });

  const [isUserProfileOpen, setIsUserProfileOpen] = useState(false);

  const toggleConnection = (type: 'broker' | 'wallet' | 'tradingView') => {
    setConnections((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const openModal = (type: 'wallet' | 'broker' | 'tradingView') => {
    setModals((prev) => ({ ...prev, [type]: true }));
  };

  const closeModal = (type: 'wallet' | 'broker' | 'tradingView') => {
    setModals((prev) => ({ ...prev, [type]: false }));
  };

  const handleConnect = (type: 'broker' | 'wallet' | 'tradingView') => {
    toggleConnection(type);
  };

  const totalConnections = Object.values(connections).filter(Boolean).length;

  return (
    <>
      <div className="h-14 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/50 flex items-center justify-between px-4">
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
              onClick={() => connections.broker ? toggleConnection('broker') : openModal('broker')}
              className={`group relative w-9 h-9 rounded-lg border transition-all ${
                connections.broker
                  ? 'bg-green-500/10 border-green-500/30'
                  : 'bg-zinc-900/40 border-zinc-700/50 hover:border-yellow-500/40 hover:bg-zinc-800/40'
              }`}
              title="Connect Broker"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <div className="flex items-center justify-center w-full h-full relative">
                <TrendingUp className={`w-4 h-4 ${connections.broker ? 'text-green-400' : 'text-gray-400 group-hover:text-yellow-400'}`} />
                {connections.broker && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center"
                  >
                    <Check className="w-2 h-2 text-black" />
                  </motion.div>
                )}
              </div>
            </motion.button>

            {/* Crypto Wallet Connection */}
            <motion.button
              onClick={() => connections.wallet ? toggleConnection('wallet') : openModal('wallet')}
              className={`group relative w-9 h-9 rounded-lg border transition-all ${
                connections.wallet
                  ? 'bg-green-500/10 border-green-500/30'
                  : 'bg-zinc-900/40 border-zinc-700/50 hover:border-yellow-500/40 hover:bg-zinc-800/40'
              }`}
              title="Connect Wallet"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <div className="flex items-center justify-center w-full h-full relative">
                <Wallet className={`w-4 h-4 ${connections.wallet ? 'text-green-400' : 'text-gray-400 group-hover:text-yellow-400'}`} />
                {connections.wallet && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center"
                  >
                    <Check className="w-2 h-2 text-black" />
                  </motion.div>
                )}
              </div>
            </motion.button>

            {/* TradingView Connection - Coming Soon */}
            <button
              disabled
              className="group relative w-9 h-9 rounded-lg border bg-zinc-900/20 border-zinc-800/50 cursor-not-allowed opacity-60"
              title="Coming Soon"
            >
              <div className="flex items-center justify-center w-full h-full relative">
                <Link2 className="w-4 h-4 text-gray-600" />
              </div>
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                Coming Soon
              </div>
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
      <ConnectWalletModal isOpen={modals.wallet} onClose={() => closeModal('wallet')} onConnect={() => handleConnect('wallet')} />
      <ConnectBrokerModal isOpen={modals.broker} onClose={() => closeModal('broker')} onConnect={() => handleConnect('broker')} />
      <ConnectTradingViewModal isOpen={modals.tradingView} onClose={() => closeModal('tradingView')} onConnect={() => handleConnect('tradingView')} />
      
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