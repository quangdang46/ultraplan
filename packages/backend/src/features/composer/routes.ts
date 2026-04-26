import { createJsonResponse } from '../../shared/http'

function resolveWorkspaceRoot(url: URL): string {
  const cwdParam = url.searchParams.get('cwd')
  return cwdParam && cwdParam.startsWith('/') ? cwdParam : process.cwd()
}

export async function handleComposerRoute(req: Request, path: string, url: URL): Promise<Response | null> {
  if (req.method === 'GET' && path === '/api/suggest/files') {
    const query = url.searchParams.get('q') ?? ''
    const { suggestFiles } = await import('../../composerService.js')
    const result = await suggestFiles(query, resolveWorkspaceRoot(url))
    return createJsonResponse(result)
  }

  if (req.method === 'GET' && path === '/api/suggest/commands') {
    const query = url.searchParams.get('q') ?? ''
    const { suggestCommands } = await import('../../composerService.js')
    const items = await suggestCommands(query, resolveWorkspaceRoot(url))
    return createJsonResponse({ items })
  }

  if (req.method === 'POST' && path === '/api/command/execute') {
    const body = (await req.json().catch(() => null)) as { command?: string } | null
    if (!body?.command?.trim()) {
      return createJsonResponse({ success: false, error: 'INVALID_INPUT', message: 'command is required' }, 400)
    }
    const { executeSlashCommand } = await import('../../composerService.js')
    const result = await executeSlashCommand(body.command, resolveWorkspaceRoot(url))
    return createJsonResponse(result)
  }

  return null
}
