import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Download, Upload, X, Loader2 } from 'lucide-react';
import { AddTradeModal } from './AddTradeModal';
import { AddColumnModal } from './AddColumnModal';
import { formatNumber } from './ui/utils';

type ColumnType = 'text' | 'number' | 'percentage';

interface Column {
  id: string;
  name: string;
  type: ColumnType;
  width: number;
}

interface Deal {
  id: string;
  isManual?: boolean;
  /** Set when trade is tied to an exchange row; used with isManual for edit locking */
  exchangeTradeId?: string | null;
  [key: string]: any;
}

interface CustomColumnConfig {
  name: string;
  type: ColumnType;
}

/** TODO: MULTI-USER-MIGRATION — sent on every write; backend ignores and uses DEFAULT_USER_ID */
const DEAL_BASE_USER_ID = 1;

function isPersistedTradeId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

const AI_REPORT_PREVIEW_CHARS = 90;

function isAiReportEmpty(value: unknown): boolean {
  const s = String(value ?? '').trim();
  return s === '' || s === 'Analysis pending...';
}

function hasExchangeTradeId(deal: Deal): boolean {
  const e = deal.exchangeTradeId;
  return e != null && String(e).trim() !== '';
}

/** API / system trades: lock all columns except notes when not manual */
function isCellLocked(deal: Deal, columnId: string): boolean {
  if (columnId === 'notes') return false;
  return deal.isManual === false;
}

function parseDealNumeric(raw: string, stripPnlPlus: boolean): number | null {
  let s = String(raw ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s/g, '')
    .replace(/,/g, '')
    .trim();
  if (stripPnlPlus) s = s.replace(/^\+/, '');
  if (s === '') return null;
  const n = Number(s);
  const parsedValue = Number.isFinite(n) ? n : null;
  console.log('Parsing value:', raw, 'Result:', parsedValue);
  return parsedValue;
}

/**
 * fieldValueOverride: value from the input at commit time (blur) so we never PATCH stale React state.
 * Optional numerics: empty string → skip PATCH (omit key) so we never send null for exit_price / pnl etc.
 */
function buildPatchBodyForColumn(
  deal: Deal,
  columnId: string,
  customColumns: CustomColumnConfig[],
  fieldValueOverride?: string
): Record<string, unknown> | null {
  const base: Record<string, unknown> = { user_id: DEAL_BASE_USER_ID };

  if (customColumns.some((c) => c.name === columnId)) {
    const cf: Record<string, unknown> = {};
    customColumns.forEach((col) => {
      const raw =
        col.name === columnId && fieldValueOverride !== undefined
          ? fieldValueOverride
          : deal[col.name];
      if (raw === undefined || raw === '') return;
      if (col.type === 'number' || col.type === 'percentage') {
        const n = parseDealNumeric(String(raw), false);
        cf[col.name] = n !== null ? n : String(raw);
      } else {
        cf[col.name] = String(raw);
      }
    });
    return { ...base, custom_fields: cf };
  }

  /** UI column id → snake_case keys in PATCH/POST JSON (never camelCase on the wire) */
  const UI_COLUMN_TO_SNAKE: Record<string, string> = {
    date: 'date',
    pair: 'pair',
    type: 'side',
    entryPrice: 'entry_price',
    exitPrice: 'exit_price',
    quantity: 'quantity',
    pnl: 'pnl',
    commission: 'commission',
    notes: 'notes',
  };
  const snakeKey = UI_COLUMN_TO_SNAKE[columnId];
  if (!snakeKey) return null;

  let val: unknown;
  switch (columnId) {
    case 'date': {
      const ds = (fieldValueOverride ?? String(deal.date || '')).trim();
      if (!ds) return null;
      val = `${ds}T00:00:00.000Z`;
      break;
    }
    case 'pair': {
      const p = (fieldValueOverride ?? String(deal.pair || '')).trim();
      if (!p) return null;
      val = p;
      break;
    }
    case 'type':
      val = String(fieldValueOverride ?? deal.type ?? 'Long');
      break;
    case 'entryPrice':
    case 'exitPrice':
    case 'commission': {
      const raw = (fieldValueOverride ?? String(deal[columnId] ?? '')).trim();
      if (raw === '') return null;
      const parsed = parseDealNumeric(raw, false);
      if (parsed === null) return null;
      val = parsed;
      break;
    }
    case 'pnl': {
      const raw = (fieldValueOverride ?? String(deal[columnId] ?? ''))
        .replace(/,/g, '')
        .trim();
      if (raw === '') return null;
      const cleaned = raw.replace(/^\+/, '');
      const n = Number(cleaned);
      if (!Number.isFinite(n)) return null;
      val = n;
      break;
    }
    case 'quantity': {
      const raw = (fieldValueOverride ?? String(deal.quantity ?? '')).trim();
      if (raw === '') {
        val = 0;
        break;
      }
      const n = parseDealNumeric(raw, false);
      val = n === null ? 0 : n;
      break;
    }
    case 'notes':
      val = deal.notes === '' || deal.notes === undefined ? null : deal.notes;
      break;
    default:
      return null;
  }

  return { ...base, [snakeKey]: val };
}

/** GET/PATCH JSON: snake_case (DB-aligned). React grid uses camelCase via apiTradeToDeal. */
interface ApiTrade {
  id: string;
  date: string | null;
  pair: string;
  side: string;
  entry_price: string | null;
  exit_price: string | null;
  quantity: string | null;
  pnl: string | null;
  commission: string | null;
  notes?: string | null;
  ai_report?: string | null;
  is_manual?: boolean;
  exchange_trade_id?: string | null;
  exchange_name?: string | null;
  custom_fields?: Record<string, unknown>;
}

/** Maps API snake_case → ApiTrade (PATCH/GET/POST responses). */
function normalizeServerTradeJson(raw: Record<string, unknown>): ApiTrade {
  const id = String(raw.id ?? '');
  let date: string | null = null;
  if (raw.date != null) {
    const d = raw.date;
    date =
      typeof d === 'string'
        ? d
        : new Date(d as unknown as string | number).toISOString();
  }

  const asStr = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    return String(v);
  };

  return {
    id,
    date,
    pair: String(raw.pair ?? ''),
    side: String(raw.side ?? ''),
    entry_price: asStr(raw.entry_price),
    exit_price: asStr(raw.exit_price),
    quantity: asStr(raw.quantity),
    pnl: asStr(raw.pnl),
    commission: asStr(raw.commission),
    notes: raw.notes != null ? String(raw.notes) : null,
    ai_report: raw.ai_report != null ? String(raw.ai_report) : null,
    is_manual: raw.is_manual as boolean | undefined,
    exchange_trade_id:
      raw.exchange_trade_id != null ? String(raw.exchange_trade_id) : null,
    exchange_name: raw.exchange_name != null ? String(raw.exchange_name) : null,
    custom_fields: (raw.custom_fields as Record<string, unknown>) ?? undefined,
  };
}

function apiTradeToDeal(api: ApiTrade, index: number, customColumns: CustomColumnConfig[]): Deal {
  const pnlNum = api.pnl != null && api.pnl !== '' ? parseFloat(api.pnl) : NaN;
  const hasValidPnl = !Number.isNaN(pnlNum);
  const formattedPnl = hasValidPnl ? formatNumber(pnlNum, 2) : '';
  const pnlDisplay =
    hasValidPnl && pnlNum > 0
      ? `+${formattedPnl}`
      : hasValidPnl
        ? formattedPnl
        : '';
  const dateOnly = api.date ? api.date.slice(0, 10) : '';
  const base: Deal = {
    id: api.id,
    isManual: api.is_manual ?? true,
    exchangeTradeId: api.exchange_trade_id ?? null,
    date: dateOnly,
    pair: api.pair ?? '',
    type: api.side ?? '',
    entryPrice:
      api.entry_price != null && api.entry_price !== ''
        ? formatNumber(Number(api.entry_price), 4)
        : '',
    exitPrice:
      api.exit_price != null && api.exit_price !== ''
        ? formatNumber(Number(api.exit_price), 4)
        : '',
    quantity:
      api.quantity != null && api.quantity !== ''
        ? formatNumber(Number(api.quantity), 6)
        : '',
    pnl: pnlDisplay,
    commission:
      api.commission != null && api.commission !== ''
        ? formatNumber(Number(api.commission), 6)
        : '',
    notes: api.notes ?? '',
    ai_report: isAiReportEmpty(api.ai_report) ? '' : String(api.ai_report),
  };

  if (api.custom_fields) {
    customColumns.forEach((col) => {
      const key = col.name;
      const value = (api.custom_fields as Record<string, unknown>)[key];
      base[key] = value != null ? String(value) : '';
    });
  }

  return base;
}

interface Sheet {
  id: string;
  name: string;
  columns: Column[];
  deals: Deal[];
}

export function DataBase() {
  const [sheet, setSheet] = useState<Sheet>({
    id: 'sheet-1',
    name: 'Bank of transactions',
    columns: [
      { id: 'date', name: 'Date', type: 'text', width: 150 },
      { id: 'pair', name: 'Pair', type: 'text', width: 140 },
      { id: 'type', name: 'Type', type: 'text', width: 120 },
      { id: 'entryPrice', name: 'Entry', type: 'number', width: 140 },
      { id: 'exitPrice', name: 'Exit', type: 'number', width: 140 },
      { id: 'quantity', name: 'Quantity', type: 'number', width: 140 },
      { id: 'pnl', name: 'P&L', type: 'number', width: 140 },
      { id: 'commission', name: 'Commission', type: 'number', width: 150 },
      { id: 'notes', name: 'Notes', type: 'text', width: 260 },
      { id: 'ai_report', name: 'AI INSIGHTS', type: 'text', width: 260 },
    ],
    deals: [],
  });
  const [customColumns, setCustomColumns] = useState<CustomColumnConfig[]>([]);
  const [showAddTradeModal, setShowAddTradeModal] = useState(false);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [editingNote, setEditingNote] = useState<{
    dealId: string | null;
    draft: string;
  }>({ dealId: null, draft: '' });
  const [resizing, setResizing] = useState<{
    columnId: string | null;
    startX: number;
    startWidth: number;
  }>({
    columnId: null,
    startX: 0,
    startWidth: 0,
  });
  const [exporting, setExporting] = useState(false);
  const [aiAnalyzeBusy, setAiAnalyzeBusy] = useState<Record<string, boolean>>({});
  const [aiAnalyzeError, setAiAnalyzeError] = useState<Record<string, boolean>>({});
  const [aiInsightsExpanded, setAiInsightsExpanded] = useState<Record<string, boolean>>({});

  const handleAnalyzeAi = useCallback(async (dealId: string) => {
    if (!isPersistedTradeId(dealId)) return;
    setAiAnalyzeError((prev) => ({ ...prev, [dealId]: false }));
    setAiAnalyzeBusy((prev) => ({ ...prev, [dealId]: true }));
    try {
      const res = await fetch(
        `http://localhost:8000/api/v1/trades/${encodeURIComponent(dealId)}/analyze`,
        { method: 'POST' }
      );
      if (!res.ok) {
        setAiAnalyzeError((prev) => ({ ...prev, [dealId]: true }));
        return;
      }
      const data = (await res.json()) as { ai_report?: string | null };
      const report =
        typeof data.ai_report === 'string' && data.ai_report.trim() !== ''
          ? data.ai_report
          : '';
      setSheet((prev) => ({
        ...prev,
        deals: prev.deals.map((d) => (d.id === dealId ? { ...d, ai_report: report } : d)),
      }));
    } catch {
      setAiAnalyzeError((prev) => ({ ...prev, [dealId]: true }));
    } finally {
      setAiAnalyzeBusy((prev) => ({ ...prev, [dealId]: false }));
    }
  }, []);

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:8000/api/v1/trades');
      if (!res.ok) return;
      const data: ApiTrade[] = await res.json();
      if (!Array.isArray(data)) return;
      const deals: Deal[] = data
        .map((t, i) => apiTradeToDeal(t, i, customColumns))
        .sort((a, b) => {
          const at = a.date ? new Date(a.date).getTime() : -Infinity;
          const bt = b.date ? new Date(b.date).getTime() : -Infinity;
          return bt - at;
        });
      setSheet((prev) => ({
        ...prev,
        deals,
      }));
    } catch {
      // Keep static fallback deals on error
    }
  }, [customColumns]);

  const notesColumnId = useMemo(() => 'notes', []);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  const activeSheet = sheet;

  // Helper function to convert number to letter (A, B, C, ..., Z, AA, AB, ...)
  const getRowLabel = (index: number): string => {
    let label = '';
    let num = index;
    while (num >= 0) {
      label = String.fromCharCode(65 + (num % 26)) + label;
      num = Math.floor(num / 26) - 1;
    }
    return label;
  };

  const addDeal = () => {
    if (!activeSheet) return;
    const newDeal: Deal = {
      id: Date.now().toString(),
    };
    // Initialize all columns with empty values
    activeSheet.columns.forEach((col) => {
      newDeal[col.id] = '';
    });
    setSheet((prev) => ({
      ...prev,
      deals: [...prev.deals, newDeal].sort((a, b) => {
        const at = a.date ? new Date(a.date).getTime() : -Infinity;
        const bt = b.date ? new Date(b.date).getTime() : -Infinity;
        return bt - at;
      }),
    }));
  };

  const updateDeal = (dealId: string, field: string, value: string) => {
    setSheet((prev) => ({
      ...prev,
      deals: prev.deals
        .map((deal) => (deal.id === dealId ? { ...deal, [field]: value } : deal))
        .sort((a, b) => {
          const at = a.date ? new Date(a.date).getTime() : -Infinity;
          const bt = b.date ? new Date(b.date).getTime() : -Infinity;
          return bt - at;
        }),
    }));
  };

  const mergeDealFromPatchResponse = useCallback((dealId: string, responseText: string) => {
    try {
      const parsed = JSON.parse(responseText) as Record<string, unknown>;
      const apiTrade = normalizeServerTradeJson(parsed);
      const dealFromServer = apiTradeToDeal(apiTrade, 0, customColumns);
      setSheet((prev) => ({
        ...prev,
        deals: prev.deals.map((d) => {
          if (d.id !== dealId) return d;
          const merged: Deal = { ...d, ...dealFromServer, id: dealId };
          if (!('is_manual' in parsed)) merged.isManual = d.isManual;
          if (!('exchange_trade_id' in parsed)) merged.exchangeTradeId = d.exchangeTradeId;
          return merged;
        }),
      }));
    } catch (e) {
      console.error('merge PATCH response failed', e);
    }
  }, [customColumns]);

  const syncDealFieldToApi = useCallback(
    async (nextDeal: Deal, columnId: string, fieldValueOverride?: string) => {
      if (!isPersistedTradeId(nextDeal.id)) return;
      if (isCellLocked(nextDeal, columnId)) return;
      const raw = buildPatchBodyForColumn(nextDeal, columnId, customColumns, fieldValueOverride);
      if (!raw) return;
      const userId = raw.user_id;
      const { user_id: _drop, ...rest } = raw;
      const entries: [string, unknown][] = [['user_id', userId]];
      for (const [k, v] of Object.entries(rest)) {
        if (k === 'notes') {
          entries.push([k, v]);
          continue;
        }
        if (v === undefined || v === null) continue;
        entries.push([k, v]);
      }
      if (entries.length <= 1) return;
      const finalBody = Object.fromEntries(entries);
      try {
        const res = await fetch(
          `http://localhost:8000/api/v1/trades/${encodeURIComponent(nextDeal.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalBody),
          }
        );
        const responseText = await res.text();
        console.log('[PATCH /api/v1/trades]', nextDeal.id, res.status, responseText);
        if (res.ok) {
          mergeDealFromPatchResponse(nextDeal.id, responseText);
        } else {
          console.error('PATCH trade failed', responseText);
        }
      } catch (e) {
        console.error('PATCH trade request failed', e);
      }
    },
    [customColumns, mergeDealFromPatchResponse]
  );

  const saveNote = useCallback(
    async (dealId: string, rawNote: string) => {
      const note = rawNote.trimEnd();
      // Optimistic UI update
      updateDeal(dealId, notesColumnId, note);

      try {
        const res = await fetch(
          `http://localhost:8000/api/v1/trades/${encodeURIComponent(dealId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              user_id: DEAL_BASE_USER_ID,
              notes: note === '' ? null : note,
            }),
          }
        );
        const responseText = await res.text();
        console.log('[PATCH /api/v1/trades notes]', dealId, res.status, responseText);
        if (res.ok) {
          mergeDealFromPatchResponse(dealId, responseText);
        } else {
          console.error('Failed to save note', responseText);
        }
      } catch (e) {
        console.error('Failed to save note', e);
      }
    },
    [notesColumnId, mergeDealFromPatchResponse]
  );

  const deleteDeal = async (deal: Deal) => {
    if (!deal.isManual) {
      return;
    }

    try {
      const res = await fetch(
        `http://localhost:8000/api/v1/trades/${encodeURIComponent(deal.id)}`,
        {
          method: 'DELETE',
        }
      );
      if (!res.ok && res.status !== 204) {
        console.error('Failed to delete trade', await res.text());
        return;
      }
      setSheet((prev) => ({
        ...prev,
        deals: prev.deals.filter((d) => d.id !== deal.id),
      }));
    } catch (e) {
      console.error('Error deleting trade', e);
    }
  };

  const handleAddCustomColumn = (column: CustomColumnConfig) => {
    if (!activeSheet) return;

    if (customColumns.some((c) => c.name === column.name)) {
      setShowAddColumnModal(false);
      return;
    }

    setCustomColumns((prev) => [...prev, column]);

    const columnId = column.name;
    const newColumn: Column = {
      id: columnId,
      name: column.name,
      type: column.type,
      width: 140,
    };

    setSheet((prev) => ({
      ...prev,
      columns: [...prev.columns, newColumn],
      deals: prev.deals.map((deal) => ({ ...deal, [columnId]: '' })),
    }));

    fetchTrades();
    setShowAddColumnModal(false);
  };

  const deleteColumn = (columnId: string) => {
    setSheet((prev) => ({
      ...prev,
      columns: prev.columns.filter((col) => col.id !== columnId),
      deals: prev.deals.map((deal) => {
        const { [columnId]: _removed, ...rest } = deal;
        return rest as Deal;
      }),
    }));
  };

  const getDecimalsForColumn = (columnId?: string): number => {
    if (!columnId) return 4;
    if (columnId === 'entryPrice' || columnId === 'exitPrice') return 4;
    if (columnId === 'quantity') return 6;
    if (columnId === 'commission') return 6;
    if (columnId === 'pnl') return 2;
    return 4;
  };

  const formatValue = (value: string, type: ColumnType, columnId?: string) => {
    if (!value) return '';

    if (type === 'number') {
      const cleaned = String(value).replace(/,/g, '').replace(/^\+/, '');
      const numeric = Number(cleaned);
      if (Number.isNaN(numeric)) return value;

      const decimals = getDecimalsForColumn(columnId);
      const formatted = formatNumber(numeric, decimals);

      if (columnId === 'pnl' && numeric > 0) {
        return `+${formatted}`;
      }

      return formatted;
    }

    if (type === 'percentage') {
      const numeric = Number(String(value).replace('%', ''));
      if (Number.isNaN(numeric)) {
        return value.includes('%') ? value : `${value}%`;
      }
      return `${numeric.toFixed(2)}%`;
    }

    return value;
  };

  const getCellClassName = (value: string, type: ColumnType) => {
    const baseClass =
      'w-full bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-yellow-500/50 rounded px-2 py-1';

    let alignClass = 'text-left';
    let colorClass = 'text-gray-300';

    if (type === 'number') {
      alignClass = 'text-right';
      const trimmed = value.trim();
      if (trimmed.startsWith('+')) colorClass = 'text-green-400';
      if (trimmed.startsWith('-')) colorClass = 'text-red-400';
    } else if (type === 'percentage') {
      alignClass = 'text-right';
      const numeric = Number(String(value).replace('%', ''));
      if (!Number.isNaN(numeric)) {
        if (numeric > 0) colorClass = 'text-green-400';
        else if (numeric < 0) colorClass = 'text-red-400';
      }
    }

    return `${baseClass} ${alignClass} ${colorClass}`;
  };

  const handleColumnResizeMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
    columnId: string
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const currentColumn = activeSheet?.columns.find((c) => c.id === columnId);
    if (!currentColumn) return;

    const startX = event.clientX;
    const startWidth = currentColumn.width;

    setResizing({
      columnId,
      startX,
      startWidth,
    });

    const handleMouseMove = (e: MouseEvent) => {
      setSheet((prev) => {
        const targetColumn = prev.columns.find((c) => c.id === columnId);
        if (!targetColumn) return prev;

        const delta = e.clientX - startX;
        const newWidth = Math.max(
          targetColumn.id === 'type' ? 120 : 80,
          startWidth + delta
        );

        return {
          ...prev,
          columns: prev.columns.map((col) =>
            col.id === columnId ? { ...col, width: newWidth } : col
          ),
        };
      });
    };

    const handleMouseUp = () => {
      setResizing({
        columnId: null,
        startX: 0,
        startWidth: 0,
      });
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Header Title */}
      <div className="border-b border-zinc-800/50 bg-zinc-950/50 flex items-center px-4 py-3">
        <h2 className="text-sm font-semibold text-yellow-400">
          {sheet.name}
        </h2>
      </div>

      {/* Toolbar */}
      <div className="border-b border-zinc-800/50 bg-zinc-950/50 px-4 py-2 flex items-center gap-2">
        <button
          onClick={() => setShowAddTradeModal(true)}
          className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-black text-sm font-medium rounded-lg transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Row
        </button>
        <button
          onClick={() => setShowAddColumnModal(true)}
          className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-gray-300 text-sm font-medium rounded-lg transition-all flex items-center gap-2 border border-zinc-700"
        >
          <Plus className="w-4 h-4" />
          Add Column
        </button>
        
        <div className="flex-1" />
        <button className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-gray-300 text-sm rounded-lg transition-all flex items-center gap-2 border border-zinc-700">
          <Upload className="w-4 h-4" />
          Import
        </button>
        <button
          onClick={async () => {
            if (!sheet.deals.length || exporting) return;
            setExporting(true);
            try {
              const res = await fetch('http://localhost:8000/api/v1/trades/export');
              if (!res.ok) {
                const text = await res.text();
                console.error('Failed to export trades', res.status, res.statusText, text);
                return;
              }
              const blob = await res.blob();
              const url = window.URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = 'cryptelix_trades.xlsx';
              document.body.appendChild(link);
              link.click();
              link.remove();
              window.URL.revokeObjectURL(url);
            } catch (e) {
              console.error('Error exporting trades', e);
            } finally {
              setExporting(false);
            }
          }}
          disabled={!sheet.deals.length || exporting}
          className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-900 disabled:opacity-60 text-gray-300 text-sm rounded-lg transition-all flex items-center gap-2 border border-zinc-700 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting...' : 'Export'}
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900/90 backdrop-blur-sm border-b border-zinc-800">
            <tr>
              {activeSheet?.columns.map((column) => (
                <th
                  key={column.id}
                  className="px-0 py-0 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider"
                  style={{
                    width: column.width,
                    minWidth: column.id === 'type' ? 120 : 80,
                  }}
                >
                  <div className="flex items-center justify-between group px-4 py-3 relative">
                    <div className="flex items-center gap-2">
                      <span>{column.name}</span>
                      {column.type === 'percentage' && (
                        <span className="text-xs text-gray-500">(%)</span>
                      )}
                      {column.type === 'number' && (
                        <span className="text-xs text-gray-500">(#)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => deleteColumn(column.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-red-400"
                        title="Delete column"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <div
                        onMouseDown={(e) =>
                          handleColumnResizeMouseDown(e, column.id)
                        }
                        className="w-1 h-6 ml-1 cursor-col-resize bg-transparent group-hover:bg-yellow-500/40 transition-colors"
                      />
                    </div>
                  </div>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-16"></th>
            </tr>
          </thead>
          <tbody>
            {activeSheet?.deals.map((deal) => (
              <tr
                key={deal.id}
                className="border-b border-zinc-800/30 hover:bg-zinc-900/30 transition-colors"
              >
                {activeSheet.columns.map((column) => (
                  <td
                    key={column.id}
                    className={`px-0 py-0 ${column.id === 'notes' || column.id === 'ai_report' ? 'align-top' : ''}`}
                    style={{
                      width: column.width,
                      minWidth: column.id === 'type' ? 120 : 80,
                    }}
                  >
                    {column.id === 'notes' ? (
                      editingNote.dealId === deal.id ? (
                        <textarea
                          value={editingNote.draft}
                          onChange={(e) =>
                            setEditingNote((prev) => ({ ...prev, draft: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              void saveNote(deal.id, editingNote.draft);
                              setEditingNote({ dealId: null, draft: '' });
                            }
                          }}
                          onBlur={() => {
                            void saveNote(deal.id, editingNote.draft);
                            setEditingNote({ dealId: null, draft: '' });
                          }}
                          rows={1}
                          placeholder="Add note..."
                          className="w-full bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-yellow-500/50 rounded px-2 py-1 text-left text-gray-300 placeholder:text-gray-600 resize-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setEditingNote({
                              dealId: deal.id,
                              draft: String(deal[column.id] ?? ''),
                            })
                          }
                          className="w-full text-left px-2 py-1 rounded hover:bg-zinc-900/30 transition-colors"
                        >
                          {String(deal[column.id] ?? '') ? (
                            <span className="text-gray-300">{String(deal[column.id] ?? '')}</span>
                          ) : (
                            <span className="text-gray-600">Add note...</span>
                          )}
                        </button>
                      )
                    ) : column.id === 'ai_report' ? (
                      (() => {
                        const busy = !!aiAnalyzeBusy[deal.id];
                        const err = !!aiAnalyzeError[deal.id];
                        const raw = String(deal.ai_report ?? '');
                        const empty = isAiReportEmpty(raw);
                        const expanded = !!aiInsightsExpanded[deal.id];
                        const longText = raw.length > AI_REPORT_PREVIEW_CHARS;
                        const shown =
                          longText && !expanded
                            ? `${raw.slice(0, AI_REPORT_PREVIEW_CHARS)}…`
                            : raw;

                        if (busy) {
                          return (
                            <div className="flex items-center justify-center px-2 py-2">
                              <Loader2 className="w-5 h-5 text-yellow-500 animate-spin" aria-label="Analyzing" />
                            </div>
                          );
                        }

                        if (err) {
                          return (
                            <div className="px-2 py-1 flex flex-col gap-1 items-start">
                              <span className="text-red-400 text-sm">Error - Try again</span>
                              <button
                                type="button"
                                onClick={() => void handleAnalyzeAi(deal.id)}
                                className="text-xs font-medium text-yellow-500 hover:text-yellow-400"
                              >
                                ✨ Analyze
                              </button>
                            </div>
                          );
                        }

                        if (empty) {
                          return (
                            <div className="px-2 py-1">
                              <button
                                type="button"
                                onClick={() => void handleAnalyzeAi(deal.id)}
                                className="text-xs font-medium text-yellow-500 hover:text-yellow-400"
                              >
                                ✨ Analyze
                              </button>
                            </div>
                          );
                        }

                        return (
                          <div className="w-full min-w-0 px-2 py-1 text-left text-sm text-gray-300" title={raw}>
                            <p className="whitespace-pre-wrap break-words text-gray-300">
                              {shown}
                            </p>
                            {longText && (
                              <button
                                type="button"
                                onClick={() =>
                                  setAiInsightsExpanded((prev) => ({
                                    ...prev,
                                    [deal.id]: !prev[deal.id],
                                  }))
                                }
                                className="mt-1 text-sm text-gray-600 hover:text-gray-400"
                              >
                                {expanded ? 'Show less' : 'Read more'}
                              </button>
                            )}
                          </div>
                        );
                      })()
                    ) : isCellLocked(deal, column.id) ? (
                      <div className={getCellClassName(String(deal[column.id] ?? ''), column.type)}>
                        {String(deal[column.id] ?? '')}
                      </div>
                    ) : column.id === 'type' ? (
                      <select
                        value={deal.type || 'Long'}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateDeal(deal.id, column.id, v);
                          const next = { ...deal, type: v };
                          void syncDealFieldToApi(next, 'type', v);
                        }}
                        className="w-full bg-zinc-900 text-gray-300 border-none focus:outline-none focus:ring-1 focus:ring-yellow-500/50 rounded px-2 py-1"
                      >
                        <option value="Long">Long</option>
                        <option value="Short">Short</option>
                      </select>
                    ) : column.id === 'date' ? (
                      <input
                        type="date"
                        value={deal[column.id] || ''}
                        onChange={(e) => updateDeal(deal.id, column.id, e.target.value)}
                        onBlur={(e) => {
                          const v = e.currentTarget.value;
                          const next = { ...deal, date: v };
                          void syncDealFieldToApi(next, 'date', v);
                        }}
                        className={getCellClassName(deal[column.id] || '', column.type)}
                      />
                    ) : (
                      <input
                        type="text"
                        value={deal[column.id] || ''}
                        onChange={(e) => updateDeal(deal.id, column.id, e.target.value)}
                        onBlur={(e) => {
                          const rawInput = e.currentTarget.value;
                          let next: Deal = { ...deal };
                          let override: string | undefined;
                          if (column.type === 'number' || column.type === 'percentage') {
                            const formatted = formatValue(rawInput, column.type, column.id);
                            next = { ...deal, [column.id]: formatted };
                            updateDeal(deal.id, column.id, formatted);
                            const numericRaw = rawInput.replace(/,/g, '').replace(/^\+/, '').trim();
                            // Commit PATCH from raw cell input so formatted strings never parse as empty / 0
                            override =
                              column.id === 'pnl' ||
                              column.id === 'entryPrice' ||
                              column.id === 'exitPrice' ||
                              column.id === 'commission' ||
                              column.id === 'quantity'
                                ? numericRaw
                                : formatted;
                          } else {
                            next = { ...deal, [column.id]: rawInput };
                            updateDeal(deal.id, column.id, rawInput);
                            override = rawInput;
                          }
                          void syncDealFieldToApi(next, column.id, override);
                        }}
                        placeholder={
                          column.type === 'number'
                            ? '0.00'
                            : column.type === 'percentage'
                              ? '0%'
                              : 'Enter value...'
                        }
                        className={getCellClassName(deal[column.id] || '', column.type)}
                      />
                    )}
                  </td>
                ))}
                <td className="px-4 py-2">
                  <button
                    onClick={() => deleteDeal(deal)}
                    disabled={deal.isManual === false}
                    className={`transition-colors ${
                      deal.isManual === false
                        ? 'text-zinc-700 cursor-not-allowed'
                        : 'text-gray-500 hover:text-red-400'
                    }`}
                    title={deal.isManual === false ? 'System Trade' : 'Delete trade'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Trade Modal */}
      {showAddTradeModal && (
        <AddTradeModal
          onClose={() => setShowAddTradeModal(false)}
          onCreated={async (raw) => {
            const apiTrade = normalizeServerTradeJson(raw);
            const deal = apiTradeToDeal(apiTrade, 0, customColumns);
            setSheet((prev) => ({
              ...prev,
              deals: [...prev.deals, deal].sort((a, b) => {
                const at = a.date ? new Date(a.date).getTime() : -Infinity;
                const bt = b.date ? new Date(b.date).getTime() : -Infinity;
                return bt - at;
              }),
            }));
            setShowAddTradeModal(false);
          }}
          customColumns={customColumns}
        />
      )}

      {showAddColumnModal && (
        <AddColumnModal
          onClose={() => setShowAddColumnModal(false)}
          onAdd={handleAddCustomColumn}
        />
      )}
    </div>
  );
}