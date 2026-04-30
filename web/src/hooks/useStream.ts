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
    alwaysAllow: Boolean(record.alwaysAllow ?? record.always_allow),
  };
}

const RETRY_DELAYS = [1000, 2000, 4000]; // 1s, 2s, 4s
const MAX_RETRIES = 3;

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    // Network errors (fetch failures)
    if (err.name === 'TypeError' || err.message === 'Failed to fetch' || err.message === 'NetworkError' || err.message === 'Network request failed') {
      return true;
    }
    // 5xx server errors are retried
    if (err.message.includes('500') || err.message.includes('502') || err.message.includes('503') || err.message.includes('504')) {
      return true;
    }
  }
  return false;
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
    connectionState: 'connected',
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const attachControllerRef = useRef<AbortController | null>(null);
  const toolInputBuffersRef = useRef<Map<string, string>>(new Map());
  const toolStartTimesRef = useRef<Map<string, number>>(new Map());
  const toolTimerRef = useRef<number | null>(null);
  const lastSeqNumRef = useRef<number>(0);
  const processedSeqNumsRef = useRef<Set<number>>(new Set());
  const client = getApiClient();

  const stopToolTimer = useCallback(() => {
    if (toolTimerRef.current !== null) {
      window.clearInterval(toolTimerRef.current);
      toolTimerRef.current = null;
    }
  }, []);

  const ensureToolTimer = useCallback(() => {
    if (toolTimerRef.current !== null) return;
    toolTimerRef.current = window.setInterval(() => {
      setState((s) => {
        if (toolStartTimesRef.current.size === 0) return s;

        const now = Date.now();
        const activeTools = new Map(s.activeTools);
        let changed = false;

        for (const [id, startedAt] of toolStartTimesRef.current.entries()) {
          const tool = activeTools.get(id);
          if (!tool || tool.status !== 'running') continue;
          const elapsedMs = now - startedAt;
          if (tool.elapsedMs === elapsedMs) continue;
          activeTools.set(id, { ...tool, elapsedMs });
          changed = true;
        }

        if (!changed) return s;

        const messages = s.messages.map((message) => ({
          ...message,
          toolCalls: message.toolCalls.map((tool) => {
            const updated = activeTools.get(tool.id);
            return updated ?? tool;
          }),
        }));

        return { ...s, activeTools, messages };
      });
    }, 250);
  }, []);

  const ensureAuthenticated = useCallback(async (): Promise<void> => {
    await ensureApiAuthenticated(client);
  }, [client]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      attachControllerRef.current?.abort();
      stopToolTimer();
    };
  }, [stopToolTimer]);

  const applyEvent = useCallback((event: ServerEvent) => {
    // Deduplicate by seqNum if available
    const seqNum = (event as unknown as { seqNum?: number }).seqNum;
    if (typeof seqNum === 'number' && seqNum > 0) {
      if (processedSeqNumsRef.current.has(seqNum)) {
        console.log('[useStream] event already processed, skipping:', event.type, seqNum);
        return;
      }
      processedSeqNumsRef.current.add(seqNum);
      // Keep set bounded
      if (processedSeqNumsRef.current.size > 10000) {
        const arr = Array.from(processedSeqNumsRef.current);
        processedSeqNumsRef.current = new Set(arr.slice(-5000));
      }
    }

    console.log("[useStream] applyEvent:", event.type, event.data);
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
        const rawDelta = (event.data as any)?.raw?.delta;
        const textDelta = event.data.delta?.text || rawDelta?.text || '';
        if (!textDelta) break;

        setState((s) => {
          const messages = [...s.messages];
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg || lastMsg.role !== 'assistant') {
            messages.push({
              id: `assistant_stream_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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
        const rawDelta = (event.data as any)?.raw?.delta;
        const thinkingDelta = event.data.delta?.thinking || rawDelta?.thinking || '';
        if (!thinkingDelta) break;

        setState((s) => {
          const messages = [...s.messages];
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg || lastMsg.role !== 'assistant') {
            messages.push({
              id: `assistant_thinking_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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
        const rawBlock = (event.data as any)?.raw?.block;
        const eventDataBlock = event.data.block || rawBlock;
        if (!eventDataBlock) break;

        // Check if this is an image block
        const blockType = eventDataBlock.type;
        const isImageBlock = blockType === 'image';
        const isDocumentBlock = blockType === 'document';

        // Extract image data if present
        let imageData: string | undefined;
        let imageMimeType: string | undefined;
        if (isImageBlock) {
          const rawContent = (eventDataBlock as { content?: unknown }).content;
          if (Array.isArray(rawContent)) {
            for (const item of rawContent) {
              if (item && typeof item === 'object' && (item as { type?: string }).type === 'image') {
                const imgItem = item as { source?: { data?: string; media_type?: string } };
                if (imgItem.source) {
                  imageData = imgItem.source.data;
                  imageMimeType = imgItem.source.media_type;
                }
              }
            }
          }
        }

        // Extract text content
        const text = extractBlockText({ type: 'content_block', data: { block: eventDataBlock } } as any);

        // Only process if we have something to show
        if (!text && !isImageBlock) break;

        setState((s) => {
          const messages = [...s.messages];
          const lastMsg = messages[messages.length - 1];

          // Build artifact if this is an image or document
          const artifact = isImageBlock || isDocumentBlock ? {
            id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            type: blockType,
            label: isImageBlock ? 'Image' : (eventDataBlock.title as string || 'Document'),
            detail: text || undefined,
            data: imageData,
            mimeType: imageMimeType,
          } : undefined;

          if (!lastMsg || lastMsg.role !== 'assistant') {
            messages.push({
              id: `assistant_block_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              role: 'assistant',
              content: text || '',
              toolCalls: [],
              artifacts: artifact ? [artifact] : undefined,
            });
          } else {
            const updated: typeof lastMsg = {
              ...lastMsg,
              content: text || lastMsg.content,
            };
            if (artifact) {
              updated.artifacts = [...(lastMsg.artifacts || []), artifact];
            }
            messages[messages.length - 1] = updated;
          }
          return { ...s, isStreaming: false, messages };
        });
        break;
      }

      case 'tool_start': {
        const rawData = (event.data as any)?.raw || {};
        const toolData = { ...rawData, ...event.data };

        // Deduplicate: skip if we already have this tool
        if (toolStartTimesRef.current.has(toolData.id)) {
          console.log('[useStream] tool_start duplicate detected, skipping:', toolData.id);
          break;
        }

        const startedAt = Date.now();
        toolStartTimesRef.current.set(toolData.id, startedAt);
        ensureToolTimer();
        const toolItem: ToolItem = {
          id: toolData.id,
          title: formatToolTitle(toolData.name, toolData.input),
          kind: toolData.name,
          status: 'running',
          outputLines: [],
          liveOutput: '',
          liveErrorOutput: '',
          elapsedMs: 0,
        };

        setState((s) => {
          const newTools = new Map(s.activeTools);
          newTools.set(toolData.id, toolItem);

          const messages = [...s.messages];
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg || lastMsg.role !== 'assistant') {
            messages.push({
              id: `assistant_tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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

      case 'tool_input_delta': {
        const toolId = event.data.id;
        const existingBuffer = toolInputBuffersRef.current.get(toolId) ?? '';
        const nextBuffer = `${existingBuffer}${event.data.partialJson}`;
        toolInputBuffersRef.current.set(toolId, nextBuffer);

        let parsedInput: Record<string, unknown> | null = null;
        try {
          const parsed = JSON.parse(nextBuffer) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            parsedInput = parsed as Record<string, unknown>;
          }
        } catch {
          parsedInput = null;
        }

        setState((s) => {
          const activeTools = new Map(s.activeTools);
          const existingTool = activeTools.get(toolId);
          if (!existingTool) return s;

          const title = parsedInput
            ? formatToolTitle(existingTool.kind, parsedInput)
            : `${existingTool.kind} - ${nextBuffer}`;
          const updatedTool = { ...existingTool, title };
          activeTools.set(toolId, updatedTool);

          const messages = s.messages.map((message) => ({
            ...message,
            toolCalls: message.toolCalls.map((tool) =>
              tool.id === toolId ? updatedTool : tool,
            ),
          }));

          return { ...s, activeTools, messages };
        });
        break;
      }

      case 'tool_output_delta': {
        const rawData = (event.data as any)?.raw || {};
        const deltaData = { ...rawData, ...(event.data as Record<string, unknown>) } as Record<string, unknown>;
        const toolCallId = String(deltaData.toolCallId ?? deltaData.tool_use_id ?? deltaData.id ?? '');
        if (!toolCallId) break;
        const chunk = typeof deltaData.chunk === 'string'
          ? deltaData.chunk
          : typeof deltaData.outputLine === 'string'
            ? deltaData.outputLine
            : '';
        if (!chunk) break;
        const stream = deltaData.stream === 'stderr' ? 'stderr' : 'stdout';

        setState((s) => {
          const activeTools = new Map(s.activeTools);
          const existingTool = activeTools.get(toolCallId);
          if (!existingTool) return s;

          const outputLines = [...(existingTool.outputLines ?? [])];
          const nextLines = chunk.split(/\r?\n/).filter(Boolean);
          outputLines.push(...nextLines);
          const trimmedLines = outputLines.slice(-200);
          const updatedTool: ToolItem = {
            ...existingTool,
            outputLines: trimmedLines,
            liveOutput: stream === 'stdout'
              ? `${existingTool.liveOutput ?? ''}${chunk}`
              : existingTool.liveOutput,
            liveErrorOutput: stream === 'stderr'
              ? `${existingTool.liveErrorOutput ?? ''}${chunk}`
              : existingTool.liveErrorOutput,
          };
          activeTools.set(toolCallId, updatedTool);

          const messages = s.messages.map((message) => ({
            ...message,
            toolCalls: message.toolCalls.map((tool) =>
              tool.id === toolCallId ? updatedTool : tool,
            ),
          }));

          return { ...s, activeTools, messages };
        });
        break;
      }

      case 'tool_result': {
        const rawData = (event.data as any)?.raw || {};
        const resultData = { ...rawData, ...(event.data as Record<string, unknown>) } as Record<string, unknown>;
        const toolCallId = String(
          resultData.toolCallId ?? resultData.tool_use_id ?? resultData.id ?? '',
        );
        if (!toolCallId) break;

        setState((s) => {
          const activeTools = new Map(s.activeTools);
          const existingTool = activeTools.get(toolCallId);
          if (!existingTool) return s;

          const rendered = toToolResultText(resultData);
          const mergedOutput = rendered || existingTool.liveOutput || existingTool.output || '';
          const updatedTool: ToolItem = {
            ...existingTool,
            status: resultData.isError ? 'failed' : 'done',
            output: mergedOutput,
            stderr: existingTool.liveErrorOutput || existingTool.stderr,
            exitCode: typeof resultData.exitCode === 'number' ? resultData.exitCode : existingTool.exitCode,
            timeDisplay: typeof resultData.timeDisplay === 'string' ? resultData.timeDisplay : existingTool.timeDisplay,
          };
          activeTools.delete(toolCallId);

          const messages = s.messages.map((message) => ({
            ...message,
            toolCalls: message.toolCalls.map((tool) =>
              tool.id === toolCallId ? updatedTool : tool,
            ),
          }));

          return { ...s, activeTools, messages };
        });
        break;
      }

      case 'permission_request': {
        const requestId = String((event.data as any)?.request_id || (event.data as any)?.requestId || Date.now());
        const permission = toPendingPermission(requestId, (event.data as any)?.request ?? event.data);
        setState((s) => {
          const existing = s.pendingPermissions.find((item) => item.requestId === permission.requestId);
          return {
            ...s,
            pendingPermissions: existing
              ? s.pendingPermissions.map((item) => item.requestId === permission.requestId ? permission : item)
              : [...s.pendingPermissions, permission],
          };
        });
        break;
      }

      case 'control_response': {
        const requestId = String((event.data as any)?.request_id || (event.data as any)?.requestId || '');
        setState((s) => ({
          ...s,
          pendingPermissions: requestId
            ? s.pendingPermissions.filter((item) => item.requestId !== requestId)
            : s.pendingPermissions,
        }));
        break;
      }

      case 'message_end': {
        setState((s) => ({
          ...s,
          isStreaming: false,
          messages: s.messages.map((message, index) =>
            index === s.messages.length - 1 && message.role === 'assistant'
              ? { ...message, streamingEndedAt: Date.now() }
              : message,
          ),
        }));
        break;
      }

      case 'error': {
        setState((s) => ({
          ...s,
          isStreaming: false,
          error: event.data.message,
          connectionState: 'failed',
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
      // Stop any attachSession stream to prevent dual streams
      if (attachControllerRef.current) {
        attachControllerRef.current.abort();
      }
      // Clear seqNum dedupe state so events from the aborted stream don't block legitimate events
      processedSeqNumsRef.current.clear();

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
        let retryCount = 0;
        let lastError: Error | null = null;

        while (true) {
          try {
            for await (const event of client.streamChat(
              { message: content, quote, sessionId },
              { signal: abortControllerRef.current.signal }
            )) {
              applyEvent(event);
            }
            break; // success
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));

            // Don't retry on AbortError
            if (lastError.name === 'AbortError') {
              throw lastError;
            }

            // Don't retry on 4xx client errors
            if (!isRetryableError(lastError)) {
              throw lastError;
            }

            if (retryCount < MAX_RETRIES) {
              retryCount++;
              setState((s) => ({ ...s, connectionState: 'reconnecting' }));
              const delay = RETRY_DELAYS[retryCount - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }

            throw lastError; // max retries exceeded
          }
        }

        setState((s) => ({ ...s, isStreaming: false, connectionState: 'connected' }));
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
            connectionState: 'failed',
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

      let retryCount = 0;
      const maxRetries = 5;

      const connect = async () => {
        let currentRetry = retryCount;
        try {
          const fromSeq = lastSeqNumRef.current;
          for await (const event of client.streamSessionEvents(
            sessionId,
            { signal: attachControllerRef.current!.signal },
            fromSeq,
          )) {
            currentRetry = 0;
            setState((s) => ({ ...s, connectionState: 'connected' }));
            const seqNum = (event as unknown as Record<string, unknown>).seqNum;
            if (typeof seqNum === 'number' && seqNum > lastSeqNumRef.current) {
              lastSeqNumRef.current = seqNum;
            }
            applyEvent(event);
          }
        } catch (err) {
          if (err instanceof Error) {
            if (err.name === 'AbortError') {
              return 'aborted';
            }
            if (err.message === 'SESSION_NOT_ACTIVE') {
              setState((s) => ({ ...s, connectionState: 'interrupted' }));
              return 'interrupted';
            }
          }

          if (currentRetry < maxRetries) {
            currentRetry++;
            setState((s) => ({ ...s, connectionState: 'reconnecting' }));
            const delay = Math.min(1000 * Math.pow(2, currentRetry - 1), 16000);
            await new Promise((r) => setTimeout(r, delay));

            try {
              const health = await client.getHealth();
              if (serverEpochRef.current !== null && health.epoch !== serverEpochRef.current) {
                serverEpochRef.current = health.epoch;
                setState((s) => ({
                  ...s,
                  error: 'Server restarted — session may need to be resumed.',
                  connectionState: 'restarted',
                }));
              }
            } catch {
              // ignore health check errors during reconnect
            }

            retryCount = currentRetry;
            const result = await connect();
            return result;
          }

          setState((s) => ({
            ...s,
            error: err instanceof Error ? err.message : 'Stream connection failed',
            connectionState: 'failed',
          }));
          return 'failed';
        }
        return 'connected';
      };

      // Capture initial server epoch
      try {
        const health = await client.getHealth();
        serverEpochRef.current = health.epoch;
      } catch {
        // non-fatal
      }

      await connect();
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
    toolInputBuffersRef.current.clear();
    toolStartTimesRef.current.clear();
    lastSeqNumRef.current = 0;
    processedSeqNumsRef.current.clear();
    stopToolTimer();
  }, [stopToolTimer]);

  const clearMessages = useCallback((sessionId: string | null = null) => {
    toolInputBuffersRef.current.clear();
    toolStartTimesRef.current.clear();
    lastSeqNumRef.current = 0;
    processedSeqNumsRef.current.clear();
    stopToolTimer();
    setState((s) => ({
      ...s,
      sessionId,
      isStreaming: false,
      pendingRouteSync: false,
      messages: [],
      activeTools: new Map(),
      pendingPermissions: [],
      error: null,
      connectionState: 'connected',
    }));
  }, [stopToolTimer]);

  const loadMessages = useCallback((
    messages: Message[],
    sessionId?: string | null,
    options?: { preservePendingPermissions?: boolean },
  ) => {
    toolInputBuffersRef.current.clear();
    toolStartTimesRef.current.clear();
    lastSeqNumRef.current = 0;
    processedSeqNumsRef.current.clear();
    stopToolTimer();
    setState((s) => ({
      ...s,
      sessionId: sessionId ?? s.sessionId,
      pendingRouteSync: false,
      messages,
      activeTools: new Map(),
      pendingPermissions: options?.preservePendingPermissions ? s.pendingPermissions : [],
      error: null,
      isStreaming: false,
      connectionState: 'connected',
    }));
  }, [stopToolTimer]);

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
