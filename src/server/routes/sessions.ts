// src/server/routes/sessions.ts
// Session management routes

import { sessionManager } from '../sessionManager.js'
import { updateSessionName } from '../sessionRegistry.js'
import { jsonResponse, corsResponse } from '../utils.js'
import { appendFile, mkdir, readdir, readFile, stat } from 'fs/promises'
import { dirname, join } from 'path'
import * as os from 'os'
import type {
  SessionMessage,
} from '../../../packages/contracts/src/index.js'
import { getProjectDir } from '../../utils/sessionStoragePortable.js'

const HOME_DIR = process.env.HOME ?? os.homedir()
const PROJECTS_DIR = join(HOME_DIR, '.claude', 'projects')

export async function sessionRoutes(req: Request, path: string, allowedOrigin: string): Promise<Response> {
  if (req.method === 'OPTIONS') return corsResponse(allowedOrigin)

  // GET /api/sessions
  if (path === '/api/sessions' && req.method === 'GET') {
    const sessions = await sessionManager.listAllSessions()
    return jsonResponse({ sessions, hasMore: false })
  }

  // POST /api/sessions
  if (path === '/api/sessions' && req.method === 'POST') {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const cwd =
      typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : process.cwd()
    const sessionId = crypto.randomUUID()

    try {
      await sessionManager.createSession(sessionId, cwd)
      return jsonResponse({
        session: {
          id: sessionId,
          title: sessionId.slice(0, 8),
          description: cwd,
          status: 'active',
          cwd,
          createdAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
        },
      }, 201)
    } catch (err) {
      return jsonResponse({ success: false, error: (err as Error).message }, 503)
    }
  }

  // GET /api/sessions/:id
  if (path.match(/^\/api\/sessions\/([^/]+)$/) && req.method === 'GET') {
    const sessionId = path.split('/')[3]
    const sessions = await sessionManager.listAllSessions()
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return jsonResponse({ error: 'SESSION_NOT_FOUND' }, 404)
    return jsonResponse({ session })
  }

  // DELETE /api/sessions/:id
  if (path.match(/^\/api\/sessions\/([^/]+)$/) && req.method === 'DELETE') {
    const sessionId = path.split('/')[3]
    const ok = await sessionManager.killSession(sessionId)
    if (!ok) return jsonResponse({ error: 'SESSION_NOT_FOUND' }, 404)
    return jsonResponse({ success: true })
  }

  // PATCH /api/sessions/:id (rename)
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

    const sessions = await sessionManager.listAllSessions()
    const session = sessions.find((item) => item.id === sessionId)
    if (!session) {
      return jsonResponse({ error: 'SESSION_NOT_FOUND' }, 404)
    }

    try {
      const transcriptPath = await resolveTranscriptPath(sessionId, session.cwd)
      if (!transcriptPath) {
        return jsonResponse(
          { error: 'SESSION_NOT_FOUND', message: 'Transcript not found' },
          404,
        )
      }

      await mkdir(dirname(transcriptPath), { recursive: true })
      await appendFile(
        transcriptPath,
        `${JSON.stringify({
          type: 'custom-title',
          customTitle: name,
          sessionId,
        })}\n`,
        'utf8',
      )
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

  // GET /api/sessions/:id/messages
  if (path.match(/^\/api\/sessions\/([^/]+)\/messages$/) && req.method === 'GET') {
    const sessionId = path.split('/')[3]
    const messages = await getSessionMessages(sessionId)
    return jsonResponse({ messages })
  }

  return jsonResponse({ error: 'NOT_FOUND' }, 404)
}

// Inline transcript reading (reads directly from ~/.claude/projects/)
async function getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  const transcriptPath = await resolveTranscriptPath(sessionId)
  if (!transcriptPath) return []

  try {
    const content = await readFile(transcriptPath, 'utf8')
    const lines = content.split('\n').filter((line) => line.trim())
    const messages: SessionMessage[] = []
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>
        const role =
          entry.type === 'user'
            ? 'user'
            : entry.type === 'assistant'
              ? 'assistant'
              : entry.type === 'system'
                ? 'system'
                : null
        if (!role) continue
        const text = extractText(entry)
        if (!text) continue
        messages.push({
          role,
          content: text,
          timestamp:
            typeof entry.timestamp === 'string'
              ? entry.timestamp
              : new Date().toISOString(),
        })
      } catch {
        // skip malformed lines
      }
    }
    return messages
  } catch {
    return []
  }
}

async function resolveTranscriptPath(
  sessionId: string,
  cwd?: string,
): Promise<string | null> {
  const candidatePaths: string[] = []

  if (cwd) {
    candidatePaths.push(join(getProjectDir(cwd), `${sessionId}.jsonl`))
  }

  let projectDirs: string[] = []
  try {
    projectDirs = await readdir(PROJECTS_DIR)
  } catch {
    projectDirs = []
  }

  for (const dir of projectDirs) {
    candidatePaths.push(join(PROJECTS_DIR, dir, `${sessionId}.jsonl`))
  }

  for (const candidatePath of candidatePaths) {
    try {
      const file = await stat(candidatePath)
      if (file.isFile()) return candidatePath
    } catch {
      // try next candidate
    }
  }

  if (cwd) {
    return join(getProjectDir(cwd), `${sessionId}.jsonl`)
  }

  return null
}

function extractText(entry: Record<string, unknown>): string | null {
  const direct = typeof entry.message === 'string' ? entry.message
    : typeof entry.content === 'string' ? entry.content
    : typeof entry.text === 'string' ? entry.text
    : null
  if (direct) return direct.trim()

  const msg = entry.message as Record<string, unknown> | undefined
  if (!msg) return null

  const content = msg.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return null

  const texts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const obj = block as Record<string, unknown>
    if (obj.type === 'text' && typeof obj.text === 'string' && obj.text.trim()) {
      texts.push(obj.text.trim())
    }
  }
  return texts.join('\n').trim() || null
}
