import { useState, useRef, useEffect, FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { CryptelixLogo } from '../CryptelixLogo';
import { isValidEmail } from '../../lib/authStorage';

interface LoginScreenProps {
  onSuccess: (email: string) => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    const trimmedPassword = password.trim();

    if (!isValidEmail(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }

    if (!trimmedPassword) {
      setError('Enter your password.');
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
          <CryptelixLogo showAlpha={false} />
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/95 p-8 shadow-2xl shadow-black/40 backdrop-blur-sm">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-white">Sign in to Cryptelix</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Enter your email and password to access your AI Environment workspace.
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
            </div>

            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-xs font-medium text-zinc-400">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  disabled={isSubmitting}
                  className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-10 pr-11 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-yellow-500/50 focus:ring-2 focus:ring-yellow-500/15 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  disabled={isSubmitting}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {showPassword ? (
                      <motion.span
                        key="eye-off"
                        initial={{ opacity: 0, scale: 0.6, rotate: -12 }}
                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                        exit={{ opacity: 0, scale: 0.6, rotate: 12 }}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        className="inline-flex"
                      >
                        <EyeOff className="h-4 w-4" />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="eye"
                        initial={{ opacity: 0, scale: 0.6, rotate: 12 }}
                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                        exit={{ opacity: 0, scale: 0.6, rotate: -12 }}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        className="inline-flex"
                      >
                        <Eye className="h-4 w-4" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <motion.button
              type="submit"
              disabled={isSubmitting || !email.trim() || !password.trim()}
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
          Alpha Test | Release - June 2026 - Limited Access
          </p>
        </div>
      </motion.div>
    </div>
  );
}
