import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from './ui/utils';

type ChatMessageVariant = 'assistant' | 'user';

interface ChatMessageMarkdownProps {
  content: string;
  variant: ChatMessageVariant;
}

function buildComponents(variant: ChatMessageVariant): Components {
  const isUser = variant === 'user';

  return {
    p: ({ children }) => (
      <p className={cn('text-sm leading-relaxed mb-2 last:mb-0', isUser && 'text-black')}>
        {children}
      </p>
    ),
    strong: ({ children }) => (
      <strong className={cn('font-semibold', isUser ? 'text-black' : 'text-white')}>
        {children}
      </strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    h1: ({ children }) => (
      <h1 className={cn('text-base font-bold mb-2 mt-3 first:mt-0', isUser ? 'text-black' : 'text-white')}>
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className={cn('text-sm font-bold mb-2 mt-3 first:mt-0', isUser ? 'text-black' : 'text-white')}>
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className={cn('text-sm font-semibold mb-1.5 mt-2 first:mt-0', isUser ? 'text-black' : 'text-white')}>
        {children}
      </h3>
    ),
    ul: ({ children }) => (
      <ul className={cn('text-sm list-disc pl-5 mb-2 space-y-1', isUser ? 'text-black/90' : 'text-gray-200')}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className={cn('text-sm list-decimal pl-5 mb-2 space-y-1', isUser ? 'text-black/90' : 'text-gray-200')}>
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'underline underline-offset-2',
          isUser ? 'text-black/80 hover:text-black' : 'text-yellow-400 hover:text-yellow-300'
        )}
      >
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote
        className={cn(
          'border-l-2 pl-3 my-2 text-sm italic',
          isUser ? 'border-black/30 text-black/80' : 'border-yellow-500/40 text-gray-300'
        )}
      >
        {children}
      </blockquote>
    ),
    code: ({ className, children }) => {
      const isBlock = Boolean(className);
      if (isBlock) {
        return <code className={className}>{children}</code>;
      }
      return (
        <code
          className={cn(
            'rounded px-1.5 py-0.5 text-[0.85em] font-mono',
            isUser ? 'bg-black/15 text-black' : 'bg-zinc-800 text-yellow-200'
          )}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre
        className={cn(
          'mb-2 overflow-x-auto rounded-lg p-3 text-xs font-mono',
          isUser ? 'bg-black/15 text-black' : 'bg-zinc-800/90 text-gray-100 border border-zinc-700/50'
        )}
      >
        {children}
      </pre>
    ),
    hr: () => (
      <hr className={cn('my-3 border-0 h-px', isUser ? 'bg-black/20' : 'bg-yellow-500/20')} />
    ),
    table: ({ children }) => (
      <div className="my-2 w-full overflow-x-auto rounded-lg border border-zinc-700/50">
        <table className="w-full min-w-[240px] border-collapse text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-zinc-800/80">{children}</thead>,
    th: ({ children }) => (
      <th className="border border-zinc-700/50 px-2 py-1.5 text-left font-semibold text-white">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-zinc-700/50 px-2 py-1.5 text-gray-200">{children}</td>
    ),
  };
}

export function ChatMessageMarkdown({ content, variant }: ChatMessageMarkdownProps) {
  if (!content.trim()) {
    return null;
  }

  return (
    <div className="chat-markdown break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildComponents(variant)}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
