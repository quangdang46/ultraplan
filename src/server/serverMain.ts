// src/server/serverMain.ts
// Main HTTP server entry point using Bun.serve

import { enableConfigs } from '../utils/config.js'
import { applySafeConfigEnvironmentVariables } from '../utils/managedEnv.js'
import { jsonResponse, withCors } from './utils.js'

export interface ServerOptions {
  port?: number
  host?: string
  capacity?: number
}

export async function runServerMode(opts: ServerOptions = {}): Promise<void> {
  // Mirror the CLI init path enough for backend mode to honor ~/.claude/settings.json
  // before any session subprocess is spawned.
  enableConfigs()
  applySafeConfigEnvironmentVariables()

  const port = opts.port ?? parseInt(process.env.CLAUDE_CODE_SERVER_PORT || '8080')
  const host = opts.host ?? '127.0.0.1'
  const envCapacity = Number.parseInt(
    process.env.CLAUDE_CODE_SERVER_MAX_SESSIONS || '',
    10,
  )
  const capacity =
    opts.capacity ??
    (Number.isFinite(envCapacity) && envCapacity > 0 ? envCapacity : 8)
  const allowedOrigin = process.env.CLAUDE_CODE_CORS_ORIGIN ?? 'http://localhost:5173'

  // Import sessionManager and initialize
  const { sessionManager } = await import('./sessionManager.js')
  sessionManager.init({ capacity })

  console.log(`🔌 Claude Code Server running on http://${host}:${port}`)

  Bun.serve({
    port,
    hostname: host,
    fetch: (req) => handleRequest(req, allowedOrigin),
    idleTimeout: 0,
  })
}

async function handleRequest(req: Request, allowedOrigin: string): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  try {
    let response: Response

    // Health
    if (path === '/health' && req.method === 'GET') {
      response = jsonResponse({ status: 'ok', timestamp: new Date().toISOString() })
    }
    // Auth routes
    else if (path.startsWith('/api/auth/')) {
      const { authRoutes } = await import('./routes/auth.js')
      response = await authRoutes(req, path, allowedOrigin)
    }
    // Session routes
    else if (path.startsWith('/api/sessions')) {
      const { sessionRoutes } = await import('./routes/sessions.js')
      response = await sessionRoutes(req, path, allowedOrigin)
    }
    // Chat stream
    else if (path.startsWith('/api/chat/') && req.method === 'POST') {
      const { chatRoutes } = await import('./routes/chat.js')
      response = await chatRoutes(req, allowedOrigin, undefined, path)
    }
    // Suggest routes
    else if (path.startsWith('/api/suggest/')) {
      const { suggestRoutes } = await import('./routes/suggest.js')
      response = await suggestRoutes(req, path, allowedOrigin)
    }
    // System routes
    else if ((path === '/api/tools' || path === '/api/state') && req.method === 'GET') {
      const { systemRoutes } = await import('./routes/system.js')
      response = await systemRoutes(req, path, allowedOrigin)
    }
    // 404
    else {
      response = jsonResponse({ error: 'NOT_FOUND' }, 404)
    }

    return withCors(response, allowedOrigin)
  } catch (err) {
    return withCors(jsonResponse({ error: 'INTERNAL_ERROR', message: (err as Error).message }, 500), allowedOrigin)
  }
}
