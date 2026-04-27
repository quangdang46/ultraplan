// src/server/routes/suggest.ts
// File/command suggestion routes

import { jsonResponse, corsResponse } from '../utils.js'

export async function suggestRoutes(req: Request, path: string, allowedOrigin: string): Promise<Response> {
  if (req.method === 'OPTIONS') return corsResponse(allowedOrigin)

  const url = new URL(req.url)
  const query = url.searchParams.get('q') ?? ''
  const cwd = url.searchParams.get('cwd') ?? process.cwd()

  // GET /api/suggest/files
  if (path.startsWith('/api/suggest/files') && req.method === 'GET') {
    const { suggestFiles } = await import('../suggest/composerService.js')
    const suggestions = await suggestFiles(query, cwd)
    return jsonResponse(suggestions)
  }

  // GET /api/suggest/commands
  if (path.startsWith('/api/suggest/commands') && req.method === 'GET') {
    const { suggestCommands } = await import('../suggest/composerService.js')
    const suggestions = await suggestCommands(query, cwd)
    return jsonResponse({ items: suggestions })
  }

  // POST /api/command/execute (DEV ONLY)
  if (path === '/api/command/execute' && req.method === 'POST') {
    if (process.env.NODE_ENV === 'production') {
      return jsonResponse({ error: 'ENDPOINT_DISABLED_IN_PRODUCTION' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const { command, args } = body

    if (!command) {
      return jsonResponse({ error: 'COMMAND_REQUIRED' }, 400)
    }

    const { spawn } = await import('child_process')
    const child = spawn(command, Array.isArray(args) ? args : [], {
      cwd: body.cwd ?? process.cwd(),
      shell: false,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (d) => stdout += d.toString())
    child.stderr?.on('data', (d) => stderr += d.toString())

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 1))
    })

    return jsonResponse({ success: exitCode === 0, stdout, stderr, exitCode })
  }

  return jsonResponse({ error: 'NOT_FOUND' }, 404)
}
