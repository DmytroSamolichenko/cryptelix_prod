import * as React from 'react';
import { X, LogOut, Mail, Wallet, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { displayNameFromEmail, formatMemberSince } from '../lib/authStorage';
const userAvatar = '/default-user-avatar.svg';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  email: string | null;
  signedInAt: string;
  onLogout: () => void;
  totalConnections: number;
  connections: {
    broker: boolean;
  };
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60';

// Offset + blur depth, so a connected block reads as lifted rather than haloed.
const CONNECTED_BLOCK =
  'border-green-500/30 bg-green-500/[0.05] shadow-[0_6px_20px_-8px_rgba(34,197,94,0.45)]';
const IDLE_BLOCK = 'border-zinc-800 bg-zinc-950/60';

function StatusPill({ tone, children }: { tone: 'green' | 'grey'; children: React.ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${
        tone === 'green'
          ? 'border-green-500/30 bg-green-500/10 text-green-400'
          : 'border-zinc-800 text-zinc-500'
      }`}
    >
      {children}
    </span>
  );
}

function ServiceRow({
  icon,
  label,
  detail,
  tone,
  status,
  disabledTitle,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  tone: 'green' | 'grey';
  status: string;
  disabledTitle?: string;
}) {
  return (
    <div
      title={disabledTitle}
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        tone === 'green' ? CONNECTED_BLOCK : `${IDLE_BLOCK} hover:border-zinc-700`
      } ${disabledTitle ? 'cursor-not-allowed' : ''}`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
          tone === 'green'
            ? 'border-green-500/30 bg-green-500/10 text-green-400'
            : 'border-zinc-800 bg-zinc-900 text-zinc-500'
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-5 text-[#e8e4d9]">{label}</div>
        <div className="text-xs leading-4 text-zinc-500 sm:truncate">{detail}</div>
      </div>
      <StatusPill tone={tone}>{status}</StatusPill>
    </div>
  );
}

export function UserProfileModal({
  isOpen,
  onClose,
  email,
  signedInAt,
  onLogout,
  totalConnections,
  connections,
}: UserProfileModalProps) {
  const displayName = displayNameFromEmail(email);
  const isWalletAccount = !email;

  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleLogout = () => {
    onClose();
    onLogout();
  };

  const connectionLabel = `${totalConnections} ${totalConnections === 1 ? 'connection' : 'connections'}`;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — above AI chat (z-50) so chat blurs/dims too */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm"
          />

          {/* Positioning wrapper keeps the centering out of the animated element. */}
          <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Profile"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto relative w-[480px] max-w-full rounded-2xl border border-yellow-900/40 bg-[#0c0c0c] p-5 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.8)] selection:bg-yellow-400/25 selection:text-[#f5f1e6]"
            >
              <button
                type="button"
                onClick={onClose}
                aria-label="Close profile"
                className={`group absolute right-3 top-3 rounded-lg p-1.5 transition-colors hover:bg-white/10 ${FOCUS_RING}`}
              >
                <X className="h-4 w-4 text-zinc-500 transition-colors group-hover:text-white" />
              </button>

              {/* Identity */}
              <div className="flex items-center gap-4 pr-8">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                  <img src={userAvatar} alt="User avatar" className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-xl font-semibold leading-7 text-[#f5f1e6]">
                    {displayName}
                  </h2>
                  <div className="flex items-center gap-1.5 text-sm text-zinc-400">
                    {isWalletAccount ? (
                      <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    ) : (
                      <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    <span className="truncate">{email || 'Wallet account'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden />
                      Active
                    </span>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums ${
                        totalConnections > 0
                          ? 'border-green-500/30 text-green-400'
                          : 'border-zinc-800 text-zinc-500'
                      }`}
                    >
                      {connectionLabel}
                    </span>
                    <span className="text-xs text-zinc-500">
                      Member since {formatMemberSince(signedInAt)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Services */}
              <div className="mt-4 space-y-2">
                {isWalletAccount ? (
                  <ServiceRow
                    icon={<Wallet className="h-4 w-4" aria-hidden />}
                    label="Crypto Wallet"
                    detail="Signed in with your wallet"
                    tone="green"
                    status="Connected"
                  />
                ) : (
                  <ServiceRow
                    icon={<Wallet className="h-4 w-4" aria-hidden />}
                    label="Crypto Wallet"
                    detail="Your account was registered with the email"
                    tone="grey"
                    status="Email account"
                    disabledTitle="Your account was registered with the email"
                  />
                )}
                <ServiceRow
                  icon={<TrendingUp className="h-4 w-4" aria-hidden />}
                  label="Trading Broker"
                  detail={connections.broker ? 'Exchange API linked' : 'No exchange linked yet'}
                  tone={connections.broker ? 'green' : 'grey'}
                  status={connections.broker ? 'Connected' : 'Not connected'}
                />
              </div>

              {/* Footer: action and legal share one line */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-zinc-900 pt-4">
                <button
                  type="button"
                  onClick={handleLogout}
                  className={`inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 ${FOCUS_RING}`}
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden />
                  Log out
                </button>
                <nav className="flex items-center gap-3 text-xs text-zinc-500" aria-label="Legal">
                  <a
                    href="/privacy-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`rounded transition-colors hover:text-yellow-400/80 ${FOCUS_RING}`}
                  >
                    Privacy Policy
                  </a>
                  <span className="text-zinc-700" aria-hidden="true">
                    ·
                  </span>
                  <a
                    href="/data-security-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`rounded transition-colors hover:text-yellow-400/80 ${FOCUS_RING}`}
                  >
                    Data Security Policy
                  </a>
                </nav>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
