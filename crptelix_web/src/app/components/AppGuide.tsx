import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { APP_GUIDE_STEPS } from '../lib/appGuideSteps';

export type GuidePhase = 'welcome' | 'skipNote' | 'tour' | 'done' | 'idle';

interface AppGuideProps {
  phase: GuidePhase;
  tourIndex: number;
  remeasureKey: string;
  onBegin: () => void;
  onSkip: () => void;
  onSkipNoteDismiss: () => void;
  onNext: () => void;
  onBack: () => void;
  onDoneDismiss: () => void;
}

interface HoleRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const TOOLTIP_WIDTH = 300;
const TOOLTIP_GAP = 12;
const DIM = 'rgba(0, 0, 0, 0.72)';

function unionRects(elements: NodeListOf<Element>): HoleRect | null {
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let found = false;

  elements.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return;
    found = true;
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  });

  if (!found) return null;
  return {
    top: top - PAD,
    left: left - PAD,
    width: right - left + PAD * 2,
    height: bottom - top + PAD * 2,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function tooltipPosition(hole: HoleRect): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const estimatedHeight = 200;
  const spaceBelow = vh - (hole.top + hole.height);
  const spaceAbove = hole.top;
  const spaceLeft = hole.left;
  const preferLeft = hole.left + hole.width > vw * 0.72 && spaceLeft > TOOLTIP_WIDTH + TOOLTIP_GAP;

  let top: number;
  let left: number;

  if (preferLeft) {
    left = hole.left - TOOLTIP_WIDTH - TOOLTIP_GAP;
    top = hole.top + hole.height / 2 - estimatedHeight / 2;
  } else if (hole.height > vh * 0.45) {
    top = hole.top + 16;
    left = hole.left + 16;
  } else if (spaceBelow >= estimatedHeight + TOOLTIP_GAP || spaceBelow >= spaceAbove) {
    top = hole.top + hole.height + TOOLTIP_GAP;
    left = hole.left + hole.width / 2 - TOOLTIP_WIDTH / 2;
  } else {
    top = hole.top - estimatedHeight - TOOLTIP_GAP;
    left = hole.left + hole.width / 2 - TOOLTIP_WIDTH / 2;
  }

  left = clamp(left, 12, vw - TOOLTIP_WIDTH - 12);
  top = clamp(top, 12, vh - 80);
  return { top, left };
}

function GuidePopup({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-guide-title"
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2 }}
        className="relative z-[1] w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 px-6 py-6 shadow-2xl"
      >
        <h2 id="app-guide-title" className="text-center text-lg font-semibold text-yellow-400">
          {title}
        </h2>
        <p className="mt-3 text-center text-sm leading-relaxed text-white">{body}</p>
        <div className="mt-6 flex items-center justify-center gap-3">{children}</div>
      </motion.div>
    </motion.div>
  );
}

function GhostButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-zinc-600 bg-transparent px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-400 hover:text-white"
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-yellow-500/20 transition-colors hover:bg-yellow-400"
    >
      {children}
    </button>
  );
}

export function AppGuide({
  phase,
  tourIndex,
  remeasureKey,
  onBegin,
  onSkip,
  onSkipNoteDismiss,
  onNext,
  onBack,
  onDoneDismiss,
}: AppGuideProps) {
  const step = APP_GUIDE_STEPS[tourIndex];
  const [hole, setHole] = useState<HoleRect | null>(null);

  const measure = useCallback(() => {
    if (phase !== 'tour' || !step) {
      setHole(null);
      return;
    }
    const nodes = document.querySelectorAll(`[data-guide="${step.target}"]`);
    const next = unionRects(nodes);
    setHole((prev) => {
      if (!prev && !next) return prev;
      if (
        prev &&
        next &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.height === next.height
      ) {
        return prev;
      }
      return next;
    });
  }, [phase, step]);

  useLayoutEffect(() => {
    measure();
  }, [measure, remeasureKey]);

  useEffect(() => {
    if (phase !== 'tour') return;

    let cancelled = false;
    let frames = 0;
    const tick = () => {
      if (cancelled) return;
      measure();
      frames += 1;
      if (frames < 45) requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, phase, tourIndex, remeasureKey]);

  const isLast = tourIndex >= APP_GUIDE_STEPS.length - 1;
  const tip = hole ? tooltipPosition(hole) : null;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;

  return (
    <AnimatePresence>
      {phase === 'welcome' && (
        <GuidePopup
          key="welcome"
          title="Welcome to Cryptelix"
          body="Thanks for choosing us. This short guide walks you through Constructor, Deal Base, and the tools you'll use for post-trade analysis."
        >
          <GhostButton onClick={onSkip}>Skip</GhostButton>
          <PrimaryButton onClick={onBegin}>Begin</PrimaryButton>
        </GuidePopup>
      )}

      {phase === 'skipNote' && (
        <GuidePopup
          key="skip"
          title="You can come back anytime"
          body="Restart this tour from the ? button in the bottom-left corner — open it and tap App Guide."
        >
          <PrimaryButton onClick={onSkipNoteDismiss}>Got it</PrimaryButton>
        </GuidePopup>
      )}

      {phase === 'done' && (
        <GuidePopup
          key="done"
          title="You're ready"
          body="Good luck with your post-analytics. Replay this guide anytime from the ? button → App Guide."
        >
          <PrimaryButton onClick={onDoneDismiss}>Start building</PrimaryButton>
        </GuidePopup>
      )}

      {phase === 'tour' && step && (
        <motion.div
          key={`tour-${step.id}`}
          className="fixed inset-0 z-[80]"
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0" />
          {hole ? (
            <>
              <div className="absolute left-0 right-0 top-0" style={{ height: Math.max(0, hole.top), background: DIM }} />
              <div
                className="absolute left-0"
                style={{
                  top: hole.top,
                  width: Math.max(0, hole.left),
                  height: hole.height,
                  background: DIM,
                }}
              />
              <div
                className="absolute right-0"
                style={{
                  top: hole.top,
                  width: Math.max(0, vw - hole.left - hole.width),
                  height: hole.height,
                  background: DIM,
                }}
              />
              <div
                className="absolute bottom-0 left-0 right-0"
                style={{
                  height: Math.max(0, vh - hole.top - hole.height),
                  background: DIM,
                }}
              />
              <div
                className="pointer-events-none absolute rounded-xl border-2 border-yellow-400 shadow-[0_0_0_1px_rgba(250,204,21,0.25),0_0_18px_rgba(250,204,21,0.25)]"
                style={{
                  top: hole.top,
                  left: hole.left,
                  width: hole.width,
                  height: hole.height,
                }}
              />
            </>
          ) : (
            <div className="absolute inset-0" style={{ background: DIM }} />
          )}

          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute z-[1] rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 shadow-2xl"
            style={
              tip
                ? { top: tip.top, left: tip.left, width: TOOLTIP_WIDTH }
                : { top: '50%', left: '50%', width: TOOLTIP_WIDTH, transform: 'translate(-50%, -50%)' }
            }
          >
            <div className="text-sm font-semibold text-yellow-400">{step.title}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-white">{step.description}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <GhostButton onClick={onSkip}>Skip</GhostButton>
              <div className="flex items-center gap-2">
                {tourIndex > 0 && <GhostButton onClick={onBack}>Back</GhostButton>}
                <PrimaryButton onClick={onNext}>{isLast ? 'Finish' : 'Next'}</PrimaryButton>
              </div>
            </div>
            <div className="mt-2 text-center text-[10px] tabular-nums text-zinc-500">
              {tourIndex + 1} / {APP_GUIDE_STEPS.length}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
