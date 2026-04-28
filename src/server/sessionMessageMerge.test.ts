import { describe, expect, test } from 'bun:test'

import type { SessionMessage } from '../../packages/contracts/src/index.js'
import { mergeSessionMessages } from './sessionMessageMerge.js'

describe('mergeSessionMessages', () => {
  test('appends in-memory assistant messages missing from the transcript', () => {
    const transcriptMessages: SessionMessage[] = [
      {
        role: 'user',
        content: 'hello',
        timestamp: '2026-04-28T00:00:00.000Z',
      },
    ]
    const inMemoryMessages: SessionMessage[] = [
      {
        role: 'user',
        content: 'hello',
        timestamp: '2026-04-28T00:00:00.000Z',
      },
      {
        role: 'assistant',
        content: 'final answer',
        timestamp: '2026-04-28T00:00:02.000Z',
      },
    ]

    expect(
      mergeSessionMessages(transcriptMessages, inMemoryMessages),
    ).toEqual(inMemoryMessages)
  })

  test('keeps transcript blocks while taking fuller assistant text from memory', () => {
    const transcriptMessages: SessionMessage[] = [
      {
        role: 'assistant',
        content: 'partial',
        timestamp: '2026-04-28T00:00:01.000Z',
        blocks: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Read',
            input: { file_path: 'README.md' },
          },
        ],
      },
    ]
    const inMemoryMessages: SessionMessage[] = [
      {
        role: 'assistant',
        content: 'partial but longer final answer',
        timestamp: '2026-04-28T00:00:02.000Z',
      },
    ]

    expect(
      mergeSessionMessages(transcriptMessages, inMemoryMessages),
    ).toEqual([
      {
        role: 'assistant',
        content: 'partial but longer final answer',
        timestamp: '2026-04-28T00:00:02.000Z',
        blocks: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Read',
            input: { file_path: 'README.md' },
          },
        ],
      },
    ])
  })

  test('returns transcript messages unchanged when memory has no newer data', () => {
    const transcriptMessages: SessionMessage[] = [
      {
        role: 'assistant',
        content: 'done',
        timestamp: '2026-04-28T00:00:02.000Z',
        blocks: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'ok',
          },
        ],
      },
    ]

    expect(mergeSessionMessages(transcriptMessages, [])).toEqual(
      transcriptMessages,
    )
  })
})
