import { useState, useCallback, useEffect, useRef } from 'react';
import { getApiClient } from '../api/client';
import type { ReplyQuote, ServerEvent } from '../api/types';
import type {
  PendingPermission,
  StreamState,
  Message,
  ToolItem,
} from '../features/chat/types';
import { toToolResultText } from '../features/chat/streamParser';
import { ensureApiAuthenticated } from '../features/chat/streamTransport';

function extractBlockText(event: Extract<ServerEvent, { type: 'content_block' }>): string {
  const block = event.data.block;
  if (typeof block.text === 'string') {
    return block.text;
  }

  const rawContent = (block as { content?: unknown }).content;
  if (!Array.isArray(rawContent)) {
    return '';
  }

  return rawContent
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.content === 'string') return record.content;
      return '';
    })
    .filter(Boolean)
    .join('');
}

function formatToolTitle(name: string, input: Record<string, unknown>): string {
  const serialized = JSON.stringify(input);
  const preview = serialized.length > 50 ? `${serialized.slice(0, 50)}...` : serialized;
  return `${name} - ${preview}`;
}

function toPendingPermission(requestId: string, request: unknown): PendingPermission {
  const record = request && typeof request === 'object'
    ? request as Record<string, unknown>
    : {};

  const toolInput = record.input && typeof record.input === 'object'
    ? record.input as Record<string, unknown>
    : record.tool_input && typeof record.tool_input === 'object'
      ? record.tool_input as Record<string, unknown>
      : {};

  const toolName =
    typeof record.tool_name === 'string' && record.tool_name.trim()
      ? record.tool_name.trim()
      : typeof record.subtype === 'string' && record.subtype.trim()
        ? record.subtype.trim()
        : 'Permission request';

  const description =
    typeof record.description === 'string' && record.description.trim()
      ? record.description.trim()
      : typeof record.message === 'string' && record.message.trim()
        ? record.message.trim()
        : undefined;

  return {
    requestId,
    toolName,
    toolInput,
    description,
    subtype: typeof record.subtype === 'string' ? record.subtype : undefined,
  };
}

export function useStream() {
  const [state, setState] = useState<StreamState>({
    sessionId: null,
    isStreaming: false,
    messages: [],
    activeTools: new Map(),
    pendingPermissions: [],
    error: null,
    pendingRouteSync: false,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const attachControllerRef = useRef<AbortController | null>(null);
  const client = getApiClient();

  const ensureAuthenticated = useCallback(async (): Promise<void> => {
    await ensureApiAuthenticated(client);
  }, [client]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      attachControllerRef.current?.abort();
    };
  }, []);

  const applyEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'session_created': {
        setState((s) => ({
          ...s,
          sessionId: event.data.sessionId,
        }));
        break;
      }

      case 'message_start': {
        setState((s) => ({ ...s, isStreaming: true }));
        break;
      }

      case 'content_delta': {
        const textDelta = event.data.delta?.text || '';
        setState((s) => {
          const messages = [...s.messages];
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg || lastMsg.role !== 'assistant') {
            messages.push({
              id: `assistant_stream_${Date.now()}`,
              role: 'assistant',
              content: textDelta,
              toolCalls: [],
            });
          } else {
            messages[messages.length - 1] = {
              ...lastMsg,
              content: `${lastMsg.content}${textDelta}`,
            };
          }
          return { ...s, isStreaming: true, messages };
        });
        break;
      }

      case 'thinking_delta': {
        const thinkingDelta = event.data.delta?.thinking || '';
        if (!thinkingDelta) break;

        setState((s) => {
          const messages = [...s.messages];
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg || lastMsg.role !== 'assistant') {
            messages.push({
              id: `assistant_thinking_${Date.now()}`,
              role: 'assistant',
              content: '',
              thinking: thinkingDelta,
              toolCalls: [],
            });
          } else {
            messages[messages.length - 1] = {
              ...lastMsg,
              thinking: `${lastMsg.thinking ?? ''}${thinkingDelta}`,
            };
          }
          return { ...s, isStreaming: true, messages };
        });
        break;
      }

      case 'content_block': {
        const text = extractBlockText(event);
        if (!text) break;

        setState((s) => {
          const messages = [...s.messages];
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg || lastMsg.role !== 'assistant') {
            messages.push({
              id: `assistant_block_${Date.now()}`,
              role: 'assistant',
              content: text,
              toolCalls: [],
            });
          } else {
            messages[messages.length - 1] = {
              ...lastMsg,
              content: text,
            };
          }
          return { ...s, isStreaming: true, messages };
        });
        break;
      }

      case 'tool_start': {
        const toolData = event.data;
        const toolItem: ToolItem = {
          id: toolData.id,
          title: formatToolTitle(toolData.name, toolData.input),
          kind: toolData.name,
          status: 'running',
          outputLines: [],
        };

        setState((s) => {
          const newTools = new Map(s.activeTools);
          newTools.set(toolData.id, toolItem);

          const messages = [...s.messages];
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg || lastMsg.role !== 'assistant') {
            messages.push({
              id: `assistant_tool_${Date.now()}`,
              role: 'assistant',
              content: '',
              toolCalls: [toolItem],
            });
          } else {
            messages[messages.length - 1] = {
              ...lastMsg,
              toolCalls: [...lastMsg.toolCalls, toolItem],
            };
          }

          return { ...s, isStreaming: true, activeTools: newTools, messages };
        });
        break;
      }

      case 'tool_result': {
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

      case 'permission_request': {
        const request = toPendingPermission(
          event.data.request_id,
          event.data.request,
        );
        setState((s) => ({
          ...s,
          pendingPermissions: [
            ...s.pendingPermissions.filter(
              (item) => item.requestId !== request.requestId,
            ),
            request,
          ],
        }));
        break;
      }

      case 'control_response': {
        setState((s) => ({
          ...s,
          pendingPermissions: s.pendingPermissions.filter(
            (item) => item.requestId !== event.data.request_id,
          ),
        }));
        break;
      }

      case 'message_end': {
        setState((s) => ({ ...s, isStreaming: false }));
        break;
      }

      case 'error': {
        setState((s) => ({
          ...s,
          isStreaming: false,
          error: event.data.message,
        }));
        break;
      }
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string, quote?: ReplyQuote, sessionId?: string): Promise<boolean> => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (attachControllerRef.current) {
        attachControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      await ensureAuthenticated();

      const userMessageId = `user_${Date.now()}`;
      const userMessage: Message = {
        id: userMessageId,
        role: 'user',
        content,
        toolCalls: [],
        quote,
      };

      const assistantPlaceholder: Message = {
              id: `assistant_placeholder_${Date.now()}`,
              role: 'assistant',
              content: '',
              toolCalls: [],
      };

      setState((s) => ({
        ...s,
        sessionId: sessionId ?? s.sessionId,
        isStreaming: true,
        error: null,
        pendingRouteSync: !sessionId,
        messages: [...s.messages, userMessage, assistantPlaceholder],
      }));

      try {
        for await (const event of client.streamChat(
          { message: content, quote, sessionId },
          { signal: abortControllerRef.current.signal }
        )) {
          applyEvent(event);
        }

        setState((s) => ({ ...s, isStreaming: false }));
        return true;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setState((s) => ({ ...s, isStreaming: false }));
          return false;
        } else {
          const error = err instanceof Error ? err.message : 'Stream failed';
          setState((s) => ({
            ...s,
            isStreaming: false,
            error,
            pendingRouteSync:
              s.pendingRouteSync && s.sessionId === null ? false : s.pendingRouteSync,
          }));
          return false;
        }
      }
    },
    [applyEvent, client, ensureAuthenticated]
  );

  const attachSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!sessionId) return;

      if (attachControllerRef.current) {
        attachControllerRef.current.abort();
      }

      attachControllerRef.current = new AbortController();
      await ensureAuthenticated();

      try {
        for await (const event of client.streamSessionEvents(
          sessionId,
          { signal: attachControllerRef.current.signal },
        )) {
          applyEvent(event);
        }
      } catch (err) {
        if (err instanceof Error) {
          if (err.name === 'AbortError') return;
          if (err.message === 'SESSION_NOT_ACTIVE') return;
        }
      }
    },
    [applyEvent, client, ensureAuthenticated]
  );

  const respondToPermission = useCallback(
    async (
      requestId: string,
      approved: boolean,
      options?: {
        updatedInput?: Record<string, unknown>;
        message?: string;
      },
    ): Promise<void> => {
      if (!state.sessionId) {
        throw new Error('No active session available for permission response');
      }

      await ensureAuthenticated();
      await client.respondToPermission({
        sessionId: state.sessionId,
        request_id: requestId,
        approved,
        ...(options?.updatedInput ? { updatedInput: options.updatedInput } : {}),
        ...(options?.message ? { message: options.message } : {}),
      });

      setState((s) => ({
        ...s,
        pendingPermissions: s.pendingPermissions.filter(
          (item) => item.requestId !== requestId,
        ),
      }));
    },
    [client, ensureAuthenticated, state.sessionId]
  );

  const executeSlashCommand = useCallback(
    async (command: string, sessionId?: string): Promise<void> => {
      const normalized = command.trim();
      if (!normalized) return;
      await sendMessage(normalized, undefined, sessionId);
    },
    [sendMessage]
  );

  const cancelStream = useCallback(async () => {
    const activeSessionId = state.sessionId;
    if (!activeSessionId) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        setState((s) => ({ ...s, isStreaming: false, pendingPermissions: [] }));
      }
      return;
    }

    try {
      await ensureAuthenticated();
      await client.interruptSession(activeSessionId);
      setState((s) => ({ ...s, pendingPermissions: [] }));
    } catch (err) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const error = err instanceof Error ? err.message : 'Failed to interrupt session';
      setState((s) => ({
        ...s,
        isStreaming: false,
        pendingPermissions: [],
        error,
      }));
    }
  }, [client, ensureAuthenticated, state.sessionId]);

  const detachSession = useCallback(() => {
    attachControllerRef.current?.abort();
  }, []);

  const clearMessages = useCallback((sessionId: string | null = null) => {
    setState((s) => ({
      ...s,
      sessionId,
      isStreaming: false,
      pendingRouteSync: false,
      messages: [],
      activeTools: new Map(),
      pendingPermissions: [],
      error: null,
    }));
  }, []);

  const loadMessages = useCallback((messages: Message[], sessionId?: string | null) => {
    setState((s) => ({
      ...s,
      sessionId: sessionId ?? s.sessionId,
      pendingRouteSync: false,
      messages,
      activeTools: new Map(),
      pendingPermissions: [],
      error: null,
      isStreaming: false,
    }));
  }, []);

  const acknowledgeRouteSync = useCallback(() => {
    setState((s) => {
      if (!s.pendingRouteSync) return s;
      return {
        ...s,
        pendingRouteSync: false,
      };
    });
  }, []);

  return {
    ...state,
    sendMessage,
    respondToPermission,
    attachSession,
    detachSession,
    executeSlashCommand,
    cancelStream,
    clearMessages,
    loadMessages,
    acknowledgeRouteSync,
  };
}
