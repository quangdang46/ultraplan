import { routeRequest } from './router'
import { HEADER_CORS } from '../shared/http'
import { log } from '../shared/logger'
import { errorResponse } from '../shared/errors'

export interface ServerOptions {
  port?: number
}

export function createServer(options: ServerOptions = {}) {
  const port = options.port ?? parseInt(process.env.CLAUDE_CODE_SERVER_PORT || '8080')

  return {
    port,
    async fetch(req: Request): Promise<Response> {
      const startedAt = Date.now()
      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: HEADER_CORS })
      }

      try {
        const response = await routeRequest(req)
        log('info', 'http.request.completed', {
          method: req.method,
          path: new URL(req.url).pathname,
          status: response.status,
          durationMs: Date.now() - startedAt,
        })
        return response
      } catch (error) {
        log('error', 'http.request.failed', {
          method: req.method,
          path: new URL(req.url).pathname,
          durationMs: Date.now() - startedAt,
          message: (error as Error).message,
        })
        return errorResponse('INTERNAL_ERROR', 500, {
          message: (error as Error).message,
        })
      }
    },
  }
}
