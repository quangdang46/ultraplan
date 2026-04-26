import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStreamContext } from '../../hooks/useStreamContext';
import { ConversationToolItem } from './ConversationToolItem';

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
            <div key={msg.id} className="bg-warm-sand text-dark-surface rounded-lg p-3 w-full prose prose-sm prose-stone max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            </div>
        ))}

        {/* Tool calls as separate bubbles below messages */}
        {messages.flatMap((msg) =>
          msg.toolCalls.map((tool) => (
            <ConversationToolItem key={tool.id} item={tool} />
          ))
        )}

        {isStreaming && (
          <div className="bg-warm-sand rounded-lg p-3">
            <div className="flex items-center gap-2 text-charcoal-warm">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm">Thinking...</span>
            </div>
          </div>
        )}

        {streamError && (
          <div className="text-red-500 text-center p-2 bg-red-50 rounded w-full">
            Error: {streamError}
          </div>
        )}
      </div>
    </div>
  );
}