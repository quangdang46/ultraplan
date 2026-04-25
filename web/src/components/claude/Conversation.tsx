import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useStream } from '../../hooks/useStream';
import { ConversationToolItem } from './ConversationToolItem';

export function Conversation() {
  const [input, setInput] = useState('');
  const { isAuthenticated, isLoading: authLoading, error: authError, initAuth, verifyAuth } = useAuth();
  const { messages, isStreaming, error: streamError, sendMessage, cancelStream, clearMessages } = useStream();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    if (!isAuthenticated) {
      try {
        const { tempToken } = await initAuth();
        await verifyAuth(tempToken);
      } catch {
        return;
      }
    }

    await sendMessage(input);
    setInput('');
  };

  const handleCancel = () => {
    cancelStream();
    clearMessages();
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-charcoal-warm">Authenticating...</div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4">
        <div className="text-red-500">Auth error: {authError}</div>
        <button
          onClick={() => initAuth()}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Retry
        </button>
      </div>
    );
  }

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

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-border-warm">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={isStreaming}
            className="flex-1 px-4 py-2 border border-border-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
            >
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
