// src/server/routes/sessions.ts
// Session management routes

import { sessionManager } from '../sessionManager.js'
import { appendSessionCustomTitle } from '../sessionPersistence.js'
import { updateSessionName } from '../sessionRegistry.js'
import { jsonResponse, corsResponse } from '../utils.js'

export async function sessionRoutes(
  req: Request,
  path: string,
  allowedOrigin: string,
): Promise<Response> {
  if (req.method === 'OPTIONS') return corsResponse(allowedOrigin)

  if (path === '/api/sessions' && req.method === 'GET') {
    const sessions = await sessionManager.listAllSessions()
    return jsonResponse({ sessions, hasMore: false })
  }

  if (path === '/api/sessions' && req.method === 'POST') {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const cwd =
      typeof body.cwd === 'string' && body.cwd.trim()
        ? body.cwd.trim()
        : process.cwd()

    try {
      const session = await sessionManager.createLogicalSession(cwd)
      return jsonResponse({ session }, 201)
    } catch (err) {
      return jsonResponse(
        { success: false, error: (err as Error).message },
        503,
      )
    }
  }

  if (path.match(/^\/api\/sessions\/([^/]+)$/) && req.method === 'GET') {
    const sessionId = path.split('/')[3]
    const session = await sessionManager.getSessionInfo(sessionId)
    if (!session) return jsonResponse({ error: 'SESSION_NOT_FOUND' }, 404)
    return jsonResponse({ session })
  }

  if (path.match(/^\/api\/sessions\/([^/]+)$/) && req.method === 'DELETE') {
    const sessionId = path.split('/')[3]
    const ok = await sessionManager.killSession(sessionId)
    if (!ok) return jsonResponse({ error: 'SESSION_NOT_FOUND' }, 404)
    return jsonResponse({ success: true })
  }

  if (path.match(/^\/api\/sessions\/([^/]+)$/) && req.method === 'PATCH') {
    const sessionId = path.split('/')[3]
    const body = await req
      .json()
      .catch(() => null) as Record<string, unknown> | null
    const name =
      typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return jsonResponse({ error: 'INVALID_INPUT', message: 'name is required' }, 400)
    }

    const session = await sessionManager.getSessionInfo(sessionId)
    if (!session) {
      return jsonResponse({ error: 'SESSION_NOT_FOUND' }, 404)
    }

    try {
      const appended = await appendSessionCustomTitle(
        sessionId,
        name,
        session.cwd,
      )
      if (!appended && session.status !== 'active') {
        return jsonResponse(
          { error: 'SESSION_NOT_FOUND', message: 'Transcript not found' },
          404,
        )
      }

      sessionManager.updateSessionName(sessionId, name)
      await updateSessionName(sessionId, name)
    } catch (error) {
      return jsonResponse(
        {
          error: 'SESSION_RENAME_FAILED',
          message: error instanceof Error ? error.message : 'Failed to rename session',
        },
        500,
      )
    }

    return jsonResponse({ success: true })
  }

  if (path.match(/^\/api\/sessions\/([^/]+)\/messages$/) && req.method === 'GET') {
    const sessionId = path.split('/')[3]
    const messages = await sessionManager.getSessionMessages(sessionId)
    return jsonResponse({ messages })
  }

  return jsonResponse({ error: 'NOT_FOUND' }, 404)
}
