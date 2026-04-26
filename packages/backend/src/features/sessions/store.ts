import { readdir, readFile, writeFile, rm, stat } from 'fs/promises'
import { join } from 'path'
import * as os from 'os'
import type { Session, SessionMessage, SessionStatus } from '../../../../contracts/src/index'
import { listSessionsImpl, type SessionInfo } from '../../../../../src/utils/listSessionsImpl'

const HOME_DIR = process.env.HOME ?? os.homedir()
const SESSION_REGISTRY_DIR = join(HOME_DIR, '.claude', 'sessions')
const PROJECTS_DIR = join(HOME_DIR, '.claude', 'projects')

interface LiveSessionEntry {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  kind: string
  name?: string
  logPath?: string
  agent?: string
}

function extractEntryText(entry: Record<string, unknown>): string {
  const direct = [
    typeof entry.message === 'string' ? entry.message : '',
    typeof entry.content === 'string' ? entry.content : '',
    typeof entry.text === 'string' ? entry.text : '',
  ]
    .map((s) => s.trim())
    .find(Boolean)
  if (direct) return direct

  const message = entry.message as Record<string, unknown> | undefined
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  const texts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const obj = block as Record<string, unknown>
    if (obj.type === 'text' && typeof obj.text === 'string') {
      const text = obj.text.trim()
      if (text) texts.push(text)
    }
  }
  return texts.join('\n').trim()
}

function sessionEntryToSession(entry: LiveSessionEntry): Session {
  return {
    id: entry.sessionId,
    title: entry.name || entry.sessionId.slice(0, 8),
    description: entry.cwd,
    status: 'active' as SessionStatus,
    cwd: entry.cwd,
    lastMessageAt: new Date(entry.startedAt).toISOString(),
    createdAt: new Date(entry.startedAt).toISOString(),
  }
}

async function loadCliSessionInfoMap(): Promise<Map<string, SessionInfo>> {
  try {
    const infos = await listSessionsImpl()
    return new Map(infos.map((info) => [info.sessionId, info]))
  } catch {
    return new Map()
  }
}

async function loadLiveSessionEntries(): Promise<LiveSessionEntry[]> {
  let entries: string[] = []
  try {
    entries = await readdir(SESSION_REGISTRY_DIR)
  } catch {
    return []
  }

  const liveEntries: LiveSessionEntry[] = []
  for (const file of entries) {
    if (!file.endsWith('.json')) continue
    try {
      const content = await readFile(join(SESSION_REGISTRY_DIR, file), 'utf8')
      liveEntries.push(JSON.parse(content) as LiveSessionEntry)
    } catch {
      // skip invalid entries
    }
  }

  return liveEntries
}

function toIsoFromEpochMs(value?: number): string | undefined {
  if (!value || Number.isNaN(value)) return undefined
  return new Date(value).toISOString()
}

export async function listSessions(): Promise<Session[]> {
  const liveEntries = await loadLiveSessionEntries()
  const liveMap = new Map(liveEntries.map((entry) => [entry.sessionId, entry]))
  const cliInfoMap = await loadCliSessionInfoMap()

  const sessions: Session[] = []
  for (const info of cliInfoMap.values()) {
    const live = liveMap.get(info.sessionId)
    const fallback = live ? sessionEntryToSession(live) : null
    sessions.push({
      id: info.sessionId,
      title: live?.name || info.summary || fallback?.title || info.sessionId.slice(0, 8),
      description: info.cwd || live?.cwd || '',
      status: live ? ('active' as SessionStatus) : ('archived' as SessionStatus),
      cwd: info.cwd || live?.cwd,
      branch: info.gitBranch,
      tag: info.tag,
      lastMessageAt: toIsoFromEpochMs(info.lastModified) || fallback?.lastMessageAt,
      createdAt:
        toIsoFromEpochMs(info.createdAt) ||
        fallback?.createdAt ||
        new Date(info.lastModified).toISOString(),
    })
  }

  const existingIds = new Set(sessions.map((s) => s.id))
  for (const live of liveEntries) {
    if (existingIds.has(live.sessionId)) continue
    sessions.push(sessionEntryToSession(live))
  }

  return sessions.sort((a, b) =>
    (b.lastMessageAt || b.createdAt).localeCompare(a.lastMessageAt || a.createdAt),
  )
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const sessions = await listSessions()
  return sessions.find((session) => session.id === sessionId) ?? null
}

export async function createSession(cwd?: string): Promise<Session> {
  const sessionId = crypto.randomUUID()
  const startedAt = Date.now()
  const entry: LiveSessionEntry = {
    pid: 0,
    sessionId,
    cwd: cwd ?? process.cwd(),
    startedAt,
    kind: 'interactive',
  }
  const pidFile = join(SESSION_REGISTRY_DIR, `0_${sessionId.slice(0, 8)}.json`)
  try {
    await writeFile(pidFile, JSON.stringify(entry), 'utf8')
  } catch {
    // ignore write errors
  }
  return sessionEntryToSession(entry)
}

export async function killSession(sessionId: string): Promise<boolean> {
  let entries: string[] = []
  try {
    entries = await readdir(SESSION_REGISTRY_DIR)
  } catch {
    return false
  }

  for (const file of entries) {
    if (!file.endsWith('.json')) continue
    try {
      const content = await readFile(join(SESSION_REGISTRY_DIR, file), 'utf8')
      const entry: LiveSessionEntry = JSON.parse(content)
      if (entry.sessionId === sessionId) {
        try {
          if (entry.pid > 0) {
            process.kill(entry.pid, 'SIGTERM')
          }
        } catch {
          // process may already be dead
        }
        await rm(join(SESSION_REGISTRY_DIR, file)).catch(() => null)
        return true
      }
    } catch {
      // skip
    }
  }
  return false
}

export async function renameSession(sessionId: string, name: string): Promise<boolean> {
  let entries: string[] = []
  try {
    entries = await readdir(SESSION_REGISTRY_DIR)
  } catch {
    return false
  }

  for (const file of entries) {
    if (!file.endsWith('.json')) continue
    const filePath = join(SESSION_REGISTRY_DIR, file)
    try {
      const content = await readFile(filePath, 'utf8')
      const entry: LiveSessionEntry = JSON.parse(content)
      if (entry.sessionId === sessionId) {
        entry.name = name
        await writeFile(filePath, JSON.stringify(entry), 'utf8')
        return true
      }
    } catch {
      // skip
    }
  }
  return false
}

export async function getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  let projectDirs: string[] = []
  try {
    projectDirs = await readdir(PROJECTS_DIR)
  } catch {
    return []
  }

  for (const dir of projectDirs) {
    const transcriptPath = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`)
    try {
      const content = await readFile(transcriptPath, 'utf8')
      const lines = content.split('\n').filter((l) => l.trim())
      const messages: SessionMessage[] = []
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>
          // Extract role from entry type marker
          const role = entry.type === 'user' ? 'user'
            : entry.type === 'assistant' ? 'assistant'
            : entry.type === 'system' ? 'system'
            : null
          if (!role) continue
          const content = extractEntryText(entry)
          if (!content) continue
          const timestamp = typeof entry.timestamp === 'string'
            ? entry.timestamp
            : new Date().toISOString()
          messages.push({
            role,
            content,
            timestamp,
          })
        } catch {
          // skip malformed lines
        }
      }
      return messages
    } catch {
      // try next project dir
    }
  }
  return []
}

export async function getSessionMessageCount(sessionId: string): Promise<number> {
  let projectDirs: string[] = []
  try {
    projectDirs = await readdir(PROJECTS_DIR)
  } catch {
    return 0
  }

  for (const dir of projectDirs) {
    const transcriptPath = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`)
    try {
      const { size } = await stat(transcriptPath)
      return size
    } catch {
      // try next
    }
  }
  return 0
}