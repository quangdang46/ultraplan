import { createJsonResponse } from '../../shared/http'
import { errorResponse } from '../../shared/errors'
import {
  listSessions,
  getSession,
  createSession,
  killSession,
  renameSession,
  getSessionMessages,
} from './store'
import type { ChatStreamRequest, Session } from '../../../../contracts/src/index'

export async function handleSessionsRoute(
  req: Request,
  path: string,
): Promise<Response | null> {
  // GET /api/sessions — list all sessions
  if (req.method === 'GET' && path === '/api/sessions') {
    const sessions = await listSessions()
    return createJsonResponse({ sessions, hasMore: false })
  }

  // GET /api/sessions/:id — get single session
  if (req.method === 'GET' && /^\/api\/sessions\/([^/]+)$/.test(path)) {
    const sessionId = path.split('/')[3]
    const session = await getSession(sessionId)
    if (!session) {
      return errorResponse('SESSION_NOT_FOUND', 404, { message: 'Session not found' })
    }
    return createJsonResponse({ session })
  }

  // GET /api/sessions/:id/messages — load transcript history
  if (req.method === 'GET' && /^\/api\/sessions\/([^/]+)\/messages$/.test(path)) {
    const parts = path.split('/')
    const sessionId = parts[3]
    const messages = await getSessionMessages(sessionId)
    return createJsonResponse({ messages })
  }

  // POST /api/sessions — create new session
  if (req.method === 'POST' && path === '/api/sessions') {
    let body: { cwd?: string } | null = null
    try {
      body = (await req.json().catch(() => null)) as { cwd?: string } | null
    } catch {
      // ignore
    }
    const cwd = body?.cwd ?? process.cwd()
    const session = await createSession(cwd)
    return createJsonResponse({ session }, 201)
  }

  // DELETE /api/sessions/:id — kill session
  if (req.method === 'DELETE' && /^\/api\/sessions\/([^/]+)$/.test(path)) {
    const sessionId = path.split('/')[3]
    const ok = await killSession(sessionId)
    if (!ok) {
      return errorResponse('SESSION_NOT_FOUND', 404, { message: 'Session not found or already dead' })
    }
    return createJsonResponse({ success: true })
  }

  // PATCH /api/sessions/:id — rename session
  if (req.method === 'PATCH' && /^\/api\/sessions\/([^/]+)$/.test(path)) {
    const sessionId = path.split('/')[3]
    let body: { name?: string } | null = null
    try {
      body = (await req.json().catch(() => null)) as { name?: string } | null
    } catch {
      // ignore
    }
    if (!body?.name) {
      return errorResponse('INVALID_INPUT', 400, { message: 'name is required' })
    }
    const ok = await renameSession(sessionId, body.name)
    if (!ok) {
      return errorResponse('SESSION_NOT_FOUND', 404, { message: 'Session not found' })
    }
    return createJsonResponse({ success: true })
  }

  return null
}
