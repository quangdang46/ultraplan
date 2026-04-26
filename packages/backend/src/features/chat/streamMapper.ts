import type { ServerEvent } from '../../../../contracts/src/index'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractToolResultText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (!raw) return ''
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item
        if (isRecord(item) && typeof item.text === 'string') return item.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (isRecord(raw)) {
    if (typeof raw.text === 'string') return raw.text
    if ('content' in raw) return extractToolResultText(raw.content)
  }
  return String(raw)
}

export function mapQueryEventToServerEvents(event: unknown): ServerEvent[] {
  if (!isRecord(event) || typeof event.type !== 'string') return []

  if (event.type === 'assistant') {
    const message = isRecord(event.message) ? event.message : null
    const content = Array.isArray(message?.content) ? message?.content : []
    const out: ServerEvent[] = []
    for (const block of content) {
      if (!isRecord(block) || typeof block.type !== 'string') continue
      if (block.type === 'text' && typeof block.text === 'string') {
        out.push({
          type: 'content_delta',
          data: { delta: { type: 'text_delta', text: block.text } },
        })
        continue
      }
      if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        out.push({
          type: 'tool_use',
          data: { id: block.id, name: block.name, input: isRecord(block.input) ? block.input : {} },
        })
        continue
      }
      if (block.type === 'tool_result') {
        out.push({
          type: 'tool_result',
          data: {
            toolCallId: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
            result: extractToolResultText((block as { content?: unknown; text?: unknown }).content ?? block.text),
            exitCode: 0,
            timeDisplay: '',
          },
        })
      }
    }
    return out
  }

  if (event.type === 'user') {
    const message = isRecord(event.message) ? event.message : null
    const content = Array.isArray(message?.content) ? message?.content : []
    return content
      .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === 'tool_result')
      .map((block) => ({
        type: 'tool_result' as const,
        data: {
          toolCallId: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
          result: extractToolResultText((block as { content?: unknown; text?: unknown }).content ?? block.text),
          exitCode: 0,
          timeDisplay: '',
        },
      }))
  }

  if (event.type === 'stream_done') {
    return [{ type: 'message_end', data: {} }]
  }

  return []
}
