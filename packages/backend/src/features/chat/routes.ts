import { createJsonResponse, createSseResponse } from '../../shared/http'
import { errorResponse } from '../../shared/errors'
import type { ChatStreamRequest, ReplyQuote } from '../../../../contracts/src/index'

const MAX_QUOTE_LENGTH = 10_000

function validateQuote(quote: unknown): ReplyQuote | undefined {
  if (quote === undefined) return undefined
  if (typeof quote !== 'object' || quote === null) {
    throw errorResponse('QUOTE_TYPE_INVALID', 400, {
      message: 'quote must be an object',
    })
  }
  const payload = quote as Record<string, unknown>
  if (typeof payload.text !== 'string') {
    throw errorResponse('QUOTE_TYPE_INVALID', 400, {
      message: 'quote.text must be a string',
    })
  }
  const text = payload.text.trim()
  if (!text) {
    throw errorResponse('QUOTE_EMPTY', 400, {
      message: 'quote.text must not be empty',
    })
  }
  if (text.length > MAX_QUOTE_LENGTH) {
    throw errorResponse('QUOTE_TOO_LONG', 400, {
      message: `quote.text exceeds maximum length (${MAX_QUOTE_LENGTH})`,
    })
  }
  return {
    text,
    sourceMessageId:
      typeof payload.sourceMessageId === 'string' ? payload.sourceMessageId : undefined,
    sourceRole:
      payload.sourceRole === 'user' || payload.sourceRole === 'assistant'
        ? payload.sourceRole
        : undefined,
  }
}

export async function handleChatRoute(req: Request, path: string): Promise<Response | null> {
  if (!(req.method === 'POST' && path === '/api/chat/stream')) {
    return null
  }

  const body = (await req.json().catch(() => null)) as ChatStreamRequest | null
  if (!body || typeof body !== 'object') {
    return errorResponse('CHAT_PAYLOAD_MALFORMED', 400, {
      message: 'request body must be a JSON object',
    })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''

  let quote: ReplyQuote | undefined
  try {
    quote = validateQuote(body.quote)
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    return errorResponse('QUOTE_PAYLOAD_MALFORMED', 400, {
      message: 'invalid quote payload',
    })
  }

  if (!message && !quote) {
    return errorResponse('CHAT_MESSAGE_MISSING', 400, {
      message: 'message or quote is required',
    })
  }
  const userMessage = message
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const { streamQuery } = await import('../../queryService.js')
        await streamQuery({
          message: userMessage,
          quote,
          sessionId: sessionId || undefined,
          onEvent: (event) => send(event.type, event),
        })
      } catch (error) {
        send('error', { message: (error as Error).message })
      } finally {
        controller.close()
      }
    },
  })

  return createSseResponse(stream)
}
