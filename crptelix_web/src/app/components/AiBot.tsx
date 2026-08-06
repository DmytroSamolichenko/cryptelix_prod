import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Sparkles,
  Clock,
  MessageSquare,
  Plus,
  Loader2,
  LayoutGrid,
  GitCompare,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ChatMessageMarkdown } from './ChatMessageMarkdown';
import { apiFetch } from '../lib/apiClient';
import { cn } from './ui/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatSessionRow {
  id: string;
  title: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Hello! I am the Cryptelix AI assistant. I can help with dashboards, metrics, and trading. What would you like to know?',
  timestamp: new Date(),
};

function parseApiMessage(raw: {
  id: string;
  role: string;
  content: string;
  created_at: string | null;
}): Message {
  return {
    id: raw.id,
    role: raw.role === 'user' ? 'user' : 'assistant',
    content: raw.content,
    timestamp: raw.created_at ? new Date(raw.created_at) : new Date(),
  };
}

function AssistantAvatar({ spinning = false }: { spinning?: boolean }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-400 shadow-[0_0_16px_rgba(250,204,21,0.45)]">
      {spinning ? (
        <Loader2 className="h-4 w-4 animate-spin text-black" />
      ) : (
        <Sparkles className="h-4 w-4 text-black" strokeWidth={2.25} />
      )}
    </div>
  );
}

export function AiBot() {
  const [sessions, setSessions] = useState<ChatSessionRow[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await apiFetch('/api/v1/chat/sessions');
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as ChatSessionRow[];
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    setLoadingMessages(true);
    setSendError(null);
    try {
      const res = await apiFetch(
        `/api/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages`
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as Array<{
        id: string;
        role: string;
        content: string;
        created_at: string | null;
      }>;
      const mapped = (Array.isArray(data) ? data : []).map(parseApiMessage);
      setMessages(mapped.length > 0 ? mapped : [WELCOME]);
    } catch {
      setMessages([WELCOME]);
      setSendError('Failed to load messages.');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    void loadSessionMessages(sessionId);
  };

  const handleNewChat = () => {
    setActiveSessionId(null);
    setMessages([{ ...WELCOME, timestamp: new Date() }]);
    setSendError(null);
    setSending(false);
    setIsActionsOpen(false);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setIsActionsOpen(false);
    setSendError(null);
    setSending(true);

    const optimisticUser: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 90_000);

    try {
      const res = await apiFetch('/api/v1/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSessionId,
          message: text,
        }),
        signal: controller.signal,
      });
      const rawText = await res.text();
      if (!res.ok) {
        let detail = rawText;
        try {
          const j = JSON.parse(rawText) as { detail?: string };
          if (typeof j.detail === 'string') detail = j.detail;
        } catch {
          /* keep raw */
        }
        throw new Error(detail || `Error ${res.status}`);
      }
      const data = JSON.parse(rawText) as {
        session_id: string;
        user_message: {
          id: string;
          role: string;
          content: string;
          created_at: string | null;
        };
        assistant_message: {
          id: string;
          role: string;
          content: string;
          created_at: string | null;
        };
      };

      setActiveSessionId(data.session_id);
      const userMsg = parseApiMessage(data.user_message);
      const asstMsg = parseApiMessage(data.assistant_message);
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== optimisticUser.id);
        return [...withoutTemp, userMsg, asstMsg];
      });
      void fetchSessions();
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      const msg = e instanceof Error ? e.message : 'Failed to send message';
      if (aborted) {
        setSendError('Request timed out. Check that the backend is running, then try again.');
      } else if (msg === 'Failed to fetch') {
        setSendError(
          'Cannot reach API (Failed to fetch). Is the backend running on :8000? Hard-refresh the page.'
        );
      } else {
        setSendError(msg);
      }
    } finally {
      window.clearTimeout(timeoutId);
      setSending(false);
    }
  };

  const quickActions = [
    {
      label: 'My portfolio',
      prompt: 'Analyze my portfolio and PnL',
      icon: Sparkles,
    },
    {
      label: 'Dashboard',
      prompt: 'Suggest a dashboard layout idea',
      icon: LayoutGrid,
    },
    {
      label: 'Compare',
      prompt: 'Compare my assets',
      icon: GitCompare,
    },
  ] as const;

  return (
    <div className="flex h-full flex-col border-l border-zinc-800/80 bg-[#0c0c0c]">
      {/* Chat History */}
      <div className="shrink-0 border-b border-zinc-800/60 px-3 pb-3 pt-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-yellow-400/80 bg-transparent shadow-[0_0_10px_rgba(250,204,21,0.18)]">
              <Clock className="h-3.5 w-3.5 text-yellow-400" strokeWidth={2.25} />
            </div>
            <div className="text-sm font-medium tracking-wide text-zinc-200">History</div>
          </div>
          <motion.button
            type="button"
            onClick={handleNewChat}
            whileHover={{ scale: 1.04, boxShadow: '0 0 22px rgba(250,204,21,0.55)' }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 22 }}
            className="rounded-full bg-yellow-400 px-3.5 py-1.5 text-xs font-semibold text-black shadow-[0_0_16px_rgba(250,204,21,0.4)]"
          >
            New chat
          </motion.button>
        </div>

        <div className="mb-3 h-px bg-zinc-800/80" />

        <div className="max-h-40 space-y-2 overflow-y-auto pr-0.5">
          {loadingSessions ? (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-2 text-xs text-zinc-600">No saved sessions yet</p>
          ) : (
            sessions.map((s) => {
              const active = activeSessionId === s.id;
              return (
                <motion.button
                  key={s.id}
                  type="button"
                  whileHover={{
                    backgroundColor: active
                      ? 'rgba(39,39,42,1)'
                      : 'rgba(63,63,70,0.75)',
                  }}
                  whileTap={{ scale: 0.985 }}
                  transition={{ type: 'spring', stiffness: 480, damping: 28 }}
                  className={cn(
                    'group box-border flex w-full items-center gap-2.5 rounded-full border px-4 py-2.5 text-left',
                    active
                      ? 'border-yellow-400/85 bg-zinc-800/90 shadow-[0_0_14px_rgba(250,204,21,0.12)]'
                      : 'border-transparent bg-zinc-800/55'
                  )}
                  onClick={() => handleSelectSession(s.id)}
                >
                  <MessageSquare
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 transition-colors duration-200',
                      active
                        ? 'text-yellow-400'
                        : 'text-zinc-500 group-hover:text-zinc-300'
                    )}
                  />
                  <div
                    className={cn(
                      'min-w-0 flex-1 truncate text-xs font-medium transition-colors duration-200',
                      active
                        ? 'text-white'
                        : 'text-zinc-400 group-hover:text-zinc-200'
                    )}
                  >
                    {s.title?.trim() || 'Untitled chat'}
                  </div>
                </motion.button>
              );
            })
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4" ref={scrollRef}>
        <div className="space-y-4">
          {loadingMessages ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading messages…
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'flex gap-2.5',
                    message.role === 'user' ? 'justify-end' : 'items-end'
                  )}
                >
                  {message.role === 'assistant' && <AssistantAvatar />}
                  <div
                    className={cn(
                      'max-w-[82%] rounded-2xl px-4 py-3',
                      message.role === 'user'
                        ? 'bg-yellow-400 text-black'
                        : 'bg-zinc-900 text-zinc-100'
                    )}
                  >
                    <ChatMessageMarkdown
                      content={message.content}
                      variant={message.role === 'user' ? 'user' : 'assistant'}
                    />
                    <div
                      className={cn(
                        'mt-2 text-[11px]',
                        message.role === 'user' ? 'text-black/55' : 'text-zinc-500'
                      )}
                    >
                      {message.timestamp.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex items-end gap-2.5">
                  <AssistantAvatar spinning />
                  <div className="rounded-2xl bg-zinc-900 px-4 py-3">
                    <p className="text-sm text-zinc-400">Assistant is typing…</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {sendError && (
        <div className="border-t border-red-900/50 bg-red-950/40 px-4 py-2 text-xs text-red-400">
          {sendError}
        </div>
      )}

      {/* Input */}
      <div className="relative shrink-0 px-3 pb-3 pt-1">
        <AnimatePresence>
          {isActionsOpen && (
            <motion.div
              key="quick-actions"
              initial={{ opacity: 0, y: 10, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              className="absolute bottom-full left-3 z-50 mb-2 w-56 origin-bottom-left overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-2xl shadow-black/50"
            >
              {quickActions.map((action, index) => (
                <motion.button
                  key={action.label}
                  type="button"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.04 * index, duration: 0.18 }}
                  onClick={() => {
                    setInput(action.prompt);
                    setIsActionsOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-3 text-left text-sm font-medium text-white transition-colors hover:bg-zinc-800',
                    index < quickActions.length - 1 && 'border-b border-zinc-800'
                  )}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-yellow-500/50 bg-transparent">
                    <action.icon className="h-4 w-4 text-yellow-400" />
                  </div>
                  <span>{action.label}</span>
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-900/90 px-2 py-1.5 shadow-inner shadow-black/20">
          <motion.button
            type="button"
            onClick={() => setIsActionsOpen((open) => !open)}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.9 }}
            animate={{
              rotate: isActionsOpen ? 45 : 0,
              backgroundColor: isActionsOpen ? 'rgba(250, 204, 21, 0.14)' : 'rgb(39, 39, 42)',
              borderColor: isActionsOpen ? 'rgb(250, 204, 21)' : 'rgba(63, 63, 70, 0.8)',
              color: isActionsOpen ? 'rgb(250, 204, 21)' : 'rgb(212, 212, 216)',
            }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border"
            aria-label={isActionsOpen ? 'Close quick actions' : 'Open quick actions'}
            aria-expanded={isActionsOpen}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </motion.button>

          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (sendError) setSendError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask about metrics or your portfolio…"
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
          />

          <motion.button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !input.trim()}
            whileTap={sending || !input.trim() ? undefined : { scale: 0.9 }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send message"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </motion.button>
        </div>
      </div>
    </div>
  );
}
