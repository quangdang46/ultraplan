import { appendFile, mkdir, readdir, readFile, stat } from 'fs/promises'
import * as os from 'os'
import { dirname, join } from 'path'
import type { SessionMessage } from '../../packages/contracts/src/index.js'
import { getProjectDir } from '../utils/sessionStoragePortable.js'

const HOME_DIR = process.env.HOME ?? os.homedir()
const PROJECTS_DIR = join(HOME_DIR, '.claude', 'projects')

export async function resolveTranscriptPath(
  sessionId: string,
  cwd?: string,
): Promise<string | null> {
  const existingPath = await findExistingTranscriptPath(sessionId, cwd)
  if (existingPath) return existingPath

  if (cwd) {
    return join(getProjectDir(cwd), `${sessionId}.jsonl`)
  }

  return null
}

export async function findExistingTranscriptPath(
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

  return null
}

export async function appendSessionCustomTitle(
  sessionId: string,
  name: string,
  cwd?: string,
): Promise<boolean> {
  const transcriptPath = await resolveTranscriptPath(sessionId, cwd)
  if (!transcriptPath) return false

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

  return true
}

export async function loadTranscriptMessages(
  sessionId: string,
  cwd?: string,
): Promise<SessionMessage[]> {
  const transcriptPath = await resolveTranscriptPath(sessionId, cwd)
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

function extractText(entry: Record<string, unknown>): string | null {
  const direct = typeof entry.message === 'string'
    ? entry.message
    : typeof entry.content === 'string'
      ? entry.content
      : typeof entry.text === 'string'
        ? entry.text
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
