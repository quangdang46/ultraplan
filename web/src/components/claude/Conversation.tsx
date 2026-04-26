import { useState } from 'react';
import { useStreamContext } from '../../hooks/useStreamContext';
import { ConversationToolItem } from './ConversationToolItem';

export function Conversation() {
  const [quote, setQuote] = useState<string | null>(null);
  const { messages, isStreaming, error: streamError, cancelStream, clearMessages } = useStreamContext();

  const handleCancel = () => {
    cancelStream();
    clearMessages();
  };

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
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-3 ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-warm-sand text-dark-surface'
              }`}
            >
              <div className="text-sm">{msg.content}</div>

              {/* Tool calls */}
              {msg.toolCalls.length > 0 && (
                <div className="mt-2 space-y-2">
                  {msg.toolCalls.map((tool) => (
                    <ConversationToolItem key={tool.id} item={tool} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isStreaming && (
          <div className="flex justify-start">
            <div className="bg-warm-sand rounded-lg p-3">
              <div className="flex items-center gap-2 text-charcoal-warm">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-sm">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {streamError && (
          <div className="text-red-500 text-center p-2 bg-red-50 rounded">
            Error: {streamError}
          </div>
        )}
      </div>

      {/* Cancel button */}
      {isStreaming ? (
        <div className="p-4 border-t border-border-warm">
          <button
            onClick={handleCancel}
            className="w-full px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}