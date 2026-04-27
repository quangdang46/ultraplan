import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStreamContext } from '../../hooks/useStreamContext';
import { ConversationToolItem } from './ConversationToolItem';
import { PermissionPanel } from './PermissionPanel';
import { ThinkingIndicator } from './ThinkingIndicator';

export function Conversation() {
  const {
    messages,
    isStreaming,
    error: streamError,
    pendingPermissions,
    respondToPermission,
  } = useStreamContext();

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <PermissionPanel
          requests={pendingPermissions}
          onRespond={respondToPermission}
        />

        {messages.length === 0 && (
          <div className="text-charcoal-warm text-center p-8">
            Send a message to start a conversation
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`space-y-2 w-full ${msg.role === 'user' ? 'max-w-[85%]' : 'max-w-[92%]'}`}>
              {msg.role === 'assistant' &&
                msg.toolCalls.map((tool) => (
                  <ConversationToolItem key={tool.id} item={tool} />
                ))}

              {msg.role === 'user' && msg.quote?.text && (
                <div className="rounded-lg border border-[#f5d4c4] bg-[#fff8f5] px-3 py-2 text-charcoal-warm">
                  <div className="mb-1 text-[10.5px] font-semibold tracking-wide text-terracotta">
                    ↩ Replying to quote
                  </div>
                  <div className="text-xs leading-[1.5] italic [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:overflow-x-hidden [&_code]:whitespace-pre-wrap [&_code]:break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.quote.text}</ReactMarkdown>
                  </div>
                </div>
              )}

              {msg.content ? (
                <div
                  className={`rounded-lg p-3 prose prose-sm max-w-none [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:overflow-x-hidden [&_code]:whitespace-pre-wrap [&_code]:break-words ${
                    msg.role === 'user'
                      ? 'bg-terracotta text-white prose-invert'
                      : 'bg-warm-sand text-dark-surface prose-stone'
                  }`}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              ) : isStreaming && msg.role === 'assistant' ? (
                <ThinkingIndicator />
              ) : null}
            </div>
          </div>
        ))}

        {streamError && (
          <div className="text-red-500 text-center p-2 bg-red-50 rounded w-full">
            Error: {streamError}
          </div>
        )}
      </div>
    </div>
  );
}
