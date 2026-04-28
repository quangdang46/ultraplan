// src/server/routes/chat.ts
// Chat streaming routes using SSE

import { sessionManager } from '../sessionManager.js'
import { jsonResponse, createSseResponse } from '../utils.js'
import type { ReplyQuote, ServerEvent } from '../eventProtocol.js'
import type { SessionManagerLike } from '../types.js'

const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

function normalizeQuote(value: unknown): ReplyQuote | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const quote = value as Record<string, unknown>
  if (typeof quote.text !== 'string') {
    return undefined
  }

  const text = quote.text.trim()
  if (!text) {
    return undefined
  }

  return {
    text,
    sourceMessageId:
      typeof quote.sourceMessageId === 'string'
        ? quote.sourceMessageId
        : undefined,
    sourceRole:
      quote.sourceRole === 'user' || quote.sourceRole === 'assistant'
        ? quote.sourceRole
        : undefined,
  }
}

function composeUserMessage(message: string, quote?: ReplyQuote): string {
  if (!quote?.text) return message

  const quotedLines = quote.text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  const userRequest = message.trim() || 'Please reply to the quoted context.'

  return `Quoted context:\n${quotedLines}\n\nUser request:\n${userRequest}`
}

function extractToolResultText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (!raw) return ''
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item
        if (
          item &&
          typeof item === 'object' &&
          'text' in item &&
          typeof item.text === 'string'
        ) {
          return item.text
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as Record<string, unknown>
    if (typeof record.text === 'string') return record.text
    if ('content' in record) return extractToolResultText(record.content)
  }
  return String(raw)
}

function mapUsage(parsed: Record<string, unknown>) {
  const usage =
    parsed.usage && typeof parsed.usage === 'object'
      ? (parsed.usage as Record<string, unknown>)
      : null

  const inputTokens =
    Number(parsed.inputTokens ?? usage?.input_tokens ?? 0) || 0
  const outputTokens =
    Number(parsed.outputTokens ?? usage?.output_tokens ?? 0) || 0

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  }
}

function mapStreamEventToServerEvents(parsed: Record<string, unknown>): ServerEvent[] {
  const rawEvent =
    parsed.event && typeof parsed.event === 'object'
      ? (parsed.event as Record<string, unknown>)
      : null
  if (!rawEvent || typeof rawEvent.type !== 'string') {
    return []
  }

  switch (rawEvent.type) {
    case 'content_block_start': {
      const block =
        rawEvent.content_block && typeof rawEvent.content_block === 'object'
          ? (rawEvent.content_block as Record<string, unknown>)
          : null
      if (!block || typeof block.type !== 'string') {
        return []
      }

      if (
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        return [{
          type: 'tool_start',
          data: {
            id: block.id,
            name: block.name,
            input:
              block.input && typeof block.input === 'object'
                ? (block.input as Record<string, unknown>)
                : {},
          },
        }]
      }

      return []
    }
    case 'content_block_delta': {
      const delta =
        rawEvent.delta && typeof rawEvent.delta === 'object'
          ? (rawEvent.delta as Record<string, unknown>)
          : null
      if (!delta || typeof delta.type !== 'string') {
        return []
      }

      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        return [{
          type: 'content_delta',
          data: {
            delta: {
              type: 'text_delta',
              text: delta.text,
            },
          },
        }]
      }

      if (
        delta.type === 'thinking_delta' &&
        typeof delta.thinking === 'string'
      ) {
        return [{
          type: 'thinking_delta',
          data: {
            delta: {
              type: 'thinking_delta',
              thinking: delta.thinking,
            },
          },
        }]
      }

      return []
    }
    default:
      return []
  }
}

export function mapSubprocessEventToServerEvents(
  parsed: Record<string, unknown>,
): ServerEvent[] {
  const type = parsed.type as string

  if (type === 'stream_event') {
    return mapStreamEventToServerEvents(parsed)
  }

  if (type === 'assistant' || type === 'user' || type === 'partial_assistant') {
    const message =
      parsed.message && typeof parsed.message === 'object'
        ? (parsed.message as Record<string, unknown>)
        : null
    const content = Array.isArray(message?.content)
      ? (message.content as Array<Record<string, unknown>>)
      : []
    const events: ServerEvent[] = []

    for (const block of content) {
      if (!block || typeof block !== 'object' || typeof block.type !== 'string') {
        continue
      }

      if (block.type === 'text' && typeof block.text === 'string' && type !== 'user') {
        events.push({
          type: 'content_delta',
          data: { delta: { type: 'text_delta', text: block.text } },
        })
        continue
      }

      if (
        block.type === 'thinking' &&
        typeof block.thinking === 'string' &&
        type !== 'user'
      ) {
        events.push({
          type: 'thinking_delta',
          data: {
            delta: {
              type: 'thinking_delta',
              thinking: block.thinking,
            },
          },
        })
        continue
      }

      if (
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        events.push({
          type: 'tool_start',
          data: {
            id: block.id,
            name: block.name,
            input:
              block.input && typeof block.input === 'object'
                ? (block.input as Record<string, unknown>)
                : {},
          },
        })
        continue
      }

      if (block.type === 'tool_result') {
        const toolCallId =
          typeof block.tool_use_id === 'string'
            ? block.tool_use_id
            : typeof block.id === 'string'
              ? block.id
              : ''

        events.push({
          type: 'tool_result',
          data: {
            toolCallId,
            id: toolCallId,
            result: extractToolResultText(
              (block as { content?: unknown; text?: unknown }).content ?? block.text,
            ),
            exitCode: 0,
            timeDisplay: '',
          },
        })
      }
    }

    return events
  }

  switch (type) {
    case 'session_created':
      return [{
        type: 'session_created',
        data: {
          sessionId: String(parsed.sessionId ?? ''),
          cwd: String(parsed.cwd ?? ''),
          createdAt: String(parsed.createdAt ?? new Date().toISOString()),
        },
      }]
    case 'control_request':
      return [{
        type: 'permission_request',
        data: {
          request_id: String(parsed.request_id ?? ''),
          request: parsed.request,
        },
      }]
    case 'control_response':
      return [{
        type: 'control_response',
        data: {
          request_id: String(parsed.request_id ?? ''),
          approved: Boolean(parsed.approved),
        },
      }]
    case 'tool_use':
      return [{
        type: 'tool_start',
        data: {
          id: String(parsed.id ?? ''),
          name: String(parsed.name ?? 'unknown_tool'),
          input:
            parsed.input && typeof parsed.input === 'object'
              ? (parsed.input as Record<string, unknown>)
              : {},
        },
      }]
    case 'tool_result': {
      const toolCallId = String(
        parsed.toolCallId ?? parsed.tool_use_id ?? parsed.id ?? '',
      )

      return [{
        type: 'tool_result',
        data: {
          toolCallId,
          id: toolCallId,
          result: extractToolResultText(parsed.result ?? parsed.content),
          exitCode: Boolean(parsed.isError ?? parsed.is_error) ? 1 : 0,
          timeDisplay: '',
        },
      }]
    }
    case 'result': {
      const events: ServerEvent[] = []
      if (Boolean(parsed.is_error)) {
        const errors = Array.isArray(parsed.errors)
          ? parsed.errors.filter((item): item is string => typeof item === 'string')
          : []
        const fallback =
          typeof parsed.result === 'string'
            ? parsed.result
            : 'Claude CLI subprocess returned an error'
        events.push({
          type: 'error',
          data: {
            code: String(parsed.subtype ?? 'SUBPROCESS_ERROR'),
            message: errors.join('\n').trim() || fallback,
          },
        })
      }

      events.push({
        type: 'message_end',
        data: {
          id: String(parsed.uuid ?? parsed.id ?? `msg_${Date.now()}`),
          usage: mapUsage(parsed),
        },
      })
      return events
    }
    case 'error':
      return [{
        type: 'error',
        data: {
          code: String(parsed.code ?? 'SUBPROCESS_ERROR'),
          message: String(parsed.message ?? 'Claude CLI subprocess error'),
        },
      }]
    default:
      return []
  }
}

function createServerEventForwarder(send: (event: ServerEvent) => void) {
  let sawTextAssistantPartial = false
  let sawThinkingAssistantPartial = false
  const streamedToolIds = new Set<string>()

  const resetPartialState = () => {
    sawTextAssistantPartial = false
    sawThinkingAssistantPartial = false
    streamedToolIds.clear()
  }

  return (parsedRaw: unknown) => {
    const parsed =
      parsedRaw && typeof parsedRaw === 'object'
        ? (parsedRaw as Record<string, unknown>)
        : null
    if (!parsed || typeof parsed.type !== 'string') {
      return
    }

    if (parsed.type === 'stream_event') {
      const forwardedEvents = mapSubprocessEventToServerEvents(parsed)
      for (const event of forwardedEvents) {
        if (event.type === 'thinking_delta') {
          sawThinkingAssistantPartial = true
        } else if (event.type === 'content_delta') {
          sawTextAssistantPartial = true
        } else if (event.type === 'tool_start') {
          streamedToolIds.add(event.data.id)
        } else if (event.type === 'tool_result') {
          const toolId = event.data.toolCallId ?? event.data.id ?? ''
          if (toolId) {
            streamedToolIds.add(toolId)
          }
        }
      }
      for (const event of forwardedEvents) {
        send(event)
      }
      return
    }

    if (parsed.type === 'assistant' || parsed.type === 'partial_assistant') {
      const filteredEvents = mapSubprocessEventToServerEvents(parsed).filter(
        (event) =>
          !(
            sawThinkingAssistantPartial &&
            event.type === 'thinking_delta'
          ) &&
          !(
            sawTextAssistantPartial &&
            event.type === 'content_delta'
          ) &&
          !(
            (event.type === 'tool_start' || event.type === 'tool_result') &&
            streamedToolIds.has(
              event.type === 'tool_start'
                ? event.data.id
                : event.data.toolCallId ?? event.data.id ?? '',
            )
          ),
      )
      resetPartialState()
      for (const event of filteredEvents) {
        send(event)
      }
      return
    }

    if (parsed.type === 'result' || parsed.type === 'error') {
      resetPartialState()
    }

    for (const event of mapSubprocessEventToServerEvents(parsed)) {
      send(event)
    }
  }
}

function buildControlResponsePayload(body: Record<string, unknown>): string | null {
  const requestId =
    typeof body.requestId === 'string'
      ? body.requestId.trim()
      : typeof body.request_id === 'string'
        ? body.request_id.trim()
        : ''
  if (!requestId) return null

  const approved = Boolean(body.approved)
  const updatedInput =
    body.updatedInput && typeof body.updatedInput === 'object'
      ? (body.updatedInput as Record<string, unknown>)
      : body.updated_input && typeof body.updated_input === 'object'
        ? (body.updated_input as Record<string, unknown>)
        : undefined
  const denyMessage =
    typeof body.message === 'string' && body.message.trim()
      ? body.message.trim()
      : 'Denied by user'

  return JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: approved
        ? {
            behavior: 'allow',
            ...(updatedInput ? { updatedInput } : {}),
          }
        : {
            behavior: 'deny',
            message: denyMessage,
          },
    },
  })
}

export async function chatRoutes(
  req: Request,
  allowedOrigin: string,
  manager: SessionManagerLike = sessionManager,
  path = new URL(req.url).pathname,
): Promise<Response> {
  if (req.method === 'POST' && path === '/api/chat/control') {
    const body = await req
      .json()
      .catch(() => null) as Record<string, unknown> | null
    if (!body) {
      return jsonResponse({ error: 'CHAT_PAYLOAD_MALFORMED' }, 400)
    }

    const sessionId =
      typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    if (!sessionId) {
      return jsonResponse({ error: 'SESSION_ID_MISSING' }, 400)
    }

    const handle = manager.getSession?.(sessionId)
    if (!handle) {
      return jsonResponse({ error: 'SESSION_NOT_FOUND' }, 404)
    }

    const payload = buildControlResponsePayload(body)
    if (!payload) {
      return jsonResponse({ error: 'REQUEST_ID_MISSING' }, 400)
    }

    handle.writeStdin(payload)
    return jsonResponse({ success: true })
  }

  if (req.method === 'GET' && path.match(/^\/api\/sessions\/([^/]+)\/stream$/)) {
    const sessionId = path.split('/')[3]
    const handle = manager.getSession?.(sessionId)
    if (!handle) {
      return jsonResponse({ error: 'SESSION_NOT_ACTIVE' }, 404)
    }

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        const send = (event: ServerEvent) => {
          const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(data))
        }

        send({
          type: 'session_created',
          data: {
            sessionId: handle.sessionId,
            cwd: handle.cwd,
            createdAt: new Date(handle.startedAt).toISOString(),
          },
        })

        const unsubscribe = handle.subscribeEvents(createServerEventForwarder(send))

        const close = () => {
          unsubscribe()
          try {
            controller.close()
          } catch {
            // already closed
          }
        }

        void handle.done.finally(close)
      },
    })

    return createSseResponse(stream, allowedOrigin)
  }

  if (req.method !== 'POST' || path !== '/api/chat/stream') {
    return jsonResponse({ error: 'NOT_FOUND' }, 404)
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'CHAT_PAYLOAD_MALFORMED' }, 400)
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const quote = normalizeQuote(body.quote)

  if (!message && !quote) {
    return jsonResponse({ error: 'CHAT_MESSAGE_MISSING' }, 400)
  }

  const cwd =
    typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined
  const resolvedSessionId = sessionId || crypto.randomUUID()

  let handle: Awaited<ReturnType<SessionManagerLike['getOrCreate']>>
  try {
    handle = await manager.getOrCreate(resolvedSessionId, cwd)
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 503)
  }

  const payload = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: composeUserMessage(message, quote),
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: handle.sessionId,
  })

  const messageId = `msg_${Date.now()}`
  const userMessage = composeUserMessage(message, quote)

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      let finished = false
      let turnCompleted = false
      let assistantText = ''
      let assistantRecorded = false

      const send = (event: ServerEvent) => {
        if (finished) return
        const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
        controller.enqueue(encoder.encode(data))
      }

      const cleanup = () => {
        if (finished) return
        finished = true
        unsubscribe()
        try {
          controller.close()
        } catch {
          // Already closed
        }
      }

      const unsubscribe = handle.subscribeEvents(createServerEventForwarder((event) => {
          if (event.type === 'content_delta') {
            void manager.beginAssistantMessage?.(handle.sessionId, handle.cwd)
            void manager.appendAssistantMessage?.(
              handle.sessionId,
              event.data.delta.text,
              'append',
              handle.cwd,
            )
            assistantText += event.data.delta.text
          } else if (event.type === 'content_block') {
            const blockText =
              event.data.block.text ??
              (typeof event.data.block.content === 'string'
                ? event.data.block.content
                : '')
            if (blockText) {
              void manager.beginAssistantMessage?.(handle.sessionId, handle.cwd)
              void manager.appendAssistantMessage?.(
                handle.sessionId,
                blockText,
                'replace',
                handle.cwd,
              )
              assistantText = blockText
            }
          } else if (
            event.type === 'message_end' &&
            assistantText.trim() &&
            !assistantRecorded
          ) {
            assistantRecorded = true
            void manager.finalizeAssistantMessage?.(handle.sessionId, handle.cwd)
          }

          if (event.type === 'message_end' || event.type === 'error') {
            turnCompleted = true
          }
          send(event)
      }))

      send({
        type: 'session_created',
        data: {
          sessionId: handle.sessionId,
          cwd: handle.cwd,
          createdAt: new Date(handle.startedAt).toISOString(),
        },
      })
      send({
        type: 'message_start',
        data: { id: messageId },
      })

      void manager.recordSessionMessage?.(
        handle.sessionId,
        {
          role: 'user',
          content: userMessage,
          blocks: [{ type: 'text', text: userMessage }],
          ...(quote ? { quote } : {}),
          timestamp: new Date().toISOString(),
        },
        handle.cwd,
      )

      void handle
        .enqueueMessage(payload)
        .then(() => {
          if (assistantText.trim() && !assistantRecorded) {
            assistantRecorded = true
            void manager.finalizeAssistantMessage?.(handle.sessionId, handle.cwd)
          }
          if (!turnCompleted) {
            send({
              type: 'message_end',
              data: { id: messageId, usage: ZERO_USAGE },
            })
          }
          cleanup()
        })
        .catch((error: unknown) => {
          send({
            type: 'error',
            data: {
              code: 'STREAM_FAILED',
              message:
                error instanceof Error ? error.message : 'Failed to stream chat response',
            },
          })
          cleanup()
        })

      handle.done
        .then(() => {
          if (!turnCompleted && !finished) {
            send({
              type: 'error',
              data: {
                code: 'SUBPROCESS_EXIT',
                message: 'Claude CLI subprocess ended before completing the turn',
              },
            })
            cleanup()
          }
        })
        .catch(() => {
          if (!finished) {
            cleanup()
          }
        })
    },
  })

  return createSseResponse(stream, allowedOrigin)
}

export { composeUserMessage }
