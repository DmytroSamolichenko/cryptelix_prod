import { useState, useRef, useEffect, FormEvent } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail, Wallet } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { CryptelixLogo } from '../CryptelixLogo';
import { isValidEmail, type AuthSession } from '../../lib/authStorage';
import { apiFetch } from '../../lib/apiClient';
import { TurnstileWidget, TURNSTILE_ENABLED } from './TurnstileWidget';
import { REOWN_ENABLED, useConfiguredWalletSignIn } from '../../lib/walletSignIn';

type AuthStep = 'email' | 'password';
type AuthMode = 'needs_activation' | 'needs_login';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60';

// Autofill otherwise paints the browser's pale blue over the dark field.
const INPUT_BASE =
  'h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 text-[13px] text-white caret-yellow-400 outline-none transition-colors placeholder:text-zinc-500 hover:border-zinc-700 focus:border-yellow-500/60 focus:ring-2 focus:ring-yellow-500/15 disabled:opacity-60 selection:bg-yellow-400/25 [&:-webkit-autofill]:[-webkit-text-fill-color:#fff] [&:-webkit-autofill]:[box-shadow:inset_0_0_0_1000px_#09090b]';
const LABEL = 'mb-1.5 block text-xs font-medium leading-none text-zinc-400';
const PRIMARY_BTN = `flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-yellow-500 text-[13px] font-semibold text-black transition-colors hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;

function FormError({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-[13px] leading-snug text-red-400">
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

interface LoginScreenProps {
  onSuccess: (session: AuthSession) => void;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  csrf_token?: string | null;
  user: { id: number; email?: string | null; username?: string | null };
}

function WalletContinueButton({
  onSuccess,
  setError,
  isSubmitting,
  setIsSubmitting,
  turnstileToken,
  resetTurnstile,
}: {
  onSuccess: (session: AuthSession) => void;
  setError: (value: string) => void;
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
  turnstileToken: string;
  resetTurnstile: () => void;
}) {
  const { signIn } = useConfiguredWalletSignIn();
  const [showNotice, setShowNotice] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);

  // The recovery warning has to land before the wallet picker opens, so the click opens it first.
  const requestWallet = () => {
    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError('Please complete the verification below.');
      return;
    }
    setError('');
    setShowNotice(true);
  };

  useEffect(() => {
    if (!showNotice) return;
    continueRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNotice(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showNotice]);

  const handleWallet = async () => {
    setShowNotice(false);
    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError('Please complete the verification below.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      const session = await signIn(turnstileToken || undefined);
      onSuccess(session);
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : 'Wallet sign-in failed.';
      setError(message);
      resetTurnstile();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-zinc-800" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-zinc-900 px-3 text-xs text-zinc-500">or</span>
        </div>
      </div>
      <button
        type="button"
        onClick={requestWallet}
        disabled={isSubmitting}
        className={`flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 text-[13px] font-semibold text-white transition-colors hover:border-yellow-500/50 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      >
        <Wallet className="h-4 w-4 text-yellow-400" aria-hidden />
        Continue with wallet
      </button>

      <AnimatePresence>
        {showNotice && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-notice-title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-zinc-950/95 p-8 backdrop-blur-sm"
          >
            <div className="w-full text-center">
              <h3 id="wallet-notice-title" className="font-sans text-base font-semibold text-white">
                Before you connect
              </h3>
              <p className="mx-auto mt-2 max-w-[300px] text-[13px] leading-5 text-zinc-400 text-balance">
                If you lose this wallet, you cannot recover the account unless you later add an
                email.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowNotice(false)}
                  className={`h-10 rounded-lg border border-zinc-800 text-[13px] font-semibold text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white ${FOCUS_RING}`}
                >
                  Cancel
                </button>
                <button
                  ref={continueRef}
                  type="button"
                  onClick={() => void handleWallet()}
                  className={`h-10 rounded-lg bg-yellow-500 text-[13px] font-semibold text-black transition-colors hover:bg-yellow-400 ${FOCUS_RING}`}
                >
                  I understand
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [step, setStep] = useState<AuthStep>('email');
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  // Bump to force a fresh Turnstile challenge (tokens are single-use).
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetTurnstile = () => {
    setTurnstileToken('');
    setTurnstileNonce((n) => n + 1);
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  // Prefill the invite code from the activation link (e.g. ?invite=CODE).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('invite');
    if (code) setInviteCode(code.trim());
  }, []);

  const resetPasswordFields = () => {
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    resetTurnstile();
  };

  const handleEmailStep = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();

    if (!isValidEmail(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      const res = await apiFetch('/api/v1/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });

      if (res.status === 404) {
        setError('This email is not invited.');
        return;
      }

      if (res.status === 429) {
        setError('Too many attempts. Please wait a minute and try again.');
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { detail?: string }).detail || 'Could not verify email.');
        return;
      }

      const data = (await res.json()) as { status: AuthMode; email: string };
      setAuthMode(data.status);
      setEmail(data.email);
      resetPasswordFields();
      setStep('password');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordStep = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedPassword = password.trim();

    if (!trimmedPassword) {
      setError('Enter your password.');
      return;
    }

    if (authMode === 'needs_activation') {
      if (!inviteCode.trim()) {
        setError('Enter your invite code.');
        return;
      }
      if (trimmedPassword.length < 10) {
        setError('Password must be at least 10 characters.');
        return;
      }
      if (
        !/[A-Z]/.test(trimmedPassword) ||
        !/[a-z]/.test(trimmedPassword) ||
        !/[0-9]/.test(trimmedPassword) ||
        !/[^A-Za-z0-9]/.test(trimmedPassword)
      ) {
        setError(
          'Password must include uppercase, lowercase, a number, and a symbol.'
        );
        return;
      }
      if (trimmedPassword !== confirmPassword.trim()) {
        setError('Passwords do not match.');
        return;
      }
    }

    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError('Please complete the verification below.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    const endpoint =
      authMode === 'needs_activation' ? '/api/v1/auth/activate' : '/api/v1/auth/login';

    const payload =
      authMode === 'needs_activation'
        ? {
            email: email.trim(),
            password: trimmedPassword,
            invite_code: inviteCode.trim(),
            turnstile_token: turnstileToken || undefined,
          }
        : {
            email: email.trim(),
            password: trimmedPassword,
            turnstile_token: turnstileToken || undefined,
          };

    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 429) {
        setError('Too many attempts. Please wait a minute and try again.');
        resetTurnstile();
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = (body as { detail?: string }).detail;
        setError(
          detail ||
            (authMode === 'needs_activation'
              ? 'Could not activate account.'
              : 'Invalid email or password.')
        );
        resetTurnstile();
        return;
      }

      const data = (await res.json()) as TokenResponse;
      onSuccess({
        accessToken: data.access_token,
        csrfToken: data.csrf_token ?? undefined,
        user: {
          id: data.user.id,
          email: data.user.email ?? null,
          username: data.user.username ?? null,
          signedInAt: new Date().toISOString(),
        },
      });
    } catch {
      setError('Network error. Please try again.');
      resetTurnstile();
    } finally {
      setIsSubmitting(false);
    }
  };

  const goBackToEmail = () => {
    setStep('email');
    setAuthMode(null);
    resetPasswordFields();
    setError('');
  };

  const isActivate = authMode === 'needs_activation';
  const passwordReady =
    password.trim().length > 0 &&
    (isActivate
      ? confirmPassword.trim().length > 0 && inviteCode.trim().length > 0
      : true);

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
        className="relative z-10 w-full max-w-[460px]"
      >
        <div className="mb-16 flex flex-col items-center text-center">
          <CryptelixLogo
            variant="wordmark"
            showAlpha={false}
            className="h-16 w-auto select-none object-contain object-center sm:h-[4.5rem]"
          />
          <h1 className="mt-3 text-[2.15rem] font-bold leading-[1.1] tracking-tight text-white sm:text-5xl">
            Join your own
          </h1>
          <p className="mt-1.5 text-[2.15rem] font-bold leading-[1.1] tracking-tight text-yellow-400 sm:text-5xl">
            Analytical Workspace
          </p>
        </div>

        <div className="relative rounded-3xl border border-zinc-800/90 bg-zinc-900/90 p-8 font-['Inter',ui-sans-serif,system-ui,sans-serif] shadow-2xl shadow-black/50 backdrop-blur-sm sm:p-9">
          <div className="mb-7 text-center">
            {/* Kept exactly as designed: pinned to the app's default sans so the card font doesn't change it. */}
            <h2 className="font-sans text-[28px] font-bold tracking-tight text-white">Sign In</h2>
            <p className="mt-2 text-[13px] leading-5 text-zinc-400 text-balance">
              {step === 'email'
                ? 'Enter your invited email to continue.'
                : isActivate
                  ? 'Create your password to finish setup.'
                  : 'Enter your password to sign in.'}
            </p>
          </div>

          {step === 'email' ? (
            <motion.form
              key="email-step"
              onSubmit={handleEmailStep}
              className="space-y-4"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <div>
                <label htmlFor="login-email" className={LABEL}>
                  Email address
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
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
                    className={`${INPUT_BASE} pl-10 pr-3`}
                  />
                </div>
              </div>

              {error && <FormError message={error} />}

              <motion.button
                type="submit"
                disabled={isSubmitting || !email.trim()}
                className={PRIMARY_BTN}
                whileTap={isSubmitting ? undefined : { scale: 0.98 }}
              >
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                    Checking…
                  </span>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </motion.button>

              {REOWN_ENABLED ? (
                <>
                  <WalletContinueButton
                    onSuccess={onSuccess}
                    setError={setError}
                    isSubmitting={isSubmitting}
                    setIsSubmitting={setIsSubmitting}
                    turnstileToken={turnstileToken}
                    resetTurnstile={resetTurnstile}
                  />
                  {TURNSTILE_ENABLED && (
                    <TurnstileWidget
                      key={turnstileNonce}
                      onVerify={(token) => {
                        setTurnstileToken(token);
                        setError('');
                      }}
                      onExpire={() => setTurnstileToken('')}
                    />
                  )}
                </>
              ) : null}
            </motion.form>
          ) : (
            <motion.form
              key="password-step"
              onSubmit={handlePasswordStep}
              className="space-y-4"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5 text-[13px] text-zinc-300">
                <span className="min-w-0 truncate">{email}</span>
                <button
                  type="button"
                  onClick={goBackToEmail}
                  className={`shrink-0 rounded text-xs font-medium text-yellow-500/90 transition-colors hover:text-yellow-400 ${FOCUS_RING}`}
                >
                  Change
                </button>
              </div>

              {isActivate && (
                <div>
                  <label htmlFor="login-invite-code" className={LABEL}>
                    Invite code
                  </label>
                  <input
                    id="login-invite-code"
                    type="text"
                    autoComplete="off"
                    placeholder="Code from your invitation"
                    value={inviteCode}
                    onChange={(e) => {
                      setInviteCode(e.target.value);
                      if (error) setError('');
                    }}
                    disabled={isSubmitting}
                    className={`${INPUT_BASE} px-3`}
                  />
                </div>
              )}

              <div>
                <label htmlFor="login-password" className={LABEL}>
                  {isActivate ? 'Create password' : 'Password'}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    ref={inputRef}
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isActivate ? 'new-password' : 'current-password'}
                    placeholder={
                      isActivate
                        ? '10+ chars, upper, lower, number, symbol'
                        : 'Enter your password'
                    }
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError('');
                    }}
                    disabled={isSubmitting}
                    className={`${INPUT_BASE} pl-10 pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    disabled={isSubmitting}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className={`absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50 ${FOCUS_RING}`}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </AnimatePresence>
                  </button>
                </div>
              </div>

              {isActivate && (
                <div>
                  <label htmlFor="login-confirm-password" className={LABEL}>
                    Confirm password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <input
                      id="login-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Repeat your password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (error) setError('');
                      }}
                      disabled={isSubmitting}
                      className={`${INPUT_BASE} pl-10 pr-3`}
                    />
                  </div>
                </div>
              )}

              {TURNSTILE_ENABLED && (
                <TurnstileWidget
                  key={turnstileNonce}
                  onVerify={(token) => setTurnstileToken(token)}
                  onExpire={() => setTurnstileToken('')}
                />
              )}

              {error && <FormError message={error} />}

              <motion.button
                type="submit"
                disabled={isSubmitting || !passwordReady}
                className={PRIMARY_BTN}
                whileTap={isSubmitting ? undefined : { scale: 0.98 }}
              >
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                    {isActivate ? 'Activating…' : 'Signing in…'}
                  </span>
                ) : (
                  <>
                    {isActivate ? 'Activate account' : 'Sign in'}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </motion.button>
            </motion.form>
          )}

          <p className="mt-5 text-center text-xs text-zinc-500">Beta Test</p>
        </div>

        <p className="mt-4 px-2 text-center text-[13px] leading-relaxed text-zinc-500 text-balance">
          By continuing, you acknowledge that you understand and agree to the{' '}
          <a
            href="https://cryptelix.app/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-yellow-500/90 underline decoration-yellow-500/40 underline-offset-2 hover:text-yellow-400"
          >
            Privacy Policy
          </a>
          {' '}and{' '}
          <a
            href="https://cryptelix.app/terms-and-conditions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-yellow-500/90 underline decoration-yellow-500/40 underline-offset-2 hover:text-yellow-400"
          >
            Terms &amp; Conditions
          </a>
          .
        </p>
      </motion.div>
    </div>
  );
}
