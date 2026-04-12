import * as React from 'react';
import { X, Network, LogOut, Mail, Calendar, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
// import userAvatar from 'figma:asset/3aa8722a1504aeb8baf8d09f164eed60a164576a.png';
const userAvatar = 'https://via.placeholder.com/150';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalConnections: number;
  connections: {
    wallet: boolean;
    broker: boolean;
    tradingView: boolean;
  };
}

export function UserProfileModal({
  isOpen,
  onClose,
  totalConnections,
  connections,
}: UserProfileModalProps) {
  const handleLogout = () => {
    onClose();
    console.log('User logged out');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.2 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="relative h-24 bg-gradient-to-br from-yellow-500/20 via-zinc-900 to-zinc-900 border-b border-zinc-800">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-zinc-800/50 transition-colors group"
              >
                <X className="w-5 h-5 text-gray-400 group-hover:text-white" />
              </button>
              
              {/* Avatar */}
              <div className="absolute -bottom-12 left-6">
                <div className="w-24 h-24 rounded-xl border-4 border-zinc-900 bg-zinc-800 overflow-hidden shadow-xl">
                  <img 
                    src={userAvatar} 
                    alt="User Avatar" 
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="pt-16 px-6 pb-6">
              {/* User Info */}
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-white mb-1">CryptoTrader</h2>
                <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
                  <Mail className="w-4 h-4" />
                  <span>trader@cryptelix.io</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Member since March 2026</span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Network className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs text-gray-400">Active Connections</span>
                  </div>
                  <div className="text-2xl font-bold text-white">{totalConnections}</div>
                </div>

                <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-gray-400">Account Status</span>
                  </div>
                  <div className="text-sm font-semibold text-green-400">Active</div>
                </div>
              </div>

              {/* Connected Services */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Connected Services</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/30">
                    <span className="text-sm text-gray-300">Crypto Wallet</span>
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      connections.wallet 
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                        : 'bg-zinc-700/50 text-gray-500'
                    }`}>
                      {connections.wallet ? 'Connected' : 'Not Connected'}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/30">
                    <span className="text-sm text-gray-300">Trading Broker</span>
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      connections.broker 
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                        : 'bg-zinc-700/50 text-gray-500'
                    }`}>
                      {connections.broker ? 'Connected' : 'Not Connected'}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/30">
                    <span className="text-sm text-gray-300">TradingView</span>
                    <div className="px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                      Coming Soon
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2">
                <motion.button
                  onClick={handleLogout}
                  className="w-full p-3 flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg border border-red-500/30 hover:border-red-500/50 transition-all"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <LogOut className="w-4 h-4" />
                  <span className="font-medium">Log Out</span>
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
