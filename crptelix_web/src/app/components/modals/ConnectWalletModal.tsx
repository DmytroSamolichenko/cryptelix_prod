import { X, Wallet, Shield, Zap, CheckCircle2, ExternalLink } from 'lucide-react';

interface ConnectWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: () => void;
}

const wallets = [
  {
    name: 'MetaMask',
    description: 'Connect to your MetaMask wallet',
    icon: '🦊',
    popular: true,
  },
  {
    name: 'WalletConnect',
    description: 'Scan with WalletConnect to connect',
    icon: '🔗',
    popular: true,
  },
  {
    name: 'Coinbase Wallet',
    description: 'Connect with Coinbase Wallet',
    icon: '💼',
    popular: false,
  },
  {
    name: 'Trust Wallet',
    description: 'Connect to Trust Wallet',
    icon: '🛡️',
    popular: false,
  },
  {
    name: 'Phantom',
    description: 'Solana wallet integration',
    icon: '👻',
    popular: false,
  },
  {
    name: 'Ledger',
    description: 'Hardware wallet connection',
    icon: '🔐',
    popular: false,
  },
];

export function ConnectWalletModal({ isOpen, onClose, onConnect }: ConnectWalletModalProps) {
  if (!isOpen) return null;

  const handleWalletConnect = (walletName: string) => {
    // Simulate connection
    console.log(`Connecting to ${walletName}...`);
    setTimeout(() => {
      onConnect();
      onClose();
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
      <div className="relative w-full max-w-2xl mx-4 bg-zinc-900 rounded-2xl border border-yellow-500/20 shadow-2xl shadow-yellow-500/10 overflow-hidden">
        {/* Header */}
        <div className="relative border-b border-zinc-800 bg-gradient-to-r from-zinc-900 via-zinc-900 to-yellow-500/5 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Connect Wallet</h2>
              <p className="text-sm text-gray-400">Choose your preferred wallet to connect</p>
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

        {/* Security Info */}
        <div className="px-6 py-4 bg-yellow-500/5 border-b border-yellow-500/10">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-gray-300">
                <span className="font-semibold text-white">Secure Connection:</span> We never store your private keys. 
                Your wallet connection is encrypted end-to-end.
              </p>
            </div>
          </div>
        </div>

        {/* Wallet Options */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          <div className="grid gap-3">
            {wallets.map((wallet) => (
              <button
                key={wallet.name}
                onClick={() => handleWalletConnect(wallet.name)}
                className="relative group w-full p-4 bg-zinc-800/50 hover:bg-zinc-800 rounded-xl border border-zinc-700/50 hover:border-yellow-500/50 transition-all text-left"
              >
                <div className="flex items-center gap-4">
                  {/* Icon */}
                  <div className="w-12 h-12 bg-zinc-900 rounded-lg flex items-center justify-center text-2xl border border-zinc-700 group-hover:border-yellow-500/50 transition-colors">
                    {wallet.icon}
                  </div>
                  
                  {/* Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-white">{wallet.name}</h3>
                      {wallet.popular && (
                        <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-500 text-xs font-medium rounded-full border border-yellow-500/30">
                          Popular
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-400">{wallet.description}</p>
                  </div>

                  {/* Arrow */}
                  <ExternalLink className="w-5 h-5 text-gray-500 group-hover:text-yellow-500 transition-colors" />
                </div>

                {/* Hover glow */}
                <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-r from-yellow-500/5 to-transparent" />
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-gray-400">
              <Zap className="w-4 h-4 text-yellow-500" />
              <span>Instant connection with Web3 providers</span>
            </div>
            <a href="#" className="text-yellow-500 hover:text-yellow-400 transition-colors flex items-center gap-1">
              Learn more
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}