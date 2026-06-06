import { useState, useRef, useEffect, FormEvent } from 'react';
import { ArrowRight, Mail } from 'lucide-react';
import { motion } from 'motion/react';
import { CryptelixLogo } from '../CryptelixLogo';
import { isValidEmail } from '../../lib/authStorage';

interface LoginScreenProps {
  onSuccess: (email: string) => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();

    if (!isValidEmail(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    await new Promise((resolve) => window.setTimeout(resolve, 320));
    onSuccess(trimmed);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-950 px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundColor: '#09090b',
          backgroundImage: `
            radial-gradient(circle, rgba(250, 204, 21, 0.07) 1px, transparent 1px),
            linear-gradient(rgba(250, 204, 21, 0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(250, 204, 21, 0.02) 1px, transparent 1px)
          `,
          backgroundSize: '24px 24px, 48px 48px, 48px 48px',
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-yellow-500/5 via-transparent to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[420px]"
      >
        <div className="mb-8 flex justify-center">
          <CryptelixLogo />
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/95 p-8 shadow-2xl shadow-black/40 backdrop-blur-sm">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-white">Sign in to Cryptelix</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Enter your email to access your AI Environment workspace.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-xs font-medium text-zinc-400">
                Email address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  ref={inputRef}
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError('');
                  }}
                  disabled={isSubmitting}
                  className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-10 pr-3 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-yellow-500/50 focus:ring-2 focus:ring-yellow-500/15 disabled:opacity-60"
                />
              </div>
              {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            </div>

            <motion.button
              type="submit"
              disabled={isSubmitting || !email.trim()}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-yellow-500 text-sm font-semibold text-black transition-colors hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50"
              whileHover={isSubmitting ? undefined : { scale: 1.01 }}
              whileTap={isSubmitting ? undefined : { scale: 0.98 }}
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                  Continuing…
                </span>
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </motion.button>
          </form>

          <p className="mt-6 text-center text-xs leading-relaxed text-zinc-500">
            Preview sign-in — any valid email works. Your session is saved on this browser.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
