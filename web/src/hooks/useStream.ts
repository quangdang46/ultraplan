import { useState, useCallback, useRef } from 'react';
import { getApiClient } from '../api/client';
import type { ServerEvent } from '../api/types';
import type { ToolItem } from '../components/claude/conversation.types';

export interface StreamState {
  isStreaming: boolean;
  messages: Message[];
  activeTools: Map<string, ToolItem>;
  error: string | null;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolItem[];
}

export function useStream() {
  const [state, setState] = useState<StreamState>({
    isStreaming: false,
    messages: [],
    activeTools: new Map(),
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const client = getApiClient();

  const ensureAuthenticated = useCallback(async (): Promise<void> => {
    // If we have a key, validate it - server-side map might have been reset
    if (client.hasApiKey()) {
      try {
        await client.authValidate();
        return;
      } catch {
        client.clearApiKey();
      }
    }
    // No valid key - do full auth flow
    const { tempToken } = await client.authInit();
    await client.authVerify(tempToken);
  }, [client]);

  const sendMessage = useCallback(
    async (content: string): Promise<void> => {
      // Cancel any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      // Ensure authenticated before sending
      await ensureAuthenticated();

      // Add user message
      const userMessageId = `user_${Date.now()}`;
      setState((s) => ({
        ...s,
        isStreaming: true,
        error: null,
        messages: [
          ...s.messages,
          { id: userMessageId, role: 'user', content, toolCalls: [] },
        ],
      }));

      // Add placeholder assistant message
      const assistantMessageId = `assistant_${Date.now()}`;
      setState((s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            toolCalls: [],
          },
        ],
      }));

      try {
        let currentMessageContent = '';

        for await (const event of client.streamChat(content)) {
          console.log('SSE event:', event.type, event.data);
          switch (event.type) {
            case 'message_start': {
              // Message started - could track ID
              break;
            }

            case 'content_delta': {
              // Text content streaming
              const textDelta = event.data.delta?.text || '';
              currentMessageContent += textDelta;

              setState((s) => {
                const messages = [...s.messages];
                const lastMsg = messages[messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  messages[messages.length - 1] = {
                    ...lastMsg,
                    content: currentMessageContent,
                  };
                }
                return { ...s, messages };
              });
              break;
            }

            case 'tool_use': {
              // Tool call started
              const toolData = event.data;
              const toolItem: ToolItem = {
                id: toolData.id,
                title: `${toolData.name} - ${JSON.stringify(toolData.input)?.slice(0, 50)}...`,
                kind: toolData.name,
                status: 'running',
                outputLines: [],
              };

              setState((s) => {
                const newTools = new Map(s.activeTools);
                newTools.set(toolData.id, toolItem);

                const messages = [...s.messages];
                const lastMsg = messages[messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  messages[messages.length - 1] = {
                    ...lastMsg,
                    toolCalls: [...lastMsg.toolCalls, toolItem],
                  };
                }

                return { ...s, activeTools: newTools, messages };
              });
              break;
            }

            case 'tool_result': {
              // Tool completed
              const resultData = event.data;

              setState((s) => {
                const newTools = new Map(s.activeTools);
                const existingTool = newTools.get(resultData.toolCallId);

                if (existingTool) {
                  newTools.set(resultData.toolCallId, {
                    ...existingTool,
                    status: resultData.exitCode === 0 ? 'done' : 'failed',
                    output: resultData.result,
                    exitCode: resultData.exitCode,
                    timeDisplay: resultData.timeDisplay,
                    elapsedMs: existingTool.elapsedMs,
                    outputLines: resultData.result?.split('\n').slice(-5) || [],
                  });
                }

                const messages = [...s.messages];
                const lastMsg = messages[messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  messages[messages.length - 1] = {
                    ...lastMsg,
                    toolCalls: lastMsg.toolCalls.map((tc) =>
                      tc.id === resultData.toolCallId
                        ? {
                            ...tc,
                            status: resultData.exitCode === 0 ? 'done' : 'failed',
                            output: resultData.result,
                          }
                        : tc
                    ),
                  };
                }

                return { ...s, activeTools: newTools, messages };
              });
              break;
            }

            case 'error': {
              setState((s) => ({
                ...s,
                error: event.data.message,
              }));
              break;
            }
          }
        }

        // Stream ended
        setState((s) => ({ ...s, isStreaming: false }));
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // Aborted - not an error
          setState((s) => ({ ...s, isStreaming: false }));
        } else {
          const error = err instanceof Error ? err.message : 'Stream failed';
          setState((s) => ({
            ...s,
            isStreaming: false,
            error,
          }));
        }
      }
    },
    [client, ensureAuthenticated]
  );

  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setState((s) => ({ ...s, isStreaming: false }));
    }
  }, []);

  const clearMessages = useCallback(() => {
    setState((s) => ({ ...s, messages: [], activeTools: new Map() }));
  }, []);

  return {
    ...state,
    sendMessage,
    cancelStream,
    clearMessages,
  };
}
