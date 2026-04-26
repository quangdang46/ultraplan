import { createJsonResponse, createSseResponse } from '../../shared/http'

export async function handleChatRoute(req: Request, path: string): Promise<Response | null> {
  if (!(req.method === 'POST' && path === '/api/chat/stream')) {
    return null
  }

  const body = (await req.json().catch(() => null)) as { message?: string } | null
  if (!body?.message) {
    return createJsonResponse({ success: false, error: 'NO_MESSAGE' }, 400)
  }

  const userMessage = body.message
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
