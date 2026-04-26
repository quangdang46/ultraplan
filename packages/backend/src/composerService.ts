import { execFile } from 'node:child_process'
import { stat, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

type SuggestionType = 'file' | 'directory' | 'agent' | 'mcp-resource' | 'command'
type FileSuggestion = {
  id: string
  displayText: string
  insertText: string
  type: SuggestionType
  tag?: string
  description?: string
  score?: number
}
type CommandSuggestion = { name: string; description: string; argumentHint?: string }
type SuggestFilesResult = {
  items: FileSuggestion[]
  isPartial: boolean
  generation: number
  capApplied: boolean
  diagnostics?: {
    totalFiles: number
    totalAgents: number
    totalMcpResources: number
  }
}
type SlashCommandResult = {
  output: string
  clearConversation?: boolean
}

const execFileAsync = promisify(execFile)
const REFRESH_THROTTLE_MS = 5_000
const TOP_LEVEL_CAP = 100
const MAX_FILE_SUGGESTIONS = 15
const MAX_PATH_RESULTS = 10
const MAX_DIR_SCAN = 120
const PATH_MODE_PREFIXES = ['~/', './', '../', '/', '~', '.', '..']

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.idea', '.vscode'])
const COMMAND_CACHE_TTL_MS = 10_000

let trackedFilesCache: string[] = []
let untrackedFilesCache: string[] = []
let mergedFilesCache: string[] = []
let mergedSignature = ''
let lastRefreshTime = 0
let generation = 0
let isPartial = true
let refreshPromise: Promise<void> | null = null
let gitIndexMtimeMs: number | null = null
let commandCache: CommandSuggestion[] = []
let commandCacheTimeMs = 0

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

function dedupeAndNormalize(files: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const file of files) {
    const normalized = normalizePath(file).trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function hashSignature(files: string[]): string {
  return `${files.length}:${files.slice(0, 20).join('|')}:${files.slice(-20).join('|')}`
}

async function getGitIndexMtime(rootDir: string): Promise<number | null> {
  try {
    const s = await stat(join(rootDir, '.git', 'index'))
    return s.mtimeMs
  } catch {
    return null
  }
}

async function getFilesUsingGit(rootDir: string): Promise<{ tracked: string[]; untracked: string[] }> {
  const trackedRun = await execFileAsync('git', ['ls-files', '--recurse-submodules'], { cwd: rootDir, maxBuffer: 32 * 1024 * 1024 })
  const untrackedRun = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: rootDir, maxBuffer: 16 * 1024 * 1024 })
  const tracked = trackedRun.stdout.split('\n').filter(Boolean)
  const untracked = untrackedRun.stdout.split('\n').filter(Boolean)
  return { tracked, untracked }
}

async function walkFilesFallback(rootDir: string, currentDir: string, acc: string[]): Promise<void> {
  if (acc.length >= 30_000) return
  const entries = await readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (acc.length >= 30_000) return
    if (entry.name === '.DS_Store') continue
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue
      await walkFilesFallback(rootDir, join(currentDir, entry.name), acc)
      continue
    }
    if (!entry.isFile()) continue
    acc.push(relative(rootDir, join(currentDir, entry.name)))
  }
}

async function refreshCaches(rootDir: string): Promise<void> {
  const now = Date.now()
  const nextGitIndexMtime = await getGitIndexMtime(rootDir)
  const throttleHit = now - lastRefreshTime < REFRESH_THROTTLE_MS
  const gitUnchanged = nextGitIndexMtime !== null && gitIndexMtimeMs !== null && nextGitIndexMtime === gitIndexMtimeMs
  if (mergedFilesCache.length > 0 && throttleHit && gitUnchanged) return

  lastRefreshTime = now
  gitIndexMtimeMs = nextGitIndexMtime
  isPartial = true

  let tracked: string[] = []
  let untracked: string[] = []
  try {
    const result = await getFilesUsingGit(rootDir)
    tracked = result.tracked
    untracked = result.untracked
  } catch {
    const fallback: string[] = []
    await walkFilesFallback(rootDir, rootDir, fallback)
    tracked = fallback
    untracked = []
  }

  trackedFilesCache = dedupeAndNormalize(tracked)
  untrackedFilesCache = dedupeAndNormalize(untracked)
  const merged = dedupeAndNormalize([...trackedFilesCache, ...untrackedFilesCache]).sort((a, b) => a.localeCompare(b))
  const signature = hashSignature(merged)
  if (signature !== mergedSignature) {
    mergedSignature = signature
    mergedFilesCache = merged
    generation += 1
  }
  isPartial = false
}

async function ensureRefreshed(rootDir: string): Promise<void> {
  if (refreshPromise) {
    await refreshPromise
    return
  }
  refreshPromise = refreshCaches(rootDir)
  try {
    await refreshPromise
  } finally {
    refreshPromise = null
  }
}

function scoreFile(file: string, query: string): number {
  if (!query) return file.split('/').length
  const f = file.toLowerCase()
  const q = query.toLowerCase()
  if (f === q) return 0
  if (f.startsWith(q)) return 5
  if (basename(f).startsWith(q)) return 10
  const idx = f.indexOf(q)
  if (idx >= 0) return 40 + idx
  return 1000
}

function toFileSuggestion(path: string, score?: number): FileSuggestion {
  return {
    id: `file-${path}`,
    displayText: path,
    insertText: path,
    type: 'file',
    tag: 'local',
    description: `${basename(path)} · ${dirname(path)}`,
    score,
  }
}

function toAgentSuggestion(path: string, score?: number): FileSuggestion {
  const agentName = basename(path).replace(/\.md$/i, '')
  return {
    id: `agent-${agentName}`,
    displayText: `@${agentName}`,
    insertText: `@${agentName}`,
    type: 'agent',
    tag: 'agent',
    description: path,
    score,
  }
}

async function parseMcpServersAsync(rootDir: string): Promise<Array<{ name: string; path: string }>> {
  try {
    const mcpPath = join(rootDir, '.mcp.json')
    const content = await Bun.file(mcpPath).text()
    const parsed = JSON.parse(content) as { mcpServers?: Record<string, unknown> }
    const names = Object.keys(parsed.mcpServers ?? {})
    return names.map((name) => ({ name, path: '.mcp.json' }))
  } catch {
    return []
  }
}

function isPathLikeToken(query: string): boolean {
  if (!query) return false
  return PATH_MODE_PREFIXES.some((prefix) => query.startsWith(prefix))
}

function resolvePathToken(token: string, rootDir: string): { dir: string; prefix: string } {
  const expanded = token.startsWith('~/') ? join(process.env.HOME || rootDir, token.slice(2)) : token
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(rootDir, expanded)
  const tokenEndsWithSlash = token.endsWith('/')
  const baseDir = tokenEndsWithSlash ? absolute : dirname(absolute)
  const prefix = tokenEndsWithSlash ? '' : basename(absolute)
  return { dir: baseDir, prefix }
}

async function pathModeSuggestions(token: string, rootDir: string): Promise<FileSuggestion[]> {
  const { dir, prefix } = resolvePathToken(token, rootDir)
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const picked = entries
      .filter((entry) => entry.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .slice(0, MAX_DIR_SCAN)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_PATH_RESULTS)
      .map((entry) => {
        const absolutePath = join(dir, entry.name)
        const relativePathRaw = relative(rootDir, absolutePath)
        const relativePath = normalizePath(relativePathRaw || '.')
        const isDirectory = entry.isDirectory()
        return {
          id: `${isDirectory ? 'dir' : 'file'}-${relativePath}`,
          displayText: relativePath,
          insertText: isDirectory ? `${relativePath}/` : relativePath,
          type: isDirectory ? 'directory' : 'file',
          tag: 'local',
          description: isDirectory ? 'directory' : `${entry.name} · ${dirname(relativePath)}`,
        } satisfies FileSuggestion
      })
    return picked
  } catch {
    return []
  }
}

export async function suggestFiles(query: string, rootDir: string): Promise<SuggestFilesResult> {
  await ensureRefreshed(rootDir)
  const trimmedQuery = query.trim()

  let items: FileSuggestion[]
  let capApplied = false
  let diagnostics: SuggestFilesResult['diagnostics'] | undefined
  if (isPathLikeToken(trimmedQuery)) {
    items = await pathModeSuggestions(trimmedQuery, rootDir)
  } else {
    const scored = mergedFilesCache
      .filter((file) => (trimmedQuery ? file.toLowerCase().includes(trimmedQuery.toLowerCase()) : true))
      .map((file) => ({ file, score: scoreFile(file, trimmedQuery) }))
      .sort((a, b) => a.score - b.score || a.file.localeCompare(b.file))
    const fileItems = (trimmedQuery ? scored.slice(0, TOP_LEVEL_CAP) : scored.slice(0, TOP_LEVEL_CAP)).map(({ file, score }) =>
      toFileSuggestion(file, score),
    )

    const agentItems = mergedFilesCache
      .filter((path) => path.startsWith('.claude/agents/') && path.endsWith('.md'))
      .map((path) => toAgentSuggestion(path, scoreFile(path, trimmedQuery) + 25))
      .filter((item) => (trimmedQuery ? item.displayText.toLowerCase().includes(trimmedQuery.toLowerCase()) : true))

    const mcpResources = await parseMcpServersAsync(rootDir)
    const mcpItems = mcpResources
      .map((resource) => ({
        id: `mcp-resource-${resource.name}`,
        displayText: `${resource.name}:${resource.path}`,
        insertText: `${resource.name}:${resource.path}`,
        type: 'mcp-resource' as const,
        tag: 'mcp',
        description: 'MCP resource',
        score: scoreFile(resource.name, trimmedQuery) + 35,
      }))
      .filter((item) => (trimmedQuery ? item.displayText.toLowerCase().includes(trimmedQuery.toLowerCase()) : true))

    const merged = [...fileItems, ...agentItems, ...mcpItems]
      .sort((a, b) => (a.score ?? 1000) - (b.score ?? 1000) || a.displayText.localeCompare(b.displayText))
    const visibleLimit = trimmedQuery ? MAX_FILE_SUGGESTIONS : merged.length
    capApplied = merged.length > visibleLimit
    items = merged.slice(0, visibleLimit)
    diagnostics = {
      totalFiles: fileItems.length,
      totalAgents: agentItems.length,
      totalMcpResources: mcpItems.length,
    }
  }

  return {
    items,
    isPartial,
    generation,
    capApplied,
    diagnostics,
  }
}

async function loadDynamicCommands(rootDir: string): Promise<CommandSuggestion[]> {
  const now = Date.now()
  if (now - commandCacheTimeMs < COMMAND_CACHE_TTL_MS && commandCache.length > 0) {
    return commandCache
  }

  try {
    const configModule = await import('../../../src/utils/config.js')
    configModule.enableConfigs()
    const commandsModule = await import('../../../src/commands.js')
    const commands = await commandsModule.getCommands(rootDir)
    const map = new Map<string, CommandSuggestion>()
    for (const cmd of commands) {
      if (cmd?.isHidden) continue
      const name = commandsModule.getCommandName(cmd)
      if (!name) continue
      const argumentHint =
        cmd.argumentHint ||
        (cmd.type === 'prompt' && Array.isArray(cmd.argNames) && cmd.argNames.length > 0
          ? cmd.argNames.map((arg: string) => `<${arg}>`).join(' ')
          : undefined)
      if (!map.has(name)) {
        map.set(name, {
          name,
          description: cmd.description ?? '',
          argumentHint,
        })
      }
    }
    commandCache = [...map.values()]
    commandCacheTimeMs = now
    return commandCache
  } catch {
    // No hardcoded fallback: keep CLI source-of-truth only.
    // Return empty when command registry isn't available yet.
    commandCache = []
    commandCacheTimeMs = now
    return []
  }
}

export async function suggestCommands(query: string, rootDir: string): Promise<CommandSuggestion[]> {
  const source = await loadDynamicCommands(rootDir)
  const normalizedQuery = query.trim().toLowerCase()
  const ranked = source
    .filter((command) => {
      if (!normalizedQuery) return true
      return (
        command.name.toLowerCase().includes(normalizedQuery) ||
        command.description.toLowerCase().includes(normalizedQuery)
      )
    })
    .sort((a, b) => {
      const aName = a.name.toLowerCase()
      const bName = b.name.toLowerCase()
      const aExact = aName === normalizedQuery
      const bExact = bName === normalizedQuery
      if (aExact !== bExact) return aExact ? -1 : 1
      const aPrefix = aName.startsWith(normalizedQuery)
      const bPrefix = bName.startsWith(normalizedQuery)
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1
      return aName.localeCompare(bName)
    })

  return ranked
}

export async function executeSlashCommand(input: string, rootDir: string): Promise<SlashCommandResult> {
  const trimmed = input.trim()
  const normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
  const [cmd, ...rest] = normalized.split(/\s+/)
  const command = cmd?.toLowerCase() ?? ''
  const args = rest.join(' ').trim()

  switch (command) {
    case '':
      return { output: 'Please provide a slash command.' }
    case 'help': {
      const dynamic = await suggestCommands('', rootDir)
      const lines = dynamic.map((item) =>
        `/${item.name}${item.argumentHint ? ` ${item.argumentHint}` : ''} — ${item.description}`,
      )
      return { output: lines.join('\n') || 'No commands available.' }
    }
    case 'clear':
      return {
        output: 'Conversation cleared.',
        clearConversation: true,
      }
    case 'model': {
      const model = process.env.ANTHROPIC_MODEL ?? process.env.CLAUDE_CODE_MODEL ?? 'default'
      const extra = args ? `\nargs: ${args}` : ''
      return { output: `Current model: ${model}${extra}` }
    }
    default: {
      const dynamic = await suggestCommands(command, rootDir)
      const exact = dynamic.find((item) => item.name.toLowerCase() === command)
      if (exact) {
        return {
          output: `/${exact.name}${exact.argumentHint ? ` ${exact.argumentHint}` : ''}\n${exact.description}`,
        }
      }
      return {
        output: `Unknown command: /${command}. Try /help.`,
      }
    }
  }
}

