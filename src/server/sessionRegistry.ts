// src/server/sessionRegistry.ts
// PID file registry for session persistence

import { readdir, readFile, writeFile, rm, mkdir } from 'fs/promises'
import { join } from 'path'
import * as os from 'os'

const HOME_DIR = process.env.HOME ?? os.homedir()
const SESSION_REGISTRY_DIR = join(HOME_DIR, '.claude', 'sessions')

export interface LiveSessionEntry {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  kind: string
  name?: string
}

async function ensureRegistryDir(): Promise<void> {
  try {
    await mkdir(SESSION_REGISTRY_DIR, { recursive: true })
  } catch {
    // ignore
  }
}

export async function registerSession(entry: LiveSessionEntry): Promise<void> {
  await ensureRegistryDir()
  await unregisterSession(entry.sessionId)
  const pidFile = join(SESSION_REGISTRY_DIR, `${entry.pid}_${entry.sessionId.slice(0, 8)}.json`)
  await writeFile(pidFile, JSON.stringify(entry), 'utf8')
}

export async function unregisterSession(sessionId: string): Promise<void> {
  let entries: string[] = []
  try {
    entries = await readdir(SESSION_REGISTRY_DIR)
  } catch {
    return
  }

  for (const file of entries) {
    if (!file.endsWith('.json')) continue
    try {
      const content = await readFile(join(SESSION_REGISTRY_DIR, file), 'utf8')
      const entry: LiveSessionEntry = JSON.parse(content)
      if (entry.sessionId === sessionId) {
        await rm(join(SESSION_REGISTRY_DIR, file)).catch(() => null)
      }
    } catch {
      // skip
    }
  }
}

export async function updateSessionName(
  sessionId: string,
  name: string,
): Promise<void> {
  let entries: string[] = []
  try {
    entries = await readdir(SESSION_REGISTRY_DIR)
  } catch {
    return
  }

  await Promise.all(
    entries
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => {
        const filePath = join(SESSION_REGISTRY_DIR, file)
        try {
          const content = await readFile(filePath, 'utf8')
          const entry = JSON.parse(content) as LiveSessionEntry
          if (entry.sessionId !== sessionId) return
          entry.name = name
          await writeFile(filePath, JSON.stringify(entry), 'utf8')
        } catch {
          // skip malformed or deleted files
        }
      }),
  )
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function listLiveSessions(): Promise<LiveSessionEntry[]> {
  let entries: string[] = []
  try {
    entries = await readdir(SESSION_REGISTRY_DIR)
  } catch {
    return []
  }

  const liveEntries = new Map<string, LiveSessionEntry>()
  const staleFiles: string[] = []

  for (const file of entries) {
    if (!file.endsWith('.json')) continue
    const filePath = join(SESSION_REGISTRY_DIR, file)

    try {
      const content = await readFile(filePath, 'utf8')
      const entry = JSON.parse(content) as LiveSessionEntry

      if (!isProcessAlive(entry.pid)) {
        staleFiles.push(filePath)
        continue
      }

      const existing = liveEntries.get(entry.sessionId)
      if (!existing || entry.startedAt >= existing.startedAt) {
        if (existing) {
          staleFiles.push(
            join(
              SESSION_REGISTRY_DIR,
              `${existing.pid}_${existing.sessionId.slice(0, 8)}.json`,
            ),
          )
        }
        liveEntries.set(entry.sessionId, entry)
      } else {
        staleFiles.push(filePath)
      }
    } catch {
      // skip
    }
  }

  await Promise.all(staleFiles.map((filePath) => rm(filePath).catch(() => null)))

  return Array.from(liveEntries.values()).sort(
    (a, b) => b.startedAt - a.startedAt,
  )
}
