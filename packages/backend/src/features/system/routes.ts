import { createJsonResponse } from '../../shared/http'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

function findRepoRoot(startDir: string): string | null {
  let current = startDir
  while (true) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function getGitBranch(cwd: string): string | null {
  try {
    const output = execFileSync('git', ['branch', '--show-current'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })
      .trim()
    return output || null
  } catch {
    return null
  }
}

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
    const fileDir = dirname(fileURLToPath(import.meta.url))
    const repoRoot = findRepoRoot(fileDir) ?? findRepoRoot(process.cwd()) ?? process.cwd()
    return createJsonResponse({
      permissionMode: 'per-tool',
      approvedTools: [],
      pendingTools: [],
      model: 'claude-3-5-sonnet-20241022',
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      cwd: repoRoot,
      gitBranch: getGitBranch(repoRoot),
      connected: true,
    })
  }

  return null
}
