import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { getProjectDir } from '../utils/sessionStoragePortable.js'
import { loadTranscriptMessages } from './sessionPersistence.js'

describe('loadTranscriptMessages', () => {
  let cwd = ''
  let projectDir = ''

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ultraplan-session-'))
    projectDir = getProjectDir(cwd)
    await mkdir(projectDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
    if (cwd) {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('preserves structured transcript blocks beyond plain text and tool calls', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    const transcriptPath = join(projectDir, `${sessionId}.jsonl`)

    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          type: 'user',
          timestamp: '2026-04-28T00:00:00.000Z',
          message: {
            content: [
              { type: 'text', text: 'Please inspect these artifacts.' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'AAA',
                },
              },
              {
                type: 'document',
                title: 'spec.pdf',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: 'BBB',
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-04-28T00:00:01.000Z',
          message: {
            content: [
              { type: 'redacted_thinking' },
              {
                type: 'web_search_result',
                title: 'API docs',
                url: 'https://example.com/docs',
                snippet: 'Primary reference',
              },
              { type: 'text', text: 'Here are the relevant docs.' },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          timestamp: '2026-04-28T00:00:02.000Z',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: [
                  { type: 'text', text: 'done' },
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: 'CCC',
                    },
                  },
                  {
                    type: 'web_search_result',
                    title: 'Release notes',
                    url: 'https://example.com/release-notes',
                  },
                ],
              },
            ],
          },
        }),
      ].join('\n'),
      'utf8',
    )

    const messages = await loadTranscriptMessages(sessionId, cwd)

    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: 'Please inspect these artifacts.',
      blocks: [
        { type: 'text', text: 'Please inspect these artifacts.' },
        {
          type: 'image',
          summary: 'Image attachment',
          mimeType: 'image/png',
          sourceType: 'base64',
        },
        {
          type: 'document',
          summary: 'Document: spec.pdf',
          title: 'spec.pdf',
          mimeType: 'application/pdf',
          sourceType: 'base64',
        },
      ],
    })
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Here are the relevant docs.',
      blocks: [
        {
          type: 'redacted_thinking',
          summary: 'Redacted thinking omitted from transcript',
        },
        {
          type: 'web_search_result',
          title: 'API docs',
          url: 'https://example.com/docs',
          summary: 'Primary reference',
        },
        { type: 'text', text: 'Here are the relevant docs.' },
      ],
    })
    expect(messages[2]?.blocks?.[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content:
        'done\n[Image attachment: image/png]\nRelease notes (https://example.com/release-notes)',
    })
  })
})
