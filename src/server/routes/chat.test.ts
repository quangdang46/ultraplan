import { describe, expect, test } from 'bun:test'
import { chatRoutes, composeUserMessage, mapSubprocessEventToServerEvents } from './chat.js'
import type { SessionHandle, SessionManagerLike, SessionDoneStatus } from '../types.js'

describe('composeUserMessage', () => {
  test('embeds quoted context into a single text prompt', () => {
    expect(
      composeUserMessage('Please answer', {
        text: 'line one\nline two',
        sourceRole: 'assistant',
      }),
    ).toContain('> line one\n> line two')
  })
})

describe('mapSubprocessEventToServerEvents', () => {
  test('maps assistant text, tool_use, and tool_result blocks', () => {
    const events = mapSubprocessEventToServerEvents({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'README.md' } },
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'done' },
        ],
      },
    })

    expect(events).toEqual([
      {
        type: 'content_delta',
        data: { delta: { type: 'text_delta', text: 'hello' } },
      },
      {
        type: 'tool_start',
        data: { id: 'tool-1', name: 'Read', input: { path: 'README.md' } },
      },
      {
        type: 'tool_result',
        data: {
          toolCallId: 'tool-1',
          id: 'tool-1',
          result: 'done',
          exitCode: 0,
          timeDisplay: '',
        },
      },
    ])
  })

  test('maps error results to error plus message_end', () => {
    const events = mapSubprocessEventToServerEvents({
      type: 'result',
      uuid: 'msg-1',
      is_error: true,
      subtype: 'error_during_execution',
      errors: ['boom'],
      usage: {
        input_tokens: 3,
        output_tokens: 5,
      },
    })

    expect(events[0]).toEqual({
      type: 'error',
      data: {
        code: 'error_during_execution',
        message: 'boom',
      },
    })
    expect(events[1]).toEqual({
      type: 'message_end',
      data: {
        id: 'msg-1',
        usage: {
          inputTokens: 3,
          outputTokens: 5,
          totalTokens: 8,
        },
      },
    })
  })
})

describe('chatRoutes', () => {
  test('subscribes before enqueueing so synchronous child output reaches SSE', async () => {
    let capturedPayload = ''
    const recordedMessages: Array<{
      sessionId: string
      role: string
      content: string
      cwd?: string
    }> = []
    let assistantDraft = ''
    const subscribers = new Set<(event: unknown) => void>()
    const done = Promise.resolve('completed' as SessionDoneStatus)

    const handle: SessionHandle = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      pid: 42,
      cwd: '/repo',
      startedAt: Date.parse('2026-04-27T00:00:00.000Z'),
      child: {} as SessionHandle['child'],
      done,
      kill() {},
      forceKill() {},
      async waitForReady() {},
      writeStdin() {},
      subscribeEvents(cb) {
        subscribers.add(cb)
        return () => subscribers.delete(cb)
      },
      async enqueueMessage(data: string) {
        capturedPayload = data
        for (const cb of subscribers) {
          cb({
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'hello back' }],
            },
          })
          cb({
            type: 'result',
            uuid: 'msg-finished',
            usage: {
              input_tokens: 1,
              output_tokens: 2,
            },
          })
        }
      },
      getActivity() {
        return []
      },
    }

    const manager: SessionManagerLike = {
      async getOrCreate() {
        return handle
      },
      async recordSessionMessage(sessionId, message, cwd) {
        recordedMessages.push({
          sessionId,
          role: message.role,
          content: message.content,
          cwd,
        })
      },
      async beginAssistantMessage() {
        assistantDraft = ''
      },
      async appendAssistantMessage(_sessionId, content, mode = 'append') {
        assistantDraft =
          mode === 'replace' ? content : `${assistantDraft}${content}`
      },
      async finalizeAssistantMessage(sessionId, cwd) {
        recordedMessages.push({
          sessionId,
          role: 'assistant',
          content: assistantDraft,
          cwd,
        })
      },
    }

    const request = new Request('http://localhost/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Reply to this',
        quote: { text: 'Original context' },
        cwd: '/repo',
      }),
    })

    const response = await chatRoutes(request, 'http://localhost:5173', manager)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('event: session_created')
    expect(body).toContain('event: message_start')
    expect(body).toContain('event: content_delta')
    expect(body).toContain('hello back')
    expect(body).toContain('event: message_end')

    const parsedPayload = JSON.parse(capturedPayload) as {
      message: { content: Array<{ type: string; text?: string }> }
      session_id: string
    }

    expect(parsedPayload.session_id).toBe(handle.sessionId)
    expect(parsedPayload.message.content[0]?.text).toContain('Quoted context:')
    expect(parsedPayload.message.content[0]?.text).toContain('> Original context')
    expect(recordedMessages).toEqual([
      {
        sessionId: handle.sessionId,
        role: 'user',
        content: expect.stringContaining('Quoted context:'),
        cwd: '/repo',
      },
      {
        sessionId: handle.sessionId,
        role: 'assistant',
        content: 'hello back',
        cwd: '/repo',
      },
    ])
  })

  test('accepts control responses for active sessions', async () => {
    let capturedPayload = ''
    const handle: SessionHandle = {
      sessionId: '550e8400-e29b-41d4-a716-446655440003',
      pid: 42,
      cwd: '/repo',
      startedAt: Date.parse('2026-04-27T00:00:00.000Z'),
      child: {} as SessionHandle['child'],
      done: Promise.resolve('completed' as SessionDoneStatus),
      kill() {},
      forceKill() {},
      async waitForReady() {},
      writeStdin(data: string) {
        capturedPayload = data
      },
      subscribeEvents() {
        return () => {}
      },
      async enqueueMessage() {},
      getActivity() {
        return []
      },
    }

    const manager: SessionManagerLike = {
      async getOrCreate() {
        return handle
      },
      getSession() {
        return handle
      },
    }

    const request = new Request('http://localhost/api/chat/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: handle.sessionId,
        request_id: 'req-1',
        approved: false,
        message: 'Need confirmation first',
      }),
    })

    const response = await chatRoutes(
      request,
      'http://localhost:5173',
      manager,
      '/api/chat/control',
    )

    expect(response.status).toBe(200)
    expect(JSON.parse(capturedPayload)).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-1',
        response: {
          behavior: 'deny',
          message: 'Need confirmation first',
        },
      },
    })
  })
})
