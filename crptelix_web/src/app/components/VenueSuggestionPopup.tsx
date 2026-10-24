import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { fetchVenueSuggestions, formatRate, type VenueSuggestion } from '../lib/venueSuggestions';

const COPY = {
  fee: {
    title: 'You’re paying too much in fees.',
    subtitle: 'and save on this trade.',
  },
  funding: {
    title: 'You’re overpaying on funding.',
    subtitle: 'and pay less funding on this position.',
  },
} as const;

interface VenueSuggestionPopupProps {
  suggestion: VenueSuggestion;
  onHide: () => void;
  onTry: () => void;
}

export function VenueSuggestionPopup({ suggestion, onHide, onTry }: VenueSuggestionPopupProps) {
  const titleId = useId();
  const copy = COPY[suggestion.kind];
  const interval = suggestion.kind === 'funding' && suggestion.fundingInterval ? ` / ${suggestion.fundingInterval}` : '';

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="w-[344px] max-w-[calc(100vw-2rem)] rounded-xl border border-[#C9A84C]/45 bg-gradient-to-b from-[#121210] to-[#0a0a0a] p-6 shadow-[0_14px_40px_rgba(0,0,0,0.6)]"
    >
      <h2 id={titleId} className="text-[19px] font-bold leading-tight tracking-[-0.01em] text-white">
        {copy.title}
      </h2>
      <p className="mt-1.5 text-[12px] text-zinc-400">
        Try <span className="font-semibold text-[#E3C06A]">{suggestion.suggestedVenue}</span> {copy.subtitle}
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-white/[0.02] px-4 py-3.5">
        <div className="min-w-0">
          <div className="truncate text-[11px] text-zinc-500">{suggestion.currentVenue}</div>
          <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-zinc-300">
            {formatRate(suggestion.currentRate, suggestion.kind)}
            {interval && <span className="ml-1 text-[11px] font-medium text-zinc-500">{interval}</span>}
          </div>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600" strokeWidth={1.5} aria-hidden />
        <div className="min-w-0 text-right">
          <div className="truncate text-[11px] text-zinc-500">{suggestion.suggestedVenue}</div>
          <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-[#E3C06A]">
            {formatRate(suggestion.suggestedRate, suggestion.kind)}
            {interval && <span className="ml-1 text-[11px] font-medium text-[#E3C06A]/60">{interval}</span>}
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onHide}
          className="h-9 flex-[1] rounded-lg border border-zinc-800 bg-black text-[12px] font-semibold text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white"
        >
          Hide
        </button>
        <a
          href={suggestion.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onTry}
          className="flex h-9 flex-[1.65] items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-[#E8C77E] to-[#C9A04A] text-[12px] font-semibold text-[#1a1407] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-[filter] hover:brightness-110"
        >
          Try {suggestion.suggestedVenue}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
    </div>
  );
}

const SHOW_DELAY_MS = 1500;

/** Shows queued suggestions one at a time; hidden ones stay hidden for the session. */
export function VenueSuggestionHost() {
  const [queue, setQueue] = useState<VenueSuggestion[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchVenueSuggestions()
      .then((items) => {
        if (!cancelled) setQueue(items);
      })
      .catch(() => {});
    const timer = window.setTimeout(() => setReady(true), SHOW_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const current = ready ? queue[0] : undefined;
  const dismiss = () => setQueue((q) => q.slice(1));

  return (
    <div className="pointer-events-none absolute right-4 top-4 z-40">
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.id}
            className="pointer-events-auto"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <VenueSuggestionPopup suggestion={current} onHide={dismiss} onTry={dismiss} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
