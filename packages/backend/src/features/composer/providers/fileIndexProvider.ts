import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const REFRESH_THROTTLE_MS = 5_000
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.idea', '.vscode'])

type WorkspaceCache = {
  trackedFiles: string[]
  untrackedFiles: string[]
  mergedFiles: string[]
  mergedSignature: string
  lastRefreshTime: number
  generation: number
  isPartial: boolean
  refreshPromise: Promise<void> | null
  gitIndexMtimeMs: number | null
}

const workspaceCache = new Map<string, WorkspaceCache>()

function getState(rootDir: string): WorkspaceCache {
  const existing = workspaceCache.get(rootDir)
  if (existing) return existing
  const state: WorkspaceCache = {
    trackedFiles: [],
    untrackedFiles: [],
    mergedFiles: [],
    mergedSignature: '',
    lastRefreshTime: 0,
    generation: 0,
    isPartial: true,
    refreshPromise: null,
    gitIndexMtimeMs: null,
  }
  workspaceCache.set(rootDir, state)
  return state
}

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
  return {
    tracked: trackedRun.stdout.split('\n').filter(Boolean),
    untracked: untrackedRun.stdout.split('\n').filter(Boolean),
  }
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
  const state = getState(rootDir)
  const now = Date.now()
  const nextGitIndexMtime = await getGitIndexMtime(rootDir)
  const throttleHit = now - state.lastRefreshTime < REFRESH_THROTTLE_MS
  const gitUnchanged = nextGitIndexMtime !== null && state.gitIndexMtimeMs !== null && nextGitIndexMtime === state.gitIndexMtimeMs
  if (state.mergedFiles.length > 0 && throttleHit && gitUnchanged) return

  state.lastRefreshTime = now
  state.gitIndexMtimeMs = nextGitIndexMtime
  state.isPartial = true

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

  state.trackedFiles = dedupeAndNormalize(tracked)
  state.untrackedFiles = dedupeAndNormalize(untracked)
  const merged = dedupeAndNormalize([...state.trackedFiles, ...state.untrackedFiles]).sort((a, b) => a.localeCompare(b))
  const signature = hashSignature(merged)
  if (signature !== state.mergedSignature) {
    state.mergedSignature = signature
    state.mergedFiles = merged
    state.generation += 1
  }
  state.isPartial = false
}

export async function getFileIndex(rootDir: string): Promise<{ mergedFiles: string[]; generation: number; isPartial: boolean }> {
  const state = getState(rootDir)
  if (state.refreshPromise) {
    await state.refreshPromise
  } else {
    state.refreshPromise = refreshCaches(rootDir)
    try {
      await state.refreshPromise
    } finally {
      state.refreshPromise = null
    }
  }
  return {
    mergedFiles: state.mergedFiles,
    generation: state.generation,
    isPartial: state.isPartial,
  }
}
