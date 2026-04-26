import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStreamContext } from '../../hooks/useStreamContext';
import { ConversationToolItem } from './ConversationToolItem';
import { ThinkingIndicator } from './ThinkingIndicator';

export function Conversation() {
  const { messages, isStreaming, error: streamError } = useStreamContext();

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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

              {msg.content ? (
                <div
                  className={`rounded-lg p-3 prose prose-sm max-w-none ${
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