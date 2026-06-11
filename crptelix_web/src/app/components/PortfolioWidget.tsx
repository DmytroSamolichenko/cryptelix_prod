import { useEffect, useState } from 'react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceDot
} from 'recharts';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

// Time period type
type TimePeriod = '24h' | '7d' | '1m' | '3m' | '1y' | 'All';

// Transaction type
interface Transaction {
  timestamp: number;
  type: 'buy' | 'sell';
  amount: number;
}

// Generate historical data for charts
function generateHistoricalData(
  currentValue: number, 
  days: number,
  transactions: Transaction[] = []
): Array<{ timestamp: number; value: number; date: string }> {
  const data = [];
  const now = Date.now();
  const volatility = 0.03; // 3% daily volatility
  
  for (let i = days; i >= 0; i--) {
    const timestamp = now - i * 24 * 60 * 60 * 1000;
    const randomChange = (Math.random() - 0.5) * 2 * volatility;
    const progressFactor = (days - i) / days;
    const trendValue = currentValue * (0.7 + progressFactor * 0.3);
    const value = trendValue * (1 + randomChange);
    
    const date = new Date(timestamp);
    const dateStr = i === 0 ? 'Now' : date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
    
    data.push({
      timestamp,
      value: Math.round(value),
      date: dateStr,
    });
  }
  
  return data;
}

// Generate transactions
function generateTransactions(days: number): Transaction[] {
  const transactions: Transaction[] = [];
  const now = Date.now();
  const numTransactions = Math.floor(Math.random() * 5) + 3;
  
  for (let i = 0; i < numTransactions; i++) {
    const daysAgo = Math.floor(Math.random() * days);
    transactions.push({
      timestamp: now - daysAgo * 24 * 60 * 60 * 1000,
      type: Math.random() > 0.5 ? 'buy' : 'sell',
      amount: Math.floor(Math.random() * 5000) + 1000,
    });
  }
  
  return transactions.sort((a, b) => a.timestamp - b.timestamp);
}

// Mock data
const generalDistributionData = [
  { name: 'Exchanges', value: 65000, color: '#facc15' },
  { name: 'Wallets', value: 45000, color: '#3b82f6' },
];

const tokenAllocationData = [
  { name: 'BTC', value: 45000, color: '#f7931a' },
  { name: 'ETH', value: 32000, color: '#627eea' },
  { name: 'SOL', value: 18000, color: '#00d4aa' },
  { name: 'USDT', value: 10000, color: '#26a17b' },
  { name: 'Others', value: 5000, color: '#6b7280' },
];

const exchanges = [
  {
    id: 'binance',
    name: 'Binance',
    data: [
      { name: 'BTC', value: 25000, color: '#f7931a' },
      { name: 'ETH', value: 18000, color: '#627eea' },
      { name: 'SOL', value: 8000, color: '#00d4aa' },
      { name: 'USDT', value: 5000, color: '#26a17b' },
    ],
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    data: [
      { name: 'BTC', value: 8000, color: '#f7931a' },
      { name: 'ETH', value: 5000, color: '#627eea' },
      { name: 'USDT', value: 1000, color: '#26a17b' },
    ],
  },
];

const wallets = [
  {
    id: 'metamask',
    name: 'MetaMask',
    data: [
      { name: 'ETH', value: 8000, color: '#627eea' },
      { name: 'USDT', value: 3000, color: '#26a17b' },
      { name: 'Others', value: 2000, color: '#6b7280' },
    ],
  },
  {
    id: 'phantom',
    name: 'Phantom',
    data: [
      { name: 'SOL', value: 10000, color: '#00d4aa' },
      { name: 'USDT', value: 1000, color: '#26a17b' },
    ],
  },
  {
    id: 'trust',
    name: 'Trust Wallet',
    data: [
      { name: 'BTC', value: 12000, color: '#f7931a' },
      { name: 'ETH', value: 1000, color: '#627eea' },
      { name: 'Others', value: 3000, color: '#6b7280' },
    ],
  },
];

interface LineChartCardProps {
  title: string;
  currentValue: number;
}

function LineChartCard({ title, currentValue }: LineChartCardProps) {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('7d');
  
  const periodToDays: Record<TimePeriod, number> = {
    '24h': 1,
    '7d': 7,
    '1m': 30,
    '3m': 90,
    '1y': 365,
    'All': 730,
  };
  
  const days = periodToDays[timePeriod];
  const historicalData = generateHistoricalData(currentValue, days);
  const transactions = generateTransactions(days);
  
  const periods: TimePeriod[] = ['24h', '7d', '1m', '3m', '1y', 'All'];
  
  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 shadow-xl">
          <p className="text-xs text-gray-400 mb-1">
            {new Date(data.timestamp).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          <p className="text-sm font-semibold text-blue-400">
            Balance: ${data.value.toLocaleString()}
          </p>
        </div>
      );
    }
    return null;
  };
  
  return (
    <div className="bg-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-lg p-3 hover:border-yellow-500/30 transition-all">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-gray-300">{title}</h3>
        <div className="flex items-center gap-1">
          {periods.map((period) => (
            <button
              key={period}
              onClick={() => setTimePeriod(period)}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-all ${
                timePeriod === period
                  ? 'bg-yellow-500/20 text-yellow-400 font-medium'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {period}
            </button>
          ))}
        </div>
      </div>
      
      <div style={{ height: '120px', minWidth: '200px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={historicalData}>
            <defs>
              <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis 
              dataKey="date" 
              stroke="#52525b"
              tick={{ fill: '#71717a', fontSize: 9 }}
              tickLine={false}
            />
            <YAxis 
              stroke="#52525b"
              tick={{ fill: '#71717a', fontSize: 9 }}
              tickLine={false}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area 
              type="monotone" 
              dataKey="value" 
              stroke="#3b82f6" 
              strokeWidth={2}
              fill={`url(#gradient-${title})`}
            />
            
            {/* Transaction markers */}
            {transactions.map((tx, idx) => {
              const dataPoint = historicalData.find(
                d => Math.abs(d.timestamp - tx.timestamp) < 24 * 60 * 60 * 1000
              );
              if (dataPoint) {
                return (
                  <ReferenceDot
                    key={`${title}-tx-${idx}-${tx.timestamp}`}
                    x={dataPoint.date}
                    y={dataPoint.value}
                    r={3}
                    fill={tx.type === 'buy' ? '#22c55e' : '#ef4444'}
                    stroke="#000"
                    strokeWidth={1}
                  />
                );
              }
              return null;
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      
      {/* Transaction legend */}
      <div className="flex items-center gap-3 mt-1 text-[10px]">
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className="text-gray-500">Buy</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <span className="text-gray-500">Sell</span>
        </div>
      </div>
    </div>
  );
}

interface AssetCardProps {
  title: string;
  pieData: Array<{ name: string; value: number; color: string }>;
  total?: number;
}

function AssetCard({ title, pieData, total }: AssetCardProps) {
  const calculatedTotal = total || pieData.reduce((sum, item) => sum + item.value, 0);
  
  const renderCustomLabel = (entry: any) => {
    const percent = ((entry.value / calculatedTotal) * 100).toFixed(1);
    return `${percent}%`;
  };
  
  return (
    <div className="space-y-2">
      {/* Pie Chart */}
      <div className="bg-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-lg p-3 hover:border-yellow-500/30 transition-all">
        <h3 className="text-xs font-medium text-gray-300 mb-2">{title}</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1" style={{ height: '120px', minWidth: '120px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={renderCustomLabel}
                  outerRadius={50}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`${title}-cell-${index}-${entry.name}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    border: '1px solid #3f3f46',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '11px',
                  }}
                  formatter={(value: number) => `$${value.toLocaleString()}`}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5">
            {pieData.map((item, index) => (
              <div key={`${title}-legend-${index}-${item.name}`} className="flex items-center gap-1.5">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-[10px] text-gray-400">{item.name}</span>
                <span className="text-[10px] text-gray-300 ml-auto">
                  ${item.value.toLocaleString()}
                </span>
              </div>
            ))}
            <div className="pt-1.5 mt-1.5 border-t border-zinc-700/50">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-yellow-400">Total</span>
                <span className="text-[10px] font-medium text-yellow-400">
                  ${calculatedTotal.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Line Chart */}
      <LineChartCard title={`${title} History`} currentValue={calculatedTotal} />
    </div>
  );
}

export function PortfolioWidget() {
  const [expandedSections, setExpandedSections] = useState({
    general: true,
    exchanges: true,
    wallets: true,
  });

  const [currentEquity, setCurrentEquity] = useState<number | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const response = await apiFetch('/api/v1/summary');
        if (!response.ok) {
          console.error('Failed to fetch financial summary', response.statusText);
          return;
        }
        const data = await response.json();
        if (data && typeof data.current_equity !== 'undefined') {
          const equityNumber = Number(data.current_equity);
          if (!Number.isNaN(equityNumber)) {
            setCurrentEquity(equityNumber);
          }
        }
      } catch (error) {
        console.error('Error fetching financial summary', error);
      }
    };

    fetchSummary();
  }, []);

  const toggleSection = (section: 'general' | 'exchanges' | 'wallets') => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="space-y-4 p-3">
      {/* Row 1: General (Overall) */}
      <div className="space-y-2">
        <button
          onClick={() => toggleSection('general')}
          className="flex items-center gap-2 w-full hover:bg-zinc-800/30 p-1 rounded transition-colors"
        >
          <div className="w-0.5 h-4 bg-yellow-500 rounded-full" />
          <h2 className="text-sm font-semibold text-white">General (Overall)</h2>
          {expandedSections.general ? (
            <ChevronUp className="w-3 h-3 text-gray-400 ml-auto" />
          ) : (
            <ChevronDown className="w-3 h-3 text-gray-400 ml-auto" />
          )}
        </button>
        {expandedSections.general && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <AssetCard
              title="Fund Distribution"
              pieData={generalDistributionData}
              total={currentEquity !== null ? currentEquity : undefined}
            />
            <AssetCard
              title="Token Allocation"
              pieData={tokenAllocationData}
            />
          </div>
        )}
      </div>

      {/* Row 2: Exchanges (Centralized) */}
      <div className="space-y-2">
        <button
          onClick={() => toggleSection('exchanges')}
          className="flex items-center gap-2 w-full hover:bg-zinc-800/30 p-1 rounded transition-colors"
        >
          <div className="w-0.5 h-4 bg-yellow-500 rounded-full" />
          <h2 className="text-sm font-semibold text-white">Exchanges (Centralized)</h2>
          {expandedSections.exchanges ? (
            <ChevronUp className="w-3 h-3 text-gray-400 ml-auto" />
          ) : (
            <ChevronDown className="w-3 h-3 text-gray-400 ml-auto" />
          )}
        </button>
        {expandedSections.exchanges && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {exchanges.map((exchange) => (
              <AssetCard
                key={exchange.id}
                title={exchange.name}
                pieData={exchange.data}
              />
            ))}
          </div>
        )}
      </div>

      {/* Row 3: Wallets (Decentralized) */}
      <div className="space-y-2">
        <button
          onClick={() => toggleSection('wallets')}
          className="flex items-center gap-2 w-full hover:bg-zinc-800/30 p-1 rounded transition-colors"
        >
          <div className="w-0.5 h-4 bg-yellow-500 rounded-full" />
          <h2 className="text-sm font-semibold text-white">Wallets (Decentralized)</h2>
          {expandedSections.wallets ? (
            <ChevronUp className="w-3 h-3 text-gray-400 ml-auto" />
          ) : (
            <ChevronDown className="w-3 h-3 text-gray-400 ml-auto" />
          )}
        </button>
        {expandedSections.wallets && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {wallets.map((wallet) => (
              <AssetCard
                key={wallet.id}
                title={wallet.name}
                pieData={wallet.data}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
