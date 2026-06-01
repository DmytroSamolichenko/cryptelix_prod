import { X, TrendingUp, Shield, BarChart3, ExternalLink, Lock, CheckCircle2, Unplug } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '../ui/utils';

interface ConnectBrokerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: () => void;
}

const brokers = [
  {
    name: 'Interactive Brokers',
    exchangeId: null,
    description: 'Professional trading platform with global access',
    logoUrl: '/broker-logos/interactive-brokers.png',
    logoFallback: 'IB',
    features: ['Stocks', 'Options', 'Futures', 'Forex'],
    popular: true,
  },
  {
    name: 'TD Ameritrade',
    exchangeId: null,
    description: 'Comprehensive trading and research platform',
    logoUrl: '/broker-logos/td-ameritrade.png',
    logoFallback: 'TD',
    features: ['Stocks', 'ETFs', 'Options', 'Crypto'],
    popular: true,
  },
  {
    name: 'Binance',
    exchangeId: 'binance',
    description: 'Leading cryptocurrency exchange',
    logoUrl: '/broker-logos/binance.png',
    logoFallback: 'BN',
    features: ['Spot', 'Futures', 'Margin', 'Staking'],
    popular: true,
  },
  {
    name: 'Coinbase Pro',
    exchangeId: 'coinbase',
    description: 'Advanced crypto trading platform',
    logoUrl: '/broker-logos/coinbase.png',
    logoFallback: 'CB',
    features: ['Crypto', 'Advanced Orders', 'API Trading'],
    popular: false,
  },
  {
    name: 'Kraken',
    exchangeId: 'kraken',
    description: 'Secure cryptocurrency exchange',
    logoUrl: '/broker-logos/kraken.png',
    logoFallback: 'KR',
    features: ['Spot', 'Futures', 'Staking', 'NFTs'],
    popular: false,
  },
  {
    name: 'Alpaca',
    exchangeId: 'alpaca',
    description: 'Commission-free API trading',
    logoUrl: '/broker-logos/alpaca.png',
    logoFallback: 'AL',
    features: ['Stocks', 'API', 'Algo Trading', 'Paper Trading'],
    popular: false,
  },
];

export function ConnectBrokerModal({ isOpen, onClose, onConnect }: ConnectBrokerModalProps) {
  const API_BASE = 'http://localhost:8000';
  const [selectedBroker, setSelectedBroker] = useState<string | null>(null);
  const [credentialsByBroker, setCredentialsByBroker] = useState<
    Record<string, { apiKey: string; apiSecret: string }>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [connectedExchangeIds, setConnectedExchangeIds] = useState<Set<string>>(new Set());

  const fetchConnectedExchanges = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/exchanges/credentials/status`);
      if (!res.ok) return;
      const payload = (await res.json()) as { connected_exchanges?: string[] };
      const ids = (payload.connected_exchanges ?? []).map((id) => id.trim().toLowerCase());
      setConnectedExchangeIds(new Set(ids));
    } catch {
      setConnectedExchangeIds(new Set());
    }
  }, []);

  useEffect(() => {
    if (isOpen) void fetchConnectedExchanges();
  }, [isOpen, fetchConnectedExchanges]);

  if (!isOpen) return null;

  const handleBrokerSelect = (brokerName: string) => {
    setSelectedBroker(brokerName);
    setStatusMessage(null);
  };

  const handleConnect = async () => {
    if (!selectedBroker) return;
    const currentCredentials = credentialsByBroker[selectedBroker] ?? { apiKey: '', apiSecret: '' };
    const { apiKey, apiSecret } = currentCredentials;
    if (!apiKey || !apiSecret) return;
    if (selectedBroker !== 'Binance') {
      setStatusMessage('Only Binance connection is available right now.');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('Saving API keys...');
    try {
      const credentialsRes = await fetch(`${API_BASE}/api/v1/exchanges/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange_name: 'binance',
          api_key: apiKey.trim(),
          api_secret: apiSecret.trim(),
        }),
      });
      if (!credentialsRes.ok) {
        const errorBody = await credentialsRes.text();
        throw new Error(errorBody || 'Failed to save exchange credentials');
      }

      // Do not block UX on full-history sync: save credentials immediately,
      // then start sync in the background.
      void triggerBackgroundSync();
      setStatusMessage('Keys saved. Trade history sync started in the background.');
      await fetchConnectedExchanges();
      onConnect();
      setSelectedBroker(null);
      setTimeout(() => onClose(), 500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      setStatusMessage(`Error: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const triggerBackgroundSync = async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const syncRes = await fetch(`${API_BASE}/api/v1/exchanges/binance/sync-trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: 200,
          account_type: 'spot',
        }),
        signal: controller.signal,
      });
      if (!syncRes.ok) {
        const body = await syncRes.text();
        console.warn('Binance sync failed:', body || syncRes.statusText);
        return;
      }
      const payload = await syncRes.json();
      const jobId = payload?.job_id as string | undefined;
      if (!jobId) return;
      void pollSyncStatus(jobId);
    } catch (error) {
      console.warn('Binance sync request failed:', error);
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const pollSyncStatus = async (jobId: string) => {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      try {
        const res = await fetch(`${API_BASE}/api/v1/exchanges/binance/sync-trades/${encodeURIComponent(jobId)}`);
        if (!res.ok) continue;
        const job = await res.json();
        if (job.status === 'done') {
          setStatusMessage(`Sync complete. Trades imported: ${job.synced_count ?? 0}.`);
          return;
        }
        if (job.status === 'failed') {
          setStatusMessage(`Sync failed: ${job.error ?? 'unknown error'}`);
          return;
        }
      } catch {
        // transient polling error, continue
      }
    }
    setStatusMessage('Sync is still running in the background.');
  };

  const selectedCredentials = selectedBroker
    ? (credentialsByBroker[selectedBroker] ?? { apiKey: '', apiSecret: '' })
    : { apiKey: '', apiSecret: '' };

  const selectedBrokerData = brokers.find((b) => b.name === selectedBroker) ?? null;
  const isSelectedConnected =
    selectedBrokerData?.exchangeId != null &&
    connectedExchangeIds.has(selectedBrokerData.exchangeId);

  const handleDisconnect = async () => {
    if (!selectedBrokerData?.exchangeId) return;

    setIsDisconnecting(true);
    setStatusMessage(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/exchanges/credentials/${encodeURIComponent(selectedBrokerData.exchangeId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(errorBody || 'Failed to disconnect exchange');
      }

      await fetchConnectedExchanges();
      setCredentialsByBroker((prev) => {
        const next = { ...prev };
        delete next[selectedBrokerData.name];
        return next;
      });
      setStatusMessage(`${selectedBrokerData.name} disconnected.`);
      setDisconnectConfirmOpen(false);
      onConnect();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Disconnect failed';
      setStatusMessage(`Error: ${message}`);
    } finally {
      setIsDisconnecting(false);
    }
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
                {brokers.map((broker) => {
                  const isConnected =
                    broker.exchangeId != null &&
                    connectedExchangeIds.has(broker.exchangeId);
                  const isSelected = selectedBroker === broker.name;

                  return (
                  <button
                    key={broker.name}
                    onClick={() => handleBrokerSelect(broker.name)}
                    className={cn(
                      'relative group w-full p-4 rounded-xl border transition-all text-left',
                      isConnected
                        ? 'bg-green-500/10 border-green-500/50 shadow-[0_0_18px_rgba(34,197,94,0.12)]'
                        : isSelected
                          ? 'bg-yellow-500/10 border-yellow-500/50'
                          : 'bg-zinc-800/50 border-zinc-700/50 hover:bg-zinc-800 hover:border-yellow-500/30'
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-14 w-14 shrink-0 flex items-center justify-center">
                        <img
                          src={broker.logoUrl}
                          alt={`${broker.name} logo`}
                          className="h-14 w-14 object-contain"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const fallback = e.currentTarget.nextElementSibling as HTMLSpanElement | null;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                        <span className="hidden h-14 w-14 items-center justify-center rounded-lg bg-zinc-800 text-sm font-bold text-zinc-300">
                          {broker.logoFallback}
                        </span>
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
                          {isConnected && (
                            <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs font-medium rounded border border-green-500/40">
                              Connected
                            </span>
                          )}
                          {isSelected && !isConnected && (
                            <CheckCircle2 className="w-4 h-4 text-yellow-500 ml-auto" />
                          )}
                          {isConnected && (
                            <CheckCircle2 className="w-4 h-4 text-green-400 ml-auto shrink-0" />
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
                  );
                })}
              </div>
            </div>

            {/* Right: API Configuration or Connected Status */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                {isSelectedConnected ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Connection
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 text-yellow-500" />
                    API Credentials
                  </>
                )}
              </h3>
              
              {selectedBroker ? (
                isSelectedConnected ? (
                  <div className="space-y-4">
                    <div className="p-6 bg-green-500/5 border border-green-500/30 rounded-xl text-center">
                      <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
                      <p className="text-white font-semibold mb-1">
                        {selectedBroker} connected
                      </p>
                      <p className="text-sm text-gray-400">
                        Your account syncs automatically. API keys are stored securely.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setDisconnectConfirmOpen(true)}
                      disabled={isDisconnecting}
                      className="w-full px-6 py-3 bg-zinc-800 hover:bg-red-500/20 border border-zinc-700 hover:border-red-500/50 text-red-400 font-semibold rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <Unplug className="w-4 h-4" />
                      {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </button>

                    {statusMessage && (
                      <p className="text-xs text-gray-300 text-center">{statusMessage}</p>
                    )}
                  </div>
                ) : (
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
                      value={selectedCredentials.apiKey}
                      onChange={(e) =>
                        selectedBroker &&
                        setCredentialsByBroker((prev) => ({
                          ...prev,
                          [selectedBroker]: {
                            ...(prev[selectedBroker] ?? { apiKey: '', apiSecret: '' }),
                            apiKey: e.target.value,
                          },
                        }))
                      }
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
                      value={selectedCredentials.apiSecret}
                      onChange={(e) =>
                        selectedBroker &&
                        setCredentialsByBroker((prev) => ({
                          ...prev,
                          [selectedBroker]: {
                            ...(prev[selectedBroker] ?? { apiKey: '', apiSecret: '' }),
                            apiSecret: e.target.value,
                          },
                        }))
                      }
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
                    disabled={!selectedCredentials.apiKey || !selectedCredentials.apiSecret || isSubmitting}
                    className="w-full px-6 py-3 bg-yellow-500 hover:bg-yellow-600 disabled:bg-zinc-700 disabled:text-gray-500 text-black font-semibold rounded-lg transition-all disabled:cursor-not-allowed shadow-lg shadow-yellow-500/20 disabled:shadow-none"
                  >
                    {isSubmitting ? 'Connecting...' : `Connect ${selectedBroker}`}
                  </button>

                  {statusMessage && (
                    <p className="text-xs text-gray-300">{statusMessage}</p>
                  )}

                  {/* Help Link */}
                  <a
                    href="#"
                    className="flex items-center justify-center gap-1 text-sm text-yellow-500 hover:text-yellow-400 transition-colors"
                  >
                    <span>How to get API credentials</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                )
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

      {disconnectConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => !isDisconnecting && setDisconnectConfirmOpen(false)}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="disconnect-dialog-title"
            className="relative w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
          >
            <h3 id="disconnect-dialog-title" className="text-lg font-semibold text-white mb-2">
              Remove connection?
            </h3>
            <p className="text-sm text-gray-400 mb-6">
              Are you sure you want to remove the connection to{' '}
              <span className="font-medium text-gray-200">{selectedBroker}</span>?
              Data sync will stop and saved API keys will be deleted.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isDisconnecting}
                onClick={() => setDisconnectConfirmOpen(false)}
                className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-gray-300 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDisconnecting}
                onClick={() => void handleDisconnect()}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors disabled:opacity-50"
              >
                {isDisconnecting ? 'Removing...' : 'Yes, remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}