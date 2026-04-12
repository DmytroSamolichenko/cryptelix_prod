import { X, TrendingUp, Shield, BarChart3, ExternalLink, Lock, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

interface ConnectBrokerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: () => void;
}

const brokers = [
  {
    name: 'Interactive Brokers',
    description: 'Professional trading platform with global access',
    logo: '📊',
    features: ['Stocks', 'Options', 'Futures', 'Forex'],
    popular: true,
  },
  {
    name: 'TD Ameritrade',
    description: 'Comprehensive trading and research platform',
    logo: '🎯',
    features: ['Stocks', 'ETFs', 'Options', 'Crypto'],
    popular: true,
  },
  {
    name: 'Binance',
    description: 'Leading cryptocurrency exchange',
    logo: '🔶',
    features: ['Spot', 'Futures', 'Margin', 'Staking'],
    popular: true,
  },
  {
    name: 'Coinbase Pro',
    description: 'Advanced crypto trading platform',
    logo: '💠',
    features: ['Crypto', 'Advanced Orders', 'API Trading'],
    popular: false,
  },
  {
    name: 'Kraken',
    description: 'Secure cryptocurrency exchange',
    logo: '🦑',
    features: ['Spot', 'Futures', 'Staking', 'NFTs'],
    popular: false,
  },
  {
    name: 'Alpaca',
    description: 'Commission-free API trading',
    logo: '🦙',
    features: ['Stocks', 'API', 'Algo Trading', 'Paper Trading'],
    popular: false,
  },
];

export function ConnectBrokerModal({ isOpen, onClose, onConnect }: ConnectBrokerModalProps) {
  const [selectedBroker, setSelectedBroker] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');

  if (!isOpen) return null;

  const handleBrokerSelect = (brokerName: string) => {
    setSelectedBroker(brokerName);
  };

  const handleConnect = () => {
    if (!selectedBroker || !apiKey || !apiSecret) return;
    
    // Simulate API connection
    console.log(`Connecting to ${selectedBroker}...`);
    setTimeout(() => {
      onConnect();
      onClose();
      setSelectedBroker(null);
      setApiKey('');
      setApiSecret('');
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-4xl mx-4 bg-zinc-900 rounded-2xl border border-yellow-500/20 shadow-2xl shadow-yellow-500/10 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="relative border-b border-zinc-800 bg-gradient-to-r from-zinc-900 via-zinc-900 to-yellow-500/5 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Connect Broker</h2>
              <p className="text-sm text-gray-400">Link your trading account to sync data automatically</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-zinc-800 rounded-lg transition-colors z-10 relative"
            >
              <X className="w-5 h-5 text-gray-300 hover:text-white" />
            </button>
          </div>
          
          {/* Decorative glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/10 blur-3xl rounded-full pointer-events-none" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid md:grid-cols-2 gap-6 p-6">
            {/* Left: Broker Selection */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-yellow-500" />
                Select Your Broker
              </h3>
              <div className="space-y-2">
                {brokers.map((broker) => (
                  <button
                    key={broker.name}
                    onClick={() => handleBrokerSelect(broker.name)}
                    className={`relative group w-full p-4 rounded-xl border transition-all text-left ${
                      selectedBroker === broker.name
                        ? 'bg-yellow-500/10 border-yellow-500/50'
                        : 'bg-zinc-800/50 border-zinc-700/50 hover:bg-zinc-800 hover:border-yellow-500/30'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Logo */}
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl border transition-colors ${
                        selectedBroker === broker.name
                          ? 'bg-yellow-500/20 border-yellow-500/50'
                          : 'bg-zinc-900 border-zinc-700'
                      }`}>
                        {broker.logo}
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-white text-sm">{broker.name}</h4>
                          {broker.popular && (
                            <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-500 text-xs font-medium rounded border border-yellow-500/30">
                              Popular
                            </span>
                          )}
                          {selectedBroker === broker.name && (
                            <CheckCircle2 className="w-4 h-4 text-yellow-500 ml-auto" />
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mb-2">{broker.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {broker.features.map((feature) => (
                            <span
                              key={feature}
                              className="px-2 py-0.5 bg-zinc-900/80 text-gray-400 text-xs rounded border border-zinc-700"
                            >
                              {feature}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right: API Configuration */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <Lock className="w-4 h-4 text-yellow-500" />
                API Credentials
              </h3>
              
              {selectedBroker ? (
                <div className="space-y-4">
                  {/* Security Notice */}
                  <div className="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
                    <div className="flex gap-3">
                      <Shield className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="text-gray-300 mb-1">
                          <span className="font-semibold text-white">Your data is secure.</span>
                        </p>
                        <p className="text-gray-400 text-xs">
                          API credentials are encrypted and stored securely. We never access your funds.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* API Key Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      API Key
                    </label>
                    <input
                      type="text"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Enter your API key"
                      className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 transition-colors"
                    />
                  </div>

                  {/* API Secret Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      API Secret
                    </label>
                    <input
                      type="password"
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      placeholder="Enter your API secret"
                      className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 transition-colors"
                    />
                  </div>

                  {/* Permissions */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Permissions Required
                    </label>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-gray-400">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span>Read account data</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-400">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span>Read trading history</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-400">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span>Read portfolio positions</span>
                      </div>
                    </div>
                  </div>

                  {/* Connect Button */}
                  <button
                    onClick={handleConnect}
                    disabled={!apiKey || !apiSecret}
                    className="w-full px-6 py-3 bg-yellow-500 hover:bg-yellow-600 disabled:bg-zinc-700 disabled:text-gray-500 text-black font-semibold rounded-lg transition-all disabled:cursor-not-allowed shadow-lg shadow-yellow-500/20 disabled:shadow-none"
                  >
                    Connect {selectedBroker}
                  </button>

                  {/* Help Link */}
                  <a
                    href="#"
                    className="flex items-center justify-center gap-1 text-sm text-yellow-500 hover:text-yellow-400 transition-colors"
                  >
                    <span>How to get API credentials</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center p-8 text-center">
                  <div>
                    <BarChart3 className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400 text-sm">
                      Select a broker from the list to configure API access
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}