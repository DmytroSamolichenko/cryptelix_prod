import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Clock, X } from 'lucide-react';
import { skipFeedback, submitFeedback } from '../lib/feedbackApi';

type Choice = { value: 0 | 1 | 2; title: string; subtitle: string };

type Question =
  | {
      id: 'q1' | 'q2' | 'q3';
      category: string;
      prompt: string;
      choices: Choice[];
    }
  | {
      id: 'comment';
      category: string;
      prompt: string;
    };

const QUESTIONS: Question[] = [
  {
    id: 'q1',
    category: '/ Environment',
    prompt: 'Does the customizable environment with widgets made your management better?',
    choices: [
      { value: 2, title: 'Yes, for sure!', subtitle: 'Significant improvement' },
      { value: 1, title: 'Made a little difference', subtitle: 'Slight improvement' },
      { value: 0, title: "Doesn't changed a bit", subtitle: 'No noticeable change' },
    ],
  },
  {
    id: 'q2',
    category: '/ Deal Base',
    prompt: 'How do you think, does "Deal Base" feels easy to navigate through your deals?',
    choices: [
      { value: 2, title: 'Feels a lot better', subtitle: 'Smooth navigation' },
      { value: 1, title: "I'm not sure", subtitle: 'Uncertain' },
      { value: 0, title: "It's very hard to understand", subtitle: 'Needs improvement' },
    ],
  },
  {
    id: 'q3',
    category: '/ AI',
    prompt: 'Does our AI feels like the most important thing in the app for you?',
    choices: [
      { value: 2, title: 'Definitely!', subtitle: 'Core to my workflow' },
      { value: 1, title: '50/50', subtitle: 'It helps sometimes' },
      { value: 0, title: "It's not useful at all", subtitle: "Doesn't add value" },
    ],
  },
  {
    id: 'comment',
    category: '/ Other',
    prompt: 'If you have other questions or suggestions for developers, leave it here!',
  },
];

interface FeedbackSurveyModalProps {
  force: boolean;
  onCompleted: () => void;
  onSkipped: () => void;
}

export function FeedbackSurveyModal({ force, onCompleted, onSkipped }: FeedbackSurveyModalProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<{ q1?: 0 | 1 | 2; q2?: 0 | 1 | 2; q3?: 0 | 1 | 2 }>({});
  const [comment, setComment] = useState('');
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = QUESTIONS[step];
  const answeredCount = useMemo(() => {
    let n = 0;
    if (answers.q1 !== undefined) n += 1;
    if (answers.q2 !== undefined) n += 1;
    if (answers.q3 !== undefined) n += 1;
    if (comment.trim()) n += 1;
    return n;
  }, [answers, comment]);

  const progress = ((step + 1) / QUESTIONS.length) * 100;
  const currentChoice =
    question.id === 'comment' ? undefined : answers[question.id as 'q1' | 'q2' | 'q3'];

  const canGoNext =
    question.id === 'comment'
      ? true
      : currentChoice !== undefined;

  const handleSelect = (value: 0 | 1 | 2) => {
    if (question.id === 'comment') return;
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
    setError(null);
  };

  const handleNext = async () => {
    if (!canGoNext || busy) return;
    if (step < QUESTIONS.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    if (answers.q1 === undefined || answers.q2 === undefined || answers.q3 === undefined) {
      setError('Please answer all questions before submitting.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitFeedback({
        q1: answers.q1,
        q2: answers.q2,
        q3: answers.q3,
        comment: comment.trim() || undefined,
      });
      onCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSkipAnyway = async () => {
    if (force || busy) return;
    setBusy(true);
    setError(null);
    try {
      await skipFeedback();
      setShowSkipConfirm(false);
      onSkipped();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Skip failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />

      <AnimatePresence mode="wait">
        {showSkipConfirm ? (
          <SkipConfirmModal
            key="skip-confirm"
            busy={busy}
            error={error}
            onBack={() => {
              setShowSkipConfirm(false);
              setError(null);
            }}
            onSkipAnyway={handleSkipAnyway}
          />
        ) : (
          <motion.div
            key="survey"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-survey-title"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-[440px] rounded-3xl border border-[#C9A84C]/45 bg-[#0C0C0C] shadow-[0_0_0_1px_rgba(201,168,76,0.08),0_24px_80px_rgba(0,0,0,0.65)]"
          >
            <div className="px-6 pt-5 pb-3">
              <div className="flex items-start justify-between gap-3">
                <h2
                  id="feedback-survey-title"
                  className="text-[11px] font-medium tracking-[0.14em] text-[#C9A84C] uppercase"
                >
                  Feedback Survey
                </h2>
                <span className="text-[11px] text-zinc-500 tabular-nums">
                  {answeredCount} / 4 answered
                </span>
              </div>
              <div className="mt-3 h-px w-full bg-zinc-800 overflow-hidden">
                <motion.div
                  className="h-full bg-[#C9A84C] shadow-[0_0_12px_rgba(201,168,76,0.55)]"
                  initial={false}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.35 }}
                />
              </div>
              <div className="mt-3 flex justify-end gap-1.5">
                {QUESTIONS.map((_, i) => (
                  <span
                    key={i}
                    className={
                      i === step
                        ? 'h-1 w-4 rounded-full bg-[#C9A84C]'
                        : i < step
                          ? 'h-1.5 w-1.5 rounded-full bg-[#C9A84C]/70'
                          : 'h-1.5 w-1.5 rounded-full bg-zinc-700'
                    }
                  />
                ))}
              </div>
            </div>

            <div className="px-6 pb-2 min-h-[320px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={question.id}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -18 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                >
                  <p className="text-xs text-zinc-500 mb-2">{question.category}</p>
                  <h3 className="text-[22px] leading-snug font-semibold text-white mb-5">
                    {question.prompt}
                  </h3>

                  {question.id === 'comment' ? (
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Share your thoughts, ideas, or anything on your mind..."
                      rows={6}
                      className="w-full resize-none rounded-2xl border border-zinc-700/80 bg-zinc-900/80 px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-[#C9A84C]/50 focus:ring-1 focus:ring-[#C9A84C]/25"
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {question.choices.map((choice) => {
                        const selected = currentChoice === choice.value;
                        return (
                          <motion.button
                            key={choice.value}
                            type="button"
                            onClick={() => handleSelect(choice.value)}
                            whileTap={{ scale: 0.985 }}
                            className={`w-full flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors ${
                              selected
                                ? 'border-[#C9A84C]/70 bg-[#C9A84C]/10'
                                : 'border-zinc-700/70 bg-zinc-900/50 hover:border-zinc-500'
                            }`}
                          >
                            <span
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                selected
                                  ? 'border-[#C9A84C] bg-[#C9A84C]'
                                  : 'border-zinc-500 bg-transparent'
                              }`}
                            >
                              {selected && (
                                <motion.span
                                  layoutId="feedback-radio-dot"
                                  className="h-2 w-2 rounded-full bg-black"
                                />
                              )}
                            </span>
                            <span>
                              <span
                                className={`block text-sm font-semibold ${
                                  selected ? 'text-white' : 'text-zinc-200'
                                }`}
                              >
                                {choice.title}
                              </span>
                              <span className="block text-xs text-zinc-500 mt-0.5">
                                {choice.subtitle}
                              </span>
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {error && (
              <p className="px-6 pb-2 text-xs text-red-400">{error}</p>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-6 py-4">
              {!force ? (
                <button
                  type="button"
                  onClick={() => setShowSkipConfirm(true)}
                  className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-300 transition-colors"
                  disabled={busy}
                >
                  Skip
                </button>
              ) : (
                <span className="text-xs text-zinc-600">Required to continue</span>
              )}

              <button
                type="button"
                onClick={handleNext}
                disabled={!canGoNext || busy}
                className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${
                  canGoNext && !busy
                    ? 'bg-zinc-200 text-zinc-900 hover:bg-white'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                {step === QUESTIONS.length - 1 ? (busy ? 'Submitting…' : 'Submit >') : 'Next >'}
              </button>
            </div>

            <p className="pb-4 text-center text-[10px] tracking-[0.12em] text-zinc-600 uppercase">
              Confidential · Results are anonymous
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SkipConfirmModal({
  busy,
  error,
  onBack,
  onSkipAnyway,
}: {
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSkipAnyway: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ duration: 0.25 }}
      className="relative w-full max-w-[420px] rounded-3xl border border-[#C9A84C]/45 bg-[#0C0C0C] shadow-[0_0_40px_rgba(201,168,76,0.12)] px-6 pt-5 pb-5"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#C9A84C]/50 text-[#C9A84C]">
          <Clock className="h-5 w-5" />
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <h3 className="text-xl font-semibold text-white mb-3">We'll check back in an hour</h3>
      <p className="text-sm text-zinc-400 leading-relaxed mb-3">
        This survey will reappear after an hour and completing it will be necessary to continue —
        your answers directly shape how we improve the experience for everyone.
      </p>
      <p className="text-sm text-zinc-400 leading-relaxed mb-5">
        We truly appreciate your understanding and are grateful for the time you spend with us. Thank
        you for being part of this journey.
      </p>

      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-3 border-t border-zinc-800 pt-4">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="flex-1 rounded-full border border-zinc-600 px-4 py-2.5 text-sm text-white hover:border-zinc-400 transition-colors"
        >
          Take me back
        </button>
        <button
          type="button"
          onClick={onSkipAnyway}
          disabled={busy}
          className="flex-1 rounded-full bg-[#C9A84C] px-4 py-2.5 text-sm font-semibold text-black shadow-[0_0_24px_rgba(201,168,76,0.35)] hover:bg-[#d4b45a] transition-colors disabled:opacity-60"
        >
          {busy ? 'Skipping…' : 'Skip anyway'}
        </button>
      </div>
    </motion.div>
  );
}
