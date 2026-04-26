import { createJsonResponse } from '../../shared/http'

export async function handleSystemRoute(req: Request, path: string): Promise<Response | null> {
  if (req.method === 'GET' && path === '/health') {
    return createJsonResponse({ status: 'ok', timestamp: new Date().toISOString() })
  }

  if (req.method === 'GET' && path === '/api/tools') {
    return createJsonResponse({
      tools: [
        { name: 'Bash', description: 'Execute shell commands', category: 'shell' },
        { name: 'Read', description: 'Read file contents', category: 'editor' },
        { name: 'Edit', description: 'Edit file contents', category: 'editor' },
        { name: 'Grep', description: 'Search file contents', category: 'editor' },
      ],
    })
  }

  if (req.method === 'GET' && path === '/api/sessions') {
    return createJsonResponse({ sessions: [], hasMore: false })
  }

  if (req.method === 'GET' && path === '/api/state') {
    return createJsonResponse({
      permissionMode: 'per-tool',
      approvedTools: [],
      pendingTools: [],
      model: 'claude-3-5-sonnet-20241022',
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      cwd: process.cwd(),
      connected: true,
    })
  }

  return null
}
