import { describe, expect, test } from 'bun:test'
import { mapQueryEventToServerEvents } from './streamMapper'

describe('streamMapper', () => {
  test('maps assistant text and tool_use blocks', () => {
    const events = mapQueryEventToServerEvents({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'README.md' } },
        ],
      },
    })

    expect(events.length).toBe(2)
    expect(events[0]?.type).toBe('content_delta')
    expect(events[1]?.type).toBe('tool_use')
  })

  test('maps tool_result when content is string', () => {
    const events = mapQueryEventToServerEvents({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }],
      },
    })
    expect(events[0]?.type).toBe('tool_result')
    if (events[0]?.type === 'tool_result') {
      expect(events[0].data.toolCallId).toBe('t1')
      expect(events[0].data.result).toBe('done')
    }
  })

  test('maps stream_done to single message_end event', () => {
    const events = mapQueryEventToServerEvents({ type: 'stream_done' })
    expect(events).toEqual([{ type: 'message_end', data: {} }])
  })
})
