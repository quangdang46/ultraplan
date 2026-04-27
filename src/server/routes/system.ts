// src/server/routes/system.ts
// System info routes (tools, state)

import { getTools } from '../../tools.js'
import { getCwd } from '../../utils/cwd.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { jsonResponse, corsResponse } from '../utils.js'

export async function systemRoutes(req: Request, path: string, allowedOrigin: string): Promise<Response> {
  if (req.method === 'OPTIONS') return corsResponse(allowedOrigin)

  // GET /api/tools
  if (path === '/api/tools' && req.method === 'GET') {
    const ctx = getEmptyToolPermissionContext()
    const tools = getTools(ctx)
    return jsonResponse({
      tools: tools.map((t) => ({
        name: t.name ?? t.constructor?.name ?? 'Unknown',
        description: t.description ?? '',
        category: 'general',
      })),
    })
  }

  // GET /api/state
  if (path === '/api/state' && req.method === 'GET') {
    return jsonResponse({
      permissionMode: 'auto',
      approvedTools: [],
      pendingTools: [],
      model: 'claude-sonnet-4-7',
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      cwd: getCwd(),
      connected: true,
    })
  }

  return jsonResponse({ error: 'NOT_FOUND' }, 404)
}
