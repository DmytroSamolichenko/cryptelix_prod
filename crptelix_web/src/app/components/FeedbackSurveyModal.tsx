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
    category: 'Environment',
    prompt: 'Does the customizable environment with widgets made your management better?',
    choices: [
      { value: 2, title: 'Yes, for sure!', subtitle: 'Significant improvement' },
      { value: 1, title: 'Made a little difference', subtitle: 'Slight improvement' },
      { value: 0, title: "Doesn't changed a bit", subtitle: 'No noticeable change' },
    ],
  },
  {
    id: 'q2',
    category: 'Deal Base',
    prompt: 'How do you think, does "Deal Base" feels easy to navigate through your deals?',
    choices: [
      { value: 2, title: 'Feels a lot better', subtitle: 'Smooth navigation' },
      { value: 1, title: "I'm not sure", subtitle: 'Uncertain' },
      { value: 0, title: "It's very hard to understand", subtitle: 'Needs improvement' },
    ],
  },
  {
    id: 'q3',
    category: 'AI',
    prompt: 'Does our AI feels like the most important thing in the app for you?',
    choices: [
      { value: 2, title: 'Definitely!', subtitle: 'Core to my workflow' },
      { value: 1, title: '50/50', subtitle: 'It helps sometimes' },
      { value: 0, title: "It's not useful at all", subtitle: "Doesn't add value" },
    ],
  },
  {
    id: 'comment',
    category: 'Other',
    prompt: 'If you have other questions or suggestions for developers, leave it here!',
  },
];

const GOLD = '#C9A84C';

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

  const canGoNext = question.id === 'comment' ? true : currentChoice !== undefined;

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
      className="fixed inset-0 z-[80] flex items-center justify-center p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="absolute inset-0 bg-black/55 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />

      <AnimatePresence mode="wait">
        {showSkipConfirm ? (
          <SkipConfirmCard
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
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-[560px] rounded-3xl border border-[#C9A84C]/45 bg-[#111110] px-11 pt-10 pb-8 max-sm:px-6 max-sm:pt-8 shadow-[0_0_0_1px_rgba(201,168,76,0.06),0_0_60px_rgba(201,168,76,0.07),0_32px_90px_rgba(0,0,0,0.75)]"
          >
            {/* Header */}
            <div className="flex items-baseline justify-between mb-[18px]">
              <h2
                id="feedback-survey-title"
                className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]"
              >
                Feedback Survey
              </h2>
              <span className="text-[13px] text-[#8A8A85] tabular-nums">
                {answeredCount} / 4 answered
              </span>
            </div>

            {/* Progress track */}
            <div className="relative mb-3 h-[2px] rounded-full bg-[#262624]">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#a8873a] to-[#C9A84C] shadow-[0_0_14px_rgba(201,168,76,0.55)]"
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>

            {/* Step dots */}
            <div className="mb-[34px] flex justify-end gap-[7px]">
              {QUESTIONS.map((_, i) => (
                <motion.span
                  key={i}
                  className="h-[6px] rounded-full"
                  initial={false}
                  animate={{
                    width: i === step ? 22 : 6,
                    backgroundColor:
                      i === step ? GOLD : i < step ? 'rgba(201,168,76,0.55)' : '#262624',
                    boxShadow: i === step ? '0 0 10px rgba(201,168,76,0.5)' : 'none',
                  }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                />
              ))}
            </div>

            {/* Question viewport */}
            <div className="relative min-h-[340px] max-sm:min-h-[400px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={question.id}
                  initial={{ opacity: 0, x: 36 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -28 }}
                  transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                >
                  <p className="mb-2.5 text-[13.5px] text-[#8A8A85]">
                    <span className="text-[#5C5C58]">/ </span>
                    {question.category}
                  </p>
                  <h3 className="mb-[26px] text-[23px] max-sm:text-xl font-bold leading-[1.32] tracking-[-0.01em] text-white">
                    {question.prompt}
                  </h3>

                  {question.id === 'comment' ? (
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Share your thoughts, ideas, or anything on your mind..."
                      className="min-h-[190px] w-full resize-none rounded-2xl border border-[#262624] bg-white/[0.015] p-[18px] text-[14.5px] leading-[1.65] text-[#EDEDEB] placeholder:text-[#5C5C58] outline-none transition-all duration-200 focus:border-[#C9A84C]/45 focus:shadow-[0_0_0_3px_rgba(201,168,76,0.08)]"
                    />
                  ) : (
                    <div className="flex flex-col gap-3">
                      {question.choices.map((choice) => {
                        const selected = currentChoice === choice.value;
                        return (
                          <motion.button
                            key={choice.value}
                            type="button"
                            onClick={() => handleSelect(choice.value)}
                            whileTap={{ scale: 0.985 }}
                            className={`flex w-full items-start gap-3.5 rounded-2xl border px-[18px] py-4 text-left transition-colors duration-200 ${
                              selected
                                ? 'border-[#C9A84C] bg-[#C9A84C]/10 shadow-[0_0_0_1px_rgba(201,168,76,0.25),0_4px_24px_rgba(201,168,76,0.08)]'
                                : 'border-[#262624] bg-white/[0.015] hover:border-[#3d3d39] hover:bg-white/[0.03]'
                            }`}
                          >
                            <span
                              className={`relative mt-[1px] h-5 w-5 shrink-0 rounded-full border-[1.5px] transition-colors duration-200 ${
                                selected ? 'border-[#C9A84C] bg-[#C9A84C]' : 'border-[#55554f]'
                              }`}
                            >
                              {selected && (
                                <motion.span
                                  className="absolute inset-[4.5px] rounded-full bg-[#0C0C0C]"
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                                />
                              )}
                            </span>
                            <span>
                              <span
                                className={`mb-[3px] block text-[15.5px] font-semibold transition-colors duration-200 ${
                                  selected ? 'text-white' : 'text-[#E8E8E5]'
                                }`}
                              >
                                {choice.title}
                              </span>
                              <span
                                className={`block text-[13px] transition-colors duration-200 ${
                                  selected ? 'text-[#C9A84C]/75' : 'text-[#5C5C58]'
                                }`}
                              >
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

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

            {/* Footer */}
            <div className="mt-[30px] flex items-center justify-between border-t border-[#1E1E1C] pt-[22px]">
              {!force ? (
                <button
                  type="button"
                  onClick={() => setShowSkipConfirm(true)}
                  disabled={busy}
                  className="px-0.5 py-1 text-[14.5px] text-[#8A8A85] underline decoration-[#44443f] underline-offset-4 transition-colors duration-200 hover:text-[#c9c9c4]"
                >
                  Skip
                </button>
              ) : (
                <span className="text-xs text-[#5C5C58]">Required to continue</span>
              )}

              <motion.button
                type="button"
                onClick={handleNext}
                disabled={!canGoNext || busy}
                whileHover={canGoNext && !busy ? { y: -1 } : undefined}
                whileTap={canGoNext && !busy ? { scale: 0.98 } : undefined}
                className={`group inline-flex items-center gap-2 rounded-full px-[26px] py-[13px] text-[15px] font-semibold transition-all duration-300 ${
                  canGoNext && !busy
                    ? 'bg-gradient-to-br from-[#E9CD7E] to-[#C9A84C] text-[#101010] shadow-[0_4px_28px_rgba(201,168,76,0.30)] hover:shadow-[0_6px_34px_rgba(201,168,76,0.45)]'
                    : 'cursor-not-allowed border border-[#262624] bg-[#1B1B19] text-[#6E6E68]'
                }`}
              >
                <span>
                  {step === QUESTIONS.length - 1 ? (busy ? 'Submitting…' : 'Submit') : 'Next'}
                </span>
                <span className="font-normal transition-transform duration-200 group-hover:translate-x-[3px]">
                  ›
                </span>
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SkipConfirmCard({
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
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full max-w-[560px] rounded-3xl border border-[#C9A84C]/45 bg-[#111110] px-11 pt-10 pb-8 max-sm:px-6 max-sm:pt-8 shadow-[0_0_0_1px_rgba(201,168,76,0.06),0_0_60px_rgba(201,168,76,0.07),0_32px_90px_rgba(0,0,0,0.75)]"
    >
      <div className="mb-[26px] flex items-start justify-between">
        <motion.div
          className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[#C9A84C]/45 text-[#C9A84C]"
          animate={{
            boxShadow: [
              '0 0 18px rgba(201,168,76,0.12)',
              '0 0 30px rgba(201,168,76,0.28)',
              '0 0 18px rgba(201,168,76,0.12)',
            ],
          }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Clock className="h-[22px] w-[22px]" strokeWidth={1.8} />
        </motion.div>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to survey"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#262624] bg-[#1B1B19] text-[#8A8A85] transition-colors duration-200 hover:border-[#3a3a36] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <h3 className="mb-[18px] text-2xl font-bold tracking-[-0.01em] text-white">
        We'll check back in an hour
      </h3>
      <p className="mb-4 text-[14.5px] leading-[1.7] text-[#8A8A85]">
        This survey will reappear after an hour and completing it will be necessary to continue —
        your answers directly shape how we improve the experience for everyone.
      </p>
      <p className="text-[14.5px] leading-[1.7] text-[#8A8A85]">
        We truly appreciate your understanding and are grateful for the time you spend with us.
        Thank you for being part of this journey.
      </p>

      {error && <p className="mt-4 text-xs text-red-400">{error}</p>}

      <div className="mt-[26px] flex gap-3.5 border-t border-[#1E1E1C] pt-6">
        <motion.button
          type="button"
          onClick={onBack}
          disabled={busy}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          className="flex-1 rounded-full border border-[#3A3A36] px-5 py-3.5 text-[15px] font-semibold text-[#E5E5E2] transition-colors duration-200 hover:border-[#6b6b64]"
        >
          Take me back
        </motion.button>
        <motion.button
          type="button"
          onClick={onSkipAnyway}
          disabled={busy}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          className="flex-1 rounded-full bg-gradient-to-br from-[#E9CD7E] to-[#C9A84C] px-5 py-3.5 text-[15px] font-semibold text-[#101010] shadow-[0_4px_28px_rgba(201,168,76,0.30)] transition-shadow duration-200 hover:shadow-[0_6px_36px_rgba(201,168,76,0.5)] disabled:opacity-60"
        >
          {busy ? 'Skipping…' : 'Skip anyway'}
        </motion.button>
      </div>
    </motion.div>
  );
}
