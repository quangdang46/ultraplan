import { useState, useCallback, useRef } from 'react';
import { getApiClient } from '../api/client';
import type { ServerEvent } from '../api/types';
import type { StreamState, Message, ToolItem } from '../features/chat/types';
import { toToolResultText } from '../features/chat/streamParser';
import { ensureApiAuthenticated } from '../features/chat/streamTransport';

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
    await ensureApiAuthenticated(client);
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

      // Add placeholder assistant message - track its index so we can update it
      setState((s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: `assistant_placeholder_${Date.now()}`,
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
              // Message started - update placeholder content tracking
              break;
            }

            case 'content_delta': {
              // Text content streaming
              const textDelta = event.data.delta?.text || '';
              currentMessageContent += textDelta;

              setState((s) => {
                const messages = [...s.messages];
                // Always update the LAST message (our placeholder)
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
              console.log('tool_result event:', event.data);
              const resultData = event.data as Record<string, unknown>;
              const toolCallId = String(
                resultData.toolCallId ?? resultData.tool_use_id ?? resultData.id ?? ''
              );
              const resultText = toToolResultText(
                resultData.result ?? resultData.content
              );
              const exitCode =
                typeof resultData.exitCode === 'number'
                  ? resultData.exitCode
                  : resultData.is_error
                    ? 1
                    : 0;
              const timeDisplay =
                typeof resultData.timeDisplay === 'string'
                  ? resultData.timeDisplay
                  : '';

              setState((s) => {
                const newTools = new Map(s.activeTools);
                const existingTool = newTools.get(toolCallId);

                if (existingTool) {
                  newTools.set(toolCallId, {
                    ...existingTool,
                    status: exitCode === 0 ? 'done' : 'failed',
                    output: resultText,
                    exitCode,
                    timeDisplay,
                    elapsedMs: existingTool.elapsedMs,
                    outputLines: resultText ? resultText.split('\n').slice(-5) : [],
                  });
                }

                const messages = [...s.messages];
                const lastMsg = messages[messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  messages[messages.length - 1] = {
                    ...lastMsg,
                    toolCalls: lastMsg.toolCalls.map((tc) =>
                      tc.id === toolCallId
                        ? {
                            ...tc,
                            status: exitCode === 0 ? 'done' : 'failed',
                            output: resultText,
                            exitCode,
                            timeDisplay,
                            outputLines: resultText ? resultText.split('\n').slice(-5) : [],
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

  const executeSlashCommand = useCallback(
    async (command: string): Promise<void> => {
      const normalized = command.trim();
      if (!normalized) return;
      // Keep slash command submission on the same stream path as CLI chat flow.
      await sendMessage(normalized);
    },
    [sendMessage]
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
    executeSlashCommand,
    cancelStream,
    clearMessages,
  };
}
