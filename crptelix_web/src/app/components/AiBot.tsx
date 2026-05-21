import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, Clock, MessageSquare, Plus, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ChatMessageMarkdown } from './ChatMessageMarkdown';

const API_BASE = 'http://localhost:8000';

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
    'Вітаю! Я глобальний AI-асистент Cryptelix. Допоможу з дашбордами, метриками та торгівлею. Що вас цікавить?',
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
      const res = await fetch(`${API_BASE}/api/v1/chat/sessions`);
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
      const res = await fetch(
        `${API_BASE}/api/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages`
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
      setSendError('Не вдалося завантажити повідомлення.');
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
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSendError(null);
    setSending(true);

    const optimisticUser: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const res = await fetch(`${API_BASE}/api/v1/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSessionId,
          message: text,
        }),
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
        throw new Error(detail || `Помилка ${res.status}`);
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
      setSendError(e instanceof Error ? e.message : 'Помилка відправки');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950 border-l border-yellow-500/20">
      {/* Chat History — chat_sessions */}
      <div className="p-3 border-b border-yellow-500/20 bg-zinc-950 shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            <div className="text-xs font-medium text-gray-400">Історія чатів</div>
          </div>
          <button
            type="button"
            onClick={handleNewChat}
            className="text-xs text-yellow-500 hover:text-yellow-400 px-2 py-1 rounded border border-yellow-500/30"
          >
            Новий чат
          </button>
        </div>
        <div className="space-y-1.5 max-h-36 overflow-y-auto">
          {loadingSessions ? (
            <div className="flex items-center gap-2 text-xs text-gray-500 px-2 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Завантаження…
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-xs text-gray-600 px-2">Ще немає збережених сесій</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`w-full text-left px-3 py-2 rounded-lg border transition-all group ${
                  activeSessionId === s.id
                    ? 'bg-zinc-800/80 border-yellow-500/40'
                    : 'bg-black/50 hover:bg-zinc-800/50 border-zinc-800/50 hover:border-yellow-500/30'
                }`}
                onClick={() => handleSelectSession(s.id)}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-gray-500 group-hover:text-yellow-400 shrink-0" />
                  <div className="text-xs text-gray-300 group-hover:text-white truncate min-w-0">
                    {s.title?.trim() || 'Чат без назви'}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4 bg-black"
        ref={scrollRef}
      >
        <div className="space-y-4">
          {loadingMessages ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" />
              Завантаження повідомлень…
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}
                >
                  {message.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-yellow-500/30">
                      <Sparkles className="w-4 h-4 text-black" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-yellow-400 text-black'
                        : 'bg-zinc-900 text-white border border-yellow-500/20'
                    }`}
                  >
                    <ChatMessageMarkdown
                      content={message.content}
                      variant={message.role === 'user' ? 'user' : 'assistant'}
                    />
                    <div
                      className={`text-xs mt-1 ${
                        message.role === 'user' ? 'text-black/60' : 'text-gray-500'
                      }`}
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
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-yellow-500/30">
                    <Loader2 className="w-4 h-4 text-black animate-spin" />
                  </div>
                  <div className="rounded-2xl px-4 py-3 bg-zinc-900 border border-yellow-500/20">
                    <p className="text-sm text-gray-400">Асистент друкує…</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {sendError && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-950/40 border-t border-red-900/50">
          {sendError}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-yellow-500/20 bg-black shrink-0">
        <div className="px-4 py-4">
          <div className="flex gap-2 items-end">
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsActionsOpen(!isActionsOpen)}
                className="w-9 h-9 flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 border border-yellow-500/30 hover:border-yellow-400 rounded-lg transition-all"
              >
                <Plus className="w-5 h-5 text-yellow-400" />
              </button>

              {isActionsOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden z-50">
                  <button
                    type="button"
                    onClick={() => {
                      setInput('Проаналізуй мій портфель і PnL');
                      setIsActionsOpen(false);
                    }}
                    className="w-full px-4 py-3 text-left text-sm text-white hover:bg-zinc-800 border-b border-zinc-800 transition-colors flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                      <Sparkles className="w-4 h-4 text-yellow-400" />
                    </div>
                    <span>Мій портфель</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInput('Створи ідею для дашборду');
                      setIsActionsOpen(false);
                    }}
                    className="w-full px-4 py-3 text-left text-sm text-white hover:bg-zinc-800 border-b border-zinc-800 transition-colors flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                      <MessageSquare className="w-4 h-4 text-yellow-400" />
                    </div>
                    <span>Дашборд</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInput('Порівняй активи');
                      setIsActionsOpen(false);
                    }}
                    className="w-full px-4 py-3 text-left text-sm text-white hover:bg-zinc-800 transition-colors flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                      <Clock className="w-4 h-4 text-yellow-400" />
                    </div>
                    <span>Порівняння</span>
                  </button>
                </div>
              )}
            </div>

            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Запитайте про метрики чи портфель…"
              disabled={sending}
              className="flex-1 bg-zinc-900 border-yellow-500/30 text-white placeholder:text-gray-500 focus:border-yellow-400"
            />
            <Button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || !input.trim()}
              size="icon"
              className="bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-500 hover:to-yellow-600 text-black shadow-lg shadow-yellow-500/50 disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
